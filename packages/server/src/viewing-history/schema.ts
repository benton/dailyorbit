import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Create viewing history table if it doesn't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureViewingHistoryTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS user_filing_view (
      user_id         VARCHAR NOT NULL,
      file_number     VARCHAR NOT NULL,
      first_viewed_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
      last_viewed_at  TIMESTAMP NOT NULL DEFAULT current_timestamp,
      PRIMARY KEY (user_id, file_number)
    )
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS user_news_view (
      user_id         VARCHAR NOT NULL,
      news_item_id    INTEGER NOT NULL,
      first_viewed_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
      last_viewed_at  TIMESTAMP NOT NULL DEFAULT current_timestamp,
      PRIMARY KEY (user_id, news_item_id)
    )
  `);
}
