import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  createTable,
  insertBatch,
  upsertBatch,
  generateCreateTableSql,
} from './loader.ts';
import type { TableDef } from './types.ts';

const STATUS_CODE_TABLE: TableDef = {
  ddlName: 'STATUS_CODE',
  appName: 'status_code',
  datFile: 'status_code.dat',
  columns: [
    {
      name: 'status_code',
      sybaseType: 'char(5)',
      duckdbType: 'VARCHAR',
      nullable: false,
    },
    {
      name: 'description',
      sybaseType: 'varchar(40)',
      duckdbType: 'VARCHAR',
      nullable: true,
    },
    {
      name: 'active_sw',
      sybaseType: 'char(1)',
      duckdbType: 'VARCHAR',
      nullable: true,
    },
    {
      name: 'active_date',
      sybaseType: 'datetime',
      duckdbType: 'TIMESTAMP',
      nullable: true,
    },
  ],
  primaryKey: ['status_code'],
};

const FILING_TABLE: TableDef = {
  ddlName: 'MAIN',
  appName: 'filing',
  datFile: 'main.dat',
  columns: [
    {
      name: 'filing_key',
      sybaseType: 'int',
      duckdbType: 'INTEGER',
      nullable: false,
    },
    {
      name: 'callsign',
      sybaseType: 'char(10)',
      duckdbType: 'VARCHAR',
      nullable: true,
    },
    {
      name: 'file_number',
      sybaseType: 'char(19)',
      duckdbType: 'VARCHAR',
      nullable: false,
    },
  ],
  primaryKey: ['filing_key'],
};

describe('generateCreateTableSql', () => {
  it('generates DDL with correct types, nullability, and change tracking columns', () => {
    const sql: string = generateCreateTableSql(STATUS_CODE_TABLE);

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "status_code"');
    expect(sql).toContain('"status_code" VARCHAR NOT NULL');
    expect(sql).toContain('"description" VARCHAR');
    expect(sql).toContain('"active_date" TIMESTAMP');
    expect(sql).toContain('"_first_seen_at" TIMESTAMP');
    expect(sql).toContain('"_last_seen_at" TIMESTAMP');
    expect(sql).toContain('"_modified_at" TIMESTAMP');
  });

  it('uses appName (filing) not ddlName (MAIN) for the table name', () => {
    const sql: string = generateCreateTableSql(FILING_TABLE);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "filing"');
    expect(sql).not.toContain('"MAIN"');
  });

  it('adds extra columns as VARCHAR', () => {
    const sql: string = generateCreateTableSql(STATUS_CODE_TABLE, 2);
    expect(sql).toContain('"_extra_5" VARCHAR');
    expect(sql).toContain('"_extra_6" VARCHAR');
  });
});

describe('createTable + insertBatch (in-memory DuckDB)', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('creates a table and inserts rows via Appender', async () => {
    await createTable(conn, STATUS_CODE_TABLE);

    const rows: Record<string, unknown>[] = [
      {
        status_code: 'GRA',
        description: 'Granted',
        active_sw: 'Y',
        active_date: '1996-02-28T00:00:00.000',
      },
      {
        status_code: 'DFT',
        description: 'Draft',
        active_sw: 'N',
        active_date: null,
      },
    ];

    await insertBatch(conn, STATUS_CODE_TABLE, rows);

    const reader = await conn.runAndReadAll(
      'SELECT * FROM "status_code" ORDER BY "status_code"',
    );
    const result = reader.getRowObjectsJS();

    expect(result).toHaveLength(2);
    expect(result[0]!.status_code).toBe('DFT');
    expect(result[0]!.description).toBe('Draft');
    expect(result[1]!.status_code).toBe('GRA');
    expect(result[1]!.active_sw).toBe('Y');
  });

  it('inserts rows with extra columns', async () => {
    await createTable(conn, STATUS_CODE_TABLE, 2);

    const rows: Record<string, unknown>[] = [
      {
        status_code: 'GRA',
        description: 'Granted',
        active_sw: 'Y',
        active_date: null,
        _extra_5: 'bonus1',
        _extra_6: 'bonus2',
      },
    ];

    await insertBatch(conn, STATUS_CODE_TABLE, rows, 2);

    const reader = await conn.runAndReadAll(
      'SELECT "_extra_5", "_extra_6" FROM "status_code"',
    );
    const result = reader.getRowObjectsJS();

    expect(result[0]!._extra_5).toBe('bonus1');
    expect(result[0]!._extra_6).toBe('bonus2');
  });

  it('sets change tracking columns on insert', async () => {
    await createTable(conn, STATUS_CODE_TABLE);

    const rows: Record<string, unknown>[] = [
      {
        status_code: 'GRA',
        description: 'Granted',
        active_sw: 'Y',
        active_date: null,
      },
    ];

    await insertBatch(conn, STATUS_CODE_TABLE, rows);

    const reader = await conn.runAndReadAll(
      'SELECT "_first_seen_at", "_last_seen_at", "_modified_at" FROM "status_code"',
    );
    const result = reader.getRowObjectsJS();

    expect(result[0]!._first_seen_at).not.toBeNull();
    expect(result[0]!._last_seen_at).not.toBeNull();
    expect(result[0]!._modified_at).not.toBeNull();
  });
});

