import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureConsultantTables } from './schema.ts';
import {
  createConsultant,
  getConsultantById,
  getConsultantBySlug,
  listConsultants,
  updateConsultant,
  archiveConsultant,
} from './repository.ts';

describe('consultant repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureConsultantTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  const SEED_DATA = {
    name: 'General Analyst',
    slug: 'general-analyst',
    description: 'Balanced FCC filing Q&A',
    systemPrompt: 'You are a general analyst.',
    modelId: null,
    temperature: null,
    maxResponseTokens: null,
    icon: '🔍',
    color: '#3B82F6',
    sortOrder: 0,
    enabled: true,
  };

  describe('createConsultant', () => {
    it('creates and returns a consultant with all fields', async () => {
      const result = await createConsultant(conn, SEED_DATA);

      expect(result).toEqual(expect.objectContaining({
        name: 'General Analyst',
        slug: 'general-analyst',
        description: 'Balanced FCC filing Q&A',
        systemPrompt: 'You are a general analyst.',
        icon: '🔍',
        color: '#3B82F6',
        sortOrder: 0,
        enabled: true,
        archivedAt: null,
      }));
      expect(result.id).toBeGreaterThan(0);
      expect(result.createdAt).toBeTruthy();
    });
  });

  describe('getConsultantById', () => {
    it('returns the consultant when found', async () => {
      const created = await createConsultant(conn, SEED_DATA);
      const found = await getConsultantById(conn, created.id);
      expect(found).toEqual(created);
    });

    it('returns null when not found', async () => {
      const found = await getConsultantById(conn, 99999);
      expect(found).toBeNull();
    });
  });

  describe('getConsultantBySlug', () => {
    it('returns the consultant when found', async () => {
      const created = await createConsultant(conn, SEED_DATA);
      const found = await getConsultantBySlug(conn, 'general-analyst');
      expect(found).toEqual(created);
    });
  });

  describe('listConsultants', () => {
    it('returns only enabled, non-archived by default', async () => {
      await createConsultant(conn, SEED_DATA);
      await createConsultant(conn, { ...SEED_DATA, name: 'Disabled', slug: 'disabled', enabled: false });
      const result = await listConsultants(conn, { enabledOnly: true });
      expect(result).toHaveLength(1);
      expect(result[0]!.slug).toEqual('general-analyst');
    });

    it('returns all when enabledOnly is false', async () => {
      await createConsultant(conn, SEED_DATA);
      await createConsultant(conn, { ...SEED_DATA, name: 'Disabled', slug: 'disabled', enabled: false });
      const result = await listConsultants(conn, { enabledOnly: false });
      expect(result).toHaveLength(2);
    });
  });

  describe('updateConsultant', () => {
    it('updates specified fields only', async () => {
      const created = await createConsultant(conn, SEED_DATA);
      const updated = await updateConsultant(conn, created.id, { name: 'Updated Name' });
      expect(updated!.name).toEqual('Updated Name');
      expect(updated!.slug).toEqual('general-analyst'); // unchanged
    });
  });

  describe('archiveConsultant', () => {
    it('sets archived_at and returns true', async () => {
      const created = await createConsultant(conn, SEED_DATA);
      const result = await archiveConsultant(conn, created.id);
      expect(result).toEqual(true);
      const found = await getConsultantById(conn, created.id);
      expect(found!.archivedAt).toBeTruthy();
    });

    it('returns false for non-existent id', async () => {
      const result = await archiveConsultant(conn, 99999);
      expect(result).toEqual(false);
    });
  });
});
