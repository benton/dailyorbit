import { randomBytes } from 'node:crypto';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import { ConfigService } from '../lib/config-service.ts';
import { setConfigService } from '../lib/config.ts';
import { initializeDatabase } from '../lib/db-init.ts';
import { rebuildAllFtsIndexes } from '../search/fts-index.ts';
import { createConsultant } from '../consultant/repository.ts';
import { chatRoutes } from './routes.ts';
import { getConversationById, listMessages } from './repository.ts';

// Mock getDb to return our in-memory instance
let testDb: DuckDBInstance;

vi.mock('../lib/db.ts', () => ({
  getDb: () => Promise.resolve(testDb),
  setDbPath: () => {},
  getDbPath: () => ':memory:',
}));

// Mock BedrockClient with canned rewrite + stream + title responses
let converseCallCount: number = 0;

vi.mock('../inference/bedrock-client.ts', () => {
  return {
    BedrockClient: class MockBedrockClient {
      async converse() {
        converseCallCount++;
        // First call: rewrite. Second call: auto-title.
        if (converseCallCount % 2 === 1) {
          return {
            $metadata: {},
            output: {
              message: {
                role: 'assistant',
                content: [
                  {
                    text: '[{"text": "Ka-band satellite spectrum allocation"}]',
                  },
                ],
              },
            },
            usage: { inputTokens: 40, outputTokens: 30, totalTokens: 70 },
            stopReason: 'end_turn',
          };
        }
        // Auto-title response
        return {
          $metadata: {},
          output: {
            message: {
              role: 'assistant',
              content: [{ text: 'Ka-band Spectrum Discussion' }],
            },
          },
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          stopReason: 'end_turn',
        };
      }

      async *converseStream(): AsyncGenerator<ConverseStreamOutput> {
        yield {
          messageStart: { role: 'assistant' },
        } as ConverseStreamOutput;
        yield {
          contentBlockDelta: {
            delta: {
              text: 'Ka-band spectrum was allocated for satellite operations. ',
            },
            contentBlockIndex: 0,
          },
        } as ConverseStreamOutput;
        yield {
          contentBlockDelta: {
            delta: {
              text: 'This allows broadband service [Source 1].',
            },
            contentBlockIndex: 0,
          },
        } as ConverseStreamOutput;
        yield {
          contentBlockStop: { contentBlockIndex: 0 },
        } as ConverseStreamOutput;
        yield {
          messageStop: { stopReason: 'end_turn' },
        } as ConverseStreamOutput;
        yield {
          metadata: {
            usage: { inputTokens: 200, outputTokens: 45, totalTokens: 245 },
            metrics: { latencyMs: 800 },
          },
        } as ConverseStreamOutput;
      }
    },
  };
});

vi.mock('../inference/embedding-service.ts', () => ({
  EmbeddingService: class MockEmbeddingService {
    constructor() {
      throw new Error('No embedding service in e2e test');
    }
  },
}));

const TEST_KEY: Buffer = randomBytes(32);
const TEST_USER_ID: string = 'test-user-123';
let consultantId: number;

/** Build a test app that injects a fake user into context. */
function buildTestApp(): Hono {
  const app = new Hono();
  // Inject fake user for auth
  app.use('*', async (c, next) => {
    c.set('user', {
      id: TEST_USER_ID,
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    });
    await next();
  });
  app.route('/api/conversations', chatRoutes);
  return app;
}

/** Parse SSE text into individual events. */
function parseSSEEvents(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const lines: string[] = text.split('\n');
  let currentData: string = '';

  for (const line of lines) {
    if (line.startsWith('data:')) {
      currentData = line.slice(5).trim();
    } else if (line === '' && currentData !== '') {
      try {
        events.push(JSON.parse(currentData) as Record<string, unknown>);
      } catch {
        // skip
      }
      currentData = '';
    }
  }
  if (currentData !== '') {
    try {
      events.push(JSON.parse(currentData) as Record<string, unknown>);
    } catch {
      // skip
    }
  }

  return events;
}

