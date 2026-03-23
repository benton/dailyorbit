import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensurePipelineTrackingTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS pipeline_run_id_seq START 1;
    CREATE TABLE IF NOT EXISTS pipeline_run (
      id            INTEGER NOT NULL DEFAULT nextval('pipeline_run_id_seq') PRIMARY KEY,
      started_at    TIMESTAMP NOT NULL DEFAULT current_timestamp,
      finished_at   TIMESTAMP,
      status        VARCHAR NOT NULL DEFAULT 'running',
      triggered_by  VARCHAR NOT NULL DEFAULT 'manual',
      mode          VARCHAR DEFAULT 'full',
      summary       VARCHAR
    );

    CREATE SEQUENCE IF NOT EXISTS pipeline_stage_run_id_seq START 1;
    CREATE TABLE IF NOT EXISTS pipeline_stage_run (
      id               INTEGER NOT NULL DEFAULT nextval('pipeline_stage_run_id_seq') PRIMARY KEY,
      pipeline_run_id  INTEGER NOT NULL REFERENCES pipeline_run(id),
      stage_id         VARCHAR NOT NULL,
      started_at       TIMESTAMP NOT NULL DEFAULT current_timestamp,
      finished_at      TIMESTAMP,
      status           VARCHAR NOT NULL DEFAULT 'running',
      items_discovered INTEGER NOT NULL DEFAULT 0,
      items_processed  INTEGER NOT NULL DEFAULT 0,
      items_failed     INTEGER NOT NULL DEFAULT 0,
      summary          VARCHAR
    );
  `);

  // Migration: add mode column to existing tables
  await conn.run(
    `ALTER TABLE pipeline_run ADD COLUMN IF NOT EXISTS mode VARCHAR DEFAULT 'full'`,
  );

  // Migration: add items_skipped column to pipeline_stage_run
  await conn.run(
    `ALTER TABLE pipeline_stage_run ADD COLUMN IF NOT EXISTS items_skipped INTEGER DEFAULT 0`,
  );
}
