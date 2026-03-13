import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import {
  DuckDBConnection as DuckDBConn,
  DuckDBInstance,
} from '@duckdb/node-api';
import { parseRecords } from './dat-parser.ts';
import { createTable, insertBatch, upsertBatch } from './loader.ts';
import { createMetadataTables, loadTableDefsFromDdl } from './schema.ts';
import type { TableDef } from './types.ts';

/** Options for the full ingest pipeline */
export type IngestOptions = {
  /** Path to the DuckDB database file */
  databaseUrl?: string | undefined;
  /** Existing DuckDB instance to use (e.g. from getDb()). Takes precedence over databaseUrl. */
  dbInstance?: DuckDBInstance | undefined;
  /** Path to the Sybase DDL file (tmp/ibfs-schema.txt) */
  ddlPath: string;
  /** Path to the directory containing .dat files (tmp/IBFS/) */
  datDir: string;
  /** Only load these tables (by appName). If empty/undefined, load all available. */
  tables?: string[] | undefined;
  /** If true, parse and validate only — no DB writes */
  dryRun?: boolean;
  /** URL the zip was downloaded from (recorded in ingest log) */
  sourceUrl?: string | undefined;
  /** Size of the downloaded zip in bytes (recorded in ingest log) */
  zipSizeBytes?: number | undefined;
  /** Callback for progress reporting */
  onProgress?: (message: string) => void;
};

/** Result of the full ingest pipeline */
export type IngestResult = {
  ingestId: number;
  tablesLoaded: LoadTableResult[];
  tablesSkipped: string[];
  totalRecords: number;
  durationMs: number;
};

/**
 * Runs the full ingest pipeline: validate, parse, load, reconcile.
 *
 * Assumes data has already been downloaded and extracted to datDir.
 * (Download + extract is handled separately by the CLI command.)
 */
export async function runIngest(options: IngestOptions): Promise<IngestResult> {
  const start: number = Date.now();
  const log: (message: string) => void = options.onProgress ?? console.log;

  // Stage 1: Load table definitions from DDL
  log('Loading table definitions...');
  const allTableDefs: TableDef[] = loadTableDefsFromDdl(options.ddlPath);

  // Filter to requested tables if specified
  const requestedTables: TableDef[] =
    options.tables != null && options.tables.length > 0
      ? allTableDefs.filter((t) => options.tables!.includes(t.appName))
      : allTableDefs;

  // Stage 2: Validate — check which .dat files exist
  const availableTables: TableDef[] = [];
  const skippedTables: string[] = [];

  for (const tableDef of requestedTables) {
    const datPath: string = resolve(options.datDir, tableDef.datFile);
    if (existsSync(datPath) && statSync(datPath).size > 0) {
      availableTables.push(tableDef);
    } else {
      skippedTables.push(tableDef.appName);
    }
  }

  log(
    `Found ${String(availableTables.length)} tables with data, ${String(skippedTables.length)} skipped (no .dat file or empty)`,
  );

  // Stage 3: Validate counts manifest if available
  const countsPath: string = resolve(options.datDir, 'counts');
  if (existsSync(countsPath)) {
    const manifest: string = readFileSync(countsPath, 'utf-8');
    const counts: Map<string, number> = parseCountsManifest(manifest);
    log(`Counts manifest: ${String(counts.size)} entries`);
  }

  if (options.dryRun === true) {
    log('Dry run — skipping database writes');
    return {
      ingestId: 0,
      tablesLoaded: availableTables.map((t) => ({
        tableName: t.appName,
        recordCount: 0,
        extraColumnCount: 0,
      })),
      tablesSkipped: skippedTables,
      totalRecords: 0,
      durationMs: Date.now() - start,
    };
  }

  // Stage 4: Open DB connection and create metadata tables
  const db: DuckDBInstance =
    options.dbInstance ?? (await DuckDBInstance.create(options.databaseUrl!));
  const conn: DuckDBConnection = await DuckDBConn.create(db);

  await createMetadataTables(conn);

  // Insert ingest_log row with status 'running'
  // Use lower 31 bits of timestamp as a simple unique ID that fits in INTEGER
  const ingestId: number = Date.now() % 2_147_483_647;
  const sourceUrl: string = options.sourceUrl ?? 'local';

  await conn.run(
    `INSERT INTO "ingest_log"
      ("ingest_id", "started_at", "source_url", "zip_size_bytes", "status")
      VALUES ($1, current_timestamp, $2, $3, $4)`,
    [
      ingestId,
      sourceUrl,
      options.zipSizeBytes ?? null,
      'running',
    ] as DuckDBValue[],
  );

  // Stage 5: Load each table
  const results: LoadTableResult[] = [];
  let totalRecords: number = 0;

  try {
    for (const tableDef of availableTables) {
      log(`Loading ${tableDef.appName} (${tableDef.datFile})...`);
      const result: LoadTableResult = await loadTable(
        conn,
        tableDef,
        options.datDir,
      );
      results.push(result);
      totalRecords += result.recordCount;
      log(
        `  ${String(result.recordCount)} records loaded${result.extraColumnCount > 0 ? `, ${String(result.extraColumnCount)} extra columns` : ''}`,
      );
    }

    // Update ingest_log to 'completed'
    const tableResults: string = JSON.stringify(results);
    await conn.run(
      `UPDATE "ingest_log"
        SET "status" = $1, "completed_at" = current_timestamp, "table_results" = $2
        WHERE "ingest_id" = $3`,
      ['completed', tableResults, ingestId] as DuckDBValue[],
    );
  } catch (error: unknown) {
    // Update ingest_log to 'failed'
    const errorMessage: string =
      error instanceof Error ? error.message : String(error);
    await conn.run(
      `UPDATE "ingest_log"
        SET "status" = $1, "completed_at" = current_timestamp, "error_message" = $2
        WHERE "ingest_id" = $3`,
      ['failed', errorMessage, ingestId] as DuckDBValue[],
    );
    conn.closeSync();
    throw error;
  }

  conn.closeSync();

  const durationMs: number = Date.now() - start;
  log(
    `Ingest complete: ${String(results.length)} tables, ${String(totalRecords)} records in ${String(Math.round(durationMs / 1000))}s`,
  );

  return {
    ingestId,
    tablesLoaded: results,
    tablesSkipped: skippedTables,
    totalRecords,
    durationMs,
  };
}

