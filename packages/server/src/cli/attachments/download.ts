import { readFileSync } from 'node:fs';
import { defineCommand } from 'citty';
import {
  databaseArg,
  parseFileNumbers,
  requestArgs,
  scopeArgs,
  storagePathArg,
} from '../shared/args.ts';
import { getLogger } from '../../lib/logger.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const downloadCommand = defineCommand({
  meta: {
    name: 'download',
    description: 'Download pending attachments',
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
    'auth-cookies': {
      type: 'string',
      description:
        'Path to JSON file with session cookies for authenticated ServiceNow downloads',
    },
    verbose: {
      type: 'boolean',
      description: 'Log per-filing details',
      default: false,
    },
  },
  async run({ args }) {
    const log = getLogger();
    const { runAttachmentPipeline } =
      await import('../../attachments/pipeline.ts');

    // Load auth cookies from JSON file if provided
    let authCookies: string | undefined;
    if (args['auth-cookies'] != null) {
      const cookiePath: string = resolveFromRoot(args['auth-cookies']);
      const raw: string = readFileSync(cookiePath, 'utf-8');
      const parsed: { cookies: string } = JSON.parse(raw) as {
        cookies: string;
      };
      authCookies = parsed.cookies;
      log.info(`Loaded auth cookies from ${cookiePath}`);
    }

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
      downloadOnly: true,
      retryFailed: args['retry-failed'],
      skipExisting: args['skip-existing'],
      delayMs: Number(args.delay),
      concurrency: Number(args.concurrency),
      verbose: args.verbose,
      authCookies,
    });

    log.info('\nSummary:');
    log.info(`  Filings processed:      ${String(result.filingsProcessed)}`);
    log.info(
      `  Attachments downloaded: ${String(result.attachmentsDownloaded)}`,
    );
    log.info(`  Attachments failed:     ${String(result.attachmentsFailed)}`);
    log.info(
      `  Duration:               ${String(Math.round(result.durationMs / 1000))}s`,
    );
  },
});
