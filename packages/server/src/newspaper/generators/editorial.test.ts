import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import { getISOWeekNumber } from '../types.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import type { InferenceResponse } from '../../inference/types.ts';
import {
  PERSONAS,
  getCurrentPersona,
  formatFilingTrends,
  formatNewsTrends,
  generateEditorial,
  queryWeeklyFilings,
  queryWeeklyNews,
} from './editorial.ts';

// ── Helpers ─────────────────────────────────────────────────────

function makeMockInferenceService(content: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content,
      modelId: 'test-model',
      usage: { inputTokens: 100, outputTokens: 300, totalTokens: 400 },
      stopReason: 'end_turn',
      latencyMs: 50,
    } satisfies InferenceResponse),
  };
}

function makeMockConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    newspaperCopyModel: 'test-model',
    newspaperEditorialSystemPrompt: '',
    newspaperEditorialUserPrompt: '',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key] ?? ''),
  };
}

const SAMPLE_EDITORIAL: string = `# The Shifting Orbital Order

The past week's filings reveal a familiar pattern: the largest operators continue to consolidate their positions while smaller entrants jockey for the remaining orbital slots. Three new space station applications from Hughes Network Systems suggest an aggressive expansion into Ka-band capacity.

The FCC's recent public notice on spectrum sharing rules has not gone unnoticed. Industry observers would do well to watch how the major players respond in the coming weeks.

Meanwhile, the flurry of modification requests from SpaceX and Amazon's Project Kuiper suggests that the mega-constellation race is far from settled.

— The Strategist`;

// ── Persona rotation tests ──────────────────────────────────────

describe('getCurrentPersona', () => {
  it('cycles through 3 personas based on ISO week number', () => {
    const seen: Set<string> = new Set();
    // Use 3 consecutive weeks to verify all 3 personas appear
    for (let w = 0; w < 3; w++) {
      // Create a date in week w of 2026 — Jan 5 is Monday of week 2
      const date: Date = new Date(Date.UTC(2026, 0, 5 + w * 7));
      const persona = getCurrentPersona(date);
      seen.add(persona.name);
      // Verify it matches the expected index
      const weekNum: number = getISOWeekNumber(date);
      expect(persona).toEqual(PERSONAS[weekNum % 3]);
    }
    expect(seen.size).toEqual(3);
  });

  it('returns the same persona for all days within the same week', () => {
    // Monday and Friday of the same week
    const monday: Date = new Date(Date.UTC(2026, 0, 5)); // Monday, week 2
    const friday: Date = new Date(Date.UTC(2026, 0, 9)); // Friday, week 2
    expect(getCurrentPersona(monday)).toEqual(getCurrentPersona(friday));
  });
});

describe('getISOWeekNumber', () => {
  it('returns correct ISO week for known dates', () => {
    // 2026-01-01 is Thursday → ISO week 1
    expect(getISOWeekNumber(new Date(Date.UTC(2026, 0, 1)))).toEqual(1);
    // 2026-01-05 is Monday → ISO week 2
    expect(getISOWeekNumber(new Date(Date.UTC(2026, 0, 5)))).toEqual(2);
    // 2026-03-24 is Tuesday → ISO week 13
    expect(getISOWeekNumber(new Date(Date.UTC(2026, 2, 24)))).toEqual(13);
  });
});

// ── Formatter tests ─────────────────────────────────────────────

describe('formatFilingTrends', () => {
  it('returns placeholder when empty', () => {
    expect(formatFilingTrends([])).toContain('No notable filings');
  });

  it('formats filings as a markdown list with truncated summaries', () => {
    const result: string = formatFilingTrends([
      {
        fileNumber: 'SAT-LOA-20260320-00001',
        applicantName: 'Hughes',
        dateFiled: '2026-03-20',
        summary: 'Application to launch and operate.',
      },
    ]);
    expect(result).toContain('SAT-LOA-20260320-00001');
    expect(result).toContain('Hughes');
    expect(result).toContain('Application to launch');
  });
});

describe('formatNewsTrends', () => {
  it('returns placeholder when empty', () => {
    expect(formatNewsTrends([])).toContain('No recent industry news');
  });

  it('formats news as a markdown list', () => {
    const result: string = formatNewsTrends([
      {
        title: 'Viasat expands Ka-band',
        sourceName: 'SpaceNews',
        summary: 'Viasat announced expansion plans.',
      },
    ]);
    expect(result).toContain('SpaceNews');
    expect(result).toContain('Viasat expands Ka-band');
  });
});

