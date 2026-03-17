import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { rebuildAllFtsIndexes } from './fts-index.ts';

describe('searchFilingContent', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    // Create tables with columns needed by the search query
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

    // Test data: two filings, one with attachment text about Ka-band
    await conn.run(`INSERT INTO filing VALUES (
      'SAT-LOA-20240101-00001', 1, 'SATX1', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2024-01-01', NULL,
      'Request for satellite frequency allocation in Ka-band', 'Ka-band satellite'
    )`);
    await conn.run(`INSERT INTO filing VALUES (
      'SES-LIC-20240201-00002', 2, 'E001', 'Hughes Net', 'SES', 'LIC', 'P', '2024-02-01', NULL,
      'Earth station license application', 'Earth station'
    )`);
    await conn.run(`INSERT INTO attachment VALUES (
      1, 'SAT-LOA-20240101-00001', 1,
      'Technical narrative describing Ka-band frequency coordination with adjacent satellite operators and detailed interference analysis',
      NULL
    )`);
    await conn.run(`INSERT INTO attachment VALUES (
      2, 'SES-LIC-20240201-00002', 2,
      'Site survey report for the proposed Virginia earth station location',
      NULL
    )`);
    await conn.run(`INSERT INTO pleading VALUES (
      1, 1, 'Viasat Inc',
      'Comments opposing Ka-band allocation due to interference concerns with existing satellite networks'
    )`);

    await rebuildAllFtsIndexes(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('should return ranked results matching a content query', async () => {
    const { searchFilingContent } = await import('./content-search.ts');
    const result = await searchFilingContent(
      conn,
      { q: 'Ka-band interference' },
      {},
      { page: 1, pageSize: 25 },
    );

    expect(result.data.length).toBeGreaterThan(0);
    // The Ka-band filing should appear (matched in description, attachment, and pleading)
    const fileNumbers: string[] = result.data.map((h) => h.file_number);
    expect(fileNumbers).toContain('SAT-LOA-20240101-00001');
    // Results should have snippets
    const firstHit = result.data[0];
    expect(firstHit).toBeDefined();
    expect(firstHit!.snippet).toContain('<mark>');
    // Results should be sorted by score descending
    for (let i: number = 1; i < result.data.length; i++) {
      const prev = result.data[i - 1]!;
      const curr = result.data[i]!;
      expect(prev.score).toBeGreaterThanOrEqual(curr.score);
    }
  });

  it('should apply metadata filters alongside content search', async () => {
    const { searchFilingContent } = await import('./content-search.ts');
    // Search for "station" but filter to SAT subsystem only — should exclude SES filing
    const result = await searchFilingContent(
      conn,
      { q: 'station' },
      { subsystem_code: ['SAT'] },
      { page: 1, pageSize: 25 },
    );

    const fileNumbers: string[] = result.data.map((h) => h.file_number);
    expect(fileNumbers).not.toContain('SES-LIC-20240201-00002');
  });

  it('should return empty results for unmatched query', async () => {
    const { searchFilingContent } = await import('./content-search.ts');
    const result = await searchFilingContent(
      conn,
      { q: 'xyznonexistent' },
      {},
      { page: 1, pageSize: 25 },
    );
    expect(result.data).toEqual([]);
    expect(result.totalRows).toEqual(0);
  });

  it('should paginate results', async () => {
    const { searchFilingContent } = await import('./content-search.ts');
    const result = await searchFilingContent(
      conn,
      { q: 'satellite' },
      {},
      { page: 1, pageSize: 1 },
    );
    expect(result.data.length).toEqual(1);
    expect(result.pageSize).toEqual(1);
  });
});
