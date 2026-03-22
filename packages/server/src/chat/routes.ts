import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getDb } from '../lib/db.ts';
import { getConfigService } from '../lib/config.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import { BedrockClient } from '../inference/bedrock-client.ts';
import { InstrumentedBedrockClient } from '../inference/instrumented-client.ts';
import { EmbeddingService } from '../inference/embedding-service.ts';
import type { EmbeddingContext } from '../search/content-search.ts';
import { rewriteQuery } from '../query/rewrite.ts';
import { retrieveContext } from '../query/retrieve.ts';
import { getConsultantById } from '../consultant/repository.ts';
import { listConsultants } from '../consultant/repository.ts';
import { buildTeamPreamble } from './team-preamble.ts';
import { generateChatAnswer } from './generate-chat.ts';
import { generateTitle } from './auto-title.ts';
import { computeCost } from '../inference/pricing.ts';
import {
  createConversation,
  getConversationById,
  listConversations,
  updateConversationTitle,
  deleteConversation,
  createMessage,
  listMessages,
  getNextSequence,
  updateConversationTotals,
} from './repository.ts';
import type { ChatSSEEvent, Message } from './types.ts';

// ── Helpers ─────────────────────────────────────────────────────────

async function withConn<T>(
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}

function getEmbeddingContext(
  region: string,
  logConn: DuckDBConnection | null,
): EmbeddingContext | undefined {
  try {
    const config = getConfigService();
    const modelId: string =
      (config.get('embeddingModel') as string) ||
      'amazon.titan-embed-text-v2:0';
    const dimensions: number =
      parseInt(config.get('embeddingDimensions') as string, 10) || 512;
    const normalize: boolean =
      (config.get('embeddingNormalize') as string) !== 'false';

    const raw = new BedrockClient(region);
    const client = new InstrumentedBedrockClient(raw, logConn, 'chat');
    const service = new EmbeddingService(client);
    return { service, modelId, dimensions, normalize };
  } catch {
    return undefined;
  }
}

// ── Chat routes (mounted at /api/conversations) ─────────────────────

export const chatRoutes = new Hono();

// GET / — list user's conversations
chatRoutes.get('/', async (c) => {
  const userId: string = c.get('user').id;
  const conversations = await withConn((conn) =>
    listConversations(conn, userId),
  );
  return c.json(conversations);
});

// POST / — create conversation
chatRoutes.post('/', async (c) => {
  const userId: string = c.get('user').id;
  const body = await c.req.json<{ consultantId: number }>();
  const consultantId: number = body.consultantId;

  if (consultantId == null) {
    return c.json({ error: 'consultantId is required' }, 400);
  }

  const conversation = await withConn(async (conn) => {
    const consultant = await getConsultantById(conn, consultantId);
    if (
      consultant == null ||
      !consultant.enabled ||
      consultant.archivedAt != null
    ) {
      return null;
    }
    return createConversation(conn, { userId, consultantId });
  });

  if (conversation == null) {
    return c.json({ error: 'Consultant not found or disabled' }, 400);
  }
  return c.json(conversation, 201);
});

// GET /:id — get conversation with messages
chatRoutes.get('/:id', async (c) => {
  const userId: string = c.get('user').id;
  const id: string = c.req.param('id');

  const result = await withConn(async (conn) => {
    const conversation = await getConversationById(conn, id);
    if (conversation == null || conversation.userId !== userId) return null;
    const messages = await listMessages(conn, id);
    return { ...conversation, messages };
  });

  if (result == null) return c.json({ error: 'Conversation not found' }, 404);
  return c.json(result);
});

// PUT /:id — rename conversation
chatRoutes.put('/:id', async (c) => {
  const userId: string = c.get('user').id;
  const id: string = c.req.param('id');
  const body = await c.req.json<{ title: string }>();

  const updated = await withConn(async (conn) => {
    const conversation = await getConversationById(conn, id);
    if (conversation == null || conversation.userId !== userId) return null;
    return updateConversationTitle(conn, id, body.title);
  });

  if (updated == null) return c.json({ error: 'Conversation not found' }, 404);
  return c.json(updated);
});

// DELETE /:id — delete conversation
chatRoutes.delete('/:id', async (c) => {
  const userId: string = c.get('user').id;
  const id: string = c.req.param('id');

  const deleted = await withConn(async (conn) => {
    const conversation = await getConversationById(conn, id);
    if (conversation == null || conversation.userId !== userId) return false;
    return deleteConversation(conn, id);
  });

  if (!deleted) return c.json({ error: 'Conversation not found' }, 404);
  return c.json({ ok: true });
});

