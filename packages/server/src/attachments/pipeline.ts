import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { compactToHyphenated } from './file-number.ts';
import { createProvider } from './provider.ts';
import {
  createAttachmentTable,
  getFilingsForScope,
  getPendingDownloads,
  markDownloaded,
  markFailed,
  upsertAttachments,
} from './repository.ts';
import {
  attachmentStoragePath,
  downloadFile,
  fileExists,
  getFileSize,
} from './storage.ts';
import type {
  AttachmentPipelineOptions,
  AttachmentPipelineResult,
  AttachmentRow,
  FilingRow,
  UpsertResult,
} from './types.ts';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAttachmentPipeline(
  options: AttachmentPipelineOptions,
): Promise<AttachmentPipelineResult> {
  const start: number = Date.now();
  const log: (msg: string) => void = options.onProgress ?? console.log;
  const delayMs: number = options.delayMs ?? 500;
  const providerName: 'fcc-report' | 'fcc-gov' =
    options.provider ?? 'fcc-report';

  // Stage 1: Connect to DB and ensure table exists
  const db: DuckDBInstance =
    options.dbInstance ?? (await DuckDBInstance.create(options.databaseUrl!));
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await createAttachmentTable(conn);

  // Stage 2: Query filings matching scope
  const filings: FilingRow[] = await getFilingsForScope(conn, options.scope);
  log(`Found ${String(filings.length)} filings matching scope`);

  // Stage 3: Discover attachments for each filing
  let totalDiscovered: number = 0;
  let filingsProcessed: number = 0;

  for (const filing of filings) {
    const provider = createProvider(
      providerName,
      filing.subsystemCode,
      filing.appTypeCode,
    );

    try {
      const attachments = await provider.discover(
        filing.fileNumber,
        filing.filingKey,
      );
      const result: UpsertResult = await upsertAttachments(conn, attachments);
      totalDiscovered += result.inserted;
      filingsProcessed++;
      log(
        `[${String(filingsProcessed)}/${String(filings.length)}] ${filing.fileNumber}: ${String(attachments.length)} attachments (${String(result.inserted)} new, ${String(result.existing)} existing)`,
      );
    } catch (error: unknown) {
      const msg: string =
        error instanceof Error ? error.message : String(error);
      log(
        `[${String(filingsProcessed + 1)}/${String(filings.length)}] ${filing.fileNumber}: ERROR — ${msg}`,
      );
      filingsProcessed++;
    }

    if (delayMs > 0 && filingsProcessed < filings.length) {
      await delay(delayMs);
    }
  }

  // Stage 4: Download attachments (unless discoverOnly)
  let attachmentsDownloaded: number = 0;
  let attachmentsFailed: number = 0;

  if (options.discoverOnly !== true) {
    const pending: AttachmentRow[] = await getPendingDownloads(
      conn,
      options.retryFailed ?? false,
    );
    log(`${String(pending.length)} attachments pending download`);

    for (const att of pending) {
      // Find the filing row to get subsystem/appType for hyphenation
      const filing: FilingRow | undefined = filings.find(
        (f) => f.filingKey === att.filingKey,
      );

      if (filing == null) {
        log(
          `Skipping attachment ${String(att.attachmentKey)}: filing not in scope`,
        );
        attachmentsFailed++;
        await markFailed(conn, att.attachmentKey);
        continue;
      }

      const hyphenated: string = compactToHyphenated(
        filing.fileNumber,
        filing.subsystemCode,
        filing.appTypeCode,
      );
      const destPath: string = attachmentStoragePath(
        options.storageBasePath,
        filing.subsystemCode,
        hyphenated,
        att.attachmentKey,
      );

      // Skip if file already exists on disk
      if (fileExists(destPath)) {
        const size: number | null = await getFileSize(destPath);
        await markDownloaded(conn, att.attachmentKey, destPath, size ?? 0);
        log(`Already on disk: ${destPath}`);
        attachmentsDownloaded++;
        continue;
      }

      try {
        const { fileSizeBytes } = await downloadFile(att.downloadUrl, destPath);
        await markDownloaded(conn, att.attachmentKey, destPath, fileSizeBytes);
        attachmentsDownloaded++;
        log(`Downloaded: ${destPath} (${String(fileSizeBytes)} bytes)`);
      } catch (error: unknown) {
        const msg: string =
          error instanceof Error ? error.message : String(error);
        log(`Failed to download ${att.downloadUrl}: ${msg}`);
        await markFailed(conn, att.attachmentKey);
        attachmentsFailed++;
      }

      if (delayMs > 0) {
        await delay(delayMs);
      }
    }
  }

  conn.closeSync();

  const durationMs: number = Date.now() - start;
  log(
    `Pipeline complete: ${String(filingsProcessed)} filings, ${String(totalDiscovered)} discovered, ${String(attachmentsDownloaded)} downloaded, ${String(attachmentsFailed)} failed (${String(Math.round(durationMs / 1000))}s)`,
  );

  return {
    filingsProcessed,
    attachmentsDiscovered: totalDiscovered,
    attachmentsDownloaded,
    attachmentsFailed,
    durationMs,
  };
}
