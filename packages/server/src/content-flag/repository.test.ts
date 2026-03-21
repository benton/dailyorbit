import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureContentFlagTables } from './schema.ts';
import {
  createBulkFlags,
  createFlag,
  dismissFlag,
  getActiveFlagKeys,
  getActiveFlagsForUser,
  undismissFlag,
} from './repository.ts';

describe('content flag repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  const USER_ID: string = 'test-user-001';
  const FILING_KEY_A: string = 'SAT-LOA-20250101-00001';
  const FILING_KEY_B: string = 'SAT-LOA-20250201-00001';
  const FILING_KEY_C: string = 'SAT-LOA-20250301-00001';

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureContentFlagTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('createFlag', () => {
    it('creates a manual flag and returns a positive id', async () => {
      const id: number = await createFlag(conn, USER_ID, {
        content_type: 'filing',
        content_key: FILING_KEY_A,
      });
      expect(id).toBeGreaterThan(0);
    });

    it('does not duplicate a flag for the same content — returns existing id', async () => {
      const id1: number = await createFlag(conn, USER_ID, {
        content_type: 'filing',
        content_key: FILING_KEY_A,
      });
      const id2: number = await createFlag(conn, USER_ID, {
        content_type: 'filing',
        content_key: FILING_KEY_A,
      });
      expect(id2).toEqual(id1);

      const flags = await getActiveFlagsForUser(conn, USER_ID, 'filing');
      const matching = flags.filter((f) => f.content_key === FILING_KEY_A);
      expect(matching).toHaveLength(1);
    });
  });

  describe('createBulkFlags', () => {
    it('creates flags for multiple content keys', async () => {
      const ids: number[] = await createBulkFlags(conn, USER_ID, {
        content_type: 'filing',
        content_keys: [FILING_KEY_B, FILING_KEY_C],
        reason: 'Interesting filings',
      });
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toEqual(ids[1]);
    });
  });

  describe('getActiveFlagsForUser', () => {
    it('lists only active (non-dismissed) flags for a user', async () => {
      await createFlag(conn, USER_ID, { content_type: 'filing', content_key: FILING_KEY_A });
      await createFlag(conn, USER_ID, { content_type: 'filing', content_key: FILING_KEY_B });

      const flags = await getActiveFlagsForUser(conn, USER_ID, 'filing');
      expect(flags).toHaveLength(2);
      for (const f of flags) {
        expect(f.dismissed_at).toBeNull();
        expect(f.source).toEqual('manual');
      }
    });
  });

  describe('dismissFlag / undismissFlag', () => {
    it('soft-deletes a flag — removed from active list but still in DB', async () => {
      const id: number = await createFlag(conn, USER_ID, {
        content_type: 'filing',
        content_key: FILING_KEY_A,
      });

      const dismissed: boolean = await dismissFlag(conn, id, USER_ID);
      expect(dismissed).toEqual(true);

      const activeFlags = await getActiveFlagsForUser(conn, USER_ID, 'filing');
      expect(activeFlags.find((f) => f.id === id)).toBeUndefined();

      const allFlags = await conn.runAndReadAll(
        'SELECT dismissed_at FROM user_content_flag WHERE id = $1',
        [id],
      );
      expect(allFlags.getRowObjectsJS()[0]!.dismissed_at).not.toBeNull();
    });

    it('returns false when dismissing a non-existent or already-dismissed flag', async () => {
      const result: boolean = await dismissFlag(conn, 99999, USER_ID);
      expect(result).toEqual(false);
    });

    it('restores a previously dismissed flag', async () => {
      const id: number = await createFlag(conn, USER_ID, {
        content_type: 'filing',
        content_key: FILING_KEY_A,
      });
      await dismissFlag(conn, id, USER_ID);
      const restored: boolean = await undismissFlag(conn, id, USER_ID);
      expect(restored).toEqual(true);

      const flags = await getActiveFlagsForUser(conn, USER_ID, 'filing');
      const found = flags.find((f) => f.id === id);
      expect(found).toBeDefined();
      expect(found!.dismissed_at).toBeNull();
    });
  });

  describe('getActiveFlagKeys', () => {
    it('returns only actively-flagged keys from a candidate list', async () => {
      await createFlag(conn, USER_ID, { content_type: 'filing', content_key: FILING_KEY_A });
      await createFlag(conn, USER_ID, { content_type: 'filing', content_key: FILING_KEY_B });

      const keys: Set<string> = await getActiveFlagKeys(
        conn,
        USER_ID,
        'filing',
        [FILING_KEY_A, FILING_KEY_B, 'NONEXISTENT'],
      );
      expect(keys).toEqual(new Set([FILING_KEY_A, FILING_KEY_B]));
    });

    it('returns empty set for empty input', async () => {
      const keys: Set<string> = await getActiveFlagKeys(conn, USER_ID, 'filing', []);
      expect(keys).toEqual(new Set());
    });
  });
});
