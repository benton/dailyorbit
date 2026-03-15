import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureCompanyTables, ensureCompanyFk } from './schema.ts';

describe('ensureCompanyTables', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('creates company, company_alias, and ownership_event tables', async () => {
    await ensureCompanyTables(conn);

    const reader = await conn.runAndReadAll(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'main'
        AND table_name IN ('company', 'company_alias', 'ownership_event')
      ORDER BY table_name
    `);
    const tables: string[] = reader
      .getRowObjectsJS()
      .map((r) => String(r.table_name));

    expect(tables).toEqual(['company', 'company_alias', 'ownership_event']);
  });

  it('company table has expected columns', async () => {
    await ensureCompanyTables(conn);

    const reader = await conn.runAndReadAll(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'company'
      ORDER BY ordinal_position
    `);
    const columns: string[] = reader
      .getRowObjectsJS()
      .map((r) => String(r.column_name));

    expect(columns).toEqual([
      'id',
      'name',
      'parent_company_id',
      'stock_ticker',
      'stock_exchange',
      'industry',
      'logo_url',
      'website',
      'description',
      'gleif_lei',
      'wikidata_id',
      'created_at',
      'updated_at',
    ]);
  });

  it('company_alias table has expected columns', async () => {
    await ensureCompanyTables(conn);

    const reader = await conn.runAndReadAll(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'company_alias'
      ORDER BY ordinal_position
    `);
    const columns: string[] = reader
      .getRowObjectsJS()
      .map((r) => String(r.column_name));

    expect(columns).toEqual(['company_id', 'alias_name', 'alias_type']);
  });

  it('ownership_event table has expected columns', async () => {
    await ensureCompanyTables(conn);

    const reader = await conn.runAndReadAll(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ownership_event'
      ORDER BY ordinal_position
    `);
    const columns: string[] = reader
      .getRowObjectsJS()
      .map((r) => String(r.column_name));

    expect(columns).toEqual([
      'event_id',
      'filing_file_number',
      'transferor_company_id',
      'transferee_company_id',
      'effective_date',
      'event_type',
      'status',
      'description',
    ]);
  });

  it('is idempotent — calling twice does not error', async () => {
    await ensureCompanyTables(conn);
    await ensureCompanyTables(conn);
  });

  it('allows inserting a company with auto-generated id', async () => {
    await ensureCompanyTables(conn);

    await conn.run(`INSERT INTO company (name) VALUES ('SpaceX')`);
    const reader = await conn.runAndReadAll(
      `SELECT id, name FROM company WHERE name = 'SpaceX'`,
    );
    const rows = reader.getRowObjectsJS();
    expect(rows.length).toEqual(1);
    expect(Number(rows[0]!.id)).toBeGreaterThan(0);
    expect(String(rows[0]!.name)).toEqual('SpaceX');
  });
});

describe('ensureCompanyFk', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(`
      CREATE TABLE filing (
        filing_key INTEGER NOT NULL PRIMARY KEY,
        file_number VARCHAR NOT NULL
      )
    `);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('adds company_id column to filing table', async () => {
    await ensureCompanyFk(conn);

    const reader = await conn.runAndReadAll(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'filing'
      ORDER BY ordinal_position
    `);
    const columns: string[] = reader
      .getRowObjectsJS()
      .map((r) => String(r.column_name));

    expect(columns).toContain('company_id');
  });

  it('is idempotent — calling twice does not error', async () => {
    await ensureCompanyFk(conn);
    await ensureCompanyFk(conn);
  });

  it('preserves existing filing data', async () => {
    await conn.run(
      `INSERT INTO filing (filing_key, file_number) VALUES (1, 'SAT-LOA-20250221-00050')`,
    );

    await ensureCompanyFk(conn);

    const reader = await conn.runAndReadAll(
      `SELECT file_number FROM filing WHERE filing_key = 1`,
    );
    expect(String(reader.getRowObjectsJS()[0]!.file_number)).toEqual(
      'SAT-LOA-20250221-00050',
    );
  });
});
