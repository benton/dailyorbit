import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runIngest } from './pipeline.ts';

/**
 * CLI entry point for the data ingest pipeline.
 *
 * Usage:
 *   node src/ingest/cli.ts [options]
 *
 * Options:
 *   --database   Path to DuckDB file (default: data/daily-orbit.duckdb)
 *   --ddl        Path to Sybase DDL file (default: tmp/ibfs-schema.txt)
 *   --dat-dir    Path to extracted .dat files (default: tmp/IBFS)
 *   --tables     Comma-separated list of tables to load (default: all)
 *   --dry-run    Parse and validate only, no DB writes
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      database: { type: 'string', default: 'data/daily-orbit.duckdb' },
      ddl: { type: 'string', default: 'tmp/ibfs-schema.txt' },
      'dat-dir': { type: 'string', default: 'tmp/IBFS' },
      tables: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  });

  const rootDir: string = resolve(import.meta.dirname, '../../../..');
  const databaseUrl: string = resolve(rootDir, values.database!);
  const ddlPath: string = resolve(rootDir, values.ddl!);
  const datDir: string = resolve(rootDir, values['dat-dir']!);
  const tables: string[] | undefined = values.tables?.split(',');
  const dryRun: boolean = values['dry-run'] ?? false;

  const result = await runIngest({
    databaseUrl,
    ddlPath,
    datDir,
    tables,
    dryRun,
  });

  if (result.tablesSkipped.length > 0) {
    console.log(`Skipped tables: ${result.tablesSkipped.join(', ')}`);
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
