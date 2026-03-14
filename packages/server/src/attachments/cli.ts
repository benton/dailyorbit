import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeAll } from '../lib/graceful-shutdown.ts';
import { runAttachmentPipeline } from './pipeline.ts';
import type { AttachmentPipelineResult } from './types.ts';

/**
 * CLI entry point for the attachment discovery and download pipeline.
 *
 * Usage:
 *   node packages/server/src/attachments/cli.ts [options]
 *
 * Options:
 *   --database       DuckDB path (default: data/daily-orbit.duckdb)
 *   --storage-path   Base path for files (default: data/attachments)
 *   --filing         Comma-separated compact file numbers
 *   --subsystem      Comma-separated subsystem codes (SAT, SES, etc.)
 *   --date-from      YYYY-MM-DD
 *   --date-to        YYYY-MM-DD
 *   --limit          Max filings to process
 *   --discover-only  Discover metadata only, skip downloads
 *   --download-only  Download pending attachments only, skip discovery
 *   --retry-failed   Re-attempt failed downloads
 *   --delay          ms between requests (default: 500)
 *   --concurrency    Number of concurrent requests (default: 1)
 *   --provider       fcc-report (default) | fcc-gov
 *   --not-scraped-since  ISO timestamp — only filings not scraped since then
 *   --stale-after    Duration — only filings not scraped within this window (e.g. "7d", "24h")
 *   --verbose        Log per-filing discovery details
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      database: { type: 'string', default: 'data/daily-orbit.duckdb' },
      'storage-path': { type: 'string', default: 'data/attachments' },
      filing: { type: 'string' },
      subsystem: { type: 'string' },
      'date-from': { type: 'string' },
      'date-to': { type: 'string' },
      limit: { type: 'string' },
      'discover-only': { type: 'boolean', default: false },
      'download-only': { type: 'boolean', default: false },
      'retry-failed': { type: 'boolean', default: false },
      delay: { type: 'string', default: '500' },
      concurrency: { type: 'string', default: '1' },
      provider: { type: 'string', default: 'fcc-report' },
      'not-scraped-since': { type: 'string' },
      'stale-after': { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const rootDir: string = resolve(import.meta.dirname, '../../../..');
  const databaseUrl: string = resolve(rootDir, values.database!);
  const storageBasePath: string = resolve(rootDir, values['storage-path']!);
  const fileNumbers: string[] | undefined = values.filing?.split(',');
  const subsystems: string[] | undefined = values.subsystem?.split(',');
  const dateFrom: string | undefined = values['date-from'];
  const dateTo: string | undefined = values['date-to'];
  const limit: number | undefined =
    values.limit != null ? Number(values.limit) : undefined;
  const discoverOnly: boolean = values['discover-only'] ?? false;
  const downloadOnly: boolean = values['download-only'] ?? false;
  const retryFailed: boolean = values['retry-failed'] ?? false;
  const delayMs: number = Number(values.delay);
  const concurrency: number = Number(values.concurrency);
  const provider: 'fcc-report' | 'fcc-gov' =
    values.provider === 'fcc-gov' ? 'fcc-gov' : 'fcc-report';
  const notScrapedSince: string | undefined = values['not-scraped-since'];
  const staleAfter: string | undefined = values['stale-after'];
  const verbose: boolean = values.verbose ?? false;

  const result: AttachmentPipelineResult = await runAttachmentPipeline({
    databaseUrl,
    storageBasePath,
    provider,
    scope: {
      fileNumbers,
      subsystems,
      dateFrom,
      dateTo,
      limit,
      notScrapedSince,
      staleAfter,
    },
    discoverOnly,
    downloadOnly,
    retryFailed,
    delayMs,
    concurrency,
    verbose,
  });

  console.log('\nSummary:');
  console.log(`  Filings processed:      ${String(result.filingsProcessed)}`);
  console.log(
    `  Attachments discovered: ${String(result.attachmentsDiscovered)}`,
  );
  console.log(
    `  Attachments downloaded: ${String(result.attachmentsDownloaded)}`,
  );
  console.log(`  Attachments failed:     ${String(result.attachmentsFailed)}`);
  console.log(
    `  Duration:               ${String(Math.round(result.durationMs / 1000))}s`,
  );

  closeAll();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Attachment pipeline failed:', err);
  closeAll();
  process.exit(1);
});
