import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { planRewind, executeRewind } from './rewind.ts';
import { ensureAlertTables } from '../alerts/schema.ts';
import { ensureContentFlagTables } from '../content-flag/schema.ts';
import { ensureViewingHistoryTables } from '../viewing-history/schema.ts';
import { ensureHiddenItemTables } from '../hidden-item/schema.ts';

const SCHEMA_SQL: string = `
  CREATE TABLE IF NOT EXISTS filing (
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    subsystem_code VARCHAR NOT NULL,
    app_type_code VARCHAR NOT NULL,
    status_code VARCHAR,
    date_filed TIMESTAMP,
    _first_seen_at TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS attachment (
    attachment_key INTEGER NOT NULL,
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    attachment_name VARCHAR NOT NULL,
    description VARCHAR NOT NULL DEFAULT '',
    download_url VARCHAR NOT NULL DEFAULT '',
    download_status VARCHAR NOT NULL DEFAULT 'pending',
    source VARCHAR DEFAULT 'attachment',
    discovered_at TIMESTAMP NOT NULL DEFAULT current_timestamp
  );
  CREATE TABLE IF NOT EXISTS pleading (
    pleading_key INTEGER NOT NULL,
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    icfs_sys_id VARCHAR NOT NULL DEFAULT '',
    pleading_number VARCHAR NOT NULL DEFAULT '',
    pleading_type VARCHAR NOT NULL DEFAULT '',
    filer_name VARCHAR NOT NULL DEFAULT '',
    ingested_at TIMESTAMP NOT NULL DEFAULT current_timestamp
  );
`;

describe('rewind', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
  });

  afterAll(() => {
    conn.closeSync();
  });

  beforeEach(async () => {
    // Drop and recreate tables for isolation
    await conn.run('DROP TABLE IF EXISTS rewind_filings');
    await conn.run('DROP TABLE IF EXISTS alert_run');
    await conn.run('DROP TABLE IF EXISTS user_content_flag');
    await conn.run('DROP TABLE IF EXISTS user_filing_view');
    await conn.run('DROP TABLE IF EXISTS user_news_view');
    await conn.run('DROP TABLE IF EXISTS user_view_watermark');
    await conn.run('DROP TABLE IF EXISTS hidden_item');
    await conn.run('DROP TABLE IF EXISTS discovery_snapshot');
    await conn.run('DROP TABLE IF EXISTS pleading');
    await conn.run('DROP TABLE IF EXISTS attachment');
    await conn.run('DROP TABLE IF EXISTS filing');

    await conn.run(SCHEMA_SQL);
    await ensureAlertTables(conn);
    await ensureContentFlagTables(conn);
    await ensureViewingHistoryTables(conn);
    await ensureHiddenItemTables(conn);
  });

  describe('validation', () => {
    it('rejects when both --since and --last are provided', async () => {
      await expect(
        planRewind(conn, { since: '2026-03-18', last: 10 }),
      ).rejects.toThrow('--since and --last are mutually exclusive');
    });

    it('rejects when neither --since nor --last is provided', async () => {
      await expect(planRewind(conn, {})).rejects.toThrow(
        'One of --since or --last is required',
      );
    });

    it('rejects when --last is zero or negative', async () => {
      await expect(planRewind(conn, { last: 0 })).rejects.toThrow(
        '--last must be a positive integer',
      );
      await expect(planRewind(conn, { last: -5 })).rejects.toThrow(
        '--last must be a positive integer',
      );
    });
  });

  describe('planRewind --since mode', () => {
    beforeEach(async () => {
      await seedFilings(conn);
    });

    it('counts filings with _first_seen_at >= the given date', async () => {
      const result = await planRewind(conn, { since: '2026-03-19' });

      expect(result.scope).toBe('filings with _first_seen_at >= 2026-03-19');

      const filingCount = result.counts.find((c) => c.table === 'filing');
      expect(filingCount?.count).toBe(2); // filing_key 2 and 3
    });

    it('counts dependent rows for matching filings', async () => {
      const result = await planRewind(conn, { since: '2026-03-19' });

      const attachmentCount = result.counts.find(
        (c) => c.table === 'attachment',
      );
      const pleadingCount = result.counts.find((c) => c.table === 'pleading');
      expect(attachmentCount?.count).toBe(2);
      expect(pleadingCount?.count).toBe(1);
    });
  });

  describe('planRewind --last mode', () => {
    beforeEach(async () => {
      await seedFilings(conn);
    });

    it('counts the N most recently ingested filings', async () => {
      const result = await planRewind(conn, { last: 1 });

      expect(result.scope).toBe(
        '1 most recently filed filings (hidden excluded)',
      );

      const filingCount = result.counts.find((c) => c.table === 'filing');
      expect(filingCount?.count).toBe(1); // most recent: filing_key 3
    });
  });

  describe('executeRewind --since mode', () => {
    beforeEach(async () => {
      await seedFilings(conn);
    });

    it('deletes filings and dependent rows in FK-safe order', async () => {
      const result = await executeRewind(conn, { since: '2026-03-19' });

      // Verify counts
      expect(result.counts).toEqual([
        { table: 'discovery_snapshot', count: 0 },
        { table: 'alert_run', count: 1 },
        { table: 'user_content_flag', count: 1 },
        { table: 'user_filing_view', count: 1 },
        { table: 'pleading', count: 1 },
        { table: 'attachment', count: 2 },
        { table: 'filing', count: 2 },
      ]);

      // Verify rows are actually gone
      const filings = await conn.runAndReadAll('SELECT count(*) FROM filing');
      expect(Number(filings.getRows()[0]![0])).toBe(1); // only filing_key 1 remains

      const attachments = await conn.runAndReadAll(
        'SELECT count(*) FROM attachment',
      );
      expect(Number(attachments.getRows()[0]![0])).toBe(1); // only att for filing_key 1

      const pleadings = await conn.runAndReadAll(
        'SELECT count(*) FROM pleading',
      );
      expect(Number(pleadings.getRows()[0]![0])).toBe(0); // pleading was for filing_key 2

      // alert_run should be fully cleared
      const alertRuns = await conn.runAndReadAll(
        'SELECT count(*) FROM alert_run',
      );
      expect(Number(alertRuns.getRows()[0]![0])).toBe(0);
    });

    it('preserves filings outside the rewind scope', async () => {
      await executeRewind(conn, { since: '2026-03-20' });

      const filings = await conn.runAndReadAll('SELECT count(*) FROM filing');
      expect(Number(filings.getRows()[0]![0])).toBe(2); // filing_key 1 and 2 remain
    });
  });

  describe('executeRewind --last mode', () => {
    beforeEach(async () => {
      await seedFilings(conn);
    });

    it('deletes exactly N most recent filings', async () => {
      const result = await executeRewind(conn, { last: 2 });

      const filingCount = result.counts.find((c) => c.table === 'filing');
      expect(filingCount?.count).toBe(2);

      const remaining = await conn.runAndReadAll(
        'SELECT file_number FROM filing',
      );
      const rows = remaining.getRows();
      expect(rows.length).toBe(1);
      expect(rows[0]![0]).toBe('SAT-LOA-20260318-00001'); // oldest
    });
  });

  describe('executeRewind --full mode', () => {
    beforeEach(async () => {
      await seedFilings(conn);
      // Create embedding table
      await conn.run(`
        CREATE TABLE IF NOT EXISTS embedding (
          embedding_id INTEGER PRIMARY KEY,
          source_table VARCHAR NOT NULL,
          source_key VARCHAR NOT NULL,
          chunk_index INTEGER NOT NULL DEFAULT 0,
          embedding FLOAT[512],
          model_id VARCHAR NOT NULL DEFAULT 'test',
          text_checksum VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
          UNIQUE (source_table, source_key, chunk_index)
        )
      `);
      // Seed embeddings for filing_key 2 and 3
      await conn.run(`
        INSERT INTO embedding (embedding_id, source_table, source_key) VALUES
          (1, 'filing', '2'),
          (2, 'filing', '3'),
          (3, 'attachment', '20'),
          (4, 'attachment', '30'),
          (5, 'filing', '1')
      `);
    });

    it('deletes embeddings for rewound filings', async () => {
      const result = await executeRewind(conn, {
        since: '2026-03-19',
        full: true,
      });

      const embeddingResult = result.fullCounts?.find(
        (c) => c.table === 'embedding',
      );
      // filing 2, filing 3, attachment 20 (filing 2), attachment 30 (filing 3)
      expect(embeddingResult?.count).toBe(4);

      // Verify remaining embeddings — only filing 1's embedding survives
      const remaining = await conn.runAndReadAll(
        'SELECT source_key FROM embedding ORDER BY source_key',
      );
      const keys = remaining.getRows().map((r) => r[0]);
      expect(keys).toEqual(['1']);
    });
  });

  describe('dry run does not modify data', () => {
    beforeEach(async () => {
      await seedFilings(conn);
    });

    it('planRewind does not delete any rows', async () => {
      await planRewind(conn, { since: '2026-03-19' });

      const filings = await conn.runAndReadAll('SELECT count(*) FROM filing');
      expect(Number(filings.getRows()[0]![0])).toBe(3);
    });
  });
});

