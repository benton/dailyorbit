import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteConfigValue,
  getAllConfig,
  getConfigValue,
  setConfigValue,
} from './config-repository.ts';
import { initializeDatabase } from './db-init.ts';

let db: DuckDBInstance;

beforeEach(async () => {
  db = await DuckDBInstance.create(':memory:');
  await initializeDatabase(db);
});

afterEach(() => {
  db.closeSync();
});

describe('config repository', () => {
  it('returns null for a missing key', async () => {
    const result = await getConfigValue(db, 'nonexistent');
    expect(result).toBeNull();
  });

  it('inserts and retrieves a plaintext config value', async () => {
    await setConfigValue(db, 'testKey', 'testValue', false);
    const result = await getConfigValue(db, 'testKey');
    expect(result).toEqual({
      key: 'testKey',
      value: 'testValue',
      encrypted: false,
    });
  });

  it('inserts and retrieves an encrypted config value', async () => {
    await setConfigValue(db, 'secret', 'cipher-blob', true);
    const result = await getConfigValue(db, 'secret');
    expect(result).toEqual({
      key: 'secret',
      value: 'cipher-blob',
      encrypted: true,
    });
  });

  it('upserts on conflict', async () => {
    await setConfigValue(db, 'key', 'v1', false);
    await setConfigValue(db, 'key', 'v2', false);
    const result = await getConfigValue(db, 'key');
    expect(result).toEqual({ key: 'key', value: 'v2', encrypted: false });
  });

  it('getAllConfig returns all rows', async () => {
    await setConfigValue(db, 'a', '1', false);
    await setConfigValue(db, 'b', '2', true);
    const rows = await getAllConfig(db);
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: 'a', value: '1', encrypted: false },
        { key: 'b', value: '2', encrypted: true },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('deleteConfigValue removes the row', async () => {
    await setConfigValue(db, 'doomed', 'val', false);
    await deleteConfigValue(db, 'doomed');
    const result = await getConfigValue(db, 'doomed');
    expect(result).toBeNull();
  });
});
