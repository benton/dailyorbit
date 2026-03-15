import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAttachmentTable } from './repository.ts';
import { runExtractionPipeline } from './extract-pipeline.ts';
import type { ExtractionPipelineResult } from './extract-pipeline.ts';

describe('runExtractionPipeline', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let tmpDir: string;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await createAttachmentTable(conn);
    tmpDir = mkdtempSync(join(tmpdir(), 'extract-test-'));
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('marks attachment as failed when file does not exist', async () => {
    await conn.run(
      `INSERT INTO attachment
        (attachment_key, filing_key, file_number, attachment_name, download_url,
         download_status, content_type, local_path, extract_status)
       VALUES (300, 1, 'SAT-STA-20230614-00142', 'Doc', 'https://example.com/300.pdf',
         'downloaded', 'application/pdf', '${tmpDir}/nonexistent.pdf', 'pending')`,
    );

    const result: ExtractionPipelineResult = await runExtractionPipeline({
      dbInstance: db,
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
      onProgress: () => {},
    });
    expect(result).toEqual({
      total: 0,
      extracted: 0,
      skippedNoText: 0,
      skippedNotPdf: 0,
      failed: 0,
      durationMs: expect.any(Number),
    });
  });
});
