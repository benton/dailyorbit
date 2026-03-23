import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureBackupTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS backup_snapshot_id_seq START 1;
    CREATE TABLE IF NOT EXISTS backup_snapshot (
      id           INTEGER NOT NULL DEFAULT nextval('backup_snapshot_id_seq') PRIMARY KEY,
      started_at   TIMESTAMP NOT NULL DEFAULT current_timestamp,
      finished_at  TIMESTAMP,
      status       VARCHAR NOT NULL DEFAULT 'running',
      s3_key       VARCHAR,
      size_bytes   BIGINT,
      triggered_by VARCHAR NOT NULL DEFAULT 'manual',
      error        VARCHAR
    );
  `);
}
