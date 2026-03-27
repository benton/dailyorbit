import { beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { createAttachmentTable } from './repository.ts';
import { runValidationPipeline } from './validate-pipeline.ts';
import { createMemoryBackend } from './storage-backend.ts';
import type { StorageBackend } from './storage-backend.ts';

describe('runValidationPipeline', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let storage: StorageBackend;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createAttachmentTable(conn);
    storage = createMemoryBackend();
  });

  async function insertDownloadedRow(
    attachmentKey: number,
    storageKey: string,
    contentType: string,
    data: Buffer,
  ): Promise<void> {
    await storage.write(storageKey, data);
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, storage_key, content_type_source)
       VALUES ($1, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/doc',
         'downloaded', $2, $3, 'http_header')`,
      [attachmentKey, contentType, storageKey],
    );
  }

  it('falls back to declared type for plain text (no magic bytes)', async () => {
    const textData: Buffer = Buffer.from('This is actually a text file.\n');
    await insertDownloadedRow(
      100,
      'SAT/test/100.pdf',
      'application/pdf',
      textData,
    );

    const result = await runValidationPipeline({
      dbInstance: db,
      storage,
      verbose: true,
      onProgress: () => {},
    });

    // file-type returns undefined for plain text → falls back to declared type
    expect(result.total).toEqual(1);
    expect(result.corrected).toEqual(0);
    expect(result.confirmed).toEqual(1);
  });

  it('corrects ZIP file declared as PDF', async () => {
    const zipData: Buffer = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    await insertDownloadedRow(
      101,
      'SAT/test/101.pdf',
      'application/pdf',
      zipData,
    );

    const result = await runValidationPipeline({
      dbInstance: db,
      storage,
      verbose: true,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.corrected).toEqual(1);
    expect(result.confirmed).toEqual(0);

    const reader = await conn.runAndReadAll(
      `SELECT content_type, content_type_source FROM attachment WHERE attachment_key = 101`,
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(String(row.content_type)).toEqual('application/zip');
    expect(String(row.content_type_source)).toEqual('file_magic');
  });

  it('confirms matching content type and still marks validated', async () => {
    const pdfData: Buffer = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
    await insertDownloadedRow(
      200,
      'SAT/test/200.pdf',
      'application/pdf',
      pdfData,
    );

    const result = await runValidationPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.corrected).toEqual(0);
    expect(result.confirmed).toEqual(1);

    const reader = await conn.runAndReadAll(
      `SELECT content_type_source FROM attachment WHERE attachment_key = 200`,
    );
    expect(String(reader.getRowObjectsJS()[0]!.content_type_source)).toEqual(
      'file_magic',
    );
  });

  it('is idempotent — second run finds 0 pending', async () => {
    const pdfData: Buffer = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
    await insertDownloadedRow(
      300,
      'SAT/test/300.pdf',
      'application/pdf',
      pdfData,
    );

    await runValidationPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    const result = await runValidationPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(0);
    expect(result.corrected).toEqual(0);
    expect(result.confirmed).toEqual(0);
  });

  it('handles a batch of mixed content types in one run', async () => {
    // PDF with correct magic bytes → confirmed
    const pdfData: Buffer = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
    await insertDownloadedRow(
      400,
      'SAT/test/400.pdf',
      'application/pdf',
      pdfData,
    );

    // ZIP disguised as PDF → corrected
    const zipData: Buffer = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    await insertDownloadedRow(
      401,
      'SAT/test/401.pdf',
      'application/pdf',
      zipData,
    );

    // Plain text declared as HTML (no magic bytes) → confirmed (falls back to declared)
    const textData: Buffer = Buffer.from('Just some text content here.\n');
    await insertDownloadedRow(402, 'SAT/test/402.html', 'text/html', textData);

    const result = await runValidationPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(3);
    expect(result.corrected).toEqual(1);
    expect(result.confirmed).toEqual(2);
    expect(result.failed).toEqual(0);
  });

  it('increments failed count when storage read throws', async () => {
    // Insert a row referencing a storage key that does not exist in the backend
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, storage_key, content_type_source)
       VALUES (500, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/doc',
         'downloaded', 'application/pdf', 'SAT/test/missing.pdf', 'http_header')`,
    );

    const result = await runValidationPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.failed).toEqual(1);
    expect(result.corrected).toEqual(0);
    expect(result.confirmed).toEqual(0);
  });

  it('returns zero counts when no rows are pending', async () => {
    const result = await runValidationPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(0);
    expect(result.corrected).toEqual(0);
    expect(result.confirmed).toEqual(0);
    expect(result.failed).toEqual(0);
  });

  it('skips rows already validated (content_type_source = file_magic)', async () => {
    // Insert a row that's already been validated
    await storage.write('SAT/test/600.pdf', Buffer.from('%PDF-1.4\n'));
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, storage_key, content_type_source)
       VALUES (600, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/doc',
         'downloaded', 'application/pdf', 'SAT/test/600.pdf', 'file_magic')`,
    );

    const result = await runValidationPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    // content_type_source is already 'file_magic', so it should NOT be pending
    expect(result.total).toEqual(0);
  });
});
