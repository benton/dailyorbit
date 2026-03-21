import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Create content flag tables if they don't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureContentFlagTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS content_flag_id_seq START 1;
    CREATE TABLE IF NOT EXISTS user_content_flag (
      id               INTEGER NOT NULL DEFAULT nextval('content_flag_id_seq') PRIMARY KEY,
      user_id          VARCHAR NOT NULL,
      content_type     VARCHAR NOT NULL,
      content_key      VARCHAR NOT NULL,
      source           VARCHAR NOT NULL DEFAULT 'manual',
      saved_search_id  INTEGER NOT NULL DEFAULT 0,
      reason           VARCHAR,
      created_at       TIMESTAMP NOT NULL DEFAULT current_timestamp,
      dismissed_at     TIMESTAMP,
      UNIQUE (user_id, content_type, content_key, saved_search_id)
    );
  `);
}
