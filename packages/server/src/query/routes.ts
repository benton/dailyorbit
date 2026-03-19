import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getDb } from '../lib/db.ts';
import { getConfigService } from '../lib/config.ts';
import { BedrockClient } from '../inference/bedrock-client.ts';
import { EmbeddingService } from '../inference/embedding-service.ts';
import type { EmbeddingContext } from '../search/content-search.ts';
import { rewriteQuery } from './rewrite.ts';
import { retrieveContext } from './retrieve.ts';
import { generateAnswer } from './generate.ts';
import type { QuerySSEEvent } from './types.ts';

export const queryRoutes = new Hono();

/** Build an EmbeddingContext from app config. */
function getEmbeddingContext(region: string): EmbeddingContext | undefined {
  try {
    const config = getConfigService();
    const modelId: string =
      (config.get('embeddingModel') as string) ||
      'amazon.titan-embed-text-v2:0';
    const dimensions: number =
      parseInt(config.get('embeddingDimensions') as string, 10) || 512;
    const normalize: boolean =
      (config.get('embeddingNormalize') as string) !== 'false';

    const client = new BedrockClient(region);
    const service = new EmbeddingService(client);
    return { service, modelId, dimensions, normalize };
  } catch {
    return undefined;
  }
}

// POST /
queryRoutes.post('/', async (c) => {
  const body = await c.req.json<{ question: string }>();
  const question: string = body.question?.trim() ?? '';

  if (question === '') {
    return c.json({ error: 'Question is required' }, 400);
  }

  const config = getConfigService();

  const maxLen: number =
    parseInt(config.get('queryMaxQuestionLength') as string, 10) || 1024;
  if (question.length > maxLen) {
    return c.json(
      { error: `Question exceeds maximum length of ${maxLen} characters` },
      400,
    );
  }

  const rewriteModelId: string =
    (config.get('queryRewriteModel') as string) || 'us.amazon.nova-micro-v1:0';
  const generateModelId: string =
    (config.get('queryGenerateModel') as string) || 'us.amazon.nova-pro-v1:0';
  const region: string = (config.get('bedrockRegion') as string) || 'us-east-2';

  const client = new BedrockClient(region);
  const embeddingCtx: EmbeddingContext | undefined =
    getEmbeddingContext(region);

  return streamSSE(c, async (stream) => {
    const startMs: number = performance.now();
    let eventId: number = 0;

    const emit = async (event: QuerySSEEvent): Promise<void> => {
      await stream.writeSSE({
        id: String(eventId++),
        data: JSON.stringify(event),
      });
    };

    try {
      // 1. Rewrite
      await emit({
        type: 'status',
        stage: 'rewriting',
        message: 'Analyzing your question...',
      });
      const { queries, usage: rewriteUsage } = await rewriteQuery(
        question,
        client,
        rewriteModelId,
      );

      // 2. Retrieve
      await emit({
        type: 'status',
        stage: 'retrieving',
        message: `Searching ${queries.length} ${queries.length === 1 ? 'query' : 'queries'} across filings...`,
      });

      const db = await getDb();
      const conn: DuckDBConnection = await DuckDBConnection.create(db);
      let retrievalMs: number = 0;
      try {
        const retrieval = await retrieveContext(queries, conn, embeddingCtx);
        retrievalMs = retrieval.retrievalMs;
        await emit({ type: 'sources', sources: retrieval.sources });

        // 3. Generate (streaming)
        await emit({
          type: 'status',
          stage: 'generating',
          message: 'Generating answer...',
        });

        let generateInputTokens: number = 0;
        let generateOutputTokens: number = 0;

        const gen = generateAnswer(
          question,
          retrieval.sources,
          client,
          generateModelId,
        );
        let result = await gen.next();
        while (!result.done) {
          await emit(result.value);
          result = await gen.next();
        }
        // Generator return value has token counts
        if (result.value != null) {
          generateInputTokens = result.value.inputTokens;
          generateOutputTokens = result.value.outputTokens;
        }

        // 4. Usage + done
        const totalMs: number = Math.round(performance.now() - startMs);
        await emit({
          type: 'usage',
          usage: {
            rewriteTokens: rewriteUsage,
            generateTokens: {
              input: generateInputTokens,
              output: generateOutputTokens,
            },
            retrievalMs,
            totalMs,
          },
        });
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
