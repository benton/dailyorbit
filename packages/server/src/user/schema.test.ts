import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureAuthTables } from './schema.ts';

describe('ensureAuthTables', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
  });

  afterEach(() => {
    conn.closeSync();
  });

  const AUTH_TABLES: string[] = ['user', 'session', 'account', 'verification'];

  it('creates all auth tables', async () => {
    await ensureAuthTables(conn);

    for (const table of AUTH_TABLES) {
      const result = await conn.runAndReadAll(
        `SELECT 1 FROM information_schema.tables WHERE table_name = '${table}' LIMIT 1`,
      );
      expect(result.getRowObjectsJS().length).toEqual(1);
    }
  });

  it('is idempotent — calling twice does not throw', async () => {
    await ensureAuthTables(conn);
    await ensureAuthTables(conn);

    for (const table of AUTH_TABLES) {
      const result = await conn.runAndReadAll(
        `SELECT 1 FROM information_schema.tables WHERE table_name = '${table}' LIMIT 1`,
      );
      expect(result.getRowObjectsJS().length).toEqual(1);
    }
  });

  it('user table has expected columns', async () => {
    await ensureAuthTables(conn);

    const result = await conn.runAndReadAll(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'user' ORDER BY ordinal_position`,
    );
    const columns: string[] = result
      .getRowObjectsJS()
      .map((row) => row.column_name as string);

    expect(columns).toEqual([
      'id',
      'name',
      'email',
      'emailVerified',
      'image',
      'createdAt',
      'updatedAt',
      'role',
      'banned',
      'banReason',
      'banExpires',
    ]);
  });
});
