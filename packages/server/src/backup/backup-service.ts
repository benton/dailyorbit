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
import { runParquetExport } from './parquet-export-service.ts';

export type ParquetExportConfig = {
  bucket: string;
  region: string;
  prefix: string;
};

export type BackupServiceConfig = {
  conn: DuckDBConnection;
  uploader: S3Uploader;
  dbPath: string;
  snapshotPrefix: string;
  /**
   * Max number of timestamped snapshots to keep in S3. Older ones are deleted
   * after each successful upload. Omit to skip pruning.
   */
  retentionCount?: number;
  /** If set, run a Parquet DR export after each successful snapshot. */
  parquetExport?: ParquetExportConfig;
};

export type BackupService = {
  runBackup: (triggeredBy: string) => Promise<void>;
  isRunning: () => boolean;
};

export function createBackupService(
  config: BackupServiceConfig,
): BackupService {
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
      await config.conn.run('FORCE CHECKPOINT');

      // 2. Copy DB file to temp location (async to avoid blocking event loop)
      log.info('[backup] Copying database file...');
      await copyFile(config.dbPath, snapPath);
      const snapStat = await stat(snapPath);

      // 3. Upload timestamped snapshot
      log.info(`[backup] Uploading ${s3Key} (${snapStat.size} bytes)...`);
      await config.uploader.upload(snapPath, s3Key);

      // 4. Upload encryption key if it exists
      const keyPath: string = config.dbPath.replace('.duckdb', '.key');
      try {
        statSync(keyPath);
        await config.uploader.upload(keyPath, 'daily-orbit.key');
      } catch {
        // Key file doesn't exist — skip
      }

      // 5. Clean up temp file
      await unlink(snapPath);

      // 6. Record success
      const fullS3Key: string = `${config.snapshotPrefix}${s3Key}`;
      await completeBackupSnapshot(config.conn, id, fullS3Key, snapStat.size);
      log.info(`[backup] Snapshot ${s3Key} uploaded successfully`);

      // 7. Prune older snapshots (non-fatal — snapshot already succeeded)
      if (config.retentionCount != null && config.retentionCount > 0) {
        try {
          const all = await config.uploader.listSnapshots();
          const toDelete = all.slice(config.retentionCount);
          for (const entry of toDelete) {
            await config.uploader.deleteObject(entry.key);
            log.info(`[backup] Pruned old snapshot ${entry.key}`);
          }
        } catch (pruneErr: unknown) {
          const pruneMsg =
            pruneErr instanceof Error ? pruneErr.message : String(pruneErr);
          log.error(
            `[backup] Snapshot prune failed (snapshot still succeeded): ${pruneMsg}`,
          );
        }
      }

      // 8. Parquet DR export (non-fatal — snapshot already succeeded)
      if (config.parquetExport != null) {
        try {
          const result = await runParquetExport(
            config.conn,
            config.parquetExport,
          );
          log.info(
            `[backup] Parquet export complete (${String(result.tablesExported)} tables)`,
          );
        } catch (parquetErr: unknown) {
          const parquetMsg =
            parquetErr instanceof Error
              ? parquetErr.message
              : String(parquetErr);
          log.error(
            `[backup] Parquet export failed (snapshot still succeeded): ${parquetMsg}`,
          );
        }
      }
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
