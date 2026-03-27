import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAttachmentTable,
  getPendingExtractions,
  markExtracted,
} from './repository.ts';
import { extractTextFromPdf } from './extract-text.ts';
import type { ExtractionResult } from './extract-text.ts';

// Known text-based PDF
const TEXT_PDF: string = resolve(
  '../../data/attachments/ITC/ITC-214-INTR2017-00369/1182093.pdf',
);
// Known scanned PDF
const SCANNED_PDF: string = resolve(
  '../../data/attachments/ROA/ROA-NEW-20030217-00001/722390.pdf',
);

const canRunIntegration: boolean =
  existsSync(TEXT_PDF) && existsSync(SCANNED_PDF);

describe.skipIf(!canRunIntegration)('PDF extraction integration', () => {
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

  it('extracts structured markdown from a text-based FCC filing PDF', () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(TEXT_PDF));
    const result: ExtractionResult = extractTextFromPdf(bytes);

    expect(result.status).toEqual('extracted');
    if (result.status !== 'extracted') return;

    expect(result.text).toContain('streamlined processing');
    expect(result.textLength).toBeGreaterThan(500);
    expect(result.pageCount).toEqual(1);
  });

  it('correctly identifies a scanned PDF as having no extractable text', () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(SCANNED_PDF));
    const result: ExtractionResult = extractTextFromPdf(bytes);

    expect(result.status).toEqual('skipped_no_text');
    if (result.status === 'failed') return;
    expect(result.textLength).toBeLessThan(50);
  });

  it('round-trips extraction through the database', async () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(TEXT_PDF));
    const result: ExtractionResult = extractTextFromPdf(bytes);
    expect(result.status).toEqual('extracted');
    if (result.status !== 'extracted') return;

    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, storage_key, extract_status)
       VALUES (500, 1, 'ITC-214-INTR2017-00369', 'Doc', 'https://example.com/500.pdf',
         'downloaded', 'application/pdf', 'ITC/ITC-214-INTR2017-00369/500.pdf', 'pending')`,
    );

    await markExtracted(conn, 500, result.text, result.textLength);

    const pending = await getPendingExtractions(conn);
    expect(pending).toHaveLength(0);

    const reader = await conn.runAndReadAll(
      `SELECT full_text, text_length, extract_status FROM attachment WHERE attachment_key = 500`,
    );
    const row = reader.getRowObjectsJS()[0]!;
    expect(String(row.extract_status)).toEqual('extracted');
    expect(Number(row.text_length)).toEqual(result.textLength);
    expect(String(row.full_text)).toContain('streamlined processing');
  });
});
