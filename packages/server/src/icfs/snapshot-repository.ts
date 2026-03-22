import { createHash } from 'node:crypto';
import type { DuckDBConnection } from '@duckdb/node-api';

export type DiscoverySnapshot = {
  id: number;
  snapshot_hash: string;
  file_numbers: string[];
  file_count: number;
  new_count: number;
  pipeline_run_id: number | null;
  created_at: string;
};

/**
 * Compute a SHA-256 hash of a sorted, deduplicated list of file numbers.
 * This produces a stable fingerprint for comparing discovery results.
 */
export function computeSnapshotHash(fileNumbers: string[]): string {
  const sorted: string[] = [...new Set(fileNumbers)].sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex');
}

/** Ensure the discovery_snapshot table exists. Idempotent. */
export async function ensureDiscoverySnapshotTable(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS discovery_snapshot_id_seq START 1;
    CREATE TABLE IF NOT EXISTS discovery_snapshot (
      id              INTEGER NOT NULL DEFAULT nextval('discovery_snapshot_id_seq') PRIMARY KEY,
      snapshot_hash   VARCHAR NOT NULL,
      file_numbers    TEXT NOT NULL,
      file_count      INTEGER NOT NULL,
      new_count       INTEGER NOT NULL,
      pipeline_run_id INTEGER,
      created_at      TIMESTAMP NOT NULL DEFAULT current_timestamp
    );
  `);
}

/** Insert a new discovery snapshot. Returns the auto-generated ID. */
export async function saveSnapshot(
  conn: DuckDBConnection,
  hash: string,
  fileNumbers: string[],
  newCount: number,
  pipelineRunId?: number,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `INSERT INTO discovery_snapshot (snapshot_hash, file_numbers, file_count, new_count, pipeline_run_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      hash,
      JSON.stringify(fileNumbers),
      fileNumbers.length,
      newCount,
      pipelineRunId ?? null,
    ],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Return the most recent discovery snapshot, or null if none exist. */
export async function getLatestSnapshot(
  conn: DuckDBConnection,
): Promise<DiscoverySnapshot | null> {
  const reader = await conn.runAndReadAll(
    `SELECT id, snapshot_hash, file_numbers, file_count, new_count,
            pipeline_run_id, created_at::VARCHAR AS created_at
     FROM discovery_snapshot
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  const row: Record<string, unknown> = rows[0] as Record<string, unknown>;
  return {
    id: Number(row.id),
    snapshot_hash: String(row.snapshot_hash),
    file_numbers: JSON.parse(String(row.file_numbers)) as string[],
    file_count: Number(row.file_count),
    new_count: Number(row.new_count),
    pipeline_run_id:
      row.pipeline_run_id != null ? Number(row.pipeline_run_id) : null,
    created_at: String(row.created_at),
  };
}
