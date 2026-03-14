import { DuckDBConnection } from '@duckdb/node-api';
import type { DuckDBInstance } from '@duckdb/node-api';
import { trackConnection } from './graceful-shutdown.ts';

export type ConfigRow = {
  key: string;
  value: string;
  encrypted: boolean;
};

export async function getConfigValue(
  db: DuckDBInstance,
  key: string,
): Promise<ConfigRow | null> {
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  const reader = await conn.runAndReadAll(
    'SELECT key, value, encrypted FROM config WHERE key = $1',
    [key],
  );
  conn.closeSync();
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return {
    key: row.key as string,
    value: row.value as string,
    encrypted: row.encrypted as boolean,
  };
}

export async function setConfigValue(
  db: DuckDBInstance,
  key: string,
  value: string,
  encrypted: boolean,
): Promise<void> {
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  await conn.run(
    `INSERT INTO config (key, value, encrypted) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, encrypted = $3`,
    [key, value, encrypted],
  );
  conn.closeSync();
}

export async function getAllConfig(db: DuckDBInstance): Promise<ConfigRow[]> {
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  const reader = await conn.runAndReadAll(
    'SELECT key, value, encrypted FROM config',
  );
  conn.closeSync();
  return reader.getRowObjectsJS().map((row) => {
    const r = row as Record<string, unknown>;
    return {
      key: r.key as string,
      value: r.value as string,
      encrypted: r.encrypted as boolean,
    };
  });
}

export async function deleteConfigValue(
  db: DuckDBInstance,
  key: string,
): Promise<void> {
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  await conn.run('DELETE FROM config WHERE key = $1', [key]);
  conn.closeSync();
}
