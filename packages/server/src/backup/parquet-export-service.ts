import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DuckDBConnection } from '@duckdb/node-api';

export type ParquetExportOptions = {
  bucket: string;
  region: string;
  /** S3 key prefix, e.g. "parquet/" */
  prefix: string;
  onProgress?: (exported: number, total: number) => void;
  signal?: AbortSignal;
};

export type ParquetExportResult = {
  tablesExported: number;
  exportedAt: string;
};

/**
 * Export all main-schema base tables to S3 as Parquet files, plus
 * schema.sql and _manifest.json for disaster-recovery restore.
 */
export async function runParquetExport(
  conn: DuckDBConnection,
  options: ParquetExportOptions,
): Promise<ParquetExportResult> {
  const { bucket, region, prefix, onProgress, signal } = options;

  await conn.run(`INSTALL httpfs; LOAD httpfs;`);
  await conn.run(
    `SET s3_region = '${region}'; SET s3_use_credential_chain = 'true';`,
  );

  const tablesResult = await conn.runAndReadAll(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'main'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = (
    tablesResult.getRowObjectsJS() as Array<{ table_name: string }>
  ).map((r) => r.table_name);

  const versionResult = await conn.runAndReadAll(`SELECT version() AS v`);
  const duckdbVersion = String(
    (versionResult.getRowObjectsJS()[0] as { v: string } | undefined)?.v ??
      'unknown',
  );

  const exportedAt = new Date();
  const tableManifest: Array<{
    name: string;
    rows: number;
    sizeBytes: number;
  }> = [];

  for (const table of tables) {
    if (signal?.aborted) {
      break;
    }

    const s3Key = `s3://${bucket}/${prefix}${table}.parquet`;
    const countResult = await conn.runAndReadAll(
      `SELECT COUNT(*)::INTEGER AS cnt FROM "${table}"`,
    );
    const rows = Number(
      (countResult.getRowObjectsJS()[0] as { cnt: number } | undefined)?.cnt ??
        0,
    );

    await conn.run(`COPY "${table}" TO '${s3Key}' (FORMAT PARQUET)`);
    tableManifest.push({ name: table, rows, sizeBytes: 0 });
    onProgress?.(tableManifest.length, tables.length);
  }

  // Export schema.sql via EXPORT DATABASE to a temp dir, then upload
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-orbit-export-'));
  try {
    await conn.run(`EXPORT DATABASE '${tempDir}' (FORMAT PARQUET)`);
    const schemaContent = readFileSync(join(tempDir, 'schema.sql'), 'utf-8');

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
