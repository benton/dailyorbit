import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureUserSettingsTables } from './schema.ts';
import {
  getOrCreateSettings,
  getSettingsByUserId,
  updateSettings,
} from './repository.ts';

describe('user-settings repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  const TEST_USER_ID: string = 'user-123';

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureUserSettingsTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('getSettingsByUserId', () => {
    it('returns null for non-existent user', async () => {
      const result = await getSettingsByUserId(conn, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getOrCreateSettings', () => {
    it('creates default settings on first access', async () => {
      const settings = await getOrCreateSettings(conn, TEST_USER_ID);
      expect(settings).toEqual({
        userId: TEST_USER_ID,
        emailDailyOrbit: false,
        wideView: false,
      });
    });

    it('returns existing settings on subsequent access', async () => {
      await getOrCreateSettings(conn, TEST_USER_ID);
      const settings = await getOrCreateSettings(conn, TEST_USER_ID);
      expect(settings.userId).toEqual(TEST_USER_ID);
    });
  });

  describe('updateSettings', () => {
    it('updates individual settings', async () => {
      await getOrCreateSettings(conn, TEST_USER_ID);

      const updated = await updateSettings(conn, TEST_USER_ID, {
        wideView: true,
      });
      expect(updated.wideView).toEqual(true);
      expect(updated.emailDailyOrbit).toEqual(false);
    });

    it('updates multiple settings at once', async () => {
      await getOrCreateSettings(conn, TEST_USER_ID);

      const updated = await updateSettings(conn, TEST_USER_ID, {
        wideView: true,
        emailDailyOrbit: true,
      });
      expect(updated.wideView).toEqual(true);
      expect(updated.emailDailyOrbit).toEqual(true);
    });
  });
});
