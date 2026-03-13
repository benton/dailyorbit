import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  parseCountsManifest,
  loadTable,
  runIngest,
} from './pipeline.ts';
import type { IngestResult, LoadTableResult } from './pipeline.ts';
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

describe('runIngest ingest_log recording', () => {
  it('creates an ingest_log row with status completed on success', async () => {
    const result: IngestResult = await runIngest({
      databaseUrl: ':memory:',
      ddlPath: DDL_PATH,
      datDir: DAT_DIR,
      tables: ['status_code'],
      onProgress: () => {},
    });

    expect(result.ingestId).toBeGreaterThan(0);
    expect(result.tablesLoaded).toHaveLength(1);
    expect(result.tablesLoaded[0]!.tableName).toBe('status_code');

    // Verify the ingest_log row by opening a fresh connection to the same DB
    // Since we used :memory:, the DB is gone after conn closes.
    // Instead, we need to test with a file-based DB or check within runIngest.
    // For an in-memory test, we re-run with a temp file.
  });

  it('records completed status and valid table_results JSON in ingest_log', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { dirname } = await import('node:path');
    const tmpDir: string = mkdtempSync(resolve(tmpdir(), 'ingest-test-'));
    const dbPath: string = resolve(tmpDir, 'test.duckdb');

    const result: IngestResult = await runIngest({
      databaseUrl: dbPath,
      ddlPath: DDL_PATH,
      datDir: DAT_DIR,
      tables: ['status_code'],
      sourceUrl: 'https://example.com/ibfs.zip',
      zipSizeBytes: 12345,
      onProgress: () => {},
    });

    expect(result.ingestId).toBeGreaterThan(0);

    // Re-open DB and verify ingest_log contents
    const db: DuckDBInstance = await DuckDBInstance.create(dbPath);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);

    // Force checkpoint to ensure WAL is flushed
    await conn.run('CHECKPOINT');

    const reader = await conn.runAndReadAll(
      'SELECT "status", "source_url", "zip_size_bytes", "table_results", "error_message" FROM "ingest_log"',
    );
    const rows = reader.getRowObjectsJS();
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.status).toBe('completed');
    expect(row.source_url).toBe('https://example.com/ibfs.zip');
    expect(Number(row.zip_size_bytes)).toBe(12345);
    expect(row.error_message).toBeNull();

    // Verify table_results is valid JSON with loaded table names
    const tableResults: LoadTableResult[] = JSON.parse(
      row.table_results as string,
    ) as LoadTableResult[];
    expect(tableResults).toHaveLength(1);
    expect(tableResults[0]!.tableName).toBe('status_code');
    expect(tableResults[0]!.recordCount).toBe(82);

    conn.closeSync();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
