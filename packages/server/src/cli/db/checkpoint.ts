import { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import { trackConnection } from '../../lib/graceful-shutdown.ts';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

export const checkpointCommand = defineCommand({
  meta: {
    name: 'checkpoint',
    description:
      'Force a WAL checkpoint to fold pending writes into the main database file',
  },
  args: {
    database: databaseArg,
  },
  async run({ args }) {
    const db = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);

    await conn.run('CHECKPOINT');
    getLogger().info('Checkpoint complete');
  },
});
