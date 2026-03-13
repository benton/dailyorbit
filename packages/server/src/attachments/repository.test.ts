import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  createAttachmentTable,
  getPendingDownloads,
  markDownloaded,
  markFailed,
  upsertAttachments,
} from './repository.ts';
import type {
  AttachmentMetadata,
  AttachmentRow,
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
});
