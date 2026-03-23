import type { DuckDBConnection } from '@duckdb/node-api';

export type BackupSnapshot = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  s3_key: string | null;
  size_bytes: bigint | null;
  triggered_by: string;
  error: string | null;
};

export async function insertBackupSnapshot(
  conn: DuckDBConnection,
  triggeredBy: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `INSERT INTO backup_snapshot (triggered_by)
     VALUES ($1)
     RETURNING id`,
    [triggeredBy],
  );
  const row = reader.getRowObjectsJS()[0] as Record<string, unknown>;
  return Number(row.id);
}

export async function completeBackupSnapshot(
  conn: DuckDBConnection,
  id: number,
  s3Key: string,
  sizeBytes: number,
): Promise<void> {
  await conn.run(
    `UPDATE backup_snapshot
     SET status = 'completed', finished_at = current_timestamp, s3_key = $1, size_bytes = $2
     WHERE id = $3`,
    [s3Key, sizeBytes, id],
  );
}

export async function failBackupSnapshot(
  conn: DuckDBConnection,
  id: number,
  error: string,
): Promise<void> {
  await conn.run(
    `UPDATE backup_snapshot
     SET status = 'failed', finished_at = current_timestamp, error = $1
     WHERE id = $2`,
    [error, id],
  );
}

export async function getLatestBackupSnapshot(
  conn: DuckDBConnection,
): Promise<BackupSnapshot | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM backup_snapshot ORDER BY started_at DESC LIMIT 1`,
  );
  const rows = reader.getRowObjectsJS() as BackupSnapshot[];
  return rows[0] ?? null;
}

export async function listBackupSnapshots(
  conn: DuckDBConnection,
  limit: number,
): Promise<BackupSnapshot[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM backup_snapshot ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return reader.getRowObjectsJS() as BackupSnapshot[];
}
