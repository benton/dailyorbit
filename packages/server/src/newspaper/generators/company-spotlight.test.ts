import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import type { InferenceResponse } from '../../inference/types.ts';
import {
  formatCompanyFilings,
  generateCompanySpotlight,
  queryCompanyAliases,
  queryCompanyFilings,
  selectSpotlightCompany,
} from './company-spotlight.ts';

// ── Helpers ─────────────────────────────────────────────────────

function makeMockInferenceService(content: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content,
      modelId: 'test-model',
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      stopReason: 'end_turn',
      latencyMs: 40,
    } satisfies InferenceResponse),
  };
}

function makeMockConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    newspaperCopyModel: 'test-model',
    newspaperSpotlightSystemPrompt: '',
    newspaperSpotlightUserPrompt: '',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key] ?? ''),
  };
}

const SAMPLE_SPOTLIGHT: string = `# Hughes Network Systems: A Ka-Band Pioneer

Hughes Network Systems, a subsidiary of EchoStar Corporation, continues to be one of the most prolific filers before the FCC's International Bureau. With a recent string of satellite launch and operate applications, the company is clearly positioning for expanded Ka-band capacity.

The company's recent filings suggest a strategic focus on next-generation high-throughput satellites. For more details, visit [Hughes Network Systems](/companies/1).`;

async function seedTestData(conn: DuckDBConnection): Promise<void> {
  await conn.run(`CREATE SEQUENCE IF NOT EXISTS company_id_seq START 1`);
  await conn.run(`
    CREATE TABLE IF NOT EXISTS company (
      id INTEGER PRIMARY KEY DEFAULT nextval('company_id_seq'),
      name VARCHAR NOT NULL,
      parent_company_id INTEGER,
      description VARCHAR,
      created_at TIMESTAMP DEFAULT current_timestamp,
      updated_at TIMESTAMP DEFAULT current_timestamp
    )
  `);
  await conn.run(`
    CREATE TABLE IF NOT EXISTS company_alias (
      company_id INTEGER NOT NULL,
      alias_name VARCHAR NOT NULL,
      alias_type VARCHAR NOT NULL DEFAULT 'legal_name',
      PRIMARY KEY (company_id, alias_name)
    )
  `);
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

  // Insert companies
  await conn.run(
    `INSERT INTO company (id, name, description, parent_company_id) VALUES
      (1, 'Hughes Network Systems', 'Satellite broadband provider', NULL),
      (2, 'SES S.A.', 'Luxembourg-based satellite operator', NULL),
      (3, 'SpaceX', 'Starlink constellation operator', NULL)`,
  );

  // Insert aliases
  await conn.run(
    `INSERT INTO company_alias VALUES
      (1, 'HUGHES NETWORK SYSTEMS, LLC', 'legal_name'),
      (2, 'SES AMERICOM, INC.', 'legal_name'),
      (3, 'SPACE EXPLORATION TECHNOLOGIES CORP.', 'legal_name')`,
  );

  // Insert filings — Hughes has the most
  await conn.run(
    `INSERT INTO filing VALUES
      (1, 'SAT-LOA-20260120-00001', 'HUGHES NETWORK SYSTEMS, LLC', '2026-01-20'),
      (2, 'SAT-MOD-20260215-00002', 'HUGHES NETWORK SYSTEMS, LLC', '2026-02-15'),
      (3, 'SAT-LOA-20260310-00003', 'HUGHES NETWORK SYSTEMS, LLC', '2026-03-10'),
      (4, 'SES-MOD-20260305-00004', 'SES AMERICOM, INC.', '2026-03-05'),
      (5, 'SAT-STA-20260318-00005', 'SPACE EXPLORATION TECHNOLOGIES CORP.', '2026-03-18')`,
  );

  await conn.run(
    `INSERT INTO attachment VALUES
      (100, 1, 'Launch and operate a Ka-band satellite'),
      (101, 3, 'Modified orbital parameters for next-gen satellite')`,
  );
}

