import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  trackConnection,
  trackInstance,
  untrackConnection,
} from '../lib/graceful-shutdown.ts';
import { yieldToEventLoop } from '../lib/concurrency.ts';
import { getLogger } from '../lib/logger.ts';
import { extensionForContentType } from './content-type.ts';
import { logProgress } from './progress.ts';
import { createProvider } from './provider.ts';
import { processQueue } from './queue.ts';
import { extractTextFromHtml, looksLikeAuthError } from './extract-html.ts';
import { extractTextFromPdf } from './extract-text.ts';
import { htmlToMarkdown } from '../lib/html-to-markdown.ts';
import {
  countDuplicateKeys,
  createAttachmentTable,
  createDiscoveryLogTable,
  findExistingSummaryByChecksum,
  getFilingsForScope,
  getPendingDownloads,
  isUndownloadableUrl,
  markDownloadSkipped,
  getPendingExtractions,
  getPendingSummarizations,
  getPendingValidations,
  markContentTypeValidated,
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
  PendingValidationRow,
} from './repository.ts';
import { detectContentType } from './validate-content-type.ts';
import {
  attachmentStorageKey,
  canaryDownload,
  downloadFile,
  SessionExpiredError,
} from './storage.ts';
import type { StorageBackend } from './storage-backend.ts';
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
  storageKey: string;
  fileSizeBytes: number;
  contentType: string | null;
};

