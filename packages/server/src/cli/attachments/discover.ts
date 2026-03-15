import { defineCommand } from 'citty';
import {
  databaseArg,
  parseFileNumbers,
  requestArgs,
  scopeArgs,
  storagePathArg,
} from '../shared/args.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const discoverCommand = defineCommand({
  meta: {
    name: 'discover',
    description: 'Discover attachment metadata for filings',
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
    verbose: {
      type: 'boolean',
      description: 'Log per-filing discovery details',
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
      discoverOnly: true,
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
      `  Duration:               ${String(Math.round(result.durationMs / 1000))}s`,
    );
  },
});
