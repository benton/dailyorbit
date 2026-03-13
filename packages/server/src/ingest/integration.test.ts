import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { parseDdl } from './ddl-parser.ts';
import { parseRecords } from './dat-parser.ts';
import { createTable, insertBatch } from './loader.ts';
import type { TableDef } from './types.ts';

const ROOT: string = resolve(import.meta.dirname, '../../../..');
const DDL_PATH: string = resolve(ROOT, 'tmp/ibfs-schema.txt');
const DAT_DIR: string = resolve(ROOT, 'tmp/IBFS');

/**
 * Counts extra columns in parsed rows beyond the DDL definition.
 */
function countExtraColumns(rows: Record<string, unknown>[]): number {
  if (rows.length === 0) {
    return 0;
  }
  return Object.keys(rows[0]!).filter((k) => k.startsWith('_extra_')).length;
}

describe('end-to-end ingest (real data, in-memory DuckDB)', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let allTables: TableDef[];

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    const ddl: string = readFileSync(DDL_PATH, 'utf-8');
    allTables = parseDdl(ddl);
  });

  afterEach(() => {
    conn.closeSync();
  });

  function findTable(appName: string): TableDef {
    const table: TableDef | undefined = allTables.find(
      (t) => t.appName === appName,
    );
    if (table == null) {
      throw new Error(`Table "${appName}" not found in DDL`);
    }
    return table;
  }

  it('loads status_code lookup table (82 records)', async () => {
    const tableDef: TableDef = findTable('status_code');
    const buf: Buffer = readFileSync(resolve(DAT_DIR, tableDef.datFile));
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);
    const extraCount: number = countExtraColumns(rows);

    // The counts manifest says 82 rows; actual record count matches
    expect(rows.length).toBe(82);

    await createTable(conn, tableDef, extraCount);
    await insertBatch(conn, tableDef, rows, extraCount);

    const reader = await conn.runAndReadAll(
      'SELECT COUNT(*) AS cnt FROM "status_code"',
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toBe(82);

    // Spot-check a known status code
    const acReader = await conn.runAndReadAll(
      `SELECT "status_text" FROM "status_code" WHERE "status_code" = 'A/C'`,
    );
    const acRows = acReader.getRowObjectsJS();
    expect(acRows).toHaveLength(1);
    expect(acRows[0]!.status_text).toBe('Action Complete');
  });

  it('loads space_station table with dedup (144,004 raw → 837 unique PKs)', async () => {
    const tableDef: TableDef = findTable('space_station');
    const buf: Buffer = readFileSync(resolve(DAT_DIR, tableDef.datFile));
    const rawRows: Record<string, unknown>[] = parseRecords(buf, tableDef);
    const extraCount: number = countExtraColumns(rawRows);

    expect(rawRows.length).toBe(144004);

    // Deduplicate by PK (same logic as loadTable in pipeline.ts)
    const seen: Map<string, number> = new Map();
    for (let i: number = 0; i < rawRows.length; i++) {
      const key: string = tableDef.primaryKey
        .map((col) => String(rawRows[i]![col] ?? ''))
        .join('|');
      seen.set(key, i);
    }
    const uniqueIndices: number[] = [...seen.values()].sort((a, b) => a - b);
    const rows: Record<string, unknown>[] = uniqueIndices.map(
      (idx) => rawRows[idx]!,
    );

    expect(rows.length).toBe(837);

    await createTable(conn, tableDef, extraCount);
    await insertBatch(conn, tableDef, rows, extraCount);

    const reader = await conn.runAndReadAll(
      'SELECT COUNT(*) AS cnt FROM "space_station"',
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toBe(837);
  }, 60000);

  it('loads first 100 rows from filing (main.dat) with extra columns', async () => {
    const tableDef: TableDef = findTable('filing');
    const buf: Buffer = readFileSync(resolve(DAT_DIR, tableDef.datFile));
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

    // Actual record count is lower than the manifest's wc -l count
    // because the manifest counts newlines, not |^| terminators.
    // Embedded newlines in text fields inflate the line count.
    expect(rows.length).toBe(141086);

    // DDL has 53 columns; data has more
    const extraCount: number = countExtraColumns(rows);
    expect(extraCount).toBeGreaterThan(0);

    // Load a sample to verify structure
    const sample: Record<string, unknown>[] = rows.slice(0, 100);
    await createTable(conn, tableDef, extraCount);
    await insertBatch(conn, tableDef, sample, extraCount);

    const reader = await conn.runAndReadAll(
      'SELECT COUNT(*) AS cnt FROM "filing"',
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toBe(100);

    // Spot-check: first row has valid key fields
    const fkReader = await conn.runAndReadAll(
      'SELECT "filing_key", "file_number", "subsystem_code" FROM "filing" LIMIT 1',
    );
    const fkRow = fkReader.getRowObjectsJS()[0]!;
    expect(fkRow.filing_key).toEqual(expect.any(Number));
    expect(fkRow.file_number).toEqual(expect.any(String));
    expect(fkRow.subsystem_code).toEqual(expect.any(String));
  }, 30000);
});
