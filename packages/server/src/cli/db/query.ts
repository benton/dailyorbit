import { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import { trackConnection } from '../../lib/graceful-shutdown.ts';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

export const queryCommand = defineCommand({
  meta: {
    name: 'query',
    description: 'Run ad-hoc SQL against DuckDB',
  },
  args: {
    database: databaseArg,
    sql: {
      type: 'positional',
      description: 'SQL query to execute',
      required: true,
    },
  },
  async run({ args }) {
    const db = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);

    const reader = await conn.runAndReadAll(args.sql);
    const rows = reader.getRowObjectsJS();

    if (rows.length === 0) {
      getLogger().info('(no rows)');
      return;
    }

    console.table(rows);
  },
});
