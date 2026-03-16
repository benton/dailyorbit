import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureViewingHistoryTables } from './schema.ts';
import {
  getRecentlyViewed,
  getViewedFileNumbers,
  markUnread,
  markViewed,
} from './repository.ts';

describe('viewing-history repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  const USER_ID: string = 'user-123';
  const FILE_A: string = 'SAT-LOA-20240101-00001';
  const FILE_B: string = 'SES-LOA-20240102-00002';

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureViewingHistoryTables(conn);
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
});
