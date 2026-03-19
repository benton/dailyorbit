import { randomBytes } from 'node:crypto';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import { ConfigService } from '../lib/config-service.ts';
import { setConfigService } from '../lib/config.ts';
import { initializeDatabase } from '../lib/db-init.ts';
import { rebuildAllFtsIndexes } from '../search/fts-index.ts';
import { queryRoutes } from './routes.ts';

// Mock getDb to return our in-memory instance
let testDb: DuckDBInstance;

vi.mock('../lib/db.ts', () => ({
  getDb: () => Promise.resolve(testDb),
  setDbPath: () => {},
  getDbPath: () => ':memory:',
}));

// Mock BedrockClient to avoid real AWS calls
vi.mock('../inference/bedrock-client.ts', () => {
  return {
    BedrockClient: class MockBedrockClient {
      async converse() {
        // Return a rewrite response — single query, valid JSON
        return {
          $metadata: {},
          metrics: { latencyMs: 50 },
          output: {
            message: {
              role: 'assistant',
              content: [
                {
                  text: '[{"text": "Ka-band satellite frequency allocation"}]',
                },
              ],
            },
          },
          usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
          stopReason: 'end_turn',
        };
      }

      async *converseStream(): AsyncGenerator<ConverseStreamOutput> {
        yield {
          messageStart: { role: 'assistant' },
        } as ConverseStreamOutput;
        yield {
          contentBlockDelta: {
            delta: { text: 'Based on the sources, ' },
            contentBlockIndex: 0,
          },
        } as ConverseStreamOutput;
        yield {
          contentBlockDelta: {
            delta: { text: 'Ka-band was allocated.' },
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
            usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
            metrics: { latencyMs: 500 },
          },
        } as ConverseStreamOutput;
      }
    },
  };
});

// Mock EmbeddingService constructor to throw so getEmbeddingContext returns undefined
// (falls back to keyword-only search in tests)
vi.mock('../inference/embedding-service.ts', () => ({
  EmbeddingService: class MockEmbeddingService {
    constructor() {
      throw new Error('No embedding service in test');
    }
  },
}));

const TEST_KEY: Buffer = randomBytes(32);

beforeEach(async () => {
  testDb = await DuckDBInstance.create(':memory:');
  await initializeDatabase(testDb);

  const service = new ConfigService(testDb, TEST_KEY);
  await service.seedDefaults();
  setConfigService(service);

  // Create filing/attachment/pleading tables (normally created by ingest DDL)
  const conn: DuckDBConnection = await DuckDBConnection.create(testDb);
  try {
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

    await conn.run(`INSERT INTO filing VALUES (
      'SAT-LOA-20240101-00001', 1, 'SATX1', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2024-01-01', NULL,
      'Request for satellite frequency allocation in Ka-band', 'Ka-band satellite'
    )`);
    await conn.run(`INSERT INTO attachment VALUES (
      1, 'SAT-LOA-20240101-00001', 1,
      'Technical narrative describing Ka-band frequency coordination',
      NULL
    )`);
    await rebuildAllFtsIndexes(conn);
  } finally {
    conn.closeSync();
  }
});

afterEach(() => {
  testDb.closeSync();
});

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
        // skip non-JSON data lines
      }
      currentData = '';
    }
  }
  // Handle final event without trailing newline
  if (currentData !== '') {
    try {
      events.push(JSON.parse(currentData) as Record<string, unknown>);
    } catch {
      // skip
    }
  }

  return events;
}

describe('POST /api/query', () => {
  it('returns SSE stream with status → sources → deltas → usage → done', async () => {
    const app = new Hono();
    app.route('/api/query', queryRoutes);

    const resp = await app.request('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What Ka-band allocations exist?' }),
    });

    expect(resp.status).toEqual(200);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');

    const text: string = await resp.text();
    const events = parseSSEEvents(text);

    // Should have the expected event sequence
    const types: string[] = events.map((e) => e.type as string);

    // First 3 should be status events (rewriting, retrieving, generating)
    expect(types[0]).toEqual('status');
    expect((events[0] as Record<string, string>).stage).toEqual('rewriting');

    expect(types[1]).toEqual('status');
    expect((events[1] as Record<string, string>).stage).toEqual('retrieving');

    // Should have sources event
    expect(types).toContain('sources');

    expect(types[types.indexOf('sources') + 1]).toEqual('status');
    expect(
      (events[types.indexOf('sources') + 1] as Record<string, string>).stage,
    ).toEqual('generating');

    // Should have delta events
    expect(types).toContain('delta');

    // Should end with usage and done
    expect(types[types.length - 2]).toEqual('usage');
    expect(types[types.length - 1]).toEqual('done');

    // Verify usage has expected structure
    const usageEvent = events.find((e) => e.type === 'usage') as Record<
      string,
      Record<string, unknown>
    >;
    expect(usageEvent).toBeDefined();
    const usage = usageEvent.usage as Record<string, unknown>;
    expect(usage).toBeDefined();
    expect(usage.rewriteTokens).toBeDefined();
    expect(usage.generateTokens).toBeDefined();
    expect(typeof usage.retrievalMs).toEqual('number');
    expect(typeof usage.totalMs).toEqual('number');
  });

  it('rejects empty question with 400', async () => {
    const app = new Hono();
    app.route('/api/query', queryRoutes);

    const resp = await app.request('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    });

    expect(resp.status).toEqual(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toContain('required');
  });

  it('rejects question exceeding max length with 400', async () => {
    const app = new Hono();
    app.route('/api/query', queryRoutes);

    const longQuestion: string = 'a'.repeat(2000);
    const resp = await app.request('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: longQuestion }),
    });

    expect(resp.status).toEqual(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toContain('maximum length');
  });
});
