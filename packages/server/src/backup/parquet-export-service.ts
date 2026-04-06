import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DuckDBConnection } from '@duckdb/node-api';

export type ParquetExportS3Options = {
  bucket: string;
  region: string;
  /** S3 key prefix, e.g. "parquet/" */
  prefix: string;
  onProgress?: (exported: number, total: number) => void;
  signal?: AbortSignal;
};

export type ParquetExportLocalOptions = {
  outputDir: string;
  onProgress?: (exported: number, total: number) => void;
  signal?: AbortSignal;
};

export type ParquetExportResult = {
  tablesExported: number;
  exportedAt: string;
};

// ── Shared helpers ──────────────────────────────────────────────────

async function listBaseTables(conn: DuckDBConnection): Promise<string[]> {
  const result = await conn.runAndReadAll(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'main'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return (result.getRowObjectsJS() as Array<{ table_name: string }>).map(
    (r) => r.table_name,
  );
}

async function getDuckDbVersion(conn: DuckDBConnection): Promise<string> {
  const result = await conn.runAndReadAll(`SELECT version() AS v`);
  return String(
    (result.getRowObjectsJS()[0] as { v: string } | undefined)?.v ?? 'unknown',
  );
}

async function getRowCount(
  conn: DuckDBConnection,
  table: string,
): Promise<number> {
  const result = await conn.runAndReadAll(
    `SELECT COUNT(*)::INTEGER AS cnt FROM "${table}"`,
  );
  return Number(
    (result.getRowObjectsJS()[0] as { cnt: number } | undefined)?.cnt ?? 0,
  );
}

async function exportSchemaToTempDir(conn: DuckDBConnection): Promise<{
  tempDir: string;
  schemaContent: string;
}> {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-orbit-export-'));
  await conn.run(`EXPORT DATABASE '${tempDir}' (FORMAT PARQUET)`);
  const schemaContent = readFileSync(join(tempDir, 'schema.sql'), 'utf-8');
  return { tempDir, schemaContent };
}

// ── S3 export ───────────────────────────────────────────────────────

/**
 * Export all main-schema base tables to S3 as Parquet files, plus
 * schema.sql and _manifest.json for disaster-recovery restore.
 */
export async function runParquetExport(
  conn: DuckDBConnection,
  options: ParquetExportS3Options,
): Promise<ParquetExportResult> {
  const { bucket, region, prefix, onProgress, signal } = options;

  await conn.run(`INSTALL httpfs; LOAD httpfs;`);
  await conn.run(`INSTALL aws; LOAD aws;`);
  await conn.run(
    `CREATE SECRET (TYPE S3, PROVIDER CREDENTIAL_CHAIN, REGION '${region}')`,
  );

  const tables = await listBaseTables(conn);
  const duckdbVersion = await getDuckDbVersion(conn);
  const exportedAt = new Date();
  const tableManifest: Array<{
    name: string;
    rows: number;
    sizeBytes: number;
  }> = [];

  for (const table of tables) {
    if (signal?.aborted) break;

    const s3Key = `s3://${bucket}/${prefix}${table}.parquet`;
    const rows = await getRowCount(conn, table);
    await conn.run(`COPY "${table}" TO '${s3Key}' (FORMAT PARQUET)`);
    tableManifest.push({ name: table, rows, sizeBytes: 0 });
    onProgress?.(tableManifest.length, tables.length);
  }

  const { tempDir, schemaContent } = await exportSchemaToTempDir(conn);
  try {
    const s3 = new S3Client({ region });

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}schema.sql`,
        Body: schemaContent,
        ContentType: 'text/plain',
      }),
    );

    const manifest = {
      exported_at: exportedAt.toISOString(),
      duckdb_version: duckdbVersion,
      tables: tableManifest,
    };

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}_manifest.json`,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json',
      }),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    tablesExported: tables.length,
    exportedAt: exportedAt.toISOString(),
  };
}

// ── Local filesystem export ─────────────────────────────────────────

/**
 * Export all main-schema base tables to a local directory as Parquet
 * files, plus schema.sql and _manifest.json.
 */
export async function runParquetExportLocal(
  conn: DuckDBConnection,
  options: ParquetExportLocalOptions,
): Promise<ParquetExportResult> {
  const { outputDir, onProgress, signal } = options;

  mkdirSync(outputDir, { recursive: true });

  const tables = await listBaseTables(conn);
  const duckdbVersion = await getDuckDbVersion(conn);
  const exportedAt = new Date();
  const tableManifest: Array<{
    name: string;
    rows: number;
    sizeBytes: number;
  }> = [];

  for (const table of tables) {
    if (signal?.aborted) break;

    const filePath = join(outputDir, `${table}.parquet`);
    const rows = await getRowCount(conn, table);
    await conn.run(`COPY "${table}" TO '${filePath}' (FORMAT PARQUET)`);
    const sizeBytes = statSync(filePath).size;
    tableManifest.push({ name: table, rows, sizeBytes });
    onProgress?.(tableManifest.length, tables.length);
  }

  const { tempDir, schemaContent } = await exportSchemaToTempDir(conn);
  try {
    writeFileSync(join(outputDir, 'schema.sql'), schemaContent, 'utf-8');

    const manifest = {
      exported_at: exportedAt.toISOString(),
      duckdb_version: duckdbVersion,
      tables: tableManifest,
    };
    writeFileSync(
      join(outputDir, '_manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    tablesExported: tables.length,
    exportedAt: exportedAt.toISOString(),
  };
}
