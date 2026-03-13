import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { parseCountsManifest, loadTable } from './pipeline.ts';
import { createMetadataTables, loadTableDefsFromDdl } from './schema.ts';
import type { TableDef } from './types.ts';

const ROOT: string = resolve(import.meta.dirname, '../../../..');
const DDL_PATH: string = resolve(ROOT, 'tmp/ibfs-schema.txt');
const DAT_DIR: string = resolve(ROOT, 'tmp/IBFS');
const COUNTS_PATH: string = resolve(ROOT, 'tmp/IBFS/counts');

describe('parseCountsManifest', () => {
  it('parses wc -l style manifest into filename→count map', () => {
    const manifest: string = [
      '    82 /opt/ibfsbatch/daily_download/output/status_code.dat',
      '  160001 /opt/ibfsbatch/daily_download/output/main.dat',
      ' 3529236 total',
    ].join('\n');

    const counts: Map<string, number> = parseCountsManifest(manifest);

    expect(counts.get('status_code.dat')).toBe(82);
    expect(counts.get('main.dat')).toBe(160001);
    expect(counts.has('total')).toBe(false);
  });

  it('parses the real counts file', () => {
    const manifest: string = readFileSync(COUNTS_PATH, 'utf-8');
    const counts: Map<string, number> = parseCountsManifest(manifest);

    expect(counts.get('status_code.dat')).toBe(82);
    expect(counts.get('main.dat')).toBe(160001);
    expect(counts.size).toBeGreaterThan(60);
  });
});

describe('loadTable', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let allTables: TableDef[];

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    allTables = loadTableDefsFromDdl(DDL_PATH);
    await createMetadataTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('loads a lookup table and returns row count', async () => {
    const tableDef: TableDef = allTables.find(
      (t) => t.appName === 'status_code',
    )!;
    const result = await loadTable(conn, tableDef, DAT_DIR);

    expect(result.tableName).toBe('status_code');
    expect(result.recordCount).toBe(82);
    expect(result.extraColumnCount).toBeGreaterThanOrEqual(0);

    const reader = await conn.runAndReadAll(
      'SELECT COUNT(*) AS cnt FROM "status_code"',
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toBe(82);
  });

  it('loads the same table twice via upsert without duplicating rows', async () => {
    const tableDef: TableDef = allTables.find(
      (t) => t.appName === 'status_code',
    )!;

    await loadTable(conn, tableDef, DAT_DIR);
    await loadTable(conn, tableDef, DAT_DIR);

    const reader = await conn.runAndReadAll(
      'SELECT COUNT(*) AS cnt FROM "status_code"',
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toBe(82);
  });

  it('records unknown extra columns in unknown_columns table', async () => {
    const tableDef: TableDef = allTables.find((t) => t.appName === 'filing')!;
    const result = await loadTable(conn, tableDef, DAT_DIR, { sampleSize: 10 });

    expect(result.extraColumnCount).toBeGreaterThan(0);

    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM "unknown_columns" WHERE "table_name" = 'filing'`,
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toBe(
      result.extraColumnCount,
    );
  }, 30000);
});
