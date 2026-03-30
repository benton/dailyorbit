import { randomBytes } from 'node:crypto';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../lib/config-service.ts';
import { CONFIG_SCHEMA } from '../lib/config-schema.ts';
import { setConfigService } from '../lib/config.ts';
import { initializeDatabase } from '../lib/db-init.ts';
import { buildConfigEntries } from './routes.ts';

const TEST_KEY: Buffer = randomBytes(32);

let db: DuckDBInstance;
let service: ConfigService;

beforeEach(async () => {
  db = await DuckDBInstance.create(':memory:');
  await initializeDatabase(db);
  service = new ConfigService(db, TEST_KEY);
  await service.seedDefaults();
  setConfigService(service);
});

afterEach(() => {
  db.closeSync();
});

describe('config routes', () => {
  describe('buildConfigEntries', () => {
    it('returns one entry per config schema key', () => {
      const entries = buildConfigEntries();
      const keys: string[] = entries.map((e) => e.key);
      expect(keys).toEqual(Object.keys(CONFIG_SCHEMA));
    });

    it('masks encrypted values with asterisks', () => {
      const entries = buildConfigEntries();
      const secret = entries.find((e) => e.key === 'betterAuthSecret');
      expect(secret).toBeDefined();
      expect(secret!.value).toEqual('********');
      expect(secret!.encrypted).toEqual(true);
    });

    it('exposes plaintext values for non-encrypted keys', () => {
      const entries = buildConfigEntries();
      const domain = entries.find((e) => e.key === 'clientDomain');
      expect(domain).toBeDefined();
      expect(domain!.value).toEqual('http://localhost:5973');
      expect(domain!.encrypted).toEqual(false);
    });

    it('includes description from schema', () => {
      const entries = buildConfigEntries();
      const authUrl = entries.find((e) => e.key === 'betterAuthUrl');
      expect(authUrl!.description).toEqual('Auth service base URL');
    });

    it('includes bedrock config keys', () => {
      const entries = buildConfigEntries();
      const keys: string[] = entries.map((e) => e.key);
      expect(keys).toContain('bedrockRegion');
      expect(keys).toContain('bedrockDefaultModel');
    });

    it('reflects updated values after set', async () => {
      await service.set('clientDomain', 'https://example.com');
      const entries = buildConfigEntries();
      const domain = entries.find((e) => e.key === 'clientDomain');
      expect(domain!.value).toEqual('https://example.com');
    });
  });
});
