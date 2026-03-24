import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import type { InferenceResponse } from '../../inference/types.ts';
import {
  formatCompanyNames,
  formatFilingTypes,
  generateClassifieds,
  queryRandomCompanies,
  queryRecentFilingTypes,
} from './classifieds.ts';

// ── Helpers ─────────────────────────────────────────────────────

function makeMockInferenceService(content: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content,
      modelId: 'test-model',
      usage: { inputTokens: 80, outputTokens: 400, totalTokens: 480 },
      stopReason: 'end_turn',
      latencyMs: 50,
    } satisfies InferenceResponse),
  };
}

function makeMockConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    newspaperCopyModel: 'test-model',
    newspaperClassifiedsSystemPrompt: '',
    newspaperClassifiedsUserPrompt: '',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key] ?? ''),
  };
}

const SAMPLE_CLASSIFIEDS: string = `**FOR SALE** — One (1) gently used Ka-band transponder, barely occupied orbital slot at 97°W. Ideal for discerning operators seeking prime geostationary real estate. Contact: Lord Reginald Forthright, Esq., c/o Orbital Dynamics LLC.

**WANTED** — Experienced spectrum coordinator, must be comfortable with ITU filing deadlines and late-night coordination calls to Geneva. Competitive salary plus Ka-band allocation bonus. Contact: HR@AcmeSatellite.space

**SERVICES** — Professional interference analysis, guaranteed to find that pesky adjacent-slot signal within 48 hours or your filing fee back. Contact: Dr. Helena Crosshatch, Signal Sleuths Ltd.

**POSITIONS AVAILABLE** — Seeking motivated earth station technician. Must be willing to relocate to remote teleport facility. Ka-band experience preferred, ability to shovel snow from dish surfaces a plus. Contact: Arctic Ground Systems, Inc.

**LOST & FOUND** — FOUND: One set of orbital parameters, apparently belonging to a V-band NGSO constellation. Discovered floating in the ITU coordination queue since 2019. Contact: Lost Property Office, FCC International Bureau.

**FOR SALE** — Vintage spectrum license, C-band, excellent provenance. Currently encumbered by 5G clearing obligations but otherwise in fine condition. Contact: Estate of the Late Great Terrestrial Microwave Co.

**WANTED** — Quiet neighbor for 105°W orbital slot. No mega-constellations, no inter-satellite links after 10pm EST. References required. Contact: Genteel Geosynchronous Operators' Association.`;

// ── Tests ───────────────────────────────────────────────────────

describe('formatCompanyNames', () => {
  it('returns placeholder when empty', () => {
    expect(formatCompanyNames([])).toContain('No companies available');
  });

  it('formats names as a markdown list', () => {
    const result: string = formatCompanyNames(['Hughes', 'SES S.A.']);
    expect(result).toEqual('- Hughes\n- SES S.A.');
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
      `INSERT INTO company (name) VALUES ('Hughes'), ('SES'), ('Viasat'), ('Intelsat')`,
    );
    const names: string[] = await queryRandomCompanies(conn, 3);
    expect(names).toHaveLength(3);
    for (const n of names) {
      expect(['Hughes', 'SES', 'Viasat', 'Intelsat']).toContain(n);
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

describe('generateClassifieds', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);

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

  it('calls inference and returns 7 classified ads', async () => {
    await conn.run(
      `INSERT INTO company (name) VALUES ('Hughes'), ('SES'), ('SpaceX')`,
    );
    await conn.run(
      `INSERT INTO filing VALUES (1, 'SAT-LOA-20260320-00001', 'SAT', 'LOA', '2026-03-20')`,
    );

    const inferenceService = makeMockInferenceService(SAMPLE_CLASSIFIEDS);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateClassifieds({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.headline).toEqual('Classifieds');
    // Body should contain multiple classified categories
    expect(result.body).toContain('FOR SALE');
    expect(result.body).toContain('WANTED');
    expect(result.body).toContain('SERVICES');
    expect(result.sourceData.modelId).toEqual('test-model');
  });

  it('passes real company names and filing types to the prompt', async () => {
    await conn.run(
      `INSERT INTO company (name) VALUES ('Hughes Network Systems'), ('SES S.A.')`,
    );
    await conn.run(
      `INSERT INTO filing VALUES (1, 'SAT-LOA-20260320-00001', 'SAT', 'LOA', '2026-03-20')`,
    );

    const inferenceService = makeMockInferenceService(SAMPLE_CLASSIFIEDS);
    const config = makeMockConfig();

    await generateClassifieds({
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
    expect(
      promptContent.includes('Hughes Network Systems') ||
        promptContent.includes('SES S.A.'),
    ).toBe(true);
  });

  it('generates even when no companies or filings exist', async () => {
    const inferenceService = makeMockInferenceService(SAMPLE_CLASSIFIEDS);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateClassifieds({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(inferenceService.complete).toHaveBeenCalledOnce();
    expect(result.sourceData.companyNames).toEqual([]);
  });
});
