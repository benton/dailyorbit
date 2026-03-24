import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import {
  formatCompanyNames,
  formatFilingTypes,
  generateFakeAd,
  queryRandomCompanies,
  queryRecentFilingTypes,
} from './fake-ad.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import type { InferenceResponse } from '../../inference/types.ts';

// ── Helpers ─────────────────────────────────────────────────────────

function makeMockInferenceService(content: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content,
      modelId: 'test-model',
      usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
      stopReason: 'end_turn',
      latencyMs: 30,
    } satisfies InferenceResponse),
  };
}

function makeMockConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    newspaperCopyModel: 'test-model',
    newspaperAdSystemPrompt: '',
    newspaperAdUserPrompt: '',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key] ?? ''),
  };
}

const SAMPLE_AD: string = `# ORBITAL DYNAMICS LLC
## "Purveyors of the Finest Ka-Band Transponders"

For discerning operators of the celestial sphere, we offer transponder capacity of unparalleled fidelity. Our Ka-band allocations have graced the most distinguished orbital slots since the dawn of the modern era.

*Est. 1998 · Washington, D.C.*`;

// ── Tests ───────────────────────────────────────────────────────────

describe('formatCompanyNames', () => {
  it('returns placeholder when empty', () => {
    expect(formatCompanyNames([])).toContain('No companies available');
  });

  it('formats names as a markdown list', () => {
    const result: string = formatCompanyNames([
      'Hughes Network Systems',
      'SES S.A.',
    ]);
    expect(result).toEqual('- Hughes Network Systems\n- SES S.A.');
  });
});

describe('formatFilingTypes', () => {
  it('returns placeholder when empty', () => {
    expect(formatFilingTypes([])).toContain('No recent filings');
  });

  it('formats types as a markdown list', () => {
    const result: string = formatFilingTypes(['SAT-LOA', 'SES-MOD']);
    expect(result).toEqual('- SAT-LOA\n- SES-MOD');
  });
});

describe('queryRandomCompanies', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(`CREATE SEQUENCE IF NOT EXISTS company_id_seq START 1`);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER PRIMARY KEY DEFAULT nextval('company_id_seq'),
        name VARCHAR NOT NULL
      )
    `);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns up to limit company names', async () => {
    await conn.run(
      `INSERT INTO company (name) VALUES ('Hughes'), ('SES'), ('Viasat'), ('Intelsat'), ('Telesat')`,
    );
    const names: string[] = await queryRandomCompanies(conn, 3);
    expect(names).toHaveLength(3);
    for (const n of names) {
      expect(['Hughes', 'SES', 'Viasat', 'Intelsat', 'Telesat']).toContain(n);
    }
  });

  it('returns empty array when no companies exist', async () => {
    const names: string[] = await queryRandomCompanies(conn, 5);
    expect(names).toEqual([]);
  });
});

describe('queryRecentFilingTypes', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER PRIMARY KEY,
        file_number VARCHAR NOT NULL,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        date_filed DATE
      )
    `);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns distinct filing type combinations from recent filings', async () => {
    await conn.run(
      `INSERT INTO filing VALUES
        (1, 'SAT-LOA-20260320-00001', 'SAT', 'LOA', '2026-03-20'),
        (2, 'SES-MOD-20260321-00002', 'SES', 'MOD', '2026-03-21'),
        (3, 'SAT-LOA-20260322-00003', 'SAT', 'LOA', '2026-03-22')`,
    );
    const types: string[] = await queryRecentFilingTypes(conn, '2026-03-24');
    expect(types.length).toBeGreaterThanOrEqual(1);
    expect(types.length).toBeLessThanOrEqual(5);
    for (const t of types) {
      expect(['SAT-LOA', 'SES-MOD']).toContain(t);
    }
  });

  it('returns empty array when no recent filings exist', async () => {
    const types: string[] = await queryRecentFilingTypes(conn, '2026-03-24');
    expect(types).toEqual([]);
  });
});

describe('generateFakeAd', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);

    // Minimal company + filing tables
    await conn.run(`CREATE SEQUENCE IF NOT EXISTS company_id_seq START 1`);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER PRIMARY KEY DEFAULT nextval('company_id_seq'),
        name VARCHAR NOT NULL
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER PRIMARY KEY,
        file_number VARCHAR NOT NULL,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        date_filed DATE
      )
    `);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('calls inference and returns structured ad with headline and body', async () => {
    await conn.run(
      `INSERT INTO company (name) VALUES ('Hughes Network Systems'), ('SES S.A.')`,
    );
    await conn.run(
      `INSERT INTO filing VALUES (1, 'SAT-LOA-20260320-00001', 'SAT', 'LOA', '2026-03-20')`,
    );

    const inferenceService = makeMockInferenceService(SAMPLE_AD);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateFakeAd({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.headline).toEqual('ORBITAL DYNAMICS LLC');
    expect(result.body).toContain('Ka-Band Transponders');
    expect(result.body).toContain('Est. 1998');
    expect(result.sourceData.modelId).toEqual('test-model');
  });

  it('passes company names to the prompt', async () => {
    await conn.run(
      `INSERT INTO company (name) VALUES ('Hughes Network Systems'), ('SES S.A.')`,
    );

    const inferenceService = makeMockInferenceService(SAMPLE_AD);
    const config = makeMockConfig();

    await generateFakeAd({
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
    // At least one of the companies should appear (random order)
    expect(
      promptContent.includes('Hughes Network Systems') ||
        promptContent.includes('SES S.A.'),
    ).toBe(true);
  });

  it('generates even when no companies or filings exist', async () => {
    const inferenceService = makeMockInferenceService(SAMPLE_AD);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateFakeAd({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    // Should still call inference with placeholder text
    expect(inferenceService.complete).toHaveBeenCalledOnce();
    expect(result.headline).toEqual('ORBITAL DYNAMICS LLC');
    expect(result.sourceData.companyNames).toEqual([]);
  });
});