describe('upsertBatch (staging + MERGE)', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('inserts new rows on first upsert', async () => {
    await createTable(conn, FILING_TABLE);

    const rows: Record<string, unknown>[] = [
      { filing_key: 1, callsign: 'ABC', file_number: 'SAT-LOA-20040701' },
      { filing_key: 2, callsign: 'DEF', file_number: 'SES-LIC-20050101' },
    ];

    await upsertBatch(conn, FILING_TABLE, rows);

    const reader = await conn.runAndReadAll(
      'SELECT "filing_key", "callsign" FROM "filing" ORDER BY "filing_key"',
    );
    const result = reader.getRowObjectsJS();
    expect(result).toHaveLength(2);
    expect(result[0]!.callsign).toBe('ABC');
    expect(result[1]!.callsign).toBe('DEF');
  });

  it('updates modified rows and preserves unchanged rows', async () => {
    await createTable(conn, FILING_TABLE);

    // Initial load
    const initialRows: Record<string, unknown>[] = [
      { filing_key: 1, callsign: 'ABC', file_number: 'SAT-LOA-20040701' },
      { filing_key: 2, callsign: 'DEF', file_number: 'SES-LIC-20050101' },
    ];
    await upsertBatch(conn, FILING_TABLE, initialRows);

    // Second load: filing_key=1 modified, filing_key=2 unchanged
    const updatedRows: Record<string, unknown>[] = [
      { filing_key: 1, callsign: 'XYZ', file_number: 'SAT-LOA-20040701' },
      { filing_key: 2, callsign: 'DEF', file_number: 'SES-LIC-20050101' },
    ];
    await upsertBatch(conn, FILING_TABLE, updatedRows);

    const reader = await conn.runAndReadAll(
      'SELECT "filing_key", "callsign", "_modified_at", "_last_seen_at" FROM "filing" ORDER BY "filing_key"',
    );
    const result = reader.getRowObjectsJS();

    expect(result).toHaveLength(2);
    // Modified row should have updated callsign
    expect(result[0]!.callsign).toBe('XYZ');
    // Both should have _last_seen_at updated
    expect(result[0]!._last_seen_at).not.toBeNull();
    expect(result[1]!._last_seen_at).not.toBeNull();
  });

  it('preserves rows not present in new snapshot (soft delete)', async () => {
    await createTable(conn, FILING_TABLE);

    // Initial load with 2 rows
    const initialRows: Record<string, unknown>[] = [
      { filing_key: 1, callsign: 'ABC', file_number: 'SAT-LOA-20040701' },
      { filing_key: 2, callsign: 'DEF', file_number: 'SES-LIC-20050101' },
    ];
    await upsertBatch(conn, FILING_TABLE, initialRows);

    // Second load with only 1 row — filing_key=2 is "deleted" from snapshot
    const newRows: Record<string, unknown>[] = [
      { filing_key: 1, callsign: 'ABC', file_number: 'SAT-LOA-20040701' },
    ];
    await upsertBatch(conn, FILING_TABLE, newRows);

    const reader = await conn.runAndReadAll(
      'SELECT COUNT(*) AS cnt FROM "filing"',
    );
    const result = reader.getRowObjectsJS();
    // Both rows should still exist (soft delete — row 2 is preserved)
    expect(Number(result[0]!.cnt)).toBe(2);
  });
});
