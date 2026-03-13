import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { compactToHyphenated } from './file-number.ts';
import { createProvider } from './provider.ts';
import { processQueue } from './queue.ts';
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
  const db: DuckDBInstance =
    options.dbInstance ?? (await DuckDBInstance.create(options.databaseUrl!));
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await createAttachmentTable(conn);

  // Stage 2: Query filings matching scope
  const filings: FilingRow[] = await getFilingsForScope(conn, options.scope);
  log(
    `Found ${String(filings.length)} filings matching scope (concurrency: ${String(concurrency)})`,
  );

  // Stage 3: Discover attachments — concurrent HTTP, sequential DB writes
  let totalDiscovered: number = 0;
  let filingsProcessed: number = 0;
  const discoveryErrors: Set<number> = new Set();

  const discoveryResults: (AttachmentMetadata[] | undefined)[] =
    await processQueue(
      filings,
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
          log(`${filings[index]!.fileNumber}: ERROR — ${msg}`);
        },
      },
    );

  for (let i: number = 0; i < filings.length; i++) {
    filingsProcessed++;
    if (discoveryErrors.has(i)) {
      continue;
    }

    const filing: FilingRow = filings[i]!;
    const attachments: AttachmentMetadata[] = discoveryResults[i]!;
    const result: UpsertResult = await upsertAttachments(conn, attachments);
    totalDiscovered += result.inserted;
    log(
      `[${String(filingsProcessed)}/${String(filings.length)}] ${filing.fileNumber}: ${String(attachments.length)} attachments (${String(result.inserted)} new, ${String(result.existing)} existing)`,
    );
  }

  // Stage 4: Download attachments (unless discoverOnly)
  let attachmentsDownloaded: number = 0;
  let attachmentsFailed: number = 0;

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
    const downloadErrors: Set<number> = new Set();

    const downloadResults: (DownloadResult | undefined)[] = await processQueue(
      pending,
      async (att: AttachmentRow): Promise<DownloadResult> => {
        const filing: FilingRow = filingByKey.get(att.filingKey)!;
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

        if (fileExists(destPath)) {
          const size: number = (await getFileSize(destPath)) ?? 0;
          return {
            attachmentKey: att.attachmentKey,
            destPath,
            fileSizeBytes: size,
          };
        }

        const { fileSizeBytes } = await downloadFile(att.downloadUrl, destPath);
        return { attachmentKey: att.attachmentKey, destPath, fileSizeBytes };
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
      },
    );

    for (let i: number = 0; i < pending.length; i++) {
      const att: AttachmentRow = pending[i]!;
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
        );
        attachmentsDownloaded++;
        log(`Downloaded: ${dl.destPath} (${String(dl.fileSizeBytes)} bytes)`);
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
