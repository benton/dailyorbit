import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { readFileSync } from 'node:fs';
import {
  trackConnection,
  trackInstance,
  untrackConnection,
} from '../lib/graceful-shutdown.ts';
import { extractTextFromPdf } from './extract-text.ts';
import { printProgress } from './progress.ts';
import {
  createAttachmentTable,
  getPendingExtractions,
  markExtracted,
  markExtractionFailed,
  markExtractionSkipped,
} from './repository.ts';
import type {
  ExtractionQueryOptions,
  PendingExtractionRow,
} from './repository.ts';

export type ExtractionPipelineOptions = {
  databaseUrl?: string;
  dbInstance?: DuckDBInstance;
  retryFailed?: boolean;
  limit?: number;
  verbose?: boolean;
  onProgress?: (msg: string) => void;
};

export type ExtractionPipelineResult = {
  total: number;
  extracted: number;
  skippedNoText: number;
  skippedNotPdf: number;
  failed: number;
  durationMs: number;
};

export async function runExtractionPipeline(
  options: ExtractionPipelineOptions,
): Promise<ExtractionPipelineResult> {
  const start: number = Date.now();
  const log: (msg: string) => void = options.onProgress ?? console.log;

  const db: DuckDBInstance =
    options.dbInstance ?? (await DuckDBInstance.create(options.databaseUrl!));
  if (options.dbInstance == null) {
    trackInstance(db);
  }
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  await createAttachmentTable(conn);

  const queryOptions: ExtractionQueryOptions = {
    retryFailed: options.retryFailed,
    limit: options.limit,
  };
  const pending: PendingExtractionRow[] = await getPendingExtractions(
    conn,
    queryOptions,
  );
  log(`${String(pending.length)} PDFs pending text extraction`);

  let extracted: number = 0;
  let skippedNoText: number = 0;
  let failed: number = 0;

  for (let i: number = 0; i < pending.length; i++) {
    const row: PendingExtractionRow = pending[i]!;

    try {
      const bytes: Uint8Array = new Uint8Array(readFileSync(row.localPath));
      const result = extractTextFromPdf(bytes);

      if (result.status === 'extracted') {
        await markExtracted(conn, row.attachmentKey, result.text, result.textLength);
        extracted++;
        if (options.verbose) {
          log(
            `  ${String(row.attachmentKey)}: extracted ${String(result.textLength)} chars (${String(result.pageCount)} pages)`,
          );
        }
      } else if (result.status === 'skipped_no_text') {
        await markExtractionSkipped(
          conn,
          row.attachmentKey,
          'skipped_no_text',
        );
        skippedNoText++;
        if (options.verbose) {
          log(`  ${String(row.attachmentKey)}: skipped (no text)`);
        }
      } else {
        await markExtractionFailed(conn, row.attachmentKey);
        failed++;
        log(`  ${String(row.attachmentKey)}: FAILED — ${result.error}`);
      }
    } catch (e: unknown) {
      await markExtractionFailed(conn, row.attachmentKey);
      failed++;
      const msg: string = e instanceof Error ? e.message : String(e);
      log(`  ${String(row.attachmentKey)}: FAILED — ${msg}`);
    }

    printProgress(i + 1, pending.length, 'Extracting');
  }

  untrackConnection(conn);
  conn.closeSync();

  const durationMs: number = Date.now() - start;
  log(
    `Extraction complete: ${String(extracted)} extracted, ${String(skippedNoText)} skipped (no text), ${String(failed)} failed (${String(Math.round(durationMs / 1000))}s)`,
  );

  return {
    total: pending.length,
    extracted,
    skippedNoText,
    skippedNotPdf: 0,
    failed,
    durationMs,
  };
}
