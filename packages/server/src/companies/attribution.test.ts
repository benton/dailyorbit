import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DuckDBValue } from '@duckdb/node-api';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureCompanyTables, ensureCompanyFk } from './schema.ts';
import { addAlias, createCompany } from './repository.ts';
import {
  attributeFiling,
  runBatchAttribution,
  seedCompanies,
} from './attribution.ts';
import { COMPANY_SEED_DATA } from './seed-data.ts';

describe('attribution engine', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    await conn.run(`
      CREATE TABLE filing (
        filing_key INTEGER NOT NULL PRIMARY KEY,
        file_number VARCHAR NOT NULL,
        address_attention VARCHAR,
        applicant_frn VARCHAR,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        status_code VARCHAR,
        date_filed DATE,
        callsign VARCHAR,
        brief_description VARCHAR,
        transferor_name VARCHAR,
        transferee_name VARCHAR
      )
    `);

    await ensureCompanyTables(conn);
    await ensureCompanyFk(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  // ── attributeFiling ───────────────────────────────────────────────

  describe('attributeFiling', () => {
    it('matches by exact alias name (tier 1)', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });
      await addAlias(conn, company.id, 'Space Exploration Holdings, LLC');

      const result = await attributeFiling(
        conn,
        'Space Exploration Holdings, LLC',
        null,
      );
      expect(result).toEqual(company.id);
    });

    it('matches by case-insensitive alias (tier 2)', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });
      await addAlias(conn, company.id, 'SpaceX Services, Inc.');

      const result = await attributeFiling(conn, 'SPACEX SERVICES, INC.', null);
      expect(result).toEqual(company.id);
    });

    it('matches by prefix alias (tier 3)', async () => {
      const company = await createCompany(conn, { name: 'Comcast' });
      await addAlias(conn, company.id, 'Comcast of ', 'prefix');

      const result = await attributeFiling(
        conn,
        'Comcast of Florida/Michigan/New Mexico/Pennsylvania/Washington, LLC',
        null,
      );
      expect(result).toEqual(company.id);
    });

    it('prefix alias is case-insensitive', async () => {
      const company = await createCompany(conn, { name: 'Charter' });
      await addAlias(conn, company.id, 'Charter Communications', 'prefix');

      const result = await attributeFiling(
        conn,
        'CHARTER COMMUNICATIONS ENTERTAINMENT I, LLC',
        null,
      );
      expect(result).toEqual(company.id);
    });

    it('matches by FRN clustering (tier 4)', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });

      // Pre-existing filing with same FRN already attributed
      await conn.run(
        `INSERT INTO filing (filing_key, file_number, applicant_frn, company_id)
         VALUES (1, 'SAT-LOA-20250101-00001', '0012345678', $1)`,
        [company.id] as DuckDBValue[],
      );

      // New filing with same FRN, no alias match
      const result = await attributeFiling(
        conn,
        'Some Unknown Name',
        '0012345678',
      );
      expect(result).toEqual(company.id);
    });

    it('returns null when no match found', async () => {
      const result = await attributeFiling(conn, 'Totally Unknown Corp', null);
      expect(result).toBeNull();
    });

    it('returns null for null/empty name and no FRN', async () => {
      const result = await attributeFiling(conn, null, null);
      expect(result).toBeNull();
    });

    it('tries FRN clustering when name is null but FRN is present', async () => {
      const company = await createCompany(conn, { name: 'SES' });
      await conn.run(
        `INSERT INTO filing (filing_key, file_number, applicant_frn, company_id)
         VALUES (1, 'SAT-LOA-20250101-00001', '9999999999', $1)`,
        [company.id] as DuckDBValue[],
      );

      const result = await attributeFiling(conn, null, '9999999999');
      expect(result).toEqual(company.id);
    });
  });

  // ── runBatchAttribution ───────────────────────────────────────────

  describe('runBatchAttribution', () => {
    it('attributes unattributed filings and returns counts', async () => {
      const spacex = await createCompany(conn, { name: 'SpaceX' });
      await addAlias(conn, spacex.id, 'SpaceX Services, Inc.');

      await conn.run(`
        INSERT INTO filing (filing_key, file_number, address_attention, applicant_frn) VALUES
          (1, 'SAT-LOA-20250101-00001', 'SpaceX Services, Inc.', NULL),
          (2, 'SAT-LOA-20250102-00002', 'Unknown Corp', NULL),
          (3, 'SAT-LOA-20250103-00003', 'SpaceX Services, Inc.', NULL)
      `);

      const result = await runBatchAttribution(conn);
      expect(result.attributed).toEqual(2);
      expect(result.skipped).toEqual(1);

      // Verify the filings were actually updated
      const reader = await conn.runAndReadAll(
        `SELECT count(*)::INTEGER AS cnt FROM filing WHERE company_id IS NOT NULL`,
      );
      expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(2);
    });

    it('does not re-attribute already attributed filings', async () => {
      const company = await createCompany(conn, { name: 'SES' });
      await addAlias(conn, company.id, 'SES Americom');

      await conn.run(
        `INSERT INTO filing (filing_key, file_number, address_attention, company_id)
         VALUES (1, 'SAT-LOA-20250101-00001', 'SES Americom', $1)`,
        [company.id] as DuckDBValue[],
      );

      const result = await runBatchAttribution(conn);
      expect(result.attributed).toEqual(0);
      expect(result.skipped).toEqual(0);
    });
  });

  // ── seedCompanies ─────────────────────────────────────────────────

  describe('seedCompanies', () => {
    it('creates companies and aliases from seed data', async () => {
      const testSeed = [
        {
          name: 'TestCorp',
          ticker: 'TC',
          exchange: 'NYSE',
          website: 'https://test.com',
          parentRef: null,
          aliases: ['TestCorp', 'Test Corporation', 'TC Inc.'],
        },
        {
          name: 'TestSub',
          ticker: null,
          exchange: null,
          website: null,
          parentRef: 'TestCorp',
          aliases: ['TestSub', 'Test Subsidiary LLC'],
        },
      ];

      const result = await seedCompanies(conn, testSeed);
      expect(result.created).toEqual(2);
      expect(result.aliasesAdded).toEqual(5);

      // Verify parent relationship was set
      const sub = await conn.runAndReadAll(
        `SELECT parent_company_id FROM company WHERE name = 'TestSub'`,
      );
      const parentId = Number(sub.getRowObjectsJS()[0]!.parent_company_id);
      const parent = await conn.runAndReadAll(
        `SELECT id FROM company WHERE name = 'TestCorp'`,
      );
      expect(parentId).toEqual(Number(parent.getRowObjectsJS()[0]!.id));
    });

    it('is idempotent — running twice does not duplicate companies', async () => {
      const testSeed = [
        {
          name: 'TestCorp',
          ticker: null,
          exchange: null,
          website: null,
          parentRef: null,
          aliases: ['TestCorp'],
        },
      ];

      await seedCompanies(conn, testSeed);
      const result2 = await seedCompanies(conn, testSeed);
      expect(result2.created).toEqual(0);

      const reader = await conn.runAndReadAll(
        `SELECT count(*)::INTEGER AS cnt FROM company`,
      );
      expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(1);
    });

    it('seeds prefix aliases with correct alias_type', async () => {
      const testSeed = [
        {
          name: 'TestCorp',
          ticker: null,
          exchange: null,
          website: null,
          parentRef: null,
          aliases: ['TestCorp'],
          prefixAliases: ['TestCorp of '],
        },
      ];

      await seedCompanies(conn, testSeed);

      const reader = await conn.runAndReadAll(
        `SELECT alias_name, alias_type FROM company_alias WHERE alias_type = 'prefix'`,
      );
      const rows = reader.getRowObjectsJS();
      expect(rows).toHaveLength(1);
      expect(String(rows[0]!.alias_name)).toEqual('TestCorp of ');
      expect(String(rows[0]!.alias_type)).toEqual('prefix');
    });

    it('seeds from the actual COMPANY_SEED_DATA without error', async () => {
      const result = await seedCompanies(conn, COMPANY_SEED_DATA);
      expect(result.created).toBeGreaterThan(25);
      expect(result.aliasesAdded).toBeGreaterThan(50);
    });
  });
});