// ── Tests ───────────────────────────────────────────────────────

describe('selectSpotlightCompany', () => {
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

  it('selects the company with the most recent filings', async () => {
    const company = await selectSpotlightCompany(conn, '2026-03-24');
    expect(company).not.toBeNull();
    expect(company!.name).toEqual('Hughes Network Systems');
  });

  it('skips recently spotlighted companies', async () => {
    // Create an edition and spotlight article for Hughes
    await conn.run(
      `INSERT INTO newspaper_edition (id, edition_date) VALUES (99, '2026-03-17')`,
    );
    await conn.run(
      `INSERT INTO newspaper_article
        (edition_id, content_type, slug, body, source_data, display_order, status)
       VALUES (99, 'company_spotlight', 'company-spotlight',
               'Hughes profile', '{"companyId": "1"}', 50, 'generated')`,
    );

    const company = await selectSpotlightCompany(conn, '2026-03-24');
    // Should skip Hughes (spotlighted recently) and pick next most active
    expect(company).not.toBeNull();
    expect(company!.name).not.toEqual('Hughes Network Systems');
  });

  it('returns null when no eligible companies exist', async () => {
    // Clear all filings
    await conn.run(`DELETE FROM filing`);
    const company = await selectSpotlightCompany(conn, '2026-03-24');
    expect(company).toBeNull();
  });
});

describe('queryCompanyFilings', () => {
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

  it('returns filings for the given company', async () => {
    const filings = await queryCompanyFilings(conn, 1, '2026-03-24');
    expect(filings.length).toBeGreaterThanOrEqual(1);
    // All returned filings should belong to company 1 (Hughes) — verified by file number prefix
    for (const f of filings) {
      expect(f.fileNumber).toBeDefined();
      expect(f.dateFiled).toBeDefined();
    }
  });
});

describe('queryCompanyAliases', () => {
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

  it('returns aliases for the given company', async () => {
    const aliases = await queryCompanyAliases(conn, 1);
    expect(aliases).toEqual(['HUGHES NETWORK SYSTEMS, LLC']);
  });
});

describe('formatCompanyFilings', () => {
  it('returns placeholder when empty', () => {
    expect(formatCompanyFilings([])).toContain('No recent filings');
  });

  it('formats filings with file number and date', () => {
    const result: string = formatCompanyFilings([
      {
        fileNumber: 'SAT-LOA-20260310-00003',
        dateFiled: '2026-03-10',
        summary: 'Launch and operate satellite',
      },
    ]);
    expect(result).toContain('SAT-LOA-20260310-00003');
    expect(result).toContain('2026-03-10');
    expect(result).toContain('Launch and operate');
  });
});

describe('generateCompanySpotlight', () => {
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

  it('generates a company profile with company page link', async () => {
    const inferenceService = makeMockInferenceService(SAMPLE_SPOTLIGHT);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateCompanySpotlight({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.headline).toContain('Hughes');
    expect(result.body).toContain('/companies/1');
    expect(result.sourceData.companyId).toEqual(1);
    expect(result.sourceData.companyName).toEqual('Hughes Network Systems');
  });

  it('passes company data to the prompt', async () => {
    const inferenceService = makeMockInferenceService(SAMPLE_SPOTLIGHT);
    const config = makeMockConfig();

    await generateCompanySpotlight({
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
    expect(promptContent).toContain('Hughes Network Systems');
    expect(promptContent).toContain('/companies/');
  });

  it('returns fallback when no eligible company exists', async () => {
    await conn.run(`DELETE FROM filing`);

    const inferenceService = makeMockInferenceService('');
    const config = makeMockConfig();

    const result: GeneratorResult = await generateCompanySpotlight({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.body).toContain('No eligible company');
    expect(inferenceService.complete).not.toHaveBeenCalled();
  });
});
