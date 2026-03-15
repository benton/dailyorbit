import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type { FileNumber } from '../lib/file-number.ts';
import {
  countDuplicateKeys,
  createAttachmentTable,
  createDiscoveryLogTable,
  getFilingsForScope,
  getPendingDownloads,
  getPendingExtractions,
  markDownloaded,
  markExtracted,
  markExtractionFailed,
  markExtractionSkipped,
  markFailed,
  markFilingsDiscovered,
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
  fileNumber: 'SAT-STA-20230614-00142' as FileNumber,
  source: 'attachment',
  attachmentName: 'Narrative',
  description: '',
  downloadUrl: 'https://fcc.report/IBFS/SAT-STA-20230614-00142/100',
};

const ATTACHMENT_B: AttachmentMetadata = {
  attachmentKey: 200,
  filingKey: 1,
  fileNumber: 'SAT-STA-20230614-00142' as FileNumber,
  source: 'file',
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

  describe('createDiscoveryLogTable', () => {
    it('creates the attachment_discovery table', async () => {
      await createDiscoveryLogTable(conn);

      const reader = await conn.runAndReadAll(
        `SELECT COUNT(*) AS cnt FROM information_schema.tables
         WHERE table_name = 'attachment_discovery'`,
      );
      expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(1);
    });

    it('is idempotent', async () => {
      await createDiscoveryLogTable(conn);
      await createDiscoveryLogTable(conn);

      const reader = await conn.runAndReadAll(
        `SELECT COUNT(*) AS cnt FROM attachment_discovery`,
      );
      expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(0);
    });
  });

  describe('markFilingsDiscovered', () => {
    it('records discovery timestamp for specified filing keys', async () => {
      await createDiscoveryLogTable(conn);

      await markFilingsDiscovered(conn, [1, 2]);

      const reader = await conn.runAndReadAll(
        `SELECT filing_key, discovered_at FROM attachment_discovery ORDER BY filing_key`,
      );
      const rows = reader.getRowObjectsJS();
      expect(rows).toHaveLength(2);
      expect(rows[0]!.discovered_at).not.toBeNull();
      expect(rows[1]!.discovered_at).not.toBeNull();
    });

    it('is idempotent — re-marking updates the timestamp', async () => {
      await createDiscoveryLogTable(conn);

      await markFilingsDiscovered(conn, [1]);
      await markFilingsDiscovered(conn, [1]);

      const reader = await conn.runAndReadAll(
        `SELECT COUNT(*) AS cnt FROM attachment_discovery WHERE filing_key = 1`,
      );
      expect(Number(reader.getRowObjectsJS()[0]!.cnt)).toEqual(1);
    });

    it('is a no-op for empty array', async () => {
      await createDiscoveryLogTable(conn);
      await markFilingsDiscovered(conn, []);
    });
  });

  describe('getPendingExtractions', () => {
    beforeEach(async () => {
      await conn.run(
        `INSERT INTO attachment
          (attachment_key, filing_key, file_number, attachment_name, download_url,
           download_status, content_type, local_path, extract_status)
         VALUES
          (100, 1, 'SAT-STA-20230614-00142', 'Narrative', 'https://example.com/100.pdf',
           'downloaded', 'application/pdf', '/tmp/100.pdf', 'pending'),
          (101, 1, 'SAT-STA-20230614-00142', 'Tech Report', 'https://example.com/101.pdf',
           'downloaded', 'application/pdf', '/tmp/101.pdf', 'extracted'),
          (102, 1, 'SAT-STA-20230614-00142', 'Photo', 'https://example.com/102.html',
           'downloaded', 'text/html', '/tmp/102.html', 'pending'),
          (103, 1, 'SAT-STA-20230614-00142', 'Pending DL', 'https://example.com/103.pdf',
           'pending', 'application/pdf', NULL, 'pending')`,
      );
    });

    it('returns only downloaded PDFs with pending extract_status', async () => {
      const rows = await getPendingExtractions(conn);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attachmentKey).toEqual(100);
    });

    it('includes failed extractions when retryFailed is true', async () => {
      await conn.run(
        `UPDATE attachment SET extract_status = 'failed' WHERE attachment_key = 100`,
      );
      const rows = await getPendingExtractions(conn, { retryFailed: true });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attachmentKey).toEqual(100);
    });

    it('respects limit parameter', async () => {
      await conn.run(
        `INSERT INTO attachment
          (attachment_key, filing_key, file_number, attachment_name, download_url,
           download_status, content_type, local_path, extract_status)
         VALUES (104, 1, 'SAT-STA-20230614-00142', 'Another', 'https://example.com/104.pdf',
           'downloaded', 'application/pdf', '/tmp/104.pdf', 'pending')`,
      );
      const rows = await getPendingExtractions(conn, { limit: 1 });
      expect(rows).toHaveLength(1);
    });
  });

  describe('markExtracted', () => {
    beforeEach(async () => {
      await conn.run(
        `INSERT INTO attachment
          (attachment_key, filing_key, file_number, attachment_name, download_url,
           download_status, local_path, extract_status)
         VALUES (200, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/200.pdf',
           'downloaded', '/tmp/200.pdf', 'pending')`,
      );
    });

    it('updates full_text, text_length, and extract_status', async () => {
      await markExtracted(conn, 200, '# Heading\n\nSome text.', 20);
      const reader = await conn.runAndReadAll(
        `SELECT full_text, text_length, extract_status FROM attachment WHERE attachment_key = 200`,
      );
      const row = reader.getRowObjectsJS()[0]!;
      expect(String(row.full_text)).toEqual('# Heading\n\nSome text.');
      expect(Number(row.text_length)).toEqual(20);
      expect(String(row.extract_status)).toEqual('extracted');
    });
  });

  describe('markExtractionSkipped', () => {
    beforeEach(async () => {
      await conn.run(
        `INSERT INTO attachment
          (attachment_key, filing_key, file_number, attachment_name, download_url,
           download_status, local_path, extract_status)
         VALUES (201, 1, 'SAT-STA-20230614-00142', 'Scan', 'https://example.com/201.pdf',
           'downloaded', '/tmp/201.pdf', 'pending')`,
      );
    });

    it('sets extract_status to skipped_no_text', async () => {
      await markExtractionSkipped(conn, 201, 'skipped_no_text');
      const reader = await conn.runAndReadAll(
        `SELECT extract_status FROM attachment WHERE attachment_key = 201`,
      );
      expect(String(reader.getRowObjectsJS()[0]!.extract_status)).toEqual(
        'skipped_no_text',
      );
    });
  });

  describe('markExtractionFailed', () => {
    beforeEach(async () => {
      await conn.run(
        `INSERT INTO attachment
          (attachment_key, filing_key, file_number, attachment_name, download_url,
           download_status, local_path, extract_status)
         VALUES (202, 1, 'SAT-STA-20230614-00142', 'Bad', 'https://example.com/202.pdf',
           'downloaded', '/tmp/202.pdf', 'pending')`,
      );
    });

    it('sets extract_status to failed', async () => {
      await markExtractionFailed(conn, 202);
      const reader = await conn.runAndReadAll(
        `SELECT extract_status FROM attachment WHERE attachment_key = 202`,
      );
      expect(String(reader.getRowObjectsJS()[0]!.extract_status)).toEqual(
        'failed',
      );
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
          date_filed DATE
        )
      `);
      await createDiscoveryLogTable(conn);

      // Filing 1: discovered recently
      await conn.run(
        `INSERT INTO filing VALUES (1, 'SAT001', 'SAT', 'STA', '2023-06-14')`,
      );
      await conn.run(
        `INSERT INTO attachment_discovery VALUES (1, '2026-03-13 12:00:00')`,
      );
      // Filing 2: discovered long ago
      await conn.run(
        `INSERT INTO filing VALUES (2, 'SES001', 'SES', 'LOA', '2024-01-01')`,
      );
      await conn.run(
        `INSERT INTO attachment_discovery VALUES (2, '2025-01-01 00:00:00')`,
      );
      // Filing 3: never discovered
      await conn.run(
        `INSERT INTO filing VALUES (3, 'SAT002', 'SAT', 'LOA', '2024-06-01')`,
      );
    });

    it('notScrapedSince returns undiscovered and stale filings', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {
        notScrapedSince: '2026-01-01T00:00:00',
      });
      const keys: number[] = filings.map((f) => f.filingKey);
      // Filing 2 (discovered 2025-01-01) and filing 3 (never discovered)
      expect(keys).toEqual([2, 3]);
    });

    it('notScrapedSince with old cutoff returns only never-discovered', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {
        notScrapedSince: '2024-06-01T00:00:00',
      });
      const keys: number[] = filings.map((f) => f.filingKey);
      expect(keys).toEqual([3]);
    });

    it('staleAfter returns filings not discovered within duration', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {
        staleAfter: '365d',
      });
      const keys: number[] = filings.map((f) => f.filingKey);
      // Filing 2 was discovered >365d ago, filing 3 never discovered
      expect(keys).toEqual([2, 3]);
    });

    it('staleness filters combine with other scope filters', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {
        subsystems: ['SAT'],
        notScrapedSince: '2026-01-01T00:00:00',
      });
      const keys: number[] = filings.map((f) => f.filingKey);
      // Only SAT filings not discovered since 2026: filing 3
      expect(keys).toEqual([3]);
    });

    it('no staleness filters returns all filings', async () => {
      const filings: FilingRow[] = await getFilingsForScope(conn, {});
      expect(filings).toHaveLength(3);
    });
  });
});
