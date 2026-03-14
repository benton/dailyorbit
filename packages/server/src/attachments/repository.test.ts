import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  countDuplicateKeys,
  createAttachmentTable,
  ensureLastScrapedColumn,
  getFilingsForScope,
  getPendingDownloads,
  markDownloaded,
  markFailed,
  markFilingsScraped,
  upsertAttachments,
} from './repository.ts';
import type {
  AttachmentMetadata,
  AttachmentRow,
  FilingRow,
  UpsertResult,
} from './types.ts';

const ATTACHMENT_A: AttachmentMetadata = {
  attachmentKey: 100,
  filingKey: 1,
  fileNumber: 'SATSTA2023061400142',
  attachmentName: 'Narrative',
  description: '',
  downloadUrl: 'https://fcc.report/IBFS/SAT-STA-20230614-00142/100',
};

const ATTACHMENT_B: AttachmentMetadata = {
  attachmentKey: 200,
  filingKey: 1,
  fileNumber: 'SATSTA2023061400142',
  attachmentName: 'Application',
  description: 'PDF',
  downloadUrl: 'https://fcc.report/IBFS/SAT-STA-20230614-00142/200',
};

describe('attachment repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createAttachmentTable(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('createAttachmentTable', () => {
    it('is idempotent — calling twice does not error', async () => {
      await createAttachmentTable(conn);
      const reader = await conn.runAndReadAll(
        `SELECT COUNT(*) AS cnt FROM attachment`,
      );
      expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(0);
    });

    it('migrates new columns onto a pre-existing table', async () => {
      const freshDb: DuckDBInstance = await DuckDBInstance.create(':memory:');
      const freshConn: DuckDBConnection =
        await DuckDBConnection.create(freshDb);

      // Create an old-schema table without the new columns
      await freshConn.run(`
        CREATE TABLE attachment (
          attachment_key INTEGER NOT NULL PRIMARY KEY,
          filing_key INTEGER NOT NULL,
          file_number VARCHAR NOT NULL,
          attachment_name VARCHAR NOT NULL,
          description VARCHAR NOT NULL DEFAULT '',
          download_url VARCHAR NOT NULL,
          download_status VARCHAR NOT NULL DEFAULT 'pending',
          file_size_bytes BIGINT,
          local_path VARCHAR,
          discovered_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
          downloaded_at TIMESTAMP
        )
      `);

      // Migrate should add the new columns
      await createAttachmentTable(freshConn);

      const reader = await freshConn.runAndReadAll(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'attachment'
         ORDER BY ordinal_position`,
      );
      const columns: string[] = reader
        .getRowObjectsJS()
        .map((r) => String(r.column_name));
      expect(columns).toContain('content_type');
      expect(columns).toContain('full_text');
      expect(columns).toContain('text_length');
      expect(columns).toContain('summary');

      freshConn.closeSync();
    });

    it('removes primary key constraint from old-schema table', async () => {
      const freshDb: DuckDBInstance = await DuckDBInstance.create(':memory:');
      const freshConn: DuckDBConnection =
        await DuckDBConnection.create(freshDb);

      // Create old-schema table WITH PK and seed data
      await freshConn.run(`
        CREATE TABLE attachment (
          attachment_key INTEGER NOT NULL PRIMARY KEY,
          filing_key INTEGER NOT NULL,
          file_number VARCHAR NOT NULL,
          attachment_name VARCHAR NOT NULL,
          description VARCHAR NOT NULL DEFAULT '',
          download_url VARCHAR NOT NULL,
          download_status VARCHAR NOT NULL DEFAULT 'pending',
          file_size_bytes BIGINT,
          content_type VARCHAR,
          local_path VARCHAR,
          discovered_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
          downloaded_at TIMESTAMP,
          full_text TEXT,
          text_length INTEGER,
          summary TEXT
        )
      `);
      await freshConn.run(
        `INSERT INTO attachment (attachment_key, filing_key, file_number, attachment_name, download_url)
         VALUES (100, 1, 'SATSTA2023061400142', 'Narrative', 'https://example.com/100')`,
      );

      // Run migration
      await createAttachmentTable(freshConn);

      // Verify PK is gone
      const pkReader = await freshConn.runAndReadAll(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.table_constraints
        WHERE table_name = 'attachment' AND constraint_type = 'PRIMARY KEY'
      `);
      expect(Number(pkReader.getRowObjectsJS()[0]!.cnt)).toEqual(0);

      // Verify data is preserved
      const dataReader = await freshConn.runAndReadAll(
        `SELECT COUNT(*) AS cnt FROM attachment`,
      );
      expect(Number(dataReader.getRowObjectsJS()[0]!.cnt)).toEqual(1);

      freshConn.closeSync();
    });

    it('new table has no primary key constraint', async () => {
      const pkReader = await conn.runAndReadAll(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.table_constraints
        WHERE table_name = 'attachment' AND constraint_type = 'PRIMARY KEY'
      `);
      expect(Number(pkReader.getRowObjectsJS()[0]!.cnt)).toEqual(0);
    });
  });

  describe('upsertAttachments', () => {
    it('inserts new attachments and reports count', async () => {
      const result: UpsertResult = await upsertAttachments(conn, [
        ATTACHMENT_A,
        ATTACHMENT_B,
      ]);
      expect(result).toEqual({ inserted: 2, existing: 0 });
    });

    it('is idempotent — re-inserting same attachments reports existing', async () => {
      await upsertAttachments(conn, [ATTACHMENT_A, ATTACHMENT_B]);
      const result: UpsertResult = await upsertAttachments(conn, [
        ATTACHMENT_A,
        ATTACHMENT_B,
      ]);
      expect(result).toEqual({ inserted: 0, existing: 2 });
    });

    it('returns empty result for empty input', async () => {
      const result: UpsertResult = await upsertAttachments(conn, []);
      expect(result).toEqual({ inserted: 0, existing: 0 });
    });
  });

  describe('getPendingDownloads', () => {
    it('returns all pending attachments', async () => {
      await upsertAttachments(conn, [ATTACHMENT_A, ATTACHMENT_B]);
      const pending: AttachmentRow[] = await getPendingDownloads(conn, [1]);
      expect(pending).toHaveLength(2);
      expect(pending[0]!.downloadStatus).toEqual('pending');
      expect(pending[1]!.downloadStatus).toEqual('pending');
    });

    it('excludes downloaded attachments', async () => {
      await upsertAttachments(conn, [ATTACHMENT_A, ATTACHMENT_B]);
      await markDownloaded(
        conn,
        ATTACHMENT_A.attachmentKey,
        '/tmp/a.pdf',
        1024,
        'application/pdf',
      );
      const pending: AttachmentRow[] = await getPendingDownloads(conn, [1]);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.attachmentKey).toEqual(ATTACHMENT_B.attachmentKey);
    });

    it('includes failed attachments when retryFailed is true', async () => {
      await upsertAttachments(conn, [ATTACHMENT_A, ATTACHMENT_B]);
      await markFailed(conn, ATTACHMENT_A.attachmentKey);
      await markDownloaded(
        conn,
        ATTACHMENT_B.attachmentKey,
        '/tmp/b.pdf',
        512,
        'application/pdf',
      );

      const withoutRetry: AttachmentRow[] = await getPendingDownloads(
        conn,
        [1],
        false,
      );
      expect(withoutRetry).toHaveLength(0);

      const withRetry: AttachmentRow[] = await getPendingDownloads(
        conn,
        [1],
        true,
      );
      expect(withRetry).toHaveLength(1);
      expect(withRetry[0]!.attachmentKey).toEqual(ATTACHMENT_A.attachmentKey);
    });
  });

  describe('markDownloaded', () => {
    it('updates status, path, file size, and content type', async () => {
      await upsertAttachments(conn, [ATTACHMENT_A]);
      await markDownloaded(
        conn,
        ATTACHMENT_A.attachmentKey,
        '/data/a.pdf',
        2048,
        'application/pdf',
      );

      const reader = await conn.runAndReadAll(
        `SELECT download_status, local_path, file_size_bytes, content_type
         FROM attachment WHERE attachment_key = $1`,
        [ATTACHMENT_A.attachmentKey],
      );
      const row = reader.getRowObjectsJS()[0]!;
      expect(String(row.download_status)).toEqual('downloaded');
      expect(String(row.local_path)).toEqual('/data/a.pdf');
      expect(Number(row.file_size_bytes)).toEqual(2048);
      expect(String(row.content_type)).toEqual('application/pdf');
    });
  });

  describe('markFailed', () => {
    it('updates status to failed', async () => {
      await upsertAttachments(conn, [ATTACHMENT_A]);
      await markFailed(conn, ATTACHMENT_A.attachmentKey);

      const reader = await conn.runAndReadAll(
        `SELECT download_status FROM attachment WHERE attachment_key = $1`,
        [ATTACHMENT_A.attachmentKey],
      );
      expect(String(reader.getRowObjectsJS()[0]!.download_status)).toEqual(
        'failed',
      );
    });
  });

  describe('countDuplicateKeys', () => {
    it('returns 0 on clean data', async () => {
      await upsertAttachments(conn, [ATTACHMENT_A, ATTACHMENT_B]);
      const dupes: number = await countDuplicateKeys(conn);
      expect(dupes).toEqual(0);
    });

    it('returns 0 on empty table', async () => {
      const dupes: number = await countDuplicateKeys(conn);
      expect(dupes).toEqual(0);
    });
  });

  describe('ensureLastScrapedColumn', () => {
    it('adds last_scraped_at column to filing table', async () => {
      await conn.run(`
        CREATE TABLE filing (
          filing_key INTEGER NOT NULL,
          file_number VARCHAR NOT NULL,
          subsystem_code VARCHAR NOT NULL,
          app_type_code VARCHAR NOT NULL,
          date_filed DATE
        )
      `);

      await ensureLastScrapedColumn(conn);

      const reader = await conn.runAndReadAll(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'filing' AND column_name = 'last_scraped_at'`,
      );
      expect(reader.getRowObjectsJS()).toHaveLength(1);
    });

    it('is idempotent', async () => {
      await conn.run(`
        CREATE TABLE filing (
          filing_key INTEGER NOT NULL,
          file_number VARCHAR NOT NULL,
          subsystem_code VARCHAR NOT NULL,
          app_type_code VARCHAR NOT NULL,
          date_filed DATE
        )
      `);

      await ensureLastScrapedColumn(conn);
      await ensureLastScrapedColumn(conn);

      const reader = await conn.runAndReadAll(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'filing' AND column_name = 'last_scraped_at'`,
      );
      expect(reader.getRowObjectsJS()).toHaveLength(1);
    });
  });

  describe('markFilingsScraped', () => {
    it('sets last_scraped_at on specified filing keys', async () => {
      await conn.run(`
        CREATE TABLE filing (
          filing_key INTEGER NOT NULL,
          file_number VARCHAR NOT NULL,
          subsystem_code VARCHAR NOT NULL,
          app_type_code VARCHAR NOT NULL,
          date_filed DATE,
          last_scraped_at TIMESTAMP
        )
      `);
      await conn.run(
        `INSERT INTO filing (filing_key, file_number, subsystem_code, app_type_code)
         VALUES (1, 'SAT001', 'SAT', 'STA'), (2, 'SES001', 'SES', 'LOA')`,
      );

      await markFilingsScraped(conn, [1]);

      const reader = await conn.runAndReadAll(
        `SELECT filing_key, last_scraped_at FROM filing ORDER BY filing_key`,
      );
      const rows = reader.getRowObjectsJS();
      expect(rows[0]!.last_scraped_at).not.toBeNull();
      expect(rows[1]!.last_scraped_at).toBeNull();
    });

    it('is a no-op for empty array', async () => {
      await markFilingsScraped(conn, []);
    });
  });

  describe('getFilingsForScope staleness filters', () => {
    beforeEach(async () => {
      await conn.run(`
        CREATE TABLE filing (
          filing_key INTEGER NOT NULL,
          file_number VARCHAR NOT NULL,
          subsystem_code VARCHAR NOT NULL,
          app_type_code VARCHAR NOT NULL,
          date_filed DATE,
          last_scraped_at TIMESTAMP
        )
      `);
      // Filing 1: scraped recently
      await conn.run(
        `INSERT INTO filing VALUES (1, 'SAT001', 'SAT', 'STA', '2023-06-14', '2026-03-13 12:00:00')`,
      );
      // Filing 2: scraped long ago
      await conn.run(
        `INSERT INTO filing VALUES (2, 'SES001', 'SES', 'LOA', '2024-01-01', '2025-01-01 00:00:00')`,
      );
      // Filing 3: never scraped
      await conn.run(
        `INSERT INTO filing VALUES (3, 'SAT002', 'SAT', 'LOA', '2024-06-01', NULL)`,
      );
    });

    it('notScrapedSince returns unscraped and stale filings', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {
        notScrapedSince: '2026-01-01T00:00:00',
      });
      const keys: number[] = filings.map((f) => f.filingKey);
      // Filing 2 (scraped 2025-01-01) and filing 3 (never scraped)
      expect(keys).toEqual([2, 3]);
    });

    it('notScrapedSince with old cutoff returns only never-scraped', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {
        notScrapedSince: '2024-06-01T00:00:00',
      });
      const keys: number[] = filings.map((f) => f.filingKey);
      expect(keys).toEqual([3]);
    });

    it('staleAfter returns filings not scraped within duration', async () => {
      // Use a very large duration that only excludes recently-scraped
      const filings: FilingRow[] = await getFilingsForScope(conn, {
        staleAfter: '365d',
      });
      const keys: number[] = filings.map((f) => f.filingKey);
      // Filing 2 was scraped >365d ago, filing 3 never scraped
      expect(keys).toEqual([2, 3]);
    });

    it('staleness filters combine with other scope filters', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {
        subsystems: ['SAT'],
        notScrapedSince: '2026-01-01T00:00:00',
      });
      const keys: number[] = filings.map((f) => f.filingKey);
      // Only SAT filings not scraped since 2026: filing 3
      expect(keys).toEqual([3]);
    });

    it('no staleness filters returns all filings', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {});
      expect(filings).toHaveLength(3);
    });
  });
});
