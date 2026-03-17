import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAttachmentTable } from './repository.ts';
import { runValidationPipeline } from './validate-pipeline.ts';

describe('runValidationPipeline', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let tempDir: string;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createAttachmentTable(conn);
    tempDir = mkdtempSync(join(tmpdir(), 'validate-pipe-'));
  });

  afterEach(() => {
    conn.closeSync();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function insertDownloadedRow(
    attachmentKey: number,
    localPath: string,
    contentType: string,
  ): Promise<void> {
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, local_path, content_type_source)
       VALUES ($1, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/doc',
         'downloaded', $2, $3, 'http_header')`,
      [attachmentKey, contentType, localPath],
    );
  }

  it('corrects mismatched content type', async () => {
    const textPath: string = join(tempDir, '100.pdf');
    writeFileSync(textPath, 'This is actually a text file.\n');
    await insertDownloadedRow(100, textPath, 'application/pdf');

    const result = await runValidationPipeline({
      dbInstance: db,
      verbose: true,
      onProgress: () => {},
    });

    expect(result.total).toEqual(1);
    expect(result.corrected).toEqual(1);
    expect(result.confirmed).toEqual(0);

    // Verify DB was updated
    const reader = await conn.runAndReadAll(
      `SELECT content_type, content_type_source FROM attachment WHERE attachment_key = 100`,
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(String(row.content_type)).toEqual('text/plain');
    expect(String(row.content_type_source)).toEqual('file_magic');
  });

  it('confirms matching content type and still marks validated', async () => {
    const pdfPath: string = join(tempDir, '200.pdf');
    writeFileSync(
      pdfPath,
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
    await insertDownloadedRow(200, pdfPath, 'application/pdf');

    const result = await runValidationPipeline({
      dbInstance: db,
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
    const textPath: string = join(tempDir, '300.pdf');
    writeFileSync(textPath, 'Plain text stub\n');
    await insertDownloadedRow(300, textPath, 'application/pdf');

    await runValidationPipeline({
      dbInstance: db,
      onProgress: () => {},
    });

    const result = await runValidationPipeline({
      dbInstance: db,
      onProgress: () => {},
    });

    expect(result.total).toEqual(0);
    expect(result.corrected).toEqual(0);
    expect(result.confirmed).toEqual(0);
  });
});
