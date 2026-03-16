import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Create user_settings table if it doesn't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureUserSettingsTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id            VARCHAR PRIMARY KEY,
      email_daily_orbit  BOOLEAN NOT NULL DEFAULT FALSE,
      wide_view          BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
}
