import { DuckDBConnection } from '@duckdb/node-api';
import type { DuckDBInstance } from '@duckdb/node-api';
import { trackConnection } from './graceful-shutdown.ts';

/**
 * Initialize a fresh database with the base schema.
 * Called only when starting from a clean DB.
 */
export async function initializeDatabase(db: DuckDBInstance): Promise<void> {
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS config (
      key       VARCHAR PRIMARY KEY,
      value     VARCHAR NOT NULL,
      encrypted BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  conn.closeSync();
}