/** Result of loading a single table */
export type LoadTableResult = {
  tableName: string;
  recordCount: number;
  extraColumnCount: number;
};

/** Options for loadTable */
export type LoadTableOptions = {
  /** For filing (main.dat) and other large tables, limit parsed rows for testing */
  sampleSize?: number;
};

/**
 * Parses a `wc -l` style counts manifest into a Map of filename → line count.
 * Skips the "total" line.
 */
export function parseCountsManifest(manifest: string): Map<string, number> {
  const counts: Map<string, number> = new Map();
  const lines: string[] = manifest.trim().split('\n');

  for (const line of lines) {
    const trimmed: string = line.trim();
    if (trimmed === '') {
      continue;
    }

    const match: RegExpExecArray | null = /^\s*(\d+)\s+(.+)$/.exec(trimmed);
    if (match == null) {
      continue;
    }

    const count: number = parseInt(match[1]!, 10);
    const fullPath: string = match[2]!;
    const filename: string = basename(fullPath);

    if (filename === 'total') {
      continue;
    }

    counts.set(filename, count);
  }

  return counts;
}

/**
 * Loads a single .dat file into DuckDB, creating the table if needed.
 *
 * On first load, uses insertBatch (Appender, fast).
 * On subsequent loads, uses upsertBatch (staging + MERGE).
 *
 * Records extra columns in the unknown_columns metadata table.
 */
export async function loadTable(
  conn: DuckDBConnection,
  tableDef: TableDef,
  datDir: string,
  options: LoadTableOptions = {},
): Promise<LoadTableResult> {
  const datPath: string = resolve(datDir, tableDef.datFile);
  const buf: Buffer = readFileSync(datPath);
  let rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

  // Deduplicate rows by primary key — FCC source data contains exact duplicate
  // rows (e.g. space_station: 144k rows but only 837 unique PKs).
  // Keep the last occurrence per PK to match "latest wins" semantics.
  if (tableDef.primaryKey.length > 0) {
    const beforeCount: number = rows.length;
    const seen: Map<string, number> = new Map();
    for (let i: number = 0; i < rows.length; i++) {
      const key: string = tableDef.primaryKey
        .map((col) => String(rows[i]![col] ?? ''))
        .join('|');
      seen.set(key, i);
    }
    if (seen.size < beforeCount) {
      const uniqueIndices: number[] = [...seen.values()].sort((a, b) => a - b);
      rows = uniqueIndices.map((idx) => rows[idx]!);
    }
  }

  if (options.sampleSize != null && options.sampleSize < rows.length) {
    rows = rows.slice(0, options.sampleSize);
  }

  // Detect extra columns
  const extraColumnCount: number =
    rows.length > 0
      ? Object.keys(rows[0]!).filter((k) => k.startsWith('_extra_')).length
      : 0;

  // Check if table already exists
  const tableExistsReader = await conn.runAndReadAll(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = '${tableDef.appName}'`,
  );
  const tableExists: boolean =
    Number(tableExistsReader.getRowObjectsJS()[0]!.cnt) > 0;

  if (!tableExists) {
    // First load: create table + fast Appender insert
    await createTable(conn, tableDef, extraColumnCount);
    await insertBatch(conn, tableDef, rows, extraColumnCount);
  } else {
    // Subsequent load: staging + MERGE upsert
    await upsertBatch(conn, tableDef, rows, extraColumnCount);
  }

  // Record extra columns in metadata
  if (extraColumnCount > 0) {
    await recordExtraColumns(conn, tableDef, rows, extraColumnCount);
  }

  return {
    tableName: tableDef.appName,
    recordCount: rows.length,
    extraColumnCount,
  };
}

/**
 * Records extra (unknown) columns in the unknown_columns metadata table,
 * including sample values from the first few rows.
 */
async function recordExtraColumns(
  conn: DuckDBConnection,
  tableDef: TableDef,
  rows: Record<string, unknown>[],
  extraColumnCount: number,
): Promise<void> {
  const ddlColCount: number = tableDef.columns.length;
  const sampleRows: Record<string, unknown>[] = rows.slice(0, 10);

  for (let i: number = 0; i < extraColumnCount; i++) {
    const colIndex: number = ddlColCount + i + 1;
    const alias: string = `_extra_${String(colIndex)}`;

    // Collect sample non-null values
    const samples: string[] = sampleRows
      .map((r) => r[alias])
      .filter((v): v is string => v != null && v !== '')
      .slice(0, 10);

    const sampleJson: string = JSON.stringify(samples);

    await conn.run(
      `INSERT OR REPLACE INTO "unknown_columns"
        ("table_name", "column_index", "column_alias", "sample_values")
        VALUES ($1, $2, $3, $4)`,
      [tableDef.appName, colIndex, alias, sampleJson] as DuckDBValue[],
    );
  }
}
