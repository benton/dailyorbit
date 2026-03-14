import { randomBytes } from 'node:crypto';
import type { DuckDBInstance } from '@duckdb/node-api';
import {
  getAllConfig,
  setConfigValue as repoSet,
} from './config-repository.ts';
import { CONFIG_SCHEMA, type ConfigKey } from './config-schema.ts';
import { SecretValue, decrypt, encrypt } from './encryption.ts';

export class ConfigService {
  private readonly db: DuckDBInstance;
  private readonly encryptionKey: Buffer;
  private cache: Map<string, string> = new Map();

  constructor(db: DuckDBInstance, encryptionKey: Buffer) {
    this.db = db;
    this.encryptionKey = encryptionKey;
  }

  /** Read all config from DB, decrypt encrypted values, populate cache. */
  async load(): Promise<void> {
    this.cache.clear();
    const rows = await getAllConfig(this.db);
    for (const row of rows) {
      const plaintext: string = row.encrypted
        ? decrypt(row.value, this.encryptionKey)
        : row.value;
      this.cache.set(row.key, plaintext);
    }
    // Fill in defaults for missing keys
    for (const [key, def] of Object.entries(CONFIG_SCHEMA)) {
      if (!this.cache.has(key)) {
        this.cache.set(key, def.defaultValue);
      }
    }
  }

  /** Synchronous read from cache. Returns SecretValue for encrypted keys, string otherwise. */
  get(key: ConfigKey): string | SecretValue {
    const value: string = this.cache.get(key) ?? '';
    const def = CONFIG_SCHEMA[key];
    if (def?.encrypted) {
      return new SecretValue(value);
    }
    return value;
  }

  /** Persist a config value to DB and update cache. */
  async set(key: ConfigKey, value: string): Promise<void> {
    const def = CONFIG_SCHEMA[key];
    if (def == null) {
      throw new Error(`Unknown config key: ${key}`);
    }
    const stored: string = def.encrypted
      ? encrypt(value, this.encryptionKey)
      : value;
    await repoSet(this.db, key, stored, def.encrypted);
    this.cache.set(key, value);
  }

  /** Re-read all config from DB (hot-reload). */
  async reload(): Promise<void> {
    await this.load();
  }

  /** Seed default config values into DB (for fresh initialization). */
  async seedDefaults(): Promise<void> {
    for (const [key, def] of Object.entries(CONFIG_SCHEMA)) {
      let value: string = def.defaultValue;
      // Auto-generate betterAuthSecret if empty
      if (key === 'betterAuthSecret' && value === '') {
        value = randomBytes(32).toString('base64');
      }
      const stored: string = def.encrypted
        ? encrypt(value, this.encryptionKey)
        : value;
      await repoSet(this.db, key, stored, def.encrypted);
    }
    await this.load();
  }
}
