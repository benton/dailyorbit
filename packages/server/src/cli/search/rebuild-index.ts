import type { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import { databaseArg } from '../shared/args.ts';
import { resolveFromRoot } from '../shared/context.ts';

export const rebuildIndexCommand = defineCommand({
  meta: {
    name: 'rebuild-index',
    description:
      'Rebuild all full-text search indexes (run after data ingestion)',
  },
  args: {
    database: databaseArg,
  },
  async run({ args }) {
    const duckdb = await import('@duckdb/node-api');
    const { setDbPath, getDb } = await import('../../lib/db.ts');
    const { rebuildAllFtsIndexes } = await import('../../search/fts-index.ts');

    setDbPath(resolveFromRoot(args.database));
    const db = await getDb();
    const conn: DuckDBConnection = await duckdb.DuckDBConnection.create(db);
    try {
      console.log('Rebuilding FTS indexes...');
      const start: number = Date.now();
      await rebuildAllFtsIndexes(conn);
      const elapsed: number = Date.now() - start;
      console.log(`FTS indexes rebuilt in ${(elapsed / 1000).toFixed(1)}s`);
    } finally {
      conn.closeSync();
    }
  },
});
