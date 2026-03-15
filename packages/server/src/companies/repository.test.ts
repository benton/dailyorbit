import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DuckDBValue } from '@duckdb/node-api';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureCompanyTables, ensureCompanyFk } from './schema.ts';
import {
  addAlias,
  createCompany,
  createOwnershipEvent,
  extractOwnershipEvents,
  getAttributionStats,
  getCompanyByAlias,
  getCompanyById,
  getCompanyDetail,
  getCompanyFilings,
  getOwnershipEventsForCompany,
  listCompanies,
  removeAlias,
  searchCompanies,
  updateCompany,
} from './repository.ts';

describe('company repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    // Create base filing table
    await conn.run(`
      CREATE TABLE filing (
        filing_key INTEGER NOT NULL PRIMARY KEY,
        file_number VARCHAR NOT NULL,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        status_code VARCHAR,
        address_attention VARCHAR,
        applicant_frn VARCHAR,
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

  // ── Company CRUD ──────────────────────────────────────────────────

  describe('createCompany / getCompanyById', () => {
    it('creates a company and retrieves it by id', async () => {
      const company = await createCompany(conn, {
        name: 'SpaceX',
        stockTicker: null,
        website: 'https://spacex.com',
      });

      expect(company.name).toEqual('SpaceX');
      expect(company.website).toEqual('https://spacex.com');
      expect(company.id).toBeGreaterThan(0);

      const fetched = await getCompanyById(conn, company.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toEqual('SpaceX');
    });

    it('returns null for non-existent id', async () => {
      const fetched = await getCompanyById(conn, 99999);
      expect(fetched).toBeNull();
    });
  });

  describe('updateCompany', () => {
    it('updates specified fields without touching others', async () => {
      const company = await createCompany(conn, {
        name: 'SpaceX',
        website: 'https://spacex.com',
      });

      const updated = await updateCompany(conn, company.id, {
        stockTicker: 'SPACEX',
        stockExchange: 'PRIVATE',
      });

      expect(updated!.stockTicker).toEqual('SPACEX');
      expect(updated!.stockExchange).toEqual('PRIVATE');
      expect(updated!.website).toEqual('https://spacex.com');
    });

    it('returns null for non-existent company', async () => {
      const result = await updateCompany(conn, 99999, { name: 'Ghost' });
      expect(result).toBeNull();
    });
  });

  describe('listCompanies', () => {
    it('returns paginated list of companies with filing counts', async () => {
      await createCompany(conn, { name: 'SpaceX' });
      await createCompany(conn, { name: 'SES' });
      await createCompany(conn, { name: 'Intelsat' });

      const result = await listCompanies(conn, { page: 1, pageSize: 2 });

      expect(result.data.length).toEqual(2);
      expect(result.totalRows).toEqual(3);
      expect(result.totalPages).toEqual(2);
    });

    it('returns empty list when no companies exist', async () => {
      const result = await listCompanies(conn, {});
      expect(result.data).toEqual([]);
      expect(result.totalRows).toEqual(0);
    });
  });

  // ── Alias operations ──────────────────────────────────────────────

  describe('addAlias / removeAlias / getCompanyByAlias', () => {
    it('adds alias and retrieves company by exact match', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });
      await addAlias(conn, company.id, 'Space Exploration Holdings LLC');

      const found = await getCompanyByAlias(
        conn,
        'Space Exploration Holdings LLC',
      );
      expect(found).not.toBeNull();
      expect(found!.id).toEqual(company.id);
    });

    it('retrieves company by case-insensitive match', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });
      await addAlias(conn, company.id, 'SpaceX Services Inc.');

      const found = await getCompanyByAlias(conn, 'SPACEX SERVICES INC.');
      expect(found).not.toBeNull();
      expect(found!.id).toEqual(company.id);
    });

    it('returns null when no alias matches', async () => {
      const found = await getCompanyByAlias(conn, 'Nonexistent Corp');
      expect(found).toBeNull();
    });

    it('removes an alias', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });
      await addAlias(conn, company.id, 'SpaceX Services Inc.');
      await removeAlias(conn, company.id, 'SpaceX Services Inc.');

      const found = await getCompanyByAlias(conn, 'SpaceX Services Inc.');
      expect(found).toBeNull();
    });

    it('adding duplicate alias is a no-op', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });
      await addAlias(conn, company.id, 'SpaceX Services Inc.');
      await addAlias(conn, company.id, 'SpaceX Services Inc.');

      const reader = await conn.runAndReadAll(
        `SELECT count(*)::INTEGER AS cnt FROM company_alias WHERE company_id = $1`,
        [company.id] as DuckDBValue[],
      );
      expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(1);
    });
  });

  // ── Search ────────────────────────────────────────────────────────

  describe('searchCompanies', () => {
    it('finds companies by partial name match', async () => {
      await createCompany(conn, { name: 'SpaceX' });
      await createCompany(conn, { name: 'SES S.A.' });

      const results = await searchCompanies(conn, 'space');
      expect(results.length).toEqual(1);
      expect(results[0]!.name).toEqual('SpaceX');
    });

    it('finds companies by alias match', async () => {
      const company = await createCompany(conn, { name: 'SES' });
      await addAlias(conn, company.id, 'SES Americom Inc.');

      const results = await searchCompanies(conn, 'Americom');
      expect(results.length).toEqual(1);
      expect(results[0]!.name).toEqual('SES');
    });
  });

  // ── Company detail ────────────────────────────────────────────────

  describe('getCompanyDetail', () => {
    it('returns full detail with aliases, subsidiaries, and filing count', async () => {
      const parent = await createCompany(conn, { name: 'EchoStar' });
      const child = await createCompany(conn, {
        name: 'Hughes Network Systems',
        parentCompanyId: parent.id,
      });
      await addAlias(conn, parent.id, 'EchoStar Corporation');

      // Add a filing attributed to the subsidiary
      await conn.run(
        `INSERT INTO filing (filing_key, file_number, company_id) VALUES (1, 'SAT-LOA-20250101-00001', $1)`,
        [child.id] as DuckDBValue[],
      );

      const detail = await getCompanyDetail(conn, parent.id);
      expect(detail).not.toBeNull();
      expect(detail!.company.name).toEqual('EchoStar');
      expect(detail!.aliases.length).toEqual(1);
      expect(detail!.aliases[0]!.aliasName).toEqual('EchoStar Corporation');
      expect(detail!.subsidiaries.length).toEqual(1);
      expect(detail!.subsidiaries[0]!.name).toEqual('Hughes Network Systems');
      expect(detail!.filingCount).toEqual(1);
    });

    it('returns null for non-existent company', async () => {
      const detail = await getCompanyDetail(conn, 99999);
      expect(detail).toBeNull();
    });
  });

  // ── Attribution stats ─────────────────────────────────────────────

  describe('getAttributionStats', () => {
    it('returns correct coverage statistics', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });

      await conn.run(
        `INSERT INTO filing (filing_key, file_number, address_attention, company_id) VALUES
         (1, 'SAT-LOA-20250101-00001', 'SpaceX Services', $1),
         (2, 'SAT-LOA-20250102-00002', 'Unknown Corp', NULL),
         (3, 'SAT-LOA-20250103-00003', 'Another Unknown', NULL)`,
        [company.id] as DuckDBValue[],
      );

      const stats = await getAttributionStats(conn);
      expect(stats.totalFilings).toEqual(3);
      expect(stats.attributedFilings).toEqual(1);
      expect(stats.unattributedFilings).toEqual(2);
      expect(stats.coveragePercent).toEqual(33.33);
      expect(stats.topUnattributedNames.length).toEqual(2);
      expect(stats.topUnattributedNames[0]!.count).toEqual(1);
    });
  });

  // ── Company filings ───────────────────────────────────────────────

  describe('getCompanyFilings', () => {
    it('returns filings for company and subsidiaries, paginated', async () => {
      const parent = await createCompany(conn, { name: 'SES' });
      const child = await createCompany(conn, {
        name: 'O3b Limited',
        parentCompanyId: parent.id,
      });

      await conn.run(
        `INSERT INTO filing (filing_key, file_number, subsystem_code, app_type_code, date_filed, company_id) VALUES
         (1, 'SAT-LOA-20250101-00001', 'SAT', 'LOA', '2025-01-01', $1),
         (2, 'SAT-MOD-20250201-00002', 'SAT', 'MOD', '2025-02-01', $2),
         (3, 'SAT-LOA-20250301-00003', 'SAT', 'LOA', '2025-03-01', NULL)`,
        [parent.id, child.id] as DuckDBValue[],
      );

      const result = await getCompanyFilings(conn, parent.id, {
        page: 1,
        pageSize: 10,
      });
      expect(result.totalRows).toEqual(2);
      expect(result.data.length).toEqual(2);
    });
  });

  // ── Ownership events ──────────────────────────────────────────────

  describe('createOwnershipEvent / getOwnershipEventsForCompany', () => {
    it('creates and retrieves ownership events', async () => {
      const transferor = await createCompany(conn, { name: 'DISH' });
      const transferee = await createCompany(conn, { name: 'EchoStar' });

      const event = await createOwnershipEvent(conn, {
        filingFileNumber: 'SAT-T/C-20250101-00001',
        transferorCompanyId: transferor.id,
        transfereeCompanyId: transferee.id,
        effectiveDate: '2025-01-15',
        eventType: 'transfer_of_control',
        status: 'granted',
        description: 'Transfer of DISH satellite licenses to EchoStar',
      });

      expect(event.eventId).toBeGreaterThan(0);
      expect(event.eventType).toEqual('transfer_of_control');

      const transferorEvents = await getOwnershipEventsForCompany(
        conn,
        transferor.id,
      );
      expect(transferorEvents.length).toEqual(1);

      const transfereeEvents = await getOwnershipEventsForCompany(
        conn,
        transferee.id,
      );
      expect(transfereeEvents.length).toEqual(1);
    });
  });

  describe('extractOwnershipEvents', () => {
    it('creates ownership events from T/C and ASG filings', async () => {
      const dish = await createCompany(conn, { name: 'DISH' });
      const echostar = await createCompany(conn, { name: 'EchoStar' });
      await addAlias(conn, dish.id, 'DISH Network Corporation');
      await addAlias(conn, echostar.id, 'EchoStar Corporation');

      await conn.run(`
        INSERT INTO filing (filing_key, file_number, app_type_code, status_code, transferor_name, transferee_name, date_filed, brief_description)
        VALUES
          (1, 'SAT-T/C-20250101-00001', 'T/C', 'G', 'DISH Network Corporation', 'EchoStar Corporation', '2025-01-01', 'Transfer of control'),
          (2, 'SAT-ASG-20250201-00002', 'ASG', 'P', 'DISH Network Corporation', NULL, '2025-02-01', 'Assignment'),
          (3, 'SAT-LOA-20250301-00003', 'LOA', 'G', NULL, NULL, '2025-03-01', 'New application')
      `);

      const result = await extractOwnershipEvents(conn);
      // Filing 1: both parties matched -> created
      // Filing 2: only transferor matched -> created
      // Filing 3: not T/C or ASG -> ignored
      expect(result.created).toEqual(2);
      expect(result.skipped).toEqual(0);

      const dishEvents = await getOwnershipEventsForCompany(conn, dish.id);
      expect(dishEvents.length).toEqual(2);
    });

    it('skips filings where neither party is identified', async () => {
      await conn.run(`
        INSERT INTO filing (filing_key, file_number, app_type_code, transferor_name, transferee_name)
        VALUES (1, 'SAT-T/C-20250101-00001', 'T/C', 'Unknown Corp', 'Another Unknown')
      `);

      const result = await extractOwnershipEvents(conn);
      expect(result.created).toEqual(0);
      expect(result.skipped).toEqual(1);
    });

    it('is idempotent — does not create duplicate events', async () => {
      const company = await createCompany(conn, { name: 'SpaceX' });
      await addAlias(conn, company.id, 'SpaceX Services');

      await conn.run(`
        INSERT INTO filing (filing_key, file_number, app_type_code, transferor_name, transferee_name)
        VALUES (1, 'SAT-T/C-20250101-00001', 'T/C', 'SpaceX Services', NULL)
      `);

      await extractOwnershipEvents(conn);
      const result2 = await extractOwnershipEvents(conn);
      expect(result2.created).toEqual(0);
    });
  });
});
