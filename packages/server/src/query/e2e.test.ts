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

// Mock BedrockClient with citation-bearing answer
vi.mock('../inference/bedrock-client.ts', () => {
  return {
    BedrockClient: class MockBedrockClient {
      async converse() {
        return {
          $metadata: {},
          metrics: { latencyMs: 50 },
          output: {
            message: {
              role: 'assistant',
              content: [
                {
                  text: '[{"text": "Ka-band satellite spectrum allocation"}, {"text": "satellite industry news Ligado interference"}]',
                },
              ],
            },
          },
          usage: { inputTokens: 40, outputTokens: 30, totalTokens: 70 },
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
              text: 'Based on the filings [Source 1], Ka-band spectrum was allocated. ',
            },
            contentBlockIndex: 0,
          },
        } as ConverseStreamOutput;
        yield {
          contentBlockDelta: {
            delta: {
              text: 'Recent news [Source 3] discusses interference concerns.',
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

// Disable embedding context so tests use keyword-only search
vi.mock('../inference/embedding-service.ts', () => ({
  EmbeddingService: class MockEmbeddingService {
    constructor() {
      throw new Error('No embedding service in e2e test');
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

  const conn: DuckDBConnection = await DuckDBConnection.create(testDb);
  try {
    // Filing tables
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

    // Seed filings
    await conn.run(`INSERT INTO filing VALUES (
      'SAT-LOA-20240101-00001', 1, 'SATX1', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2024-01-01', NULL,
      'Request for satellite frequency allocation in Ka-band', 'Ka-band satellite'
    )`);
    await conn.run(`INSERT INTO filing VALUES (
      'SES-LIC-20240201-00002', 2, 'E001', 'Hughes Net', 'SES', 'LIC', 'P', '2024-02-01', NULL,
      'Earth station license application for C-band operations', 'Earth station C-band'
    )`);
    await conn.run(`INSERT INTO attachment VALUES (
      1, 'SAT-LOA-20240101-00001', 1,
      'Technical narrative describing Ka-band frequency coordination with adjacent operators',
      NULL
    )`);

    // Seed news data
    await conn.run(`
      INSERT INTO news_source (id, name, feed_url, category) VALUES
        (1, 'SpaceNews', 'https://spacenews.com/feed/', 'industry'),
        (2, 'Via Satellite', 'https://viasatellite.com/feed/', 'industry')
    `);
    await conn.run(`
      INSERT INTO news_item (id, news_source_id, source_url, title, full_text, extract_status) VALUES
        (1, 1, 'https://spacenews.com/ka-band-ruling',
         'FCC issues new Ka-band spectrum allocation ruling',
         'The FCC issued a ruling on Ka-band spectrum allocation for satellite operators.',
         'extracted'),
        (2, 1, 'https://spacenews.com/starlink-launch',
         'SpaceX launches Starlink satellites for broadband expansion',
         'SpaceX launched 23 Starlink satellites expanding its broadband constellation.',
         'extracted'),
        (3, 2, 'https://viasatellite.com/ligado-fcc',
         'Ligado tells FCC that SkyTerra proposal will not cause interference',
         'Ligado Networks told the FCC that its SkyTerra Next proposal will not cause harmful interference to GPS or satellite operations.',
         'extracted')
    `);

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

describe('Query E2E — filings + news', () => {
  it('streams complete pipeline with filings and news sources', async () => {
    const app = new Hono();
    app.route('/api/query', queryRoutes);

    const resp = await app.request('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question:
          'What Ka-band allocations exist and what are the latest news about Ligado interference?',
      }),
    });

    expect(resp.status).toEqual(200);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');

    const text: string = await resp.text();
    const events = parseSSEEvents(text);
    const types: string[] = events.map((e) => e.type as string);

    // 1. Status events appear in order: rewriting -> retrieving -> generating
    const statusEvents = events.filter((e) => e.type === 'status');
    const stages: string[] = statusEvents.map((e) => e.stage as string);
    expect(stages).toEqual(['rewriting', 'retrieving', 'generating']);

    // 2. Sources event is present and non-empty
    const sourcesEvent = events.find((e) => e.type === 'sources') as
      | Record<string, unknown>
      | undefined;
    expect(sourcesEvent).toBeDefined();
    const sources = sourcesEvent!.sources as Array<Record<string, unknown>>;
    expect(sources.length).toBeGreaterThan(0);

    // Verify sources include both filing and news types
    const sourceTypes = new Set(sources.map((s) => s.type as string));
    expect(sourceTypes.has('filing') || sourceTypes.has('attachment')).toEqual(
      true,
    );
    expect(sourceTypes.has('news')).toEqual(true);

    // 3. Answer text is non-empty and contains citation brackets
    const deltaEvents = events.filter((e) => e.type === 'delta');
    expect(deltaEvents.length).toBeGreaterThan(0);
    const fullAnswer: string = deltaEvents
      .map((e) => e.text as string)
      .join('');
    expect(fullAnswer.length).toBeGreaterThan(0);
    expect(fullAnswer).toMatch(/\[Source \d+\]/);

    // 4. Usage event has non-zero token counts
    const usageEvent = events.find((e) => e.type === 'usage') as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(usageEvent).toBeDefined();
    const usage = usageEvent!.usage!;
    expect(usage).toBeDefined();

    const rewriteTokens = usage.rewriteTokens as Record<string, number>;
    expect(rewriteTokens.input).toBeGreaterThan(0);
    expect(rewriteTokens.output).toBeGreaterThan(0);

    const generateTokens = usage.generateTokens as Record<string, number>;
    expect(generateTokens.input).toBeGreaterThan(0);
    expect(generateTokens.output).toBeGreaterThan(0);

    expect(usage.retrievalMs as number).toBeGreaterThanOrEqual(0);
    expect(usage.totalMs as number).toBeGreaterThan(0);

    // 5. Done event terminates the stream
    expect(types[types.length - 1]).toEqual('done');
  });

  it('includes news sources with proper metadata', async () => {
    const app = new Hono();
    app.route('/api/query', queryRoutes);

    const resp = await app.request('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Ligado interference FCC ruling',
      }),
    });

    expect(resp.status).toEqual(200);
    const text: string = await resp.text();
    const events = parseSSEEvents(text);

    const sourcesEvent = events.find((e) => e.type === 'sources') as
      | Record<string, unknown>
      | undefined;
    expect(sourcesEvent).toBeDefined();

    const sources = sourcesEvent!.sources as Array<Record<string, unknown>>;
    const newsSources = sources.filter((s) => s.type === 'news');

    // Should find the Ligado news article
    expect(newsSources.length).toBeGreaterThan(0);

    // News sources should have id, title, snippet, score, url
    for (const ns of newsSources) {
      expect(ns.id).toBeDefined();
      expect(typeof ns.title).toEqual('string');
      expect((ns.title as string).length).toBeGreaterThan(0);
      expect(typeof ns.snippet).toEqual('string');
      expect(typeof ns.score).toEqual('number');
      expect(typeof ns.url).toEqual('string');
    }
  });
});
