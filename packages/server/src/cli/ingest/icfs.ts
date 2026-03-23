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
      description: 'Comma-separated subsystem codes (default: SAT,SES)',
    },
    'app-types': {
      type: 'string',
      description: 'Comma-separated application types',
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
    const subsystems: string[] | undefined = args.subsystems?.split(',');
    const appTypes: string[] | undefined = args['app-types']?.split(',');
    const delayMs: number = Number(args.delay);
    const concurrency: number = Number(args.concurrency);

    const log = getLogger();
    if (!fileNumbers && !dateFrom) {
      log.error(
        'Error: --date-from is required unless --file-numbers is provided',
      );
      process.exit(1);
    }

    const dbInstance = await createDb(args.database);
    log.info(`Database: ${args.database}`);

    const { runIcfsIngest } = await import('../../icfs/pipeline.ts');
    const result = await runIcfsIngest({
      dbInstance,
      dateFrom,
      dateTo,
      delayMs,
      concurrency,
      onProgress: (msg: string) => log.info(msg),
      ...(fileNumbers != null ? { fileNumbers } : {}),
      ...(subsystems != null ? { subsystems } : {}),
      ...(appTypes != null ? { appTypes } : {}),
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