// ── Query tests ─────────────────────────────────────────────────

describe('queryWeeklyFilings', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER PRIMARY KEY,
        file_number VARCHAR NOT NULL,
        address_attention VARCHAR,
        date_filed DATE
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER PRIMARY KEY,
        filing_key INTEGER,
        summary VARCHAR
      )
    `);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns filings from the last 7 days with summaries', async () => {
    await conn.run(
      `INSERT INTO filing VALUES
        (1, 'SAT-LOA-20260320-00001', 'Hughes', '2026-03-20'),
        (2, 'SES-MOD-20260321-00002', 'SES', '2026-03-21')`,
    );
    await conn.run(
      `INSERT INTO attachment VALUES
        (100, 1, 'Application to launch a new satellite'),
        (101, 2, 'Modification of earth station license')`,
    );
    const filings = await queryWeeklyFilings(conn, '2026-03-24');
    expect(filings.length).toEqual(2);
    expect(filings[0]!.fileNumber).toEqual('SES-MOD-20260321-00002');
  });

  it('returns empty array when no filings match', async () => {
    const filings = await queryWeeklyFilings(conn, '2026-03-24');
    expect(filings).toEqual([]);
  });
});

describe('queryWeeklyNews', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS news_source (
        id INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS news_item (
        id INTEGER PRIMARY KEY,
        news_source_id INTEGER,
        title VARCHAR,
        published_at TIMESTAMP,
        summary VARCHAR
      )
    `);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns news from the last 7 days with summaries', async () => {
    await conn.run(`INSERT INTO news_source VALUES (1, 'SpaceNews')`);
    await conn.run(
      `INSERT INTO news_item VALUES
        (1, 1, 'Viasat expands Ka-band', '2026-03-22 10:00:00', 'Viasat announced expansion'),
        (2, 1, 'SpaceX files new STA', '2026-03-23 14:00:00', 'SpaceX temporary authority')`,
    );
    const news = await queryWeeklyNews(conn, '2026-03-24');
    expect(news.length).toEqual(2);
    expect(news[0]!.title).toEqual('SpaceX files new STA');
  });

  it('returns empty array when no news matches', async () => {
    await conn.run(`INSERT INTO news_source VALUES (1, 'SpaceNews')`);
    const news = await queryWeeklyNews(conn, '2026-03-24');
    expect(news).toEqual([]);
  });
});

// ── Generator integration tests ─────────────────────────────────

describe('generateEditorial', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER PRIMARY KEY,
        file_number VARCHAR NOT NULL,
        address_attention VARCHAR,
        date_filed DATE
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER PRIMARY KEY,
        filing_key INTEGER,
        summary VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS news_source (
        id INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS news_item (
        id INTEGER PRIMARY KEY,
        news_source_id INTEGER,
        title VARCHAR,
        published_at TIMESTAMP,
        summary VARCHAR
      )
    `);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('calls inference with persona voice and returns editorial with headline', async () => {
    await conn.run(
      `INSERT INTO filing VALUES (1, 'SAT-LOA-20260320-00001', 'Hughes', '2026-03-20')`,
    );
    await conn.run(
      `INSERT INTO attachment VALUES (100, 1, 'Application to launch satellite')`,
    );

    const inferenceService = makeMockInferenceService(SAMPLE_EDITORIAL);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateEditorial({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.headline).toEqual('The Shifting Orbital Order');
    expect(result.body).toContain('The Strategist');
    expect(result.sourceData.persona).toBeDefined();
    expect(result.sourceData.modelId).toEqual('test-model');
  });

  it('includes persona details in the system prompt', async () => {
    const inferenceService = makeMockInferenceService(SAMPLE_EDITORIAL);
    const config = makeMockConfig();

    await generateEditorial({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    const call = inferenceService.complete.mock.calls[0]![0]!;
    const systemPrompt: string = call.params.systemPrompt as string;
    // The persona for 2026-03-24 (week 13, 13%3=1) is The Counsel
    expect(systemPrompt).toContain('The Counsel');
    expect(systemPrompt).toContain('regulatory trends');
  });

  it('generates even when no filings or news exist', async () => {
    await conn.run(`INSERT INTO news_source VALUES (1, 'SpaceNews')`);

    const inferenceService = makeMockInferenceService(SAMPLE_EDITORIAL);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateEditorial({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(inferenceService.complete).toHaveBeenCalledOnce();
    expect(result.sourceData.filingCount).toEqual(0);
    expect(result.sourceData.newsCount).toEqual(0);
  });
});
