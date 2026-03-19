import { defineCommand } from 'citty';
import { DuckDBConnection } from '@duckdb/node-api';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

const seedCommand = defineCommand({
  meta: {
    name: 'seed',
    description: 'Seed default consultants (idempotent)',
  },
  args: {
    database: databaseArg,
  },
  async run({ args }) {
    const db = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);

    try {
      const { ensureConsultantTables } = await import(
        '../../consultant/schema.ts'
      );
      await ensureConsultantTables(conn);

      const { seedConsultants } = await import('../../consultant/seed.ts');
      const result = await seedConsultants(conn);

      console.log(
        `Seed complete: ${String(result.created)} created, ${String(result.skipped)} skipped (already exist)`,
      );
    } finally {
      conn.closeSync();
    }
  },
});

export const consultantCommand = defineCommand({
  meta: {
    name: 'consultant',
    description: 'Manage consultant personas',
  },
  subCommands: {
    seed: seedCommand,
  },
});
