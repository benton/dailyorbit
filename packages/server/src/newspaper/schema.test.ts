import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from './schema.ts';

describe('newspaper schema', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('creates all three tables on first call', async () => {
    await ensureNewspaperTables(conn);

    const tables = await conn.runAndReadAll(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name LIKE 'newspaper_%'
       ORDER BY table_name`,
    );
    const names: string[] = tables
      .getRowObjectsJS()
      .map((r: Record<string, unknown>) => String(r.table_name));

    expect(names).toEqual([
      'newspaper_article',
      'newspaper_edition',
      'newspaper_image',
    ]);
  });

  it('is idempotent — calling twice does not error', async () => {
    await ensureNewspaperTables(conn);
    await ensureNewspaperTables(conn);

    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM newspaper_edition`,
    );
    expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(0);
  });

  it('enforces unique edition_date constraint', async () => {
    await ensureNewspaperTables(conn);

    await conn.run(
      `INSERT INTO newspaper_edition (edition_date) VALUES ('2026-03-24')`,
    );
    await expect(
      conn.run(
        `INSERT INTO newspaper_edition (edition_date) VALUES ('2026-03-24')`,
      ),
    ).rejects.toThrow();
  });

  it('enforces unique (edition_id, slug) constraint on articles', async () => {
    await ensureNewspaperTables(conn);

    await conn.run(
      `INSERT INTO newspaper_edition (edition_date) VALUES ('2026-03-24')`,
    );
    const edReader = await conn.runAndReadAll(
      `SELECT id FROM newspaper_edition WHERE edition_date = '2026-03-24'`,
    );
    const editionId: number = Number(edReader.getRowObjectsJS()[0]!.id);

    await conn.run(
      `INSERT INTO newspaper_article (edition_id, content_type, slug, body)
       VALUES (?, 'daily_digest', 'three-miles-up', 'test body')`,
      [editionId],
    );

    await expect(
      conn.run(
        `INSERT INTO newspaper_article (edition_id, content_type, slug, body)
         VALUES (?, 'daily_digest', 'three-miles-up', 'duplicate')`,
        [editionId],
      ),
    ).rejects.toThrow();
  });
});
