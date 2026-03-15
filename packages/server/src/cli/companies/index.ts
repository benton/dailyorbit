import { defineCommand } from 'citty';
import { DuckDBConnection } from '@duckdb/node-api';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

export const companiesCommand = defineCommand({
  meta: {
    name: 'companies',
    description: 'Company entity management and attribution',
  },
  subCommands: {
    seed: defineCommand({
      meta: {
        name: 'seed',
        description:
          'Seed company data from built-in satellite industry dataset',
      },
      args: { database: databaseArg },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureCompanyTables, ensureCompanyFk } =
            await import('../../companies/schema.ts');
          await ensureCompanyTables(conn);
          await ensureCompanyFk(conn);

          const { seedCompanies } =
            await import('../../companies/attribution.ts');
          const { COMPANY_SEED_DATA } =
            await import('../../companies/seed-data.ts');
          const result = await seedCompanies(conn, COMPANY_SEED_DATA);

          console.log('Seed complete:');
          console.log(`  Companies created: ${String(result.created)}`);
          console.log(`  Aliases added:     ${String(result.aliasesAdded)}`);
        } finally {
          conn.closeSync();
        }
      },
    }),

    attribute: defineCommand({
      meta: {
        name: 'attribute',
        description: 'Run batch attribution of filings to companies',
      },
      args: { database: databaseArg },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureCompanyTables, ensureCompanyFk } =
            await import('../../companies/schema.ts');
          await ensureCompanyTables(conn);
          await ensureCompanyFk(conn);

          const { runBatchAttribution } =
            await import('../../companies/attribution.ts');
          const result = await runBatchAttribution(conn, (processed, total) => {
            const pct: string = ((processed / total) * 100).toFixed(1);
            process.stdout.write(
              `\rProcessing: ${String(processed)} / ${String(total)} (${pct}%)`,
            );
          });
          process.stdout.write('\n');

          console.log('Attribution complete:');
          console.log(`  Filings attributed: ${String(result.attributed)}`);
          console.log(`  Filings skipped:    ${String(result.skipped)}`);
        } finally {
          conn.closeSync();
        }
      },
    }),

    stats: defineCommand({
      meta: {
        name: 'stats',
        description: 'Show company attribution coverage statistics',
      },
      args: { database: databaseArg },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureCompanyFk } = await import('../../companies/schema.ts');
          await ensureCompanyFk(conn);

          const { getAttributionStats } =
            await import('../../companies/repository.ts');
          const stats = await getAttributionStats(conn);

          console.log('Attribution Stats:');
          console.log(`  Total filings:       ${String(stats.totalFilings)}`);
          console.log(
            `  Attributed:          ${String(stats.attributedFilings)}`,
          );
          console.log(
            `  Unattributed:        ${String(stats.unattributedFilings)}`,
          );
          console.log(
            `  Coverage:            ${String(stats.coveragePercent)}%`,
          );

          if (stats.topUnattributedNames.length > 0) {
            console.log('\nTop unattributed applicant names:');
            for (const entry of stats.topUnattributedNames) {
              console.log(`  ${String(entry.count).padStart(6)} ${entry.name}`);
            }
          }
        } finally {
          conn.closeSync();
        }
      },
    }),

    'extract-ownership': defineCommand({
      meta: {
        name: 'extract-ownership',
        description: 'Extract ownership events from T/C and ASG filings',
      },
      args: { database: databaseArg },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureCompanyTables, ensureCompanyFk } =
            await import('../../companies/schema.ts');
          await ensureCompanyTables(conn);
          await ensureCompanyFk(conn);

          const { extractOwnershipEvents } =
            await import('../../companies/repository.ts');
          const result = await extractOwnershipEvents(
            conn,
            (processed, total) => {
              const pct: string = ((processed / total) * 100).toFixed(1);
              process.stdout.write(
                `\rProcessing: ${String(processed)} / ${String(total)} (${pct}%)`,
              );
            },
          );
          process.stdout.write('\n');

          console.log('Ownership event extraction complete:');
          console.log(`  Events created: ${String(result.created)}`);
          console.log(
            `  Filings skipped (no party match): ${String(result.skipped)}`,
          );
        } finally {
          conn.closeSync();
        }
      },
    }),

    enrich: defineCommand({
      meta: {
        name: 'enrich',
        description: 'Enrich company data from GLEIF and Wikidata',
      },
      args: { database: databaseArg },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { enrichAllCompanies } =
            await import('../../enrichment/pipeline.ts');
          const result = await enrichAllCompanies(
            conn,
            (processed: number, total: number) => {
              const pct: string = ((processed / total) * 100).toFixed(1);
              process.stdout.write(
                `\rEnriching: ${String(processed)} / ${String(total)} (${pct}%)`,
              );
            },
          );
          process.stdout.write('\n');

          console.log('Enrichment complete:');
          console.log(`  Companies enriched: ${String(result.enriched)}`);
          console.log(`  Companies skipped:  ${String(result.skipped)}`);
          console.log(`  Errors:             ${String(result.errors)}`);
        } finally {
          conn.closeSync();
        }
      },
    }),
  },
});
