#!/usr/bin/env node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm

/**
 * Reset all attachment downloads: delete local files and mark rows as pending.
 * Usage: node --no-warnings packages/server/src/attachments/reset-downloads.ts [--db <path>] [--storage <path>]
 */

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  closeAll,
  trackConnection,
  trackInstance,
} from '../lib/graceful-shutdown.ts';

const args: string[] = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  const idx: number = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1]!;
  }
  return fallback;
}

const databasePath: string = getArg('--db', 'data/daily-orbit.duckdb');
const storagePath: string = getArg('--storage', 'data/attachments');

async function main(): Promise<void> {
  // Step 1: Delete local attachment files
  if (existsSync(storagePath)) {
    console.log(`Deleting ${storagePath}/ ...`);
    execFileSync('rm', ['-rf', storagePath]);
    console.log('Done.');
  } else {
    console.log(`${storagePath}/ does not exist — skipping file deletion.`);
  }

  // Step 2: Reset download status in database
  console.log(`Connecting to ${databasePath} ...`);
  const db: DuckDBInstance = await DuckDBInstance.create(databasePath);
  trackInstance(db);
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
  closeAll();
}

main().catch((err: unknown) => {
  console.error(err);
  closeAll();
  process.exit(1);
});
