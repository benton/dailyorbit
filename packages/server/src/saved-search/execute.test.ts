import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { executeSavedSearch } from './execute.ts';
import type { FilingSearchFilters } from '../search/types.ts';

describe('saved search execution', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    // Create minimal filing table for search
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        callsign VARCHAR,
        address_attention VARCHAR,
        subsystem_code VARCHAR NOT NULL,
        app_type_code VARCHAR NOT NULL,
        status_code VARCHAR,
        date_filed TIMESTAMP,
        company_id INTEGER,
        _first_seen_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        parent_company_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        summary VARCHAR,
        attachment_name VARCHAR
      );
      INSERT INTO filing VALUES
        (1, 'SAT-LOA-20250101-00001', 'E123', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2025-01-15', NULL, '2025-01-15');
    `);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should execute a filing search with saved filters', async () => {
    const filters: FilingSearchFilters = { subsystem_code: ['SAT'] };
    const result = await executeSavedSearch(conn, 'filing', filters, {
      page: 1,
      pageSize: 10,
    });
    expect(result.data.length).toEqual(1);
  });

  it('should execute a filing search scoped to new items since a timestamp', async () => {
    const filters: FilingSearchFilters = { subsystem_code: ['SAT'] };
    // Items since far in the future should return nothing
    const result = await executeSavedSearch(
      conn,
      'filing',
      filters,
      { page: 1, pageSize: 10 },
      '2099-01-01',
    );
    expect(result.data).toHaveLength(0);
  });
});
