import { defineCommand } from 'citty';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

export const icfsCommand = defineCommand({
  meta: {
    name: 'icfs',
    description: 'Ingest filings from the ICFS ServiceNow API',
  },
  args: {
    database: databaseArg,
    'date-from': {
      type: 'string',
      description: 'Start month YYYY-MM (required unless --file-numbers given)',
    },
    'date-to': {
      type: 'string',
      description: 'End month YYYY-MM (default: same as date-from)',
    },
    subsystems: {
      type: 'string',
      description:
        'Comma-separated subsystem codes to query (default: SAT,SES,ITC). Use empty string to disable defaults.',
    },
    'app-types': {
      type: 'string',
      description:
        'Comma-separated application types (overrides defaults for all specified subsystems)',
    },
    'file-numbers': {
      type: 'string',
      description: 'Comma-separated specific file numbers (skips discovery)',
    },
    delay: {
      type: 'string',
      description: 'Delay between requests in ms',
      default: '500',
    },
    concurrency: {
      type: 'string',
      description: 'Number of concurrent HTTP requests',
      default: '20',
    },
  },
  async run({ args }) {
    const fileNumbers: string[] | undefined = args['file-numbers']?.split(',');
    const dateFrom: string = args['date-from'] ?? '';
    const dateTo: string = args['date-to'] ?? dateFrom;
    const subsystems: string[] | undefined = (
      args.subsystems as string | undefined
    )
      ?.split(',')
      .filter(Boolean);
    const appTypes: string[] | undefined = (
      args['app-types'] as string | undefined
    )
      ?.split(',')
      .filter(Boolean);
    const delayMs: number = Number(args.delay);
    const concurrency: number = Number(args.concurrency);

    const log = getLogger();
    if (!fileNumbers && !dateFrom) {
      log.error(
        'Error: --date-from is required unless --file-numbers is provided',
      );
      process.exit(1);
    }

    const { runIcfsIngest, DEFAULT_SUBSYSTEM_APP_TYPES } =
      await import('../../icfs/pipeline.ts');

    // Build per-subsystem app type overrides from CLI args
    let subsystemAppTypes: Record<string, string[]> | undefined;
    if (subsystems != null || appTypes != null) {
      const subs: string[] =
        subsystems ?? Object.keys(DEFAULT_SUBSYSTEM_APP_TYPES);
      subsystemAppTypes = {};
      for (const sub of subs) {
        subsystemAppTypes[sub] =
          appTypes ?? DEFAULT_SUBSYSTEM_APP_TYPES[sub] ?? [];
      }
    }

    const dbInstance = await createDb(args.database);
    log.info(`Database: ${args.database}`);
    const result = await runIcfsIngest({
      dbInstance,
      dateFrom,
      dateTo,
      delayMs,
      concurrency,
      onProgress: (msg: string) => log.info(msg),
      ...(fileNumbers != null ? { fileNumbers } : {}),
      ...(subsystemAppTypes != null ? { subsystemAppTypes } : {}),
    });

    log.info('\nSummary:');
    log.info(`  Filings discovered: ${String(result.filingsDiscovered)}`);
    log.info(`  Filings ingested:   ${String(result.filingsIngested)}`);
    log.info(`  Filings not found:  ${String(result.filingsNotFound)}`);
    log.info(`  Filings failed:     ${String(result.filingsFailed)}`);
    log.info(
      `  Duration:           ${String(Math.round(result.durationMs / 1000))}s`,
    );
  },
});
