import { readFileSync } from 'node:fs';
import type { DuckDBConnection } from '@duckdb/node-api';
import { parseDdl } from './ddl-parser.ts';
import type { TableDef } from './types.ts';

/**
 * Loads table definitions from the pre-generated schema JSON file.
 */
export function loadTableDefs(schemaPath: string): TableDef[] {
  const json: string = readFileSync(schemaPath, 'utf-8');
  return JSON.parse(json) as TableDef[];
}

/**
 * Loads table definitions by parsing the Sybase DDL file directly.
 */
export function loadTableDefsFromDdl(ddlPath: string): TableDef[] {
  const ddl: string = readFileSync(ddlPath, 'utf-8');
  return parseDdl(ddl);
}

/** SQL for the ingest_log metadata table */
const INGEST_LOG_SQL: string = `
  CREATE TABLE IF NOT EXISTS "ingest_log" (
    "ingest_id" INTEGER PRIMARY KEY,
    "started_at" TIMESTAMP NOT NULL,
    "completed_at" TIMESTAMP,
    "source_url" VARCHAR NOT NULL,
    "zip_size_bytes" BIGINT,
    "status" VARCHAR NOT NULL,
    "error_message" VARCHAR,
    "table_results" VARCHAR
  )
`;

/** SQL for the unknown_columns metadata table */
const UNKNOWN_COLUMNS_SQL: string = `
  CREATE TABLE IF NOT EXISTS "unknown_columns" (
    "table_name" VARCHAR NOT NULL,
    "column_index" INTEGER NOT NULL,
    "column_alias" VARCHAR NOT NULL,
    "sample_values" VARCHAR,
    "identified_as" VARCHAR,
    PRIMARY KEY ("table_name", "column_index")
  )
`;

/**
 * Creates the application metadata tables (ingest_log, unknown_columns).
 */
export async function createMetadataTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(INGEST_LOG_SQL);
  await conn.run(UNKNOWN_COLUMNS_SQL);
}