/** Seed test data: 3 filings across different dates with dependent rows. */
async function seedFilings(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO filing VALUES
      (1, 'SAT-LOA-20260318-00001', 'SAT', 'LOA', 'A', '2026-03-18', '2026-03-18'),
      (2, 'SAT-LOA-20260319-00001', 'SAT', 'LOA', 'A', '2026-03-19', '2026-03-19'),
      (3, 'SAT-MOD-20260320-00001', 'SAT', 'MOD', 'A', '2026-03-20', '2026-03-20')
  `);

  await conn.run(`
    INSERT INTO attachment (attachment_key, filing_key, file_number, attachment_name) VALUES
      (10, 1, 'SAT-LOA-20260318-00001', 'doc1.pdf'),
      (20, 2, 'SAT-LOA-20260319-00001', 'doc2.pdf'),
      (30, 3, 'SAT-MOD-20260320-00001', 'doc3.pdf')
  `);

  await conn.run(`
    INSERT INTO pleading (pleading_key, filing_key, file_number) VALUES
      (100, 2, 'SAT-LOA-20260319-00001')
  `);

  await conn.run(`
    INSERT INTO user_filing_view (user_id, file_number) VALUES
      ('user1', 'SAT-LOA-20260319-00001')
  `);

  await conn.run(`
    INSERT INTO user_content_flag (id, user_id, content_type, content_key, source)
    VALUES (1, 'user1', 'filing', 'SAT-LOA-20260319-00001', 'alert')
  `);

  // Insert a saved search and alert_run
  await conn.run(`
    INSERT INTO alert_run (id, saved_search_id, pipeline_run_id) VALUES (1, 1, 1)
  `);
}
