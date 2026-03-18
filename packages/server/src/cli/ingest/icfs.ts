import { defineCommand } from 'citty';
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

    if (!fileNumbers && !dateFrom) {
      console.error(
        'Error: --date-from is required unless --file-numbers is provided',
      );
      process.exit(1);
    }

    const dbInstance = await createDb(args.database);
    console.log(`Database: ${args.database}`);

    const { runIcfsIngest } = await import('../../icfs/pipeline.ts');
    const result = await runIcfsIngest({
      dbInstance,
      dateFrom,
      dateTo,
      delayMs,
      concurrency,
      onProgress: (msg: string) => console.log(msg),
      ...(fileNumbers != null ? { fileNumbers } : {}),
      ...(subsystems != null ? { subsystems } : {}),
      ...(appTypes != null ? { appTypes } : {}),
    });

    console.log('\nSummary:');
    console.log(`  Filings discovered: ${String(result.filingsDiscovered)}`);
    console.log(`  Filings ingested:   ${String(result.filingsIngested)}`);
    console.log(`  Filings not found:  ${String(result.filingsNotFound)}`);
    console.log(`  Filings failed:     ${String(result.filingsFailed)}`);
    console.log(
      `  Duration:           ${String(Math.round(result.durationMs / 1000))}s`,
    );
  },
});
