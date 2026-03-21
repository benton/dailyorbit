import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureViewingHistoryTables } from './schema.ts';
import {
  type ContentType,
  getRecentlyViewed,
  getUnreadFilingsSince,
  getViewedFileNumbers,
  getViewedNewsIds,
  getWatermark,
  getWatermarks,
  markNewsUnread,
  markNewsViewed,
  markUnread,
  markViewed,
  setWatermark,
} from './repository.ts';

describe('viewing-history repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  const USER_ID: string = 'user-123';
  const OTHER_USER: string = 'user-456';
  const FILE_A: string = 'SAT-LOA-20240101-00001';
  const FILE_B: string = 'SES-LOA-20240102-00002';
  const FILE_C: string = 'SAT-MOD-20240115-00003';

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureViewingHistoryTables(conn);

    // Create minimal filing table with seed data at known dates
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        file_number    VARCHAR PRIMARY KEY,
        date_filed     TIMESTAMP,
        subsystem_code VARCHAR,
        app_type_code  VARCHAR,
        address_attention VARCHAR
      )
    `);
    await conn.run(`INSERT INTO filing VALUES ($1, $2, $3, $4, $5)`, [
      FILE_A,
      '2024-01-01T00:00:00Z',
      'SAT',
      'LOA',
      'Acme Corp',
    ]);
    await conn.run(`INSERT INTO filing VALUES ($1, $2, $3, $4, $5)`, [
      FILE_B,
      '2024-01-02T00:00:00Z',
      'SES',
      'LOA',
      'Beta Inc',
    ]);
    await conn.run(`INSERT INTO filing VALUES ($1, $2, $3, $4, $5)`, [
      FILE_C,
      '2024-01-15T00:00:00Z',
      'SAT',
      'MOD',
      'Gamma LLC',
    ]);

    // Create minimal news_item table with seed data
    await conn.run(`
      CREATE TABLE IF NOT EXISTS news_item (
        id           INTEGER PRIMARY KEY,
        published_at TIMESTAMP,
        created_at   TIMESTAMP NOT NULL
      )
    `);
    await conn.run(`INSERT INTO news_item VALUES ($1, $2, $3)`, [
      1,
      '2024-01-05T00:00:00Z',
      '2024-01-05T00:00:00Z',
    ]);
    await conn.run(`INSERT INTO news_item VALUES ($1, $2, $3)`, [
      2,
      null,
      '2024-01-10T00:00:00Z',
    ]);
    await conn.run(`INSERT INTO news_item VALUES ($1, $2, $3)`, [
      3,
      '2024-01-20T00:00:00Z',
      '2024-01-20T00:00:00Z',
    ]);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('markViewed / getViewedFileNumbers', () => {
    it('marks a filing as viewed', async () => {
      await markViewed(conn, USER_ID, FILE_A);
      const viewed: Set<string> = await getViewedFileNumbers(conn, USER_ID, [
        FILE_A,
        FILE_B,
      ]);
      expect(viewed).toEqual(new Set([FILE_A]));
    });

    it('is idempotent — marking twice does not throw', async () => {
      await markViewed(conn, USER_ID, FILE_A);
      await markViewed(conn, USER_ID, FILE_A);
      const viewed: Set<string> = await getViewedFileNumbers(conn, USER_ID, [
        FILE_A,
      ]);
      expect(viewed.size).toEqual(1);
    });
  });

  describe('markUnread', () => {
    it('removes view record', async () => {
      await markViewed(conn, USER_ID, FILE_A);
      await markUnread(conn, USER_ID, FILE_A);
      const viewed: Set<string> = await getViewedFileNumbers(conn, USER_ID, [
        FILE_A,
      ]);
      expect(viewed.size).toEqual(0);
    });
  });

  describe('getViewedFileNumbers', () => {
    it('returns empty set for empty input', async () => {
      const viewed: Set<string> = await getViewedFileNumbers(conn, USER_ID, []);
      expect(viewed.size).toEqual(0);
    });
  });

  describe('getRecentlyViewed', () => {
    it('returns recently viewed in order', async () => {
      await markViewed(conn, USER_ID, FILE_A);
      await markViewed(conn, USER_ID, FILE_B);
      const recent = await getRecentlyViewed(conn, USER_ID, 10);
      expect(recent.length).toEqual(2);
      expect(recent[0]!.fileNumber).toEqual(FILE_B);
    });

    it('respects limit parameter', async () => {
      await markViewed(conn, USER_ID, FILE_A);
      await markViewed(conn, USER_ID, FILE_B);
      const recent = await getRecentlyViewed(conn, USER_ID, 1);
      expect(recent.length).toEqual(1);
    });
  });

  describe('news viewing history', () => {
    const NEWS_A: number = 42;
    const NEWS_B: number = 99;

    it('marks a news item as viewed', async () => {
      await markNewsViewed(conn, USER_ID, NEWS_A);
      const viewed: Set<number> = await getViewedNewsIds(conn, USER_ID, [
        NEWS_A,
        NEWS_B,
      ]);
      expect(viewed).toEqual(new Set([NEWS_A]));
    });

    it('is idempotent — updates last_viewed_at on repeat views', async () => {
      await markNewsViewed(conn, USER_ID, NEWS_A);
      await markNewsViewed(conn, USER_ID, NEWS_A);
      const viewed: Set<number> = await getViewedNewsIds(conn, USER_ID, [
        NEWS_A,
      ]);
      expect(viewed).toEqual(new Set([NEWS_A]));
    });

    it('marks a news item as unread', async () => {
      await markNewsViewed(conn, USER_ID, NEWS_A);
      await markNewsUnread(conn, USER_ID, NEWS_A);
      const viewed: Set<number> = await getViewedNewsIds(conn, USER_ID, [
        NEWS_A,
      ]);
      expect(viewed).toEqual(new Set());
    });

    it('returns empty set for empty input', async () => {
      const viewed: Set<number> = await getViewedNewsIds(conn, USER_ID, []);
      expect(viewed).toEqual(new Set());
    });
  });

  // ── Watermark tests ─────────────────────────────────────────────────

  describe('watermark CRUD', () => {
    it('returns null when no watermark exists', async () => {
      const wm: Date | null = await getWatermark(conn, USER_ID, 'filing');
      expect(wm).toBeNull();
    });

    it('sets and retrieves a watermark', async () => {
      const ts: Date = new Date('2024-01-10T00:00:00Z');
      await setWatermark(conn, USER_ID, 'filing', ts);
      const wm: Date | null = await getWatermark(conn, USER_ID, 'filing');
      expect(wm).toEqual(ts);
    });

    it('upserts watermark on repeated set', async () => {
      const ts1: Date = new Date('2024-01-05T00:00:00Z');
      const ts2: Date = new Date('2024-01-15T00:00:00Z');
      await setWatermark(conn, USER_ID, 'filing', ts1);
      await setWatermark(conn, USER_ID, 'filing', ts2);
      const wm: Date | null = await getWatermark(conn, USER_ID, 'filing');
      expect(wm).toEqual(ts2);
    });

    it('isolates content types — filing watermark does not affect news', async () => {
      const filingTs: Date = new Date('2024-01-10T00:00:00Z');
      await setWatermark(conn, USER_ID, 'filing', filingTs);
      const newsWm: Date | null = await getWatermark(conn, USER_ID, 'news');
      expect(newsWm).toBeNull();
    });

    it('isolates users — one user watermark does not affect another', async () => {
      const ts: Date = new Date('2024-01-10T00:00:00Z');
      await setWatermark(conn, USER_ID, 'filing', ts);
      const otherWm: Date | null = await getWatermark(
        conn,
        OTHER_USER,
        'filing',
      );
      expect(otherWm).toBeNull();
    });

    it('getWatermarks returns all watermarks for a user', async () => {
      const filingTs: Date = new Date('2024-01-10T00:00:00Z');
      const newsTs: Date = new Date('2024-01-12T00:00:00Z');
      await setWatermark(conn, USER_ID, 'filing', filingTs);
      await setWatermark(conn, USER_ID, 'news', newsTs);
      const wms: Map<ContentType, Date> = await getWatermarks(conn, USER_ID);
      expect(wms.size).toEqual(2);
      expect(wms.get('filing')).toEqual(filingTs);
      expect(wms.get('news')).toEqual(newsTs);
    });

    it('getWatermarks returns empty map when none exist', async () => {
      const wms: Map<ContentType, Date> = await getWatermarks(conn, USER_ID);
      expect(wms.size).toEqual(0);
    });
  });

  describe('watermark + getUnreadFilingsSince', () => {
    const sinceDate: Date = new Date('2023-12-01T00:00:00Z');

    it('excludes filings at or below the watermark', async () => {
      // Watermark at Jan 10 — FILE_A (Jan 1) and FILE_B (Jan 2) are below it
      await setWatermark(
        conn,
        USER_ID,
        'filing',
        new Date('2024-01-10T00:00:00Z'),
      );
      const unread = await getUnreadFilingsSince(conn, USER_ID, sinceDate);
      const fileNumbers: string[] = unread.map((u) => u.fileNumber);
      expect(fileNumbers).toEqual([FILE_C]); // Only Jan 15 filing is above watermark
    });

    it('returns all filings when no watermark exists', async () => {
      const unread = await getUnreadFilingsSince(conn, USER_ID, sinceDate);
      const fileNumbers: string[] = unread.map((u) => u.fileNumber);
      expect(fileNumbers).toEqual([FILE_C, FILE_B, FILE_A]);
    });

    it('watermark at exact filing date excludes that filing', async () => {
      await setWatermark(
        conn,
        USER_ID,
        'filing',
        new Date('2024-01-02T00:00:00Z'),
      );
      const unread = await getUnreadFilingsSince(conn, USER_ID, sinceDate);
      const fileNumbers: string[] = unread.map((u) => u.fileNumber);
      expect(fileNumbers).toEqual([FILE_C]);
    });

    it('watermark combines with per-item views', async () => {
      // Watermark covers FILE_A and FILE_B, explicit view covers FILE_C
      await setWatermark(
        conn,
        USER_ID,
        'filing',
        new Date('2024-01-10T00:00:00Z'),
      );
      await markViewed(conn, USER_ID, FILE_C);
      const unread = await getUnreadFilingsSince(conn, USER_ID, sinceDate);
      expect(unread).toEqual([]);
    });
  });

  describe('watermark + getViewedFileNumbers', () => {
    it('includes watermarked filings in bulk-check results', async () => {
      await setWatermark(
        conn,
        USER_ID,
        'filing',
        new Date('2024-01-10T00:00:00Z'),
      );
      const viewed: Set<string> = await getViewedFileNumbers(conn, USER_ID, [
        FILE_A,
        FILE_B,
        FILE_C,
      ]);
      // FILE_A (Jan 1) and FILE_B (Jan 2) are at or below watermark
      expect(viewed).toEqual(new Set([FILE_A, FILE_B]));
    });

    it('combines explicit views and watermark views', async () => {
      await setWatermark(
        conn,
        USER_ID,
        'filing',
        new Date('2024-01-10T00:00:00Z'),
      );
      await markViewed(conn, USER_ID, FILE_C);
      const viewed: Set<string> = await getViewedFileNumbers(conn, USER_ID, [
        FILE_A,
        FILE_B,
        FILE_C,
      ]);
      expect(viewed).toEqual(new Set([FILE_A, FILE_B, FILE_C]));
    });
  });

  describe('watermark + getViewedNewsIds', () => {
    it('respects news watermark', async () => {
      // Watermark at Jan 12 — news 1 (Jan 5) is below, news 3 (Jan 20) is above
      await setWatermark(
        conn,
        USER_ID,
        'news',
        new Date('2024-01-12T00:00:00Z'),
      );
      const viewed: Set<number> = await getViewedNewsIds(
        conn,
        USER_ID,
        [1, 2, 3],
      );
      // News 1 (published Jan 5) and News 2 (no published_at, created Jan 10) are below watermark
      expect(viewed).toEqual(new Set([1, 2]));
    });

    it('handles NULL published_at by falling back to created_at', async () => {
      // News item 2 has NULL published_at, created_at = Jan 10
      // Watermark at Jan 8 — news 2 should NOT be below watermark
      await setWatermark(
        conn,
        USER_ID,
        'news',
        new Date('2024-01-08T00:00:00Z'),
      );
      const viewed: Set<number> = await getViewedNewsIds(
        conn,
        USER_ID,
        [1, 2, 3],
      );
      // Only news 1 (Jan 5) is below watermark
      expect(viewed).toEqual(new Set([1]));
    });

    it('returns empty when no watermark and no explicit views', async () => {
      const viewed: Set<number> = await getViewedNewsIds(
        conn,
        USER_ID,
        [1, 2, 3],
      );
      expect(viewed).toEqual(new Set());
    });
  });

  describe('markUnread on watermarked item', () => {
    it('watermarked filing still appears viewed after markUnread', async () => {
      await setWatermark(
        conn,
        USER_ID,
        'filing',
        new Date('2024-01-10T00:00:00Z'),
      );
      // FILE_A is below watermark — markUnread has no per-item row to delete
      await markUnread(conn, USER_ID, FILE_A);
      const viewed: Set<string> = await getViewedFileNumbers(conn, USER_ID, [
        FILE_A,
      ]);
      expect(viewed).toEqual(new Set([FILE_A]));
    });
  });
});
