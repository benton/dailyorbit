import { defineCommand } from 'citty';
import {
  databaseArg,
  parseFileNumbers,
  requestArgs,
  scopeArgs,
  storagePathArg,
} from '../shared/args.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const syncCommand = defineCommand({
  meta: {
    name: 'sync',
    description: 'Discover and download attachments in one pass',
  },
  args: {
    database: databaseArg,
    'storage-path': storagePathArg,
    ...scopeArgs,
    ...requestArgs,
    provider: {
      type: 'string',
      description: 'Discovery provider: fcc-report or fcc-gov',
      default: 'fcc-report',
    },
    'not-scraped-since': {
      type: 'string',
      description: 'Only filings not scraped since this ISO timestamp',
    },
    'stale-after': {
      type: 'string',
      description:
        'Only filings not scraped within this window (e.g. "7d", "24h")',
    },
    'retry-failed': {
      type: 'boolean',
      description: 'Re-attempt previously failed downloads',
      default: false,
    },
    'skip-existing': {
      type: 'boolean',
      description:
        'Skip attachments whose files already exist on disk (default: true)',
      default: true,
    },
    verbose: {
      type: 'boolean',
      description: 'Log per-filing details',
      default: false,
    },
  },
  async run({ args }) {
    const { runAttachmentPipeline } =
      await import('../../attachments/pipeline.ts');

    const result = await runAttachmentPipeline({
      databaseUrl: resolveFromRoot(args.database),
      storageBasePath: resolveFromRoot(args['storage-path']),
      provider: args.provider === 'fcc-gov' ? 'fcc-gov' : 'fcc-report',
      scope: {
        fileNumbers: parseFileNumbers(args.filing),
        subsystems: args.subsystem?.split(','),
        dateFrom: args['date-from'],
        dateTo: args['date-to'],
        limit: args.limit != null ? Number(args.limit) : undefined,
        notScrapedSince: args['not-scraped-since'],
        staleAfter: args['stale-after'],
      },
      retryFailed: args['retry-failed'],
      skipExisting: args['skip-existing'],
      delayMs: Number(args.delay),
      concurrency: Number(args.concurrency),
      verbose: args.verbose,
    });

    console.log('\nSummary:');
    console.log(`  Filings processed:      ${String(result.filingsProcessed)}`);
    console.log(
      `  Attachments discovered: ${String(result.attachmentsDiscovered)}`,
    );
    console.log(
      `  Attachments downloaded: ${String(result.attachmentsDownloaded)}`,
    );
    console.log(
      `  Attachments failed:     ${String(result.attachmentsFailed)}`,
    );
    if (result.downloadsSkipped > 0) {
      console.log(
        `  Downloads skipped (bad URL):${String(result.downloadsSkipped).padStart(1)}`,
      );
    }
    console.log(`  Texts extracted:        ${String(result.textsExtracted)}`);
    console.log(
      `  Texts skipped (no text):${String(result.textsSkippedNoText).padStart(2)}`,
    );
    console.log(`  Texts failed:           ${String(result.textsFailed)}`);
    console.log(
      `  Summaries generated:    ${String(result.summariesGenerated)}`,
    );
    console.log(
      `  Summaries copied (dedup):${String(result.summariesCopied).padStart(1)}`,
    );
    console.log(`  Summaries failed:       ${String(result.summariesFailed)}`);
    console.log(
      `  Duration:               ${String(Math.round(result.durationMs / 1000))}s`,
    );
  },
});
