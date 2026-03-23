import { createInterface } from 'node:readline';
import { defineCommand } from 'citty';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb, resolveFromRoot } from '../shared/context.ts';

export const rewindCommand = defineCommand({
  meta: {
    name: 'rewind',
    description:
      'Remove recently ingested filings and dependent rows for re-testing the pipeline',
  },
  args: {
    database: databaseArg,
    since: {
      type: 'string',
      description: 'Remove filings with _first_seen_at >= date (YYYY-MM-DD)',
    },
    last: {
      type: 'string',
      description: 'Remove the N most recently ingested filings',
    },
    full: {
      type: 'boolean',
      description:
        'Also delete embeddings and rebuild FTS index (expensive to re-derive)',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print what would be deleted but do not execute',
      default: false,
    },
    yes: {
      type: 'boolean',
      description: 'Skip confirmation prompt',
      default: false,
    },
  },
  async run({ args }) {
    const databaseUrl: string = resolveFromRoot(args.database);
    const since: string | undefined = args.since || undefined;
    const last: number | undefined = args.last
      ? Number.parseInt(args.last, 10)
      : undefined;
    const full: boolean = args.full;
    const dryRun: boolean = args['dry-run'];
    const yes: boolean = args.yes;

    const instance = await createDb(databaseUrl);
    const conn = await instance.connect();

    try {
      const { planRewind, executeRewind } =
        await import('../../test-utils/rewind.ts');

      // Plan phase: compute counts
      const plan = await planRewind(conn, { since, last, full });

      const log = getLogger();
      // Display scope and counts
      log.info(`\nRewind scope: ${plan.scope}\n`);
      printTable(log, plan.counts);

      if (!full && plan.fullCounts && plan.fullCounts.length > 0) {
        log.info('\n  --full would also delete:');
        printTable(log, plan.fullCounts);
      }

      if (dryRun) {
        log.info('\nDry run — no changes made.');
        return;
      }

      // Confirmation
      if (!yes) {
        const confirmed: boolean = await confirm('Proceed? [y/N] ');
        if (!confirmed) {
          log.info('Aborted.');
          return;
        }
      }

      // Execute
      log.info('\nDeleting...');
      const result = await executeRewind(conn, { since, last, full });

      for (const row of result.counts) {
        const countStr: string = String(row.count).padStart(6);
        log.info(`  ${row.table}: ${countStr} deleted`);
      }

      if (full && result.fullCounts) {
        for (const row of result.fullCounts) {
          const countStr: string = String(row.count).padStart(6);
          log.info(`  ${row.table}: ${countStr} deleted`);
        }

        // Rebuild FTS index
        log.info('  FTS index: rebuilding...');
        const start: number = performance.now();
        const { rebuildAllFtsIndexes } =
          await import('../../search/fts-index.ts');
        await rebuildAllFtsIndexes(conn);
        const elapsed: string = ((performance.now() - start) / 1000).toFixed(1);
        log.info(`  FTS index: rebuilt (${elapsed}s)`);

        log.info(
          "\nDone. Run './daily-orbit ingest ibfs' to re-ingest (will re-extract, re-summarize, and re-embed).",
        );
      } else {
        log.info("\nDone. Run './daily-orbit ingest ibfs' to re-ingest.");
      }
    } finally {
      conn.closeSync();
    }
  },
});

function printTable(
  log: ReturnType<typeof getLogger>,
  rows: Array<{ table: string; count: number | string }>,
): void {
  const maxName: number = Math.max(...rows.map((r) => r.table.length));
  for (const row of rows) {
    const name: string = row.table.padEnd(maxName + 2);
    const count: string =
      typeof row.count === 'number'
        ? String(row.count).padStart(8)
        : row.count.toString().padStart(8);
    log.info(`  ${name}${count}`);
  }
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}
