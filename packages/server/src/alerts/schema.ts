import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureAlertTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS alert_run_id_seq START 1;
    CREATE TABLE IF NOT EXISTS alert_run (
      id               INTEGER NOT NULL DEFAULT nextval('alert_run_id_seq') PRIMARY KEY,
      saved_search_id  INTEGER NOT NULL,
      pipeline_run_id  INTEGER NOT NULL,
      executed_at      TIMESTAMP NOT NULL DEFAULT current_timestamp,
      items_matched    INTEGER NOT NULL DEFAULT 0,
      items_flagged    INTEGER NOT NULL DEFAULT 0,
      email_sent       BOOLEAN NOT NULL DEFAULT false,
      error            VARCHAR
    );
  `);
}
