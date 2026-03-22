import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureHiddenItemTables } from './schema.ts';
import {
  getActiveHiddenKeys,
  getActiveHidesForUser,
  getSystemHides,
  hideItem,
  unhideAllForUser,
  unhideItem,
  unhideSystemItem,
} from './repository.ts';

describe('hidden item repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  const USER_ID: string = 'test-user-001';
  const OTHER_USER_ID: string = 'test-user-002';
  const CONTENT_TYPE: string = 'filing';
  const KEY_A: string = 'SAT-LOA-20250101-00001';
  const KEY_B: string = 'SAT-LOA-20250201-00001';
  const KEY_C: string = 'SAT-LOA-20250301-00001';

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureHiddenItemTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('hideItem', () => {
    it('upserts and returns a positive id with correct fields', async () => {
      const reason: string = 'not relevant';
      const id: number = await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
        reason,
      });
      expect(id).toBeGreaterThan(0);

      const rows = await getActiveHidesForUser(conn, USER_ID, CONTENT_TYPE);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.content_key).toEqual(KEY_A);
      expect(rows[0]!.reason).toEqual(reason);
      expect(rows[0]!.scope).toEqual('user');
      expect(rows[0]!.removed_at).toBeNull();
    });

    it('re-activates a removed hide — removed_at becomes null again', async () => {
      const id1: number = await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
      });
      await unhideItem(conn, id1, USER_ID);

      // Verify it was removed
      const afterUnhide = await getActiveHidesForUser(
        conn,
        USER_ID,
        CONTENT_TYPE,
      );
      expect(afterUnhide).toHaveLength(0);

      // Re-hide
      const id2: number = await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
      });
      expect(id2).toEqual(id1);

      const rows = await getActiveHidesForUser(conn, USER_ID, CONTENT_TYPE);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.removed_at).toBeNull();
    });
  });

  describe('unhideItem', () => {
    it('soft-deletes by setting removed_at', async () => {
      const id: number = await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
      });

      const result: boolean = await unhideItem(conn, id, USER_ID);
      expect(result).toEqual(true);

      const reader = await conn.runAndReadAll(
        'SELECT removed_at FROM hidden_item WHERE id = $1',
        [id],
      );
      expect(reader.getRowObjectsJS()[0]!.removed_at).not.toBeNull();
    });

    it('returns false for non-existent id', async () => {
      const result: boolean = await unhideItem(conn, 99999, USER_ID);
      expect(result).toEqual(false);
    });
  });

  describe('getActiveHiddenKeys', () => {
    it('returns correct set combining user and system hides', async () => {
      // 2 user hides
      await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
      });
      const idB: number = await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_B,
      });
      // 1 system hide
      await hideItem(
        conn,
        USER_ID,
        { content_type: CONTENT_TYPE, content_key: KEY_C },
        'system',
      );
      // Unhide one user hide
      await unhideItem(conn, idB, USER_ID);

      const keys: Set<string> = await getActiveHiddenKeys(
        conn,
        USER_ID,
        CONTENT_TYPE,
        [KEY_A, KEY_B, KEY_C, 'NONEXISTENT'],
      );
      expect(keys).toEqual(new Set([KEY_A, KEY_C]));
    });

    it('returns empty set for empty input', async () => {
      const keys: Set<string> = await getActiveHiddenKeys(
        conn,
        USER_ID,
        CONTENT_TYPE,
        [],
      );
      expect(keys).toEqual(new Set());
    });
  });

  describe('getActiveHidesForUser', () => {
    it('returns only active user-scope hides', async () => {
      // User hide
      await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
      });
      // System hide (same user triggers it but scope is system)
      await hideItem(
        conn,
        USER_ID,
        { content_type: CONTENT_TYPE, content_key: KEY_B },
        'system',
      );
      // Other user's hide
      await hideItem(conn, OTHER_USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_C,
      });

      const rows = await getActiveHidesForUser(conn, USER_ID, CONTENT_TYPE);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.content_key).toEqual(KEY_A);
      expect(rows[0]!.scope).toEqual('user');
    });
  });

  describe('unhideAllForUser', () => {
    it('removes only user-scope hides and returns count', async () => {
      // 2 user hides
      await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
      });
      await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_B,
      });
      // 1 system hide
      await hideItem(
        conn,
        USER_ID,
        { content_type: CONTENT_TYPE, content_key: KEY_C },
        'system',
      );

      const count: number = await unhideAllForUser(conn, USER_ID);
      expect(count).toEqual(2);

      // User hides gone
      const userRows = await getActiveHidesForUser(conn, USER_ID, CONTENT_TYPE);
      expect(userRows).toHaveLength(0);

      // System hide still active
      const systemRows = await getSystemHides(conn, CONTENT_TYPE);
      expect(systemRows).toHaveLength(1);
      expect(systemRows[0]!.content_key).toEqual(KEY_C);
    });
  });

  describe('getSystemHides', () => {
    it('returns only system-scope hides', async () => {
      await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
      });
      await hideItem(
        conn,
        USER_ID,
        { content_type: CONTENT_TYPE, content_key: KEY_B },
        'system',
      );
      await hideItem(
        conn,
        OTHER_USER_ID,
        { content_type: CONTENT_TYPE, content_key: KEY_C },
        'system',
      );

      const rows = await getSystemHides(conn, CONTENT_TYPE);
      expect(rows).toHaveLength(2);
      const keys: string[] = rows.map((r) => r.content_key).sort();
      expect(keys).toEqual([KEY_B, KEY_C]);
    });
  });

  describe('unhideSystemItem', () => {
    it('removes a system hide without affecting user hides', async () => {
      // User hide
      await hideItem(conn, USER_ID, {
        content_type: CONTENT_TYPE,
        content_key: KEY_A,
      });
      // System hide
      const systemId: number = await hideItem(
        conn,
        USER_ID,
        { content_type: CONTENT_TYPE, content_key: KEY_B },
        'system',
      );

      const result: boolean = await unhideSystemItem(conn, systemId);
      expect(result).toEqual(true);

      // System hide gone
      const systemRows = await getSystemHides(conn, CONTENT_TYPE);
      expect(systemRows).toHaveLength(0);

      // User hide still active
      const userRows = await getActiveHidesForUser(conn, USER_ID, CONTENT_TYPE);
      expect(userRows).toHaveLength(1);
      expect(userRows[0]!.content_key).toEqual(KEY_A);
    });

    it('returns false for non-existent system hide', async () => {
      const result: boolean = await unhideSystemItem(conn, 99999);
      expect(result).toEqual(false);
    });
  });
});
