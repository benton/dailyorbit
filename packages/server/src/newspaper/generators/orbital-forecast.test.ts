import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import type { InferenceResponse } from '../../inference/types.ts';
import {
  formatCompanyActivity,
  formatFilingStats,
  generateOrbitalForecast,
  queryCompanyActivity,
  queryFilingStats,
} from './orbital-forecast.ts';

// ── Helpers ─────────────────────────────────────────────────────

function makeMockInferenceService(content: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content,
      modelId: 'test-model',
      usage: { inputTokens: 80, outputTokens: 200, totalTokens: 280 },
      stopReason: 'end_turn',
      latencyMs: 40,
    } satisfies InferenceResponse),
  };
}

function makeMockConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    newspaperCopyModel: 'test-model',
    newspaperForecastSystemPrompt: '',
    newspaperForecastUserPrompt: '',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key] ?? ''),
  };
}

const SAMPLE_FORECAST: string = `# A Busy Week for Earth Station Filings

The International Bureau saw a marked uptick in earth station activity this week, with SES filings climbing 44% above the 90-day average. Hughes Network Systems led the charge with 3 new modification requests, while SpaceX continued its steady cadence of STA filings.

Satellite space station applications remained flat, but the surge in earth station modifications suggests operators are repositioning ground infrastructure ahead of next-generation constellation deployments.`;

async function seedTestData(conn: DuckDBConnection): Promise<void> {
  await conn.run(`CREATE SEQUENCE IF NOT EXISTS company_id_seq START 1`);
  await conn.run(`
    CREATE TABLE IF NOT EXISTS company (
      id INTEGER PRIMARY KEY DEFAULT nextval('company_id_seq'),
      name VARCHAR NOT NULL
    )
  `);
  await conn.run(`
    CREATE TABLE IF NOT EXISTS company_alias (
      company_id INTEGER NOT NULL,
      alias_name VARCHAR NOT NULL,
      PRIMARY KEY (company_id, alias_name)
    )
  `);
  await conn.run(`
    CREATE TABLE IF NOT EXISTS filing (
      filing_key INTEGER PRIMARY KEY,
      file_number VARCHAR NOT NULL,
      subsystem_code VARCHAR,
      app_type_code VARCHAR,
      address_attention VARCHAR,
      date_filed DATE
    )
  `);

  await conn.run(
    `INSERT INTO company VALUES (1, 'Hughes Network Systems'), (2, 'SpaceX')`,
  );
  await conn.run(
    `INSERT INTO company_alias VALUES
      (1, 'HUGHES NETWORK SYSTEMS, LLC'),
      (2, 'SPACE EXPLORATION TECHNOLOGIES CORP.')`,
  );

  // Recent week: 5 SES filings, 2 SAT filings
  await conn.run(
    `INSERT INTO filing VALUES
      (1, 'SES-MOD-20260320-00001', 'SES', 'MOD', 'HUGHES NETWORK SYSTEMS, LLC', '2026-03-20'),
      (2, 'SES-MOD-20260321-00002', 'SES', 'MOD', 'HUGHES NETWORK SYSTEMS, LLC', '2026-03-21'),
      (3, 'SES-MOD-20260322-00003', 'SES', 'MOD', 'HUGHES NETWORK SYSTEMS, LLC', '2026-03-22'),
      (4, 'SAT-STA-20260319-00004', 'SAT', 'STA', 'SPACE EXPLORATION TECHNOLOGIES CORP.', '2026-03-19'),
      (5, 'SAT-LOA-20260323-00005', 'SAT', 'LOA', 'SPACE EXPLORATION TECHNOLOGIES CORP.', '2026-03-23'),
      (6, 'SES-NEW-20260318-00006', 'SES', 'NEW', 'HUGHES NETWORK SYSTEMS, LLC', '2026-03-18'),
      (7, 'SES-MOD-20260317-00007', 'SES', 'MOD', 'HUGHES NETWORK SYSTEMS, LLC', '2026-03-17')`,
  );

  // Older filings to establish 90-day average
  await conn.run(
    `INSERT INTO filing VALUES
      (100, 'SES-MOD-20260101-00100', 'SES', 'MOD', 'HUGHES NETWORK SYSTEMS, LLC', '2026-01-01'),
      (101, 'SES-MOD-20260115-00101', 'SES', 'MOD', 'HUGHES NETWORK SYSTEMS, LLC', '2026-01-15'),
      (102, 'SAT-LOA-20260110-00102', 'SAT', 'LOA', 'SPACE EXPLORATION TECHNOLOGIES CORP.', '2026-01-10'),
      (103, 'SAT-STA-20260201-00103', 'SAT', 'STA', 'SPACE EXPLORATION TECHNOLOGIES CORP.', '2026-02-01'),
      (104, 'SAT-LOA-20260215-00104', 'SAT', 'LOA', 'SPACE EXPLORATION TECHNOLOGIES CORP.', '2026-02-15')`,
  );
}

