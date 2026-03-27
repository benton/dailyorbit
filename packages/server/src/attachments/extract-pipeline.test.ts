import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAttachmentTable } from './repository.ts';
import { runExtractionPipeline } from './extract-pipeline.ts';
import { createMemoryBackend } from './storage-backend.ts';
import type { StorageBackend } from './storage-backend.ts';
import type { ExtractionPipelineResult } from './extract-pipeline.ts';

describe('runExtractionPipeline', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let storage: StorageBackend;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createAttachmentTable(conn);
    storage = createMemoryBackend();
  });

  it('marks attachment as failed when file does not exist in storage', async () => {
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, storage_key, extract_status, content_type_source)
       VALUES (300, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/300.pdf',
         'downloaded', 'application/pdf', 'SAT/test/nonexistent.pdf', 'pending', 'file_magic')`,
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.failed).toEqual(1);
    expect(result.extracted + result.skippedNoText).toEqual(0);

    const reader = await conn.runAndReadAll(
      `SELECT extract_status FROM attachment WHERE attachment_key = 300`,
    );
    expect(String(reader.getRowObjectsJS()[0]!.extract_status)).toEqual(
      'failed',
    );
  });

  it('returns zero counts when nothing is pending', async () => {
    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });
    expect(result).toEqual({
      total: 0,
      extracted: 0,
      skippedNoText: 0,
      skippedNotPdf: 0,
      skippedAuthError: 0,
      failed: 0,
      durationMs: expect.any(Number),
    });
  });

  async function insertExtractionRow(
    attachmentKey: number,
    storageKey: string,
    contentType: string,
    data: Buffer,
  ): Promise<void> {
    await storage.write(storageKey, data);
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, storage_key, extract_status, content_type_source)
       VALUES ($1, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/doc',
         'downloaded', $2, $3, 'pending', 'file_magic')`,
      [attachmentKey, contentType, storageKey],
    );
  }

  it('extracts text from a text/plain attachment', async () => {
    const textContent: string =
      'This is a plain text filing with sufficient content for extraction.\n' +
      'It contains multiple sentences about satellite communications.\n';
    await insertExtractionRow(
      400,
      'SAT/test/400.txt',
      'text/plain',
      Buffer.from(textContent),
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.extracted).toEqual(1);
    expect(result.failed).toEqual(0);

    const reader = await conn.runAndReadAll(
      `SELECT extract_status, full_text, text_length FROM attachment WHERE attachment_key = 400`,
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(String(row.extract_status)).toEqual('extracted');
    expect(String(row.full_text)).toContain('satellite communications');
    expect(Number(row.text_length)).toBeGreaterThan(0);
  });

  it('skips text/plain with fewer than 10 non-whitespace chars', async () => {
    const shortText: string = '  hi  \n';
    await insertExtractionRow(
      401,
      'SAT/test/401.txt',
      'text/plain',
      Buffer.from(shortText),
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.skippedNoText).toEqual(1);
    expect(result.extracted).toEqual(0);

    const reader = await conn.runAndReadAll(
      `SELECT extract_status FROM attachment WHERE attachment_key = 401`,
    );
    expect(String(reader.getRowObjectsJS()[0]!.extract_status)).toEqual(
      'skipped_no_text',
    );
  });

  it('extracts text from a text/csv attachment', async () => {
    const csvContent: string =
      'filing_key,file_number,status\n' +
      '1,SAT-STA-20230614-00142,granted\n' +
      '2,SAT-LOA-20240101-00001,pending\n';
    await insertExtractionRow(
      402,
      'SAT/test/402.csv',
      'text/csv',
      Buffer.from(csvContent),
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.extracted).toEqual(1);

    const reader = await conn.runAndReadAll(
      `SELECT full_text FROM attachment WHERE attachment_key = 402`,
    );
    expect(String(reader.getRowObjectsJS()[0]!.full_text)).toContain(
      'SAT-STA-20230614-00142',
    );
  });

  it('extracts text from an HTML attachment', async () => {
    const html: string =
      '<html><body><p>This is a filing about satellite orbital positions and frequency coordination.</p></body></html>';
    await insertExtractionRow(
      403,
      'SAT/test/403.html',
      'text/html',
      Buffer.from(html),
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.extracted).toEqual(1);

    const reader = await conn.runAndReadAll(
      `SELECT extract_status, full_text FROM attachment WHERE attachment_key = 403`,
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(String(row.extract_status)).toEqual('extracted');
    expect(String(row.full_text)).toContain('satellite orbital positions');
  });

  it('detects auth error HTML stubs and marks skipped_auth_error', async () => {
    // Small HTML that matches AUTH_ERROR_PATTERNS (< 500 bytes with "access denied")
    const authHtml: string =
      '<html><head><title>Error</title></head><body>' +
      '<h1>Access Denied</h1><p>You do not have permission.</p>' +
      '</body></html>';
    await insertExtractionRow(
      404,
      'SAT/test/404.html',
      'text/html',
      Buffer.from(authHtml),
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.skippedAuthError).toEqual(1);
    expect(result.extracted).toEqual(0);

    const reader = await conn.runAndReadAll(
      `SELECT extract_status FROM attachment WHERE attachment_key = 404`,
    );
    expect(String(reader.getRowObjectsJS()[0]!.extract_status)).toEqual(
      'skipped_auth_error',
    );
  });

  it('handles a batch with mixed content types', async () => {
    // text/plain → extracted
    await insertExtractionRow(
      500,
      'SAT/test/500.txt',
      'text/plain',
      Buffer.from(
        'Substantial text content for the FCC filing about NGSO systems.\n',
      ),
    );

    // text/plain too short → skipped_no_text
    await insertExtractionRow(
      501,
      'SAT/test/501.txt',
      'text/plain',
      Buffer.from('hi'),
    );

    // missing file → failed
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, storage_key, extract_status, content_type_source)
       VALUES (502, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/502.pdf',
         'downloaded', 'application/pdf', 'SAT/test/missing-502.pdf', 'pending', 'file_magic')`,
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
      storage,
      onProgress: () => {},
    });

    expect(result.total).toEqual(3);
    expect(result.extracted).toEqual(1);
    expect(result.skippedNoText).toEqual(1);
    expect(result.failed).toEqual(1);
  });
});
