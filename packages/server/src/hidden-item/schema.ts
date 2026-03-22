import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Create hidden item tables if they don't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureHiddenItemTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS hidden_item_id_seq START 1;
    CREATE TABLE IF NOT EXISTS hidden_item (
      id            INTEGER NOT NULL DEFAULT nextval('hidden_item_id_seq') PRIMARY KEY,
      user_id       VARCHAR NOT NULL,
      content_type  VARCHAR NOT NULL,
      content_key   VARCHAR NOT NULL,
      scope         VARCHAR NOT NULL DEFAULT 'user',
      reason        VARCHAR,
      created_at    TIMESTAMP NOT NULL DEFAULT current_timestamp,
      removed_at    TIMESTAMP,
      UNIQUE (user_id, content_type, content_key, scope)
    );
  `);
}