// ── Tests ───────────────────────────────────────────────────────

describe('queryFilingStats', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await seedTestData(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns filing counts by subsystem with change percentages', async () => {
    const stats = await queryFilingStats(conn, '2026-03-24');
    expect(stats.length).toBeGreaterThanOrEqual(1);
    // SES should have more filings this week
    const sesStat = stats.find((s) => s.subsystemCode === 'SES');
    expect(sesStat).toBeDefined();
    expect(sesStat!.weekCount).toBeGreaterThanOrEqual(1);
    expect(typeof sesStat!.changePct).toEqual('number');
  });

  it('returns empty array when no filings exist', async () => {
    await conn.run(`DELETE FROM filing`);
    const stats = await queryFilingStats(conn, '2026-03-24');
    expect(stats).toEqual([]);
  });
});

describe('queryCompanyActivity', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await seedTestData(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns top companies with filing counts and types', async () => {
    const activity = await queryCompanyActivity(conn, '2026-03-24');
    expect(activity.length).toBeGreaterThanOrEqual(1);
    // Hughes should be first (most filings)
    expect(activity[0]!.companyName).toEqual('Hughes Network Systems');
    expect(activity[0]!.filingCount).toBeGreaterThanOrEqual(1);
    expect(activity[0]!.filingTypes).toContain('SES');
  });

  it('returns empty array when no company-attributed filings exist', async () => {
    await conn.run(`DELETE FROM company_alias`);
    const activity = await queryCompanyActivity(conn, '2026-03-24');
    expect(activity).toEqual([]);
  });
});

describe('formatFilingStats', () => {
  it('returns placeholder when empty', () => {
    expect(formatFilingStats([])).toContain('No filing data');
  });

  it('formats stats with subsystem, count, average, and change', () => {
    const result: string = formatFilingStats([
      { subsystemCode: 'SES', weekCount: 5, avgCount: 3.5, changePct: 43 },
    ]);
    expect(result).toContain('SES');
    expect(result).toContain('5 this week');
    expect(result).toContain('avg 3.5');
    expect(result).toContain('+43%');
  });

  it('formats negative changes without plus sign', () => {
    const result: string = formatFilingStats([
      { subsystemCode: 'SAT', weekCount: 1, avgCount: 3, changePct: -67 },
    ]);
    expect(result).toContain('-67%');
  });
});

describe('formatCompanyActivity', () => {
  it('returns placeholder when empty', () => {
    expect(formatCompanyActivity([])).toContain('No company activity');
  });

  it('formats company name, count, and filing types', () => {
    const result: string = formatCompanyActivity([
      {
        companyName: 'Hughes Network Systems',
        filingCount: 4,
        filingTypes: 'SES-MOD, SES-NEW',
      },
    ]);
    expect(result).toContain('Hughes Network Systems');
    expect(result).toContain('4 filings');
    expect(result).toContain('SES-MOD');
  });
});

describe('generateOrbitalForecast', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);
    await seedTestData(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('generates a forecast with filing stats in the prompt', async () => {
    const inferenceService = makeMockInferenceService(SAMPLE_FORECAST);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateOrbitalForecast({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.headline).toContain('Earth Station');
    expect(result.body).toContain('44%');
    expect(result.sourceData.modelId).toEqual('test-model');
  });

  it('passes filing stats and company activity to the prompt', async () => {
    const inferenceService = makeMockInferenceService(SAMPLE_FORECAST);
    const config = makeMockConfig();

    await generateOrbitalForecast({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    const call = inferenceService.complete.mock.calls[0]![0]!;
    const promptContent: string = call.messages[0]!.content as string;
    expect(promptContent).toContain('SES');
    expect(promptContent).toContain('Hughes Network Systems');
  });

  it('generates even when no filing data exists', async () => {
    await conn.run(`DELETE FROM filing`);

    const inferenceService = makeMockInferenceService(SAMPLE_FORECAST);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateOrbitalForecast({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(inferenceService.complete).toHaveBeenCalledOnce();
    expect(result.sourceData.notableTrends).toEqual(0);
  });
});
