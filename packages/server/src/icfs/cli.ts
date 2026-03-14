import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DuckDBInstance } from '@duckdb/node-api';
import { closeAll, trackInstance } from '../lib/graceful-shutdown.ts';
import { runIcfsIngest } from './pipeline.ts';
import type { IcfsIngestResult } from './pipeline.ts';

/**
 * CLI entry point for ICFS filing ingestion.
 *
 * Usage:
 *   node packages/server/src/icfs/cli.ts [options]
 *
 * Options:
 *   --database      Path to DuckDB file (default: data/daily-orbit.duckdb)
 *   --date-from     Start month YYYY-MM (required unless --file-numbers given)
 *   --date-to       End month YYYY-MM (default: same as date-from)
 *   --subsystems    Comma-separated subsystems (default: SAT,SES)
 *   --app-types     Comma-separated app types (default: LOA,MOD,STA,AMD,T/C,ASG,LIC,RWL)
 *   --file-numbers  Comma-separated specific file numbers (skips discovery)
 *   --delay         Delay between requests in ms (default: 500)
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      database: { type: 'string', default: 'data/daily-orbit.duckdb' },
      'date-from': { type: 'string' },
      'date-to': { type: 'string' },
      subsystems: { type: 'string' },
      'app-types': { type: 'string' },
      'file-numbers': { type: 'string' },
      delay: { type: 'string', default: '500' },
    },
    strict: true,
  });

  const rootDir: string = resolve(import.meta.dirname, '../../../..');
  const databaseUrl: string = resolve(rootDir, values.database!);
  const fileNumbers: string[] | undefined = values['file-numbers']?.split(',');
  const dateFrom: string = values['date-from'] ?? '';
  const dateTo: string = values['date-to'] ?? dateFrom;
  const subsystems: string[] | undefined = values.subsystems?.split(',');
  const appTypes: string[] | undefined = values['app-types']?.split(',');
  const delayMs: number = Number(values.delay);

  if (!fileNumbers && !dateFrom) {
    console.error(
      'Error: --date-from is required unless --file-numbers is provided',
    );
    process.exit(1);
  }

  console.log(`Database: ${databaseUrl}`);
  const dbInstance: DuckDBInstance = await DuckDBInstance.create(databaseUrl);
  trackInstance(dbInstance);

  const result: IcfsIngestResult = await runIcfsIngest({
    dbInstance,
    dateFrom,
    dateTo,
    delayMs,
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

  closeAll();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('ICFS ingestion failed:', err);
  closeAll();
  process.exit(1);
});
