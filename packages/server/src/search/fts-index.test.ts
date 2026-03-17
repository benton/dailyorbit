import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

describe('FTS index management', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    // Minimal schema for testing
    await conn.run(`
      CREATE TABLE filing (
        file_number VARCHAR PRIMARY KEY,
        description VARCHAR,
        brief_description VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE attachment (
        attachment_key INTEGER PRIMARY KEY,
        file_number VARCHAR,
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

    // Insert test data
    await conn.run(
      `INSERT INTO filing VALUES ('SAT-LOA-20240101-00001', 'Request for satellite frequency allocation in Ka-band', 'Ka-band satellite')`,
    );
    await conn.run(
      `INSERT INTO filing VALUES ('SES-LIC-20240201-00002', 'Earth station license application', 'Earth station')`,
    );
    await conn.run(
      `INSERT INTO attachment VALUES (1, 'SAT-LOA-20240101-00001', 'Technical narrative describing Ka-band frequency coordination with adjacent satellites', NULL)`,
    );
    await conn.run(
      `INSERT INTO attachment VALUES (2, 'SES-LIC-20240201-00002', 'Site survey for proposed earth station location in Virginia', NULL)`,
    );
    await conn.run(
      `INSERT INTO pleading VALUES (1, 100, 'SpaceX', 'Comments opposing the Ka-band frequency allocation due to interference concerns')`,
    );
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('should create FTS indexes on all three tables', async () => {
    const { rebuildAllFtsIndexes } = await import('./fts-index.ts');
    await rebuildAllFtsIndexes(conn);

    // Verify indexes exist by querying each one
    const filingResult = await conn.runAndReadAll(`
      SELECT file_number, fts_main_filing.match_bm25(file_number, 'satellite') AS score
      FROM filing WHERE score IS NOT NULL
    `);
    expect(filingResult.getRowObjectsJS().length).toEqual(1);

    const attachmentResult = await conn.runAndReadAll(`
      SELECT attachment_key, fts_main_attachment.match_bm25(attachment_key, 'frequency') AS score
      FROM attachment WHERE score IS NOT NULL
    `);
    expect(attachmentResult.getRowObjectsJS().length).toEqual(1);

    const pleadingResult = await conn.runAndReadAll(`
      SELECT pleading_key, fts_main_pleading.match_bm25(pleading_key, 'interference') AS score
      FROM pleading WHERE score IS NOT NULL
    `);
    expect(pleadingResult.getRowObjectsJS().length).toEqual(1);
  });

  it('should rebuild indexes idempotently (overwrite)', async () => {
    const { rebuildAllFtsIndexes } = await import('./fts-index.ts');
    await rebuildAllFtsIndexes(conn);
    // Second call should not throw
    await rebuildAllFtsIndexes(conn);

    const result = await conn.runAndReadAll(`
      SELECT file_number, fts_main_filing.match_bm25(file_number, 'satellite') AS score
      FROM filing WHERE score IS NOT NULL
    `);
    expect(result.getRowObjectsJS().length).toEqual(1);
  });

  it('should handle empty tables without error', async () => {
    const { rebuildAllFtsIndexes } = await import('./fts-index.ts');
    await conn.run('DELETE FROM filing');
    await conn.run('DELETE FROM attachment');
    await conn.run('DELETE FROM pleading');
    await rebuildAllFtsIndexes(conn);
    // Should not throw; querying empty index returns no results
    const result = await conn.runAndReadAll(`
      SELECT file_number, fts_main_filing.match_bm25(file_number, 'anything') AS score
      FROM filing WHERE score IS NOT NULL
    `);
    expect(result.getRowObjectsJS().length).toEqual(0);
  });
});
