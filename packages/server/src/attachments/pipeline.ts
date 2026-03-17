import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  trackConnection,
  trackInstance,
  untrackConnection,
} from '../lib/graceful-shutdown.ts';
import { extensionForContentType } from './content-type.ts';
import { printProgress } from './progress.ts';
import { createProvider } from './provider.ts';
import { processQueue } from './queue.ts';
import { extractTextFromPdf } from './extract-text.ts';
import {
  countDuplicateKeys,
  createAttachmentTable,
  createDiscoveryLogTable,
  getFilingsForScope,
  getPendingDownloads,
  getPendingExtractions,
  getPendingSummarizations,
  markDownloaded,
  markExtracted,
  markExtractionFailed,
  markExtractionSkipped,
  markFailed,
  markFilingsDiscovered,
  saveSummary,
  upsertAttachments,
} from './repository.ts';
import type {
  PendingExtractionRow,
  PendingSummarizationRow,
} from './repository.ts';
import {
  attachmentStoragePath,
  downloadFile,
  findExistingAttachment,
  SessionExpiredError,
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
    const allPending: AttachmentRow[] = await getPendingDownloads(
      conn,
      filingKeys,
      options.retryFailed ?? false,
    );

    // When authCookies is provided, filter to only ServiceNow URLs
    const pending: AttachmentRow[] =
      options.authCookies != null
        ? allPending.filter((a) =>
            a.downloadUrl.includes('servicenowservices.com'),
          )
        : allPending;
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
        const existing = await findExistingAttachment(
          options.storageBasePath,
          filing.subsystemCode,
          filing.fileNumber,
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
    let sessionExpired: boolean = false;

    const downloadResults: (DownloadResult | undefined)[] = await processQueue(
      toDownload,
      async (att: AttachmentRow): Promise<DownloadResult> => {
        // Stop downloading once session has expired — leave remaining items pending
        if (sessionExpired) {
          throw new SessionExpiredError(att.downloadUrl);
        }

        const filing: FilingRow = filingByKey.get(att.filingKey)!;

        // Download to a temporary path first, then derive final path from content-type
        const tmpPath: string = attachmentStoragePath(
          options.storageBasePath,
          filing.subsystemCode,
          filing.fileNumber,
          att.attachmentKey,
          'tmp',
        );

        const { fileSizeBytes, contentType } = await downloadFile(
          att.downloadUrl,
          tmpPath,
          options.authCookies != null
            ? { cookies: options.authCookies }
            : undefined,
        );

        const ext: string = extensionForContentType(
          contentType ?? 'application/octet-stream',
        );
        const destPath: string = attachmentStoragePath(
          options.storageBasePath,
          filing.subsystemCode,
          filing.fileNumber,
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
          if (error instanceof SessionExpiredError) {
            sessionExpired = true;
            // Don't mark as failed — leave pending for next session
            return;
          }
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
      } else if (downloadResults[i] != null) {
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
      // else: session expired — item left pending, not counted as failed
    }

    if (sessionExpired) {
      const remaining: number =
        toDownload.length - attachmentsDownloaded - attachmentsFailed;
      log(
        `Session expired — downloaded ${String(attachmentsDownloaded)} before expiry, ${String(remaining)} remaining`,
      );
    }
  }

  // Stage 5: Extract text from newly downloaded PDFs
  let textsExtracted: number = 0;
  let textsSkippedNoText: number = 0;
  let textsFailed: number = 0;

  if (options.discoverOnly !== true) {
    const filingKeysForExtraction: number[] = filings.map((f) => f.filingKey);
    const pendingExtractions: PendingExtractionRow[] =
      await getPendingExtractions(conn, {
        filingKeys: filingKeysForExtraction,
      });

    if (pendingExtractions.length > 0) {
      log(`${String(pendingExtractions.length)} PDFs pending text extraction`);

      const { readFileSync } = await import('node:fs');

      for (let i: number = 0; i < pendingExtractions.length; i++) {
        const row: PendingExtractionRow = pendingExtractions[i]!;

        try {
          const bytes: Uint8Array = new Uint8Array(readFileSync(row.localPath));
          const result = extractTextFromPdf(bytes);

          if (result.status === 'extracted') {
            await markExtracted(
              conn,
              row.attachmentKey,
              result.text,
              result.textLength,
            );
            textsExtracted++;
            if (verbose) {
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
            textsSkippedNoText++;
            if (verbose) {
              log(`  ${String(row.attachmentKey)}: skipped (no text)`);
            }
          } else {
            await markExtractionFailed(conn, row.attachmentKey);
            textsFailed++;
            log(
              `  ${String(row.attachmentKey)}: extraction FAILED — ${result.error}`,
            );
          }
        } catch (e: unknown) {
          await markExtractionFailed(conn, row.attachmentKey);
          textsFailed++;
          const msg: string = e instanceof Error ? e.message : String(e);
          log(`  ${String(row.attachmentKey)}: extraction FAILED — ${msg}`);
        }

        printProgress(i + 1, pendingExtractions.length, 'Extracting');
      }

      log(
        `Extraction: ${String(textsExtracted)} extracted, ${String(textsSkippedNoText)} skipped (no text), ${String(textsFailed)} failed`,
      );
    }
  }

  // Stage 6: Summarize extracted text via Bedrock
  let summariesGenerated: number = 0;
  let summariesFailed: number = 0;

  if (options.discoverOnly !== true && options.skipSummarization !== true) {
    const filingKeysForSummarization: number[] = filings.map(
      (f) => f.filingKey,
    );
    const pendingSummarizations: PendingSummarizationRow[] =
      await getPendingSummarizations(conn, {
        filingKeys: filingKeysForSummarization,
      });

    if (pendingSummarizations.length > 0) {
      log(
        `${String(pendingSummarizations.length)} attachments pending summarization`,
      );

      const { BedrockClient } = await import('../inference/bedrock-client.ts');
      const { InferenceService } =
        await import('../inference/inference-service.ts');
      const {
        DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
        DEFAULT_SUMMARIZATION_USER_PROMPT,
        renderPrompt,
      } = await import('../inference/prompts.ts');

      // Resolve config — prefer explicit options, fall back to ConfigService, then defaults
      let region: string = options.bedrockRegion ?? 'us-east-2';
      let modelId: string =
        options.summarizationModel ?? 'us.amazon.nova-pro-v1:0';
      let systemPrompt: string = DEFAULT_SUMMARIZATION_SYSTEM_PROMPT;
      let userPromptTemplate: string = DEFAULT_SUMMARIZATION_USER_PROMPT;

      try {
        const { getConfigService } = await import('../lib/config.ts');
        const config = getConfigService();
        region =
          options.bedrockRegion ??
          ((config.get('bedrockRegion') as string) || region);
        modelId =
          options.summarizationModel ??
          ((config.get('summarizationModel') as string) || modelId);
        const customSystem: string = config.get(
          'summarizationSystemPrompt',
        ) as string;
        const customUser: string = config.get(
          'summarizationUserPrompt',
        ) as string;
        if (customSystem) systemPrompt = customSystem;
        if (customUser) userPromptTemplate = customUser;
      } catch {
        // ConfigService not initialized (standalone CLI) — use defaults
      }

      const client = new BedrockClient(region);
      const service = new InferenceService(client);
      const summConcurrency: number = options.summarizationConcurrency ?? 10;

      log(
        `Summarizing with ${modelId} (concurrency: ${String(summConcurrency)})`,
      );

      const summResults: (boolean | undefined)[] = await processQueue(
        pendingSummarizations,
        async (row: PendingSummarizationRow): Promise<boolean> => {
          const vars: Record<string, string> = {
            fileNumber: row.fileNumber,
            applicantName: row.applicantName,
            dateFiled: row.dateFiled,
            appTypeCode: row.appTypeCode,
            subsystemCode: row.subsystemCode,
            attachmentName: row.attachmentName,
            fullText: row.fullText,
            companyName: '',
          };

          const resp = await service.complete({
            modelId,
            messages: [
              { role: 'user', content: renderPrompt(userPromptTemplate, vars) },
            ],
            params: {
              systemPrompt,
              maxTokens: 512,
              temperature: 0.3,
            },
          });

          await saveSummary(conn, row.attachmentKey, resp.content);
          return true;
        },
        {
          concurrency: summConcurrency,
          delayMs: 0,
          onError: (error: unknown, row: PendingSummarizationRow) => {
            const msg: string =
              error instanceof Error ? error.message : String(error);
            log(`Summarization error [${row.fileNumber}]: ${msg}`);
          },
          onItemComplete: (completed: number, total: number) => {
            printProgress(completed, total, 'Summarizing');
          },
        },
      );

      for (const r of summResults) {
        if (r === true) {
          summariesGenerated++;
        } else {
          summariesFailed++;
        }
      }

      log(
        `Summarization: ${String(summariesGenerated)} generated, ${String(summariesFailed)} failed`,
      );
    }
  }

  untrackConnection(conn);
  conn.closeSync();

  // Rebuild FTS indexes so new/updated content is searchable
  const { rebuildAllFtsIndexes } = await import('../search/fts-index.ts');
  const ftsConn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    log('Rebuilding FTS indexes...');
    const ftsStart: number = Date.now();
    await rebuildAllFtsIndexes(ftsConn);
    log(
      `FTS indexes rebuilt in ${((Date.now() - ftsStart) / 1000).toFixed(1)}s`,
    );
  } finally {
    ftsConn.closeSync();
  }

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
    textsExtracted,
    textsSkippedNoText,
    textsFailed,
    summariesGenerated,
    summariesFailed,
    durationMs,
  };
}
