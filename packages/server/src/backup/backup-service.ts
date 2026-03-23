import type { DuckDBConnection } from '@duckdb/node-api';
import { copyFile, stat, unlink } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { getLogger } from '../lib/logger.ts';
import {
  insertBackupSnapshot,
  completeBackupSnapshot,
  failBackupSnapshot,
} from './repository.ts';
import type { S3Uploader } from './s3-client.ts';

export type BackupServiceConfig = {
  conn: DuckDBConnection;
  uploader: S3Uploader;
  dbPath: string;
  snapshotPrefix: string;
};

export type BackupService = {
  runBackup: (triggeredBy: string) => Promise<void>;
  isRunning: () => boolean;
};

export function createBackupService(config: BackupServiceConfig): BackupService {
  const log = getLogger();
  let running: boolean = false;

  async function runBackup(triggeredBy: string): Promise<void> {
    if (running) {
      throw new Error('A backup is already in progress');
    }

    running = true;
    const id: number = await insertBackupSnapshot(config.conn, triggeredBy);
    const timestamp: string = formatTimestamp(new Date());
    const s3Key: string = `${timestamp}.duckdb`;
    const snapPath: string = `${config.dbPath}.snap`;

    try {
      // 1. Checkpoint WAL into main file
      log.info('[backup] Checkpointing WAL...');
      await config.conn.run('CHECKPOINT');

      // 2. Copy DB file to temp location (async to avoid blocking event loop)
      log.info('[backup] Copying database file...');
      await copyFile(config.dbPath, snapPath);
      const snapStat = await stat(snapPath);

      // 3. Upload timestamped snapshot
      log.info(`[backup] Uploading ${s3Key} (${snapStat.size} bytes)...`);
      await config.uploader.upload(snapPath, s3Key);

      // 4. Server-side copy to latest.duckdb (no re-upload)
      log.info('[backup] Copying to latest.duckdb (server-side)...');
      await config.uploader.copyObject(s3Key, 'latest.duckdb');

      // 5. Upload encryption key if it exists
      const keyPath: string = config.dbPath.replace('.duckdb', '.key');
      try {
        statSync(keyPath);
        await config.uploader.upload(keyPath, 'daily-orbit.key');
      } catch {
        // Key file doesn't exist — skip
      }

      // 6. Clean up temp file
      await unlink(snapPath);

      // 7. Record success
      const fullS3Key: string = `${config.snapshotPrefix}${s3Key}`;
      await completeBackupSnapshot(config.conn, id, fullS3Key, snapStat.size);
      log.info(`[backup] Snapshot ${s3Key} uploaded successfully`);
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      log.error(`[backup] Snapshot failed: ${msg}`);
      await failBackupSnapshot(config.conn, id, msg);
      // Clean up temp file if it exists
      try {
        await unlink(snapPath);
      } catch {
        // ignore
      }
    } finally {
      running = false;
    }
  }

  function isRunning(): boolean {
    return running;
  }

  return { runBackup, isRunning };
}

function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
  );
}
