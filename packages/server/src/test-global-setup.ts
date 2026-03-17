import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

/**
 * Vitest global setup — pre-install DuckDB extensions so individual
 * tests don't each pay the download cost (critical in CI).
 */
export async function setup(): Promise<void> {
  const db: DuckDBInstance = await DuckDBInstance.create(':memory:');
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await conn.run('INSTALL fts; LOAD fts;');
  await conn.run('INSTALL vss; LOAD vss;');
  conn.closeSync();
}
