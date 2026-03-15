import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  trackConnection,
  trackInstance,
  untrackConnection,
} from '../lib/graceful-shutdown.ts';
import { extensionForContentType } from './content-type.ts';
import { compactToHyphenated } from './file-number.ts';
import { printProgress } from './progress.ts';
import { createProvider } from './provider.ts';
import { processQueue } from './queue.ts';
import {
  countDuplicateKeys,
  createAttachmentTable,
  createDiscoveryLogTable,
  getFilingsForScope,
  getPendingDownloads,
  markDownloaded,
  markFailed,
  markFilingsDiscovered,
  upsertAttachments,
} from './repository.ts';
import {
  attachmentStoragePath,
  downloadFile,
  findExistingAttachment,
} from './storage.ts';
import type {
  AttachmentMetadata,
  AttachmentPipelineOptions,
  AttachmentPipelineResult,
  AttachmentRow,
  FilingRow,
  UpsertResult,
} from './types.ts';

type DownloadResult = {
  attachmentKey: number;
  destPath: string;
  fileSizeBytes: number;
  contentType: string | null;
};

export async function runAttachmentPipeline(
  options: AttachmentPipelineOptions,
): Promise<AttachmentPipelineResult> {
  const start: number = Date.now();
  const log: (msg: string) => void = options.onProgress ?? console.log;
  const delayMs: number = options.delayMs ?? 500;
  const concurrency: number = options.concurrency ?? 1;
  const providerName: 'fcc-report' | 'fcc-gov' =
    options.provider ?? 'fcc-report';

  // Stage 1: Connect to DB and ensure table exists
  const verbose: boolean = options.verbose ?? false;

  const db: DuckDBInstance =
    options.dbInstance ?? (await DuckDBInstance.create(options.databaseUrl!));
  trackInstance(db);
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  await createAttachmentTable(conn);
  await createDiscoveryLogTable(conn);

  // Stage 2: Query filings matching scope
  const filings: FilingRow[] = await getFilingsForScope(conn, options.scope);
  log(
    `Found ${String(filings.length)} filings matching scope (concurrency: ${String(concurrency)})`,
  );

  // Stage 3: Discover attachments — only for un-scraped (or stale) filings
  // Already-scraped filings are included in the download phase but skip discovery.
  // downloadOnly skips discovery entirely.
  const skipDiscovery: boolean = options.downloadOnly === true;
  const needsDiscovery: boolean =
    options.scope.staleAfter != null || options.scope.notScrapedSince != null;
  const filingsToDiscover: FilingRow[] = skipDiscovery
    ? []
    : needsDiscovery
      ? filings
      : filings.filter((f) => f.discoveredAt == null);

  let totalDiscovered: number = 0;
  const filingsProcessed: number = filings.length;
  const discoveryErrors: Set<number> = new Set();

  if (filingsToDiscover.length > 0) {
    log(
      `Discovering attachments for ${String(filingsToDiscover.length)} un-scraped filings`,
    );

    const discoveryResults: (AttachmentMetadata[] | undefined)[] =
      await processQueue(
        filingsToDiscover,
        async (filing: FilingRow): Promise<AttachmentMetadata[]> => {
          const provider = createProvider(
            providerName,
            filing.subsystemCode,
            filing.appTypeCode,
          );
          return provider.discover(filing.fileNumber, filing.filingKey);
        },
        {
          concurrency,
          delayMs,
          onError: (error: unknown, _filing: FilingRow, index: number) => {
            discoveryErrors.add(index);
            const msg: string =
              error instanceof Error ? error.message : String(error);
            log(`${filingsToDiscover[index]!.fileNumber}: ERROR — ${msg}`);
          },
          onItemComplete: (completed: number, total: number) => {
            printProgress(completed, total, 'Discovering');
          },
        },
      );

    const succeededFilingKeys: number[] = [];

    for (let i: number = 0; i < filingsToDiscover.length; i++) {
      if (discoveryErrors.has(i)) {
        continue;
      }

      const filing: FilingRow = filingsToDiscover[i]!;
      succeededFilingKeys.push(filing.filingKey);
      const attachments: AttachmentMetadata[] = discoveryResults[i]!;
      if (attachments.length === 0) {
        continue;
      }

      const result: UpsertResult = await upsertAttachments(conn, attachments);
      totalDiscovered += result.inserted;
      if (verbose) {
        log(
          `  ${filing.fileNumber}: ${String(attachments.length)} attachments (${String(result.inserted)} new, ${String(result.existing)} existing)`,
        );
      }
    }

    // Mark filings as having had discovery attempted
    if (succeededFilingKeys.length > 0) {
      await markFilingsDiscovered(conn, succeededFilingKeys);
    }
  } else {
    log('All filings already scraped — skipping discovery');
  }

  log(
    `Discovery: ${String(totalDiscovered)} new attachments (${String(discoveryErrors.size)} errors)`,
  );

  // Check for duplicate attachment keys after discovery
  const dupeCount: number = await countDuplicateKeys(conn);
  if (dupeCount > 0) {
    log(
      `WARNING: ${String(dupeCount)} duplicate attachment_key values detected`,
    );
  }

  // Stage 4: Download attachments (unless discoverOnly)
  let attachmentsDownloaded: number = 0;
  let attachmentsFailed: number = 0;
  let attachmentsSkipped: number = 0;
  const skipExisting: boolean = options.skipExisting !== false;

  if (options.discoverOnly !== true) {
    const filingKeys: number[] = filings.map((f) => f.filingKey);
    const pending: AttachmentRow[] = await getPendingDownloads(
      conn,
      filingKeys,
      options.retryFailed ?? false,
    );
    log(`${String(pending.length)} attachments pending download`);

    const filingByKey: Map<number, FilingRow> = new Map(
      filings.map((f) => [f.filingKey, f]),
    );

    // When skipExisting is enabled, check disk for already-downloaded files
    // and reconcile them with the DB before queuing network downloads.
    const toDownload: AttachmentRow[] = [];

    if (skipExisting) {
      for (const att of pending) {
        const filing: FilingRow = filingByKey.get(att.filingKey)!;
        const hyphenated: string = compactToHyphenated(
          filing.fileNumber,
          filing.subsystemCode,
          filing.appTypeCode,
        );
        const existing = await findExistingAttachment(
          options.storageBasePath,
          filing.subsystemCode,
          hyphenated,
          att.attachmentKey,
        );
        if (existing != null) {
          // File already on disk — reconcile DB status without re-downloading
          const ext: string = existing.path.split('.').pop() ?? 'bin';
          const mimeGuess: string | null =
            ext === 'pdf'
              ? 'application/pdf'
              : ext === 'html'
                ? 'text/html'
                : null;
          await markDownloaded(
            conn,
            att.attachmentKey,
            existing.path,
            existing.fileSizeBytes,
            mimeGuess,
          );
          attachmentsSkipped++;
        } else {
          toDownload.push(att);
        }
      }
      if (attachmentsSkipped > 0) {
        log(
          `Skipped ${String(attachmentsSkipped)} attachments already on disk`,
        );
      }
    } else {
      toDownload.push(...pending);
    }

    const downloadErrors: Set<number> = new Set();

    const downloadResults: (DownloadResult | undefined)[] = await processQueue(
      toDownload,
      async (att: AttachmentRow): Promise<DownloadResult> => {
        const filing: FilingRow = filingByKey.get(att.filingKey)!;
        const hyphenated: string = compactToHyphenated(
          filing.fileNumber,
          filing.subsystemCode,
          filing.appTypeCode,
        );

        // Download to a temporary path first, then derive final path from content-type
        const tmpPath: string = attachmentStoragePath(
          options.storageBasePath,
          filing.subsystemCode,
          hyphenated,
          att.attachmentKey,
          'tmp',
        );

        const { fileSizeBytes, contentType } = await downloadFile(
          att.downloadUrl,
          tmpPath,
        );

        const ext: string = extensionForContentType(
          contentType ?? 'application/octet-stream',
        );
        const destPath: string = attachmentStoragePath(
          options.storageBasePath,
          filing.subsystemCode,
          hyphenated,
          att.attachmentKey,
          ext,
        );

        // Rename tmp → final path (same directory, just extension change)
        if (tmpPath !== destPath) {
          const { rename } = await import('node:fs/promises');
          await rename(tmpPath, destPath);
        }

        return {
          attachmentKey: att.attachmentKey,
          destPath,
          fileSizeBytes,
          contentType,
        };
      },
      {
        concurrency,
        delayMs,
        onError: (error: unknown, att: AttachmentRow, index: number) => {
          downloadErrors.add(index);
          const msg: string =
            error instanceof Error ? error.message : String(error);
          log(`Failed to download ${att.downloadUrl}: ${msg}`);
        },
        onItemComplete: (completed: number, total: number) => {
          printProgress(completed, total, 'Downloading');
        },
      },
    );

    for (let i: number = 0; i < toDownload.length; i++) {
      const att: AttachmentRow = toDownload[i]!;
      if (downloadErrors.has(i)) {
        await markFailed(conn, att.attachmentKey);
        attachmentsFailed++;
      } else {
        const dl: DownloadResult = downloadResults[i]!;
        await markDownloaded(
          conn,
          dl.attachmentKey,
          dl.destPath,
          dl.fileSizeBytes,
          dl.contentType,
        );
        attachmentsDownloaded++;
      }
    }
  }

  untrackConnection(conn);
  conn.closeSync();

  const durationMs: number = Date.now() - start;
  const skippedSuffix: string =
    attachmentsSkipped > 0
      ? `, ${String(attachmentsSkipped)} skipped (on disk)`
      : '';
  log(
    `Pipeline complete: ${String(filingsProcessed)} filings, ${String(totalDiscovered)} discovered, ${String(attachmentsDownloaded)} downloaded, ${String(attachmentsFailed)} failed${skippedSuffix} (${String(Math.round(durationMs / 1000))}s)`,
  );

  return {
    filingsProcessed,
    attachmentsDiscovered: totalDiscovered,
    attachmentsDownloaded,
    attachmentsFailed,
    attachmentsSkipped,
    durationMs,
  };
}