export async function runAttachmentPipeline(
  options: AttachmentPipelineOptions,
): Promise<AttachmentPipelineResult> {
  const start: number = Date.now();
  const log: (msg: string) => void =
    options.onProgress ??
    ((msg: string): void => {
      getLogger().info(msg);
    });
  const delayMs: number = options.delayMs ?? 500;
  const concurrency: number = options.concurrency ?? 1;
  const providerName: 'fcc-report' | 'fcc-gov' =
    options.provider ?? 'fcc-report';
  const storage: StorageBackend = options.storage;

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
          signal: options.signal,
          onError: (error: unknown, _filing: FilingRow, index: number) => {
            discoveryErrors.add(index);
            const msg: string =
              error instanceof Error ? error.message : String(error);
            log(`${filingsToDiscover[index]!.fileNumber}: ERROR — ${msg}`);
          },
          onItemComplete: (completed: number, total: number) => {
            logProgress(completed, total, 'Discovering', log);
          },
        },
      );

    for (let i: number = 0; i < filingsToDiscover.length; i++) {
      if (discoveryErrors.has(i) || discoveryResults[i] == null) {
        continue;
      }

      const filing: FilingRow = filingsToDiscover[i]!;
      const attachments: AttachmentMetadata[] = discoveryResults[i]!;
      if (attachments.length > 0) {
        const result: UpsertResult = await upsertAttachments(conn, attachments);
        totalDiscovered += result.inserted;
        if (verbose) {
          log(
            `  ${filing.fileNumber}: ${String(attachments.length)} attachments (${String(result.inserted)} new, ${String(result.existing)} existing)`,
          );
        }
      }

      // Mark immediately so progress survives interruption
      await markFilingsDiscovered(conn, [filing.filingKey]);
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

  const isCancelled = (): boolean => options.signal?.aborted === true;

  // Bail early if cancelled
  if (isCancelled()) {
    log('Stopped after discovery (run cancelled)');
  }

  // Stage 4: Download attachments (unless discoverOnly)
  let attachmentsDownloaded: number = 0;
  let attachmentsFailed: number = 0;
  let attachmentsSkipped: number = 0;
  let downloadSkipped: number = 0;
  const skipExisting: boolean = options.skipExisting !== false;

  if (options.discoverOnly !== true && !isCancelled()) {
    const filingKeys: number[] = filings.map((f) => f.filingKey);
    const allPending: AttachmentRow[] = await getPendingDownloads(
      conn,
      filingKeys,
      options.retryFailed ?? false,
    );

    // When authCookies is provided, filter to only ServiceNow URLs
    const afterAuthFilter: AttachmentRow[] =
      options.authCookies != null
        ? allPending.filter((a) =>
            a.downloadUrl.includes('servicenowservices.com'),
          )
        : allPending;

    if (options.authCookies != null) {
      log(
        `Auth filter: ${String(allPending.length)} total pending → ${String(afterAuthFilter.length)} with ServiceNow URLs (filtered out ${String(allPending.length - afterAuthFilter.length)})`,
      );
      if (afterAuthFilter.length > 0) {
        const sampleUrls: string[] = afterAuthFilter
          .slice(0, 3)
          .map((a) => a.downloadUrl);
        log(`Sample download URLs: ${JSON.stringify(sampleUrls)}`);
        const cookieCount: number =
          (options.authCookies.match(/; /g)?.length ?? 0) + 1;
        log(
          `Auth cookies: ${String(cookieCount)} cookies, length=${String(options.authCookies.length)}`,
        );
      }
    }

    // Filter out undownloadable URLs (empty, /ibfs? form links, /nav_to nav links)
    const pending: AttachmentRow[] = [];
    for (const att of afterAuthFilter) {
      if (isUndownloadableUrl(att.downloadUrl)) {
        await markDownloadSkipped(conn, att.attachmentKey);
        downloadSkipped++;
      } else {
        pending.push(att);
      }
    }
    if (downloadSkipped > 0) {
      log(
        `Skipped ${String(downloadSkipped)} attachments with undownloadable URLs`,
      );
    }
    log(`${String(pending.length)} attachments pending download`);

    const filingByKey: Map<number, FilingRow> = new Map(
      filings.map((f) => [f.filingKey, f]),
    );

    // When skipExisting is enabled, check storage for already-downloaded files
    // and reconcile them with the DB before queuing network downloads.
    const toDownload: AttachmentRow[] = [];

    if (skipExisting) {
      for (const att of pending) {
        const filing: FilingRow = filingByKey.get(att.filingKey)!;
        // Check if any file with this attachment key exists in storage
        const entries: string[] = await storage.list(
          `${filing.subsystemCode}/${filing.fileNumber}/`,
        );
        const match: string | undefined = entries.find((e) =>
          e.includes(`${String(att.attachmentKey)}.`),
        );
        if (match != null) {
          const stat = await storage.stat(match);
          if (stat != null) {
            const ext: string = match.split('.').pop() ?? 'bin';
            const mimeGuess: string | null =
              ext === 'pdf'
                ? 'application/pdf'
                : ext === 'html'
                  ? 'text/html'
                  : null;
            await markDownloaded(
              conn,
              att.attachmentKey,
              match,
              stat.contentLength,
              mimeGuess,
            );
            attachmentsSkipped++;
            continue;
          }
        }
        toDownload.push(att);
      }
      if (attachmentsSkipped > 0) {
        log(
          `Skipped ${String(attachmentsSkipped)} attachments already in storage`,
        );
      }
    } else {
      toDownload.push(...pending);
    }

    const downloadErrors: Set<number> = new Set();
    let sessionExpired: boolean = false;

    // Throttle authenticated ServiceNow downloads to avoid triggering anti-bot
    const isAuthenticated: boolean = options.authCookies != null;
    const downloadConcurrency: number = isAuthenticated ? 1 : concurrency;
    const downloadDelay: number = isAuthenticated ? 3000 : delayMs;

    // Abort controller lets us stop the queue immediately on session expiry
    const downloadAbort: AbortController = new AbortController();
    if (options.signal != null) {
      options.signal.addEventListener('abort', () => downloadAbort.abort());
    }

    // ── Canary download: test first URL with raw fetch (same as test_icfs_auth_download.sh) ──
    if (isAuthenticated && toDownload.length > 0) {
      const canaryAtt: AttachmentRow = toDownload[0]!;
      log(`=== CANARY DOWNLOAD: testing ${canaryAtt.downloadUrl} ===`);

      const canaryOk: boolean = await canaryDownload(
        canaryAtt.downloadUrl,
        options.authCookies!,
        log,
      );

      if (!canaryOk) {
        log(
          '=== CANARY got HTML — checking if auth failure or legitimate HTML attachment ===',
        );
        log('=== Testing with downloadFile() (has auth-failure detection) ===');

        try {
          const result = await downloadFile(canaryAtt.downloadUrl, {
            cookies: options.authCookies,
          });
          log(
            `=== downloadFile() SUCCEEDED: ${String(result.fileSizeBytes)} bytes, ${result.contentType} — HTML is a legitimate attachment, proceeding ===`,
          );
        } catch (e: unknown) {
          log(
            `=== downloadFile() ALSO FAILED: ${e instanceof Error ? e.message : String(e)} ===`,
          );
          sessionExpired = true;
        }
      } else {
        log('=== CANARY PASSED — proceeding with download queue ===');

        // Also verify downloadFile() works before trusting the queue
        log('=== Verifying downloadFile() path matches canary ===');
        try {
          const result = await downloadFile(canaryAtt.downloadUrl, {
            cookies: options.authCookies,
          });
          log(
            `=== downloadFile() also OK: ${String(result.fileSizeBytes)} bytes, ${result.contentType} ===`,
          );
        } catch (e: unknown) {
          log(
            `=== downloadFile() FAILED despite canary passing: ${e instanceof Error ? e.message : String(e)} ===`,
          );
          log('=== BUG IS IN downloadFile/fetchWithRetry PATH ===');
          sessionExpired = true;
        }
      }
    }

    log(
      `Starting download queue: ${String(toDownload.length)} items, concurrency=${String(downloadConcurrency)}, delay=${String(downloadDelay)}ms`,
    );

    const downloadResults: (DownloadResult | undefined)[] = await processQueue(
      toDownload,
      async (att: AttachmentRow, index: number): Promise<DownloadResult> => {
        const filing: FilingRow = filingByKey.get(att.filingKey)!;
        if (index < 5) {
          log(
            `Downloading [${String(index)}]: key=${String(att.attachmentKey)} url=${att.downloadUrl} filing=${filing.fileNumber}`,
          );
        }

        // Download to a temporary key first, then derive final key from content-type
        const tmpKey: string = attachmentStorageKey(
          filing.subsystemCode,
          filing.fileNumber,
          att.attachmentKey,
          'tmp',
        );

        const { buffer, fileSizeBytes, contentType } = await downloadFile(
          att.downloadUrl,
          isAuthenticated ? { cookies: options.authCookies } : undefined,
        );

        // Write to tmp key
        await storage.write(tmpKey, buffer);

        const ext: string = extensionForContentType(
          contentType ?? 'application/octet-stream',
        );
        const finalKey: string = attachmentStorageKey(
          filing.subsystemCode,
          filing.fileNumber,
          att.attachmentKey,
          ext,
        );

        // Rename tmp → final key (same directory, just extension change)
        if (tmpKey !== finalKey) {
          await storage.rename(tmpKey, finalKey);
        }

        return {
          attachmentKey: att.attachmentKey,
          storageKey: finalKey,
          fileSizeBytes,
          contentType,
        };
      },
      {
        concurrency: downloadConcurrency,
        delayMs: downloadDelay,
        signal: downloadAbort.signal,
        onError: (error: unknown, att: AttachmentRow, index: number) => {
          if (error instanceof SessionExpiredError) {
            log(
              `SessionExpiredError on item ${String(index)}/${String(toDownload.length)}: url=${att.downloadUrl} error=${error.message}`,
            );
            sessionExpired = true;
            downloadAbort.abort();
            return;
          }
          downloadErrors.add(index);
          const msg: string =
            error instanceof Error ? error.message : String(error);
          log(`Failed to download ${att.downloadUrl}: ${msg}`);
        },
        onItemComplete: (completed: number, total: number) => {
          logProgress(completed, total, 'Downloading', log);
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
          dl.storageKey,
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

  // Stage 4.5: Validate content types of downloaded files
  if (options.discoverOnly !== true && !isCancelled()) {
    const validationPending: PendingValidationRow[] =
      await getPendingValidations(conn);

    if (validationPending.length > 0) {
      log(
        `${String(validationPending.length)} attachments pending content-type validation`,
      );

      let validated: number = 0;
      let validationCorrected: number = 0;

      for (let i: number = 0; i < validationPending.length; i++) {
        const row: PendingValidationRow = validationPending[i]!;
        try {
          const data: Buffer = await storage.read(row.storageKey);
          const detected = await detectContentType(data, row.contentType);
          await markContentTypeValidated(
            conn,
            row.attachmentKey,
            detected.mimeType,
          );
          validated++;
          if (detected.isDifferent) {
            validationCorrected++;
            if (verbose) {
              log(
                `  ${String(row.attachmentKey)}: ${row.contentType ?? '(null)'} → ${detected.mimeType}`,
              );
            }
          }
        } catch (e: unknown) {
          const msg: string = e instanceof Error ? e.message : String(e);
          const isNotFound: boolean =
            msg.includes('NotFound') || msg.includes('not found');
          if (isNotFound) {
            // File doesn't exist in storage — mark as file_missing so we
            // don't retry validation every pipeline run
            await markContentTypeValidated(
              conn,
              row.attachmentKey,
              row.contentType ?? 'application/octet-stream',
              'file_missing',
            );
            validated++;
          }
          log(`  ${String(row.attachmentKey)}: validation FAILED — ${msg}`);
        }

        logProgress(i + 1, validationPending.length, 'Validating', log);

        // Yield to event loop periodically so HTTP handlers aren't starved
        if ((i + 1) % 50 === 0) {
          await yieldToEventLoop();
        }
      }

      log(
        `Validation: ${String(validated)} validated, ${String(validationCorrected)} corrected`,
      );
    }
  }

  // Early exit: when stopAfterDownload is set, skip extraction, summarization, and FTS rebuild
  if (options.stopAfterDownload === true) {
    untrackConnection(conn);
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
      attachmentsSkipped,
      downloadsSkipped: downloadSkipped,
      textsExtracted: 0,
      textsSkippedNoText: 0,
      textsSkippedAuthError: 0,
      textsFailed: 0,
      summariesGenerated: 0,
      summariesCopied: 0,
      summariesFailed: 0,
      durationMs,
    };
  }

  // Stage 5: Extract text from newly downloaded PDFs (skip if cancelled)
  let textsExtracted: number = 0;
  let textsSkippedNoText: number = 0;
  let textsSkippedAuthError: number = 0;
  let textsFailed: number = 0;

  if (options.discoverOnly !== true && !isCancelled()) {
    const filingKeysForExtraction: number[] = filings.map((f) => f.filingKey);
    const pendingExtractions: PendingExtractionRow[] =
      await getPendingExtractions(conn, {
        filingKeys: filingKeysForExtraction,
      });

    if (pendingExtractions.length > 0) {
      log(
        `${String(pendingExtractions.length)} attachments pending text extraction`,
      );

      for (let i: number = 0; i < pendingExtractions.length; i++) {
        const row: PendingExtractionRow = pendingExtractions[i]!;

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
              textsExtracted++;
              if (verbose) {
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
              textsSkippedNoText++;
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
              textsSkippedAuthError++;
              if (verbose) {
                log(
                  `  ${String(row.attachmentKey)}: skipped (auth error stub)`,
                );
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
                textsExtracted++;
                if (verbose) {
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
            }
          } else {
            // PDF extraction — pdftotext fallback needs a temp file
            const bytes: Uint8Array = new Uint8Array(data);
            let tempPath: string | undefined;
            try {
              // For pdftotext fallback, write to a temp file
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
          textsFailed++;
          const msg: string = e instanceof Error ? e.message : String(e);
          log(`  ${String(row.attachmentKey)}: extraction FAILED — ${msg}`);
        }

        logProgress(i + 1, pendingExtractions.length, 'Extracting', log);

        // Yield to event loop periodically so HTTP handlers aren't starved
        if ((i + 1) % 50 === 0) {
          await yieldToEventLoop();
        }
      }

      log(
        `Extraction: ${String(textsExtracted)} extracted, ${String(textsSkippedNoText)} skipped (no text), ${String(textsFailed)} failed`,
      );
    }
  }

  // Stage 6: Summarize extracted text via Bedrock
  let summariesGenerated: number = 0;
  let summariesCopied: number = 0;
  let summariesFailed: number = 0;

  if (
    options.discoverOnly !== true &&
    options.skipSummarization !== true &&
    !isCancelled()
  ) {
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

      const summResults: ('generated' | 'copied' | undefined)[] =
        await processQueue(
          pendingSummarizations,
          async (
            row: PendingSummarizationRow,
          ): Promise<'generated' | 'copied'> => {
            // Dedup: check if another attachment with the same text already has a summary
            if (row.textChecksum != null) {
              const existing: string | null =
                await findExistingSummaryByChecksum(conn, row.textChecksum);
              if (existing != null) {
                await saveSummary(conn, row.attachmentKey, existing, 'copied');
                return 'copied';
              }
            }

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
                {
                  role: 'user',
                  content: renderPrompt(userPromptTemplate, vars),
                },
              ],
              params: {
                systemPrompt,
                maxTokens: 512,
                temperature: 0.3,
              },
            });

            await saveSummary(conn, row.attachmentKey, resp.content, modelId);
            return 'generated';
          },
          {
            concurrency: summConcurrency,
            delayMs: 0,
            signal: options.signal,
            onError: (error: unknown, row: PendingSummarizationRow) => {
              const msg: string =
                error instanceof Error ? error.message : String(error);
              log(`Summarization error [${row.fileNumber}]: ${msg}`);
            },
            onItemComplete: (completed: number, total: number) => {
              logProgress(completed, total, 'Summarizing', log);
            },
          },
        );

      for (const r of summResults) {
        if (r === 'generated') {
          summariesGenerated++;
        } else if (r === 'copied') {
          summariesCopied++;
        } else {
          summariesFailed++;
        }
      }

      const copiedSuffix: string =
        summariesCopied > 0
          ? `, ${String(summariesCopied)} copied (dedup)`
          : '';
      log(
        `Summarization: ${String(summariesGenerated)} generated${copiedSuffix}, ${String(summariesFailed)} failed`,
      );
    }
  }

  untrackConnection(conn);
  conn.closeSync();

  // Rebuild FTS indexes so new/updated content is searchable
  if (!isCancelled()) {
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
  }

  const durationMs: number = Date.now() - start;
  const skippedSuffix: string =
    attachmentsSkipped > 0
      ? `, ${String(attachmentsSkipped)} skipped (in storage)`
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
    downloadsSkipped: downloadSkipped,
    textsExtracted,
    textsSkippedNoText,
    textsSkippedAuthError,
    textsFailed,
    summariesGenerated,
    summariesCopied,
    summariesFailed,
    durationMs,
  };
}
