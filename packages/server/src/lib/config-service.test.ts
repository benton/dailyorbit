import { randomBytes } from 'node:crypto';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigValue } from './config-repository.ts';
import { ConfigService } from './config-service.ts';
import { initializeDatabase } from './db-init.ts';
import { SecretValue, decrypt } from './encryption.ts';

const TEST_KEY: Buffer = randomBytes(32);

let db: DuckDBInstance;
let service: ConfigService;

beforeEach(async () => {
  db = await DuckDBInstance.create(':memory:');
  await initializeDatabase(db);
  service = new ConfigService(db, TEST_KEY);
});

afterEach(() => {
  db.closeSync();
});

describe('ConfigService', () => {
  describe('load and get', () => {
    it('returns defaults when DB is empty', async () => {
      await service.load();
      expect(service.get('betterAuthUrl')).toEqual('http://localhost:9000');
      expect(service.get('clientDomain')).toEqual('http://localhost:5173');
    });

    it('returns SecretValue for encrypted keys', async () => {
      await service.load();
      const secret = service.get('betterAuthSecret');
      expect(secret).toBeInstanceOf(SecretValue);
    });

    it('returns plain string for non-encrypted keys', async () => {
      await service.load();
      const value = service.get('clientDomain');
      expect(typeof value).toEqual('string');
      expect(value).not.toBeInstanceOf(SecretValue);
    });
  });

  describe('set', () => {
    it('persists a plaintext value and updates cache', async () => {
      await service.load();
      await service.set('clientDomain', 'https://example.com');
      expect(service.get('clientDomain')).toEqual('https://example.com');

      // Verify DB has the plaintext
      const row = await getConfigValue(db, 'clientDomain');
      expect(row).toEqual({
        key: 'clientDomain',
        value: 'https://example.com',
        encrypted: false,
      });
    });

    it('persists an encrypted value and updates cache', async () => {
      await service.load();
      await service.set('betterAuthSecret', 'my-secret');

      const cached = service.get('betterAuthSecret');
      expect(cached).toBeInstanceOf(SecretValue);
      expect((cached as SecretValue).unwrap()).toEqual('my-secret');

      // Verify DB has encrypted blob, not plaintext
      const row = await getConfigValue(db, 'betterAuthSecret');
      expect(row?.encrypted).toEqual(true);
      expect(row?.value).not.toEqual('my-secret');
      expect(decrypt(row!.value, TEST_KEY)).toEqual('my-secret');
    });

    it('throws for unknown config key', async () => {
      await service.load();
      await expect(service.set('bogus' as any, 'value')).rejects.toThrow(
        'Unknown config key: bogus',
      );
    });
  });

  describe('seedDefaults', () => {
    it('seeds all schema keys into DB', async () => {
      await service.seedDefaults();

      expect(service.get('betterAuthUrl')).toEqual('http://localhost:9000');
      expect(service.get('clientDomain')).toEqual('http://localhost:5173');

      // betterAuthSecret should be auto-generated (non-empty)
      const secret = service.get('betterAuthSecret') as SecretValue;
      expect(secret.unwrap().length).toBeGreaterThan(0);
    });

    it('stores encrypted values as encrypted in DB', async () => {
      await service.seedDefaults();
      const row = await getConfigValue(db, 'betterAuthSecret');
      expect(row?.encrypted).toEqual(true);
      // The stored value should be decryptable
      const decrypted: string = decrypt(row!.value, TEST_KEY);
      expect(decrypted.length).toBeGreaterThan(0);
    });
  });

  describe('reload', () => {
    it('re-reads values from DB', async () => {
      await service.seedDefaults();
      // Directly modify DB behind the service's back
      const service2: ConfigService = new ConfigService(db, TEST_KEY);
      await service2.load();
      await service2.set('clientDomain', 'https://changed.com');

      // Original service still has old value
      expect(service.get('clientDomain')).toEqual('http://localhost:5173');

      // After reload, picks up new value
      await service.reload();
      expect(service.get('clientDomain')).toEqual('https://changed.com');
    });
  });
});
