import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import { trackConnection } from '../../lib/graceful-shutdown.ts';
import { databaseArg, storagePathArg } from '../shared/args.ts';
import { createDb, resolveFromRoot } from '../shared/context.ts';

export const resetCommand = defineCommand({
  meta: {
    name: 'reset',
    description: 'Delete attachment files and reset DB status to pending',
  },
  args: {
    database: databaseArg,
    'storage-path': storagePathArg,
  },
  async run({ args }) {
    const storagePath: string = resolveFromRoot(args['storage-path']);

    // Step 1: Delete local attachment files
    if (existsSync(storagePath)) {
      console.log(`Deleting ${storagePath}/ ...`);
      execFileSync('rm', ['-rf', storagePath]);
      console.log('Done.');
    } else {
      console.log(`${storagePath}/ does not exist — skipping file deletion.`);
    }

    // Step 2: Reset download status in database
    const db = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);

    const countReader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM attachment WHERE download_status IN ('downloaded', 'failed')`,
    );
    const count: number = Number(countReader.getRowObjectsJS()[0]!.cnt);
    console.log(`Resetting ${String(count)} attachment rows to pending ...`);

    await conn.run(`
      UPDATE attachment
      SET download_status = 'pending',
          local_path = NULL,
          file_size_bytes = NULL,
          content_type = NULL,
          downloaded_at = NULL
      WHERE download_status IN ('downloaded', 'failed')
    `);

    console.log('Done. All attachments reset to pending.');
  },
});
