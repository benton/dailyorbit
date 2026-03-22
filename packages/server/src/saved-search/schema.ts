import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureSavedSearchTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS saved_search_id_seq START 1;
    CREATE TABLE IF NOT EXISTS saved_search (
      id                 INTEGER NOT NULL DEFAULT nextval('saved_search_id_seq') PRIMARY KEY,
      user_id            VARCHAR NOT NULL REFERENCES "user"(id),
      name               VARCHAR NOT NULL,
      content_type       VARCHAR NOT NULL,
      filters            JSON NOT NULL,
      include_time_scope BOOLEAN NOT NULL DEFAULT true,
      alert_enabled      BOOLEAN NOT NULL DEFAULT false,
      search_type        VARCHAR NOT NULL DEFAULT 'keyword',
      created_at         TIMESTAMP NOT NULL DEFAULT current_timestamp,
      updated_at         TIMESTAMP NOT NULL DEFAULT current_timestamp
    );
  `);

  // Idempotent migration for existing tables (DuckDB doesn't support NOT NULL in ADD COLUMN)
  await conn.run(
    `ALTER TABLE saved_search ADD COLUMN IF NOT EXISTS search_type VARCHAR DEFAULT 'keyword'`,
  );
}
