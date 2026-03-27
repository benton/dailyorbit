import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { getLogger } from '../lib/logger.ts';
import {
  trackConnection,
  trackInstance,
  untrackConnection,
} from '../lib/graceful-shutdown.ts';
import { extractTextFromHtml, looksLikeAuthError } from './extract-html.ts';
import { extractTextFromPdf } from './extract-text.ts';
import { htmlToMarkdown } from '../lib/html-to-markdown.ts';
import { processWithConcurrency } from '../lib/concurrency.ts';
import { logProgress } from './progress.ts';
import {
  createAttachmentTable,
  getPendingExtractions,
  getPendingValidations,
  markContentTypeValidated,
  markExtracted,
  markExtractionFailed,
  markExtractionSkipped,
} from './repository.ts';
import type {
  ExtractionQueryOptions,
  PendingExtractionRow,
  PendingValidationRow,
} from './repository.ts';
import { detectContentType } from './validate-content-type.ts';
import type { StorageBackend } from './storage-backend.ts';

export type ExtractionPipelineOptions = {
  databaseUrl?: string | undefined;
  dbInstance?: DuckDBInstance | undefined;
  storage: StorageBackend;
  retryFailed?: boolean | undefined;
  limit?: number | undefined;
  concurrency?: number | undefined;
  verbose?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
};

export type ExtractionPipelineResult = {
  total: number;
  extracted: number;
  skippedNoText: number;
  skippedNotPdf: number;
  skippedAuthError: number;
  failed: number;
  durationMs: number;
};

export async function runExtractionPipeline(
  options: ExtractionPipelineOptions,
): Promise<ExtractionPipelineResult> {
  const start: number = Date.now();
  const log: (msg: string) => void =
    options.onProgress ??
    ((msg: string): void => {
      getLogger().info(msg);
    });

  const db: DuckDBInstance =
    options.dbInstance ?? (await DuckDBInstance.create(options.databaseUrl!));
  if (options.dbInstance == null) {
    trackInstance(db);
  }
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  await createAttachmentTable(conn);

  const storage: StorageBackend = options.storage;

  // Pre-validate content types so extraction only sees real PDFs
  const unvalidated: PendingValidationRow[] = await getPendingValidations(conn);
  if (unvalidated.length > 0) {
    log(
      `Validating content types for ${String(unvalidated.length)} attachments...`,
    );
    let validationCorrected: number = 0;
    for (const row of unvalidated) {
      try {
        const data: Buffer = await storage.read(row.storageKey);
        const detected = await detectContentType(data, row.contentType);
        await markContentTypeValidated(
          conn,
          row.attachmentKey,
          detected.mimeType,
        );
        if (detected.isDifferent) {
          validationCorrected++;
        }
      } catch {
        // Validation failure is non-fatal — row will be retried next run
      }
    }
    if (validationCorrected > 0) {
      log(`Content-type validation: ${String(validationCorrected)} corrected`);
    }
  }

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
  let skippedAuthError: number = 0;
  let failed: number = 0;
  let processed: number = 0;
  const concurrency: number = options.concurrency ?? 1;

  await processWithConcurrency(
    pending,
    concurrency,
    async (row: PendingExtractionRow) => {
      try {
        const data: Buffer = await storage.read(row.storageKey);

        // Text and CSV files: read directly as UTF-8 text
        if (
          row.contentType === 'text/plain' ||
          row.contentType === 'text/csv'
        ) {
          const text: string = data.toString('utf-8');
          const textLength: number = text.replace(/\s/g, '').length;
          if (textLength >= 10) {
            await markExtracted(conn, row.attachmentKey, text, textLength);
            extracted++;
            if (options.verbose) {
              log(
                `  ${String(row.attachmentKey)}: extracted ${String(textLength)} chars (text)`,
              );
            }
          } else {
            await markExtractionSkipped(
              conn,
              row.attachmentKey,
              'skipped_no_text',
            );
            skippedNoText++;
          }
        } else if (row.contentType === 'text/html') {
          // HTML extraction
          const html: string = data.toString('utf-8');
          const fileSizeBytes: number = data.byteLength;
          if (looksLikeAuthError(html, fileSizeBytes)) {
            await markExtractionSkipped(
              conn,
              row.attachmentKey,
              'skipped_auth_error',
            );
            skippedAuthError++;
            if (options.verbose) {
              log(`  ${String(row.attachmentKey)}: skipped (auth error stub)`);
            }
          } else {
            const result = extractTextFromHtml(html);
            if (result.status === 'extracted') {
              const cleanText: string = htmlToMarkdown(result.text);
              const cleanLength: number = cleanText.replace(/\s/g, '').length;
              await markExtracted(
                conn,
                row.attachmentKey,
                cleanText,
                cleanLength,
              );
              extracted++;
              if (options.verbose) {
                log(
                  `  ${String(row.attachmentKey)}: extracted ${String(cleanLength)} chars (html→md)`,
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
          }
        } else {
          // PDF extraction — pdftotext fallback needs a temp file
          const bytes: Uint8Array = new Uint8Array(data);
          let tempPath: string | undefined;
          try {
            const { writeFileSync } = await import('node:fs');
            const { join } = await import('node:path');
            const { tmpdir } = await import('node:os');
            tempPath = join(
              tmpdir(),
              `extract-${String(row.attachmentKey)}.pdf`,
            );
            writeFileSync(tempPath, data);
            const result = extractTextFromPdf(bytes, tempPath);

            if (result.status === 'extracted') {
              await markExtracted(
                conn,
                row.attachmentKey,
                result.text,
                result.textLength,
              );
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
          } finally {
            if (tempPath != null) {
              try {
                const { unlinkSync } = await import('node:fs');
                unlinkSync(tempPath);
              } catch {
                // Best-effort cleanup
              }
            }
          }
        }
      } catch (e: unknown) {
        await markExtractionFailed(conn, row.attachmentKey);
        failed++;
        const msg: string = e instanceof Error ? e.message : String(e);
        log(`  ${String(row.attachmentKey)}: FAILED — ${msg}`);
      }

      processed++;
      logProgress(processed, pending.length, 'Extracting', log);
    },
  );

  untrackConnection(conn);
  conn.closeSync();

  const durationMs: number = Date.now() - start;
  const skippedParts: string[] = [`${String(skippedNoText)} no text`];
  if (skippedAuthError > 0) {
    skippedParts.push(`${String(skippedAuthError)} auth errors`);
  }
  log(
    `Extraction complete: ${String(extracted)} extracted, ${skippedParts.join(', ')} skipped, ${String(failed)} failed (${String(Math.round(durationMs / 1000))}s)`,
  );

  return {
    total: pending.length,
    extracted,
    skippedNoText,
    skippedNotPdf: 0,
    skippedAuthError,
    failed,
    durationMs,
  };
}