beforeEach(async () => {
  converseCallCount = 0;
  testDb = await DuckDBInstance.create(':memory:');
  await initializeDatabase(testDb);

  const service = new ConfigService(testDb, TEST_KEY);
  await service.seedDefaults();
  setConfigService(service);

  const conn: DuckDBConnection = await DuckDBConnection.create(testDb);
  try {
    // Create filing tables for retrieval
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        file_number VARCHAR PRIMARY KEY,
        filing_key INTEGER,
        callsign VARCHAR,
        address_attention VARCHAR,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        status_code VARCHAR,
        date_filed DATE,
        company_id UUID,
        description VARCHAR,
        brief_description VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER PRIMARY KEY,
        file_number VARCHAR,
        filing_key INTEGER,
        full_text VARCHAR,
        summary VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS pleading (
        pleading_key INTEGER PRIMARY KEY,
        filing_key INTEGER,
        filer_name VARCHAR,
        exhibit_attachment_html VARCHAR
      )
    `);

    // Seed filing
    await conn.run(`INSERT INTO filing VALUES (
      'SAT-LOA-20240101-00001', 1, 'SATX1', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2024-01-01', NULL,
      'Request for satellite frequency allocation in Ka-band', 'Ka-band satellite'
    )`);

    // Seed news
    await conn.run(`
      INSERT INTO news_source (id, name, feed_url, category) VALUES
        (1, 'SpaceNews', 'https://spacenews.com/feed/', 'industry')
    `);
    await conn.run(`
      INSERT INTO news_item (id, news_source_id, source_url, title, full_text, extract_status) VALUES
        (1, 1, 'https://spacenews.com/ka-band-ruling',
         'FCC issues new Ka-band spectrum allocation ruling',
         'The FCC issued a ruling on Ka-band spectrum allocation for satellite operators.',
         'extracted')
    `);

    // Seed consultant
    const consultant = await createConsultant(conn, {
      name: 'General Analyst',
      slug: 'general-analyst',
      description: 'Balanced FCC filing Q&A',
      systemPrompt: 'You are a general analyst.',
      modelId: null,
      temperature: null,
      maxResponseTokens: null,
      icon: '🔍',
      color: '#3B82F6',
      sortOrder: 0,
      enabled: true,
    });
    consultantId = consultant.id;

    await rebuildAllFtsIndexes(conn);
  } finally {
    conn.closeSync();
  }
});

afterEach(() => {
  testDb.closeSync();
});

describe('Chat E2E', () => {
  it('creates a conversation, sends a message, and streams a complete response', async () => {
    const app = buildTestApp();

    // 1. Create conversation
    const createResp = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consultantId }),
    });
    expect(createResp.status).toEqual(201);
    const conversation = (await createResp.json()) as Record<string, unknown>;
    const conversationId: string = conversation.id as string;
    expect(conversationId).toBeTruthy();

    // 2. Send message and read SSE stream
    const msgResp = await app.request(
      `/api/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'What Ka-band allocations exist?',
        }),
      },
    );
    expect(msgResp.status).toEqual(200);
    expect(msgResp.headers.get('content-type')).toContain('text/event-stream');

    const text: string = await msgResp.text();
    const events = parseSSEEvents(text);
    const types: string[] = events.map((e) => e.type as string);

    // 3. Status events arrive in order
    const statusEvents = events.filter((e) => e.type === 'status');
    const stages: string[] = statusEvents.map((e) => e.stage as string);
    expect(stages).toEqual(['rewriting', 'retrieving', 'generating']);

    // 4. Sources event is emitted
    const sourcesEvent = events.find((e) => e.type === 'sources');
    expect(sourcesEvent).toBeDefined();

    // 5. Delta events accumulate into an answer
    const deltaEvents = events.filter((e) => e.type === 'delta');
    expect(deltaEvents.length).toBeGreaterThan(0);
    const fullAnswer: string = deltaEvents
      .map((e) => e.text as string)
      .join('');
    expect(fullAnswer).toContain('Ka-band spectrum');

    // 6. Usage event has token counts
    const usageEvent = events.find((e) => e.type === 'usage') as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(usageEvent).toBeDefined();
    const usage = usageEvent!.usage!;
    const genTokens = usage.generateTokens as Record<string, number>;
    expect(genTokens.input).toBeGreaterThan(0);
    expect(genTokens.output).toBeGreaterThan(0);

    // 7. Title is auto-generated on first exchange
    const titleEvent = events.find((e) => e.type === 'title');
    expect(titleEvent).toBeDefined();
    expect((titleEvent as Record<string, string>).title).toEqual(
      'Ka-band Spectrum Discussion',
    );

    // 8. Done event terminates the stream
    expect(types[types.length - 1]).toEqual('done');

    // 9. Verify persistence: messages saved in DB
    const conn: DuckDBConnection = await DuckDBConnection.create(testDb);
    try {
      const messages = await listMessages(conn, conversationId);
      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toEqual('user');
      expect(messages[0]!.content).toEqual('What Ka-band allocations exist?');
      expect(messages[1]!.role).toEqual('assistant');
      expect(messages[1]!.content).toContain('Ka-band spectrum');
      expect(messages[1]!.sources).toBeTruthy();

      // 10. Conversation totals updated
      const conv = await getConversationById(conn, conversationId);
      expect(conv!.totalInputTokens).toBeGreaterThan(0);
      expect(conv!.totalOutputTokens).toBeGreaterThan(0);

      // 11. Title persisted
      expect(conv!.title).toEqual('Ka-band Spectrum Discussion');
    } finally {
      conn.closeSync();
    }
  });

  it('returns 404 for message to non-existent conversation', async () => {
    const app = buildTestApp();
    const resp = await app.request(
      '/api/conversations/non-existent-id/messages',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' }),
      },
    );
    expect(resp.status).toEqual(404);
  });

  it('returns 400 for empty message content', async () => {
    const app = buildTestApp();

    const createResp = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consultantId }),
    });
    const conversation = (await createResp.json()) as Record<string, unknown>;
    const conversationId: string = conversation.id as string;

    const resp = await app.request(
      `/api/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '   ' }),
      },
    );
    expect(resp.status).toEqual(400);
  });
});
