import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureIcfsColumns } from './schema.ts';

describe('ensureIcfsColumns', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await conn.run(
      `CREATE TABLE filing (
        filing_key INTEGER NOT NULL PRIMARY KEY,
        file_number VARCHAR NOT NULL
      )`,
    );
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('adds expected ICFS columns to existing filing table', async () => {
    await ensureIcfsColumns(conn);

    const reader = await conn.runAndReadAll(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'filing'
      ORDER BY ordinal_position
    `);
    const columns: string[] = reader
      .getRowObjectsJS()
      .map((r) => String(r.column_name));

    expect(columns).toContain('icfs_sys_id');
    expect(columns).toContain('applicant_frn');
    expect(columns).toContain('red_light_status');
    expect(columns).toContain('transferor_name');
    expect(columns).toContain('transferee_name');
    expect(columns).toContain('icfs_service_types');
    expect(columns).toContain('icfs_last_fetched_at');
    expect(columns).toContain('brief_description');
    expect(columns).toContain('da_number');
  });

  it('is idempotent — calling twice does not error', async () => {
    await ensureIcfsColumns(conn);
    await ensureIcfsColumns(conn);

    const reader = await conn.runAndReadAll(`
      SELECT COUNT(*) AS cnt FROM information_schema.columns
      WHERE table_name = 'filing'
    `);
    const count: number = Number(reader.getRowObjectsJS()[0]!.cnt);
    // 2 original + 28 ICFS columns = 30
    expect(count).toEqual(30);
  });

  it('preserves existing data in the filing table', async () => {
    await conn.run(
      `INSERT INTO filing (filing_key, file_number) VALUES (1, 'SAT-LOA-20250221-00050')`,
    );

    await ensureIcfsColumns(conn);

    const reader = await conn.runAndReadAll(
      `SELECT file_number FROM filing WHERE filing_key = 1`,
    );
    expect(String(reader.getRowObjectsJS()[0]!.file_number)).toEqual(
      'SAT-LOA-20250221-00050',
    );
  });
});
