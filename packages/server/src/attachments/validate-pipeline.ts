import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { processWithConcurrency } from '../lib/concurrency.ts';
import {
  trackConnection,
  trackInstance,
  untrackConnection,
} from '../lib/graceful-shutdown.ts';
import { printProgress } from './progress.ts';
import {
  createAttachmentTable,
  getPendingValidations,
  markContentTypeValidated,
} from './repository.ts';
import type { PendingValidationRow } from './repository.ts';
import { detectContentType } from './validate-content-type.ts';

export type ValidationPipelineOptions = {
  databaseUrl?: string | undefined;
  dbInstance?: DuckDBInstance | undefined;
  limit?: number | undefined;
  concurrency?: number | undefined;
  verbose?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
};

export type ValidationPipelineResult = {
  total: number;
  corrected: number;
  confirmed: number;
  failed: number;
  durationMs: number;
};

export async function runValidationPipeline(
  options: ValidationPipelineOptions,
): Promise<ValidationPipelineResult> {
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

  const pending: PendingValidationRow[] = await getPendingValidations(conn, {
    limit: options.limit,
  });
  log(`${String(pending.length)} attachments pending content-type validation`);

  let corrected: number = 0;
  let confirmed: number = 0;
  let failed: number = 0;
  let processed: number = 0;
  const concurrency: number = options.concurrency ?? 1;

  await processWithConcurrency(
    pending,
    concurrency,
    async (row: PendingValidationRow) => {
      try {
        const detected = detectContentType(row.localPath, row.contentType);
        await markContentTypeValidated(
          conn,
          row.attachmentKey,
          detected.mimeType,
        );

        if (detected.isDifferent) {
          corrected++;
          if (options.verbose) {
            log(
              `  ${String(row.attachmentKey)}: ${row.contentType ?? '(null)'} → ${detected.mimeType}`,
            );
          }
        } else {
          confirmed++;
        }
      } catch (e: unknown) {
        failed++;
        const msg: string = e instanceof Error ? e.message : String(e);
        log(`  ${String(row.attachmentKey)}: validation FAILED — ${msg}`);
      }

      processed++;
      printProgress(processed, pending.length, 'Validating');
    },
  );

  untrackConnection(conn);
  conn.closeSync();

  const durationMs: number = Date.now() - start;
  log(
    `Validation complete: ${String(corrected)} corrected, ${String(confirmed)} confirmed, ${String(failed)} failed (${String(Math.round(durationMs / 1000))}s)`,
  );

  return {
    total: pending.length,
    corrected,
    confirmed,
    failed,
    durationMs,
  };
}
