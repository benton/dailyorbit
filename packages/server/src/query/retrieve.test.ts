import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { rebuildAllFtsIndexes } from '../search/fts-index.ts';
import { retrieveContext } from './retrieve.ts';
import type { RewrittenQuery } from './types.ts';

describe('retrieveContext', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    await conn.run(`
      CREATE TABLE filing (
        file_number VARCHAR PRIMARY KEY,
        filing_key INTEGER,
        callsign VARCHAR,
        address_attention VARCHAR,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        status_code VARCHAR,
        date_filed DATE,
        company_id UUID,
        description VARCHAR,
        brief_description VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE attachment (
        attachment_key INTEGER PRIMARY KEY,
        file_number VARCHAR,
        filing_key INTEGER,
        full_text VARCHAR,
        summary VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE pleading (
        pleading_key INTEGER PRIMARY KEY,
        filing_key INTEGER,
        filer_name VARCHAR,
        exhibit_attachment_html VARCHAR
      )
    `);
    await conn.run(
      `CREATE TABLE company (id UUID PRIMARY KEY, name VARCHAR, parent_company_id UUID)`,
    );
    await conn.run(`
      CREATE TABLE news_source (
        id INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL,
        feed_url VARCHAR NOT NULL UNIQUE,
        category VARCHAR NOT NULL DEFAULT 'industry',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_fetched_at TIMESTAMP,
        last_fetch_status VARCHAR,
        last_fetch_error VARCHAR,
        created_at TIMESTAMP DEFAULT current_timestamp,
        updated_at TIMESTAMP DEFAULT current_timestamp
      )
    `);
    await conn.run(`
      CREATE TABLE news_item (
        id INTEGER PRIMARY KEY,
        news_source_id INTEGER NOT NULL,
        source_url VARCHAR NOT NULL UNIQUE,
        title VARCHAR NOT NULL,
        author VARCHAR,
        published_at TIMESTAMP,
        full_text VARCHAR,
        text_length INTEGER,
        text_checksum VARCHAR,
        summary VARCHAR,
        summarized_by VARCHAR,
        summarized_at TIMESTAMP,
        extract_status VARCHAR NOT NULL DEFAULT 'pending',
        company_id INTEGER,
        tags VARCHAR[],
        indexed_by VARCHAR,
        indexed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT current_timestamp
      )
    `);

    // Seed test data
    await conn.run(`INSERT INTO filing VALUES (
      'SAT-LOA-20240101-00001', 1, 'SATX1', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2024-01-01', NULL,
      'Request for satellite frequency allocation in Ka-band', 'Ka-band satellite'
    )`);
    await conn.run(`INSERT INTO filing VALUES (
      'SES-LIC-20240201-00002', 2, 'E001', 'Hughes Net', 'SES', 'LIC', 'P', '2024-02-01', NULL,
      'Earth station license application for C-band operations', 'Earth station C-band'
    )`);
    await conn.run(`INSERT INTO filing VALUES (
      'SAT-STA-20240301-00003', 3, 'SATX2', 'Viasat Inc', 'SAT', 'STA', 'G', '2024-03-01', NULL,
      'Special temporary authority for Ka-band testing', 'Ka-band STA'
    )`);
    await conn.run(`INSERT INTO attachment VALUES (
      1, 'SAT-LOA-20240101-00001', 1,
      'Technical narrative describing Ka-band frequency coordination with adjacent satellite operators',
      NULL
    )`);
    await conn.run(`INSERT INTO attachment VALUES (
      2, 'SES-LIC-20240201-00002', 2,
      'Site survey report for the proposed Virginia earth station location with C-band equipment',
      NULL
    )`);
    await conn.run(`INSERT INTO pleading VALUES (
      1, 1, 'Viasat Inc',
      'Comments opposing Ka-band allocation due to interference concerns'
    )`);

    await rebuildAllFtsIndexes(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns sources matching a single query', async () => {
    const queries: RewrittenQuery[] = [{ text: 'Ka-band satellite frequency' }];

    const { sources, retrievalMs } = await retrieveContext(queries, conn);

    expect(sources.length).toBeGreaterThan(0);
    expect(retrievalMs).toBeGreaterThanOrEqual(0);

    // Should find the Ka-band filing
    const ids: string[] = sources.map((s) => s.id);
    const hasKaBand: boolean =
      ids.includes('SAT-LOA-20240101-00001') ||
      sources.some((s) => s.title.includes('SAT-LOA-20240101-00001'));
    expect(hasKaBand).toEqual(true);

    // Each source should have required fields
    for (const source of sources) {
      expect(source.type).toBeDefined();
      expect(source.id).toBeDefined();
      expect(source.title).toBeDefined();
      expect(typeof source.score).toEqual('number');
    }
  });

  it('merges results from multiple queries via RRF', async () => {
    const queries: RewrittenQuery[] = [
      { text: 'Ka-band satellite' },
      { text: 'earth station C-band' },
    ];

    const { sources } = await retrieveContext(queries, conn);

    // Should have results from both query domains
    expect(sources.length).toBeGreaterThanOrEqual(2);

    // Scores should be sorted descending
    for (let i: number = 1; i < sources.length; i++) {
      expect(sources[i - 1]!.score).toBeGreaterThanOrEqual(sources[i]!.score);
    }
  });

  it('applies filters from rewritten query', async () => {
    const queries: RewrittenQuery[] = [
      {
        text: 'satellite applications',
        filters: { subsystems: ['SES'] },
      },
    ];

    const { sources } = await retrieveContext(queries, conn);

    // With SES subsystem filter, should not return SAT filings
    const types: string[] = sources.map((s) => s.id);
    const hasSatFiling: boolean = types.some((id) => id.startsWith('SAT-'));
    expect(hasSatFiling).toEqual(false);
  });

  it('deduplicates sources across queries', async () => {
    // Both queries should match the same Ka-band filing
    const queries: RewrittenQuery[] = [
      { text: 'Ka-band frequency coordination' },
      { text: 'Ka-band satellite allocation' },
    ];

    const { sources } = await retrieveContext(queries, conn);

    // Check no duplicate source keys
    const keys: string[] = sources.map((s) => `${s.type}:${s.id}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toEqual(uniqueKeys.size);
  });

  it('returns at most 10 results', async () => {
    const queries: RewrittenQuery[] = [{ text: 'station satellite' }];

    const { sources } = await retrieveContext(queries, conn);

    expect(sources.length).toBeLessThanOrEqual(10);
  });

  it('returns empty sources for unmatched query', async () => {
    const queries: RewrittenQuery[] = [{ text: 'xyznonexistent42' }];

    const { sources } = await retrieveContext(queries, conn);

    expect(sources).toEqual([]);
  });
});
