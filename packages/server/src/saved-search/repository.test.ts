import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureSavedSearchTables } from './schema.ts';
import {
  createSavedSearch,
  getSavedSearchById,
  getSavedSearchesForUser,
  deleteSavedSearch,
  updateSavedSearch,
} from './repository.ts';

describe('saved search repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const testUserId: string = 'test-user-001';

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    // Create user table for FK
    await conn.run(`
      CREATE TABLE IF NOT EXISTS "user" (
        id VARCHAR NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL UNIQUE,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image VARCHAR,
        "createdAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        role VARCHAR NOT NULL DEFAULT 'user',
        banned BOOLEAN NOT NULL DEFAULT false,
        "banReason" VARCHAR,
        "banExpires" TIMESTAMP
      );
      INSERT INTO "user" (id, name, email) VALUES ('test-user-001', 'Test', 'test@example.com');
    `);
    await ensureSavedSearchTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should create and retrieve a filing saved search', async () => {
    const filters = {
      subsystem_code: ['SAT'],
      company: 'SpaceX',
    };
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'SpaceX SAT filings',
      content_type: 'filing',
      filters,
    });
    expect(id).toBeGreaterThan(0);

    const saved = await getSavedSearchById(conn, id);
    expect(saved).not.toBeNull();
    expect(saved!.name).toEqual('SpaceX SAT filings');
    expect(saved!.content_type).toEqual('filing');
    expect(saved!.filters).toEqual(filters);
    expect(saved!.include_time_scope).toEqual(false);
    expect(saved!.alert_enabled).toEqual(false);
  });

  it('should set include_time_scope=true when date filters are present', async () => {
    const filters = {
      subsystem_code: ['SAT'],
      date_filed_from: '2025-01-01',
    };
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'SAT filings 2025',
      content_type: 'filing',
      filters,
    });

    const saved = await getSavedSearchById(conn, id);
    expect(saved!.include_time_scope).toEqual(true);
  });

  it('should create and retrieve a news saved search', async () => {
    const filters = { q: 'spectrum sharing', mode: 'hybrid' as const };
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'Spectrum sharing news',
      content_type: 'news',
      filters,
    });

    const saved = await getSavedSearchById(conn, id);
    expect(saved!.content_type).toEqual('news');
    expect(saved!.filters).toEqual(filters);
    expect(saved!.include_time_scope).toEqual(false);
  });

  it('should list all saved searches for a user', async () => {
    const searches = await getSavedSearchesForUser(conn, testUserId);
    expect(searches.length).toEqual(3);
    for (const s of searches) {
      expect(s.user_id).toEqual(testUserId);
    }
  });

  it('should not return searches belonging to other users', async () => {
    const searches = await getSavedSearchesForUser(conn, 'nonexistent-user');
    expect(searches).toHaveLength(0);
  });

  it('should update a saved search name', async () => {
    const searches = await getSavedSearchesForUser(conn, testUserId);
    const first = searches[0]!;
    await updateSavedSearch(conn, first.id, testUserId, { name: 'Renamed' });
    const updated = await getSavedSearchById(conn, first.id);
    expect(updated!.name).toEqual('Renamed');
  });

  it('should delete a saved search', async () => {
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'To delete',
      content_type: 'filing',
      filters: {},
    });
    const deleted: boolean = await deleteSavedSearch(conn, id, testUserId);
    expect(deleted).toEqual(true);
    const result = await getSavedSearchById(conn, id);
    expect(result).toBeNull();
  });

  it("should not delete another user's saved search", async () => {
    const id: number = await createSavedSearch(conn, testUserId, {
      name: 'Protected',
      content_type: 'filing',
      filters: {},
    });
    const deleted: boolean = await deleteSavedSearch(conn, id, 'other-user');
    expect(deleted).toEqual(false);
    const result = await getSavedSearchById(conn, id);
    expect(result).not.toBeNull();
  });
});