// POST /:id/messages — send message, stream response
chatRoutes.post('/:id/messages', async (c) => {
  const userId: string = c.get('user').id;
  const conversationId: string = c.req.param('id');
  const body = await c.req.json<{ content: string }>();
  const content: string = body.content?.trim() ?? '';
  if (content === '') return c.json({ error: 'Content is required' }, 400);

  // Verify conversation exists and belongs to user
  const conversation = await withConn(async (conn) => {
    const conv = await getConversationById(conn, conversationId);
    if (conv == null || conv.userId !== userId) return null;
    return conv;
  });
  if (conversation == null) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  const config = getConfigService();
  const rewriteModelId: string =
    (config.get('queryRewriteModel') as string) || 'us.amazon.nova-micro-v1:0';
  const generateModelId: string =
    (config.get('queryGenerateModel') as string) || 'us.amazon.nova-pro-v1:0';
  const region: string = (config.get('bedrockRegion') as string) || 'us-east-2';
  const rewriteSystemPrompt: string =
    (config.get('queryRewriteSystemPrompt') as string) || '';

  const raw = new BedrockClient(region);
  const client = new InstrumentedBedrockClient(raw, null, 'chat');
  const embeddingCtx: EmbeddingContext | undefined = getEmbeddingContext(
    region,
    null,
  );

  return streamSSE(c, async (stream) => {
    const startMs: number = performance.now();
    let eventId: number = 0;

    const emit = async (event: ChatSSEEvent): Promise<void> => {
      await stream.writeSSE({
        id: String(eventId++),
        data: JSON.stringify(event),
      });
    };

    try {
      const db = await getDb();
      const conn: DuckDBConnection = await DuckDBConnection.create(db);
      trackConnection(conn);
      // Set logging connection on instrumented clients
      client.setConnection(conn);
      try {
        // 1. Persist user message
        const seq: number = await getNextSequence(conn, conversationId);
        await createMessage(conn, {
          conversationId,
          role: 'user',
          content,
          sequence: seq,
        });

        // 2. Load history + consultant + team
        const history: Message[] = await listMessages(conn, conversationId);
        const consultant = await getConsultantById(
          conn,
          conversation.consultantId,
        );
        if (consultant == null) {
          await emit({ type: 'error', message: 'Consultant not found' });
          return;
        }
        const allConsultants = await listConsultants(conn, {
          enabledOnly: true,
        });
        const teamPreamble: string = buildTeamPreamble(
          consultant.name,
          allConsultants,
        );

        // 3. Rewrite
        await emit({
          type: 'status',
          stage: 'rewriting',
          message: 'Analyzing your question...',
        });
        const { queries, usage: rewriteUsage } = await rewriteQuery(
          content,
          client,
          rewriteModelId,
          rewriteSystemPrompt || undefined,
        );

        // 4. Retrieve
        await emit({
          type: 'status',
          stage: 'retrieving',
          message: `Searching ${queries.length} ${queries.length === 1 ? 'query' : 'queries'} across filings...`,
        });
        const retrieval = await retrieveContext(queries, conn, embeddingCtx);
        await emit({ type: 'sources', sources: retrieval.sources });

        // 5. Generate (multi-turn streaming)
        await emit({
          type: 'status',
          stage: 'generating',
          message: 'Generating answer...',
        });
        // Pass history WITHOUT the just-inserted user message (it becomes the RAG-augmented question)
        const priorHistory: Message[] = history.slice(0, -1);

        let answerText: string = '';
        const gen = generateChatAnswer({
          question: content,
          sources: retrieval.sources,
          history: priorHistory,
          consultant,
          teamPreamble,
          client,
          fallbackModelId: generateModelId,
        });
        let result = await gen.next();
        while (!result.done) {
          if (result.value.type === 'delta') answerText += result.value.text;
          await emit(result.value);
          result = await gen.next();
        }
        const genUsage = result.value;
        const activeModelId: string = consultant.modelId ?? generateModelId;

        // 6. Compute costs
        const rewriteCostCents: number = computeCost(
          rewriteModelId,
          rewriteUsage.input,
          rewriteUsage.output,
        );
        const genCostCents: number = computeCost(
          activeModelId,
          genUsage.inputTokens,
          genUsage.outputTokens,
        );
        const totalCostCents: number = rewriteCostCents + genCostCents;

        // 7. Persist assistant message
        const assistantSeq: number = await getNextSequence(
          conn,
          conversationId,
        );
        await createMessage(conn, {
          conversationId,
          role: 'assistant',
          content: answerText,
          sources: retrieval.sources,
          inputTokens: genUsage.inputTokens,
          outputTokens: genUsage.outputTokens,
          costCents: genCostCents,
          modelId: activeModelId,
          consultantId: consultant.id,
          sequence: assistantSeq,
        });

        // 8. Update conversation totals
        await updateConversationTotals(conn, conversationId, {
          inputTokens: rewriteUsage.input + genUsage.inputTokens,
          outputTokens: rewriteUsage.output + genUsage.outputTokens,
          costCents: totalCostCents,
          consultantId: consultant.id,
        });

        // 9. Usage event
        const totalMs: number = Math.round(performance.now() - startMs);
        await emit({
          type: 'usage',
          usage: {
            rewriteTokens: rewriteUsage,
            generateTokens: {
              input: genUsage.inputTokens,
              output: genUsage.outputTokens,
            },
            retrievalMs: retrieval.retrievalMs,
            totalMs,
            costCents: totalCostCents,
          },
        });

        // 9. Auto-title (first exchange only)
        if (assistantSeq === 2 && conversation.title == null) {
          try {
            const title = await generateTitle(
              content,
              answerText,
              client,
              rewriteModelId,
            );
            await updateConversationTitle(conn, conversationId, title);
            await emit({ type: 'title', title });
          } catch {
            // Non-critical — don't fail the stream
          }
        }
      } finally {
        conn.closeSync();
      }

      await emit({ type: 'done' });
    } catch (err: unknown) {
      const message: string =
        err instanceof Error ? err.message : 'An unexpected error occurred';
      await emit({ type: 'error', message });
    }
  });
});
