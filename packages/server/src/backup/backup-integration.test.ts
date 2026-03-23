import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureBackupTables } from './schema.ts';
import { createBackupService, type BackupService } from './backup-service.ts';
import { listBackupSnapshots, type BackupSnapshot } from './repository.ts';
import type { S3Uploader } from './s3-client.ts';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('backup integration', () => {
  let conn: DuckDBConnection;
  const tmpDb: string = join(tmpdir(), `test-backup-${Date.now()}.duckdb`);

  beforeAll(async () => {
    // Write a fake DB file so copy succeeds
    writeFileSync(tmpDb, 'fake-db-content');

    const db: DuckDBInstance = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureBackupTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
    try { unlinkSync(tmpDb); } catch { /* ignore */ }
  });

  it('runs a full backup cycle: checkpoint -> copy -> upload -> record', async () => {
    const uploads: Array<{ localPath: string; s3Key: string }> = [];
    const mockUploader: S3Uploader = {
      upload: vi.fn().mockImplementation(
        async (localPath: string, s3Key: string) => {
          uploads.push({ localPath, s3Key });
        },
      ),
      listSnapshots: vi.fn().mockResolvedValue([]),
    };

    const service: BackupService = createBackupService({
      conn,
      uploader: mockUploader,
      dbPath: tmpDb,
      snapshotPrefix: 'db/',
    });

    await service.runBackup('test');

    // Should have uploaded timestamped + latest (no key file exists so just 2)
    expect(uploads.length).toBe(2);
    expect(uploads[0]!.s3Key).toMatch(/^\d{8}-\d{4}\.duckdb$/);
    expect(uploads[1]!.s3Key).toBe('latest.duckdb');

    // Should have recorded in backup_snapshot table
    const snapshots: BackupSnapshot[] = await listBackupSnapshots(conn, 1);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.status).toBe('completed');
    expect(snapshots[0]!.triggered_by).toBe('test');
    expect(snapshots[0]!.size_bytes).toBeGreaterThan(0);

    // Temp snap file should be cleaned up
    expect(existsSync(`${tmpDb}.snap`)).toBe(false);
  });
});
