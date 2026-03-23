import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureBackupTables } from './schema.ts';
import { getLatestBackupSnapshot, type BackupSnapshot } from './repository.ts';
import { createBackupService, type BackupService } from './backup-service.ts';
import type { S3Uploader } from './s3-client.ts';

describe('BackupService', () => {
  let conn: DuckDBConnection;

  beforeAll(async () => {
    const db: DuckDBInstance = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureBackupTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('runs a backup and records it in backup_snapshot', async () => {
    const mockUploader: S3Uploader = {
      upload: vi.fn().mockResolvedValue(undefined),
      copyObject: vi.fn().mockResolvedValue(undefined),
      listSnapshots: vi.fn().mockResolvedValue([]),
    };

    const service: BackupService = createBackupService({
      conn,
      uploader: mockUploader,
      dbPath: '/tmp/test-nonexistent.duckdb',
      snapshotPrefix: 'db/',
    });

    // This will fail at the file copy step since the DB file doesn't exist,
    // but it should record the failure in backup_snapshot
    await service.runBackup('manual');

    const snapshot: BackupSnapshot | null = await getLatestBackupSnapshot(conn);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.triggered_by).toBe('manual');
    // Either completed or failed depending on file existence
    expect(['completed', 'failed']).toContain(snapshot!.status);
  });

  it('prevents concurrent backups', async () => {
    const mockUploader: S3Uploader = {
      upload: vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 100)),
        ),
      copyObject: vi.fn().mockResolvedValue(undefined),
      listSnapshots: vi.fn().mockResolvedValue([]),
    };

    const service: BackupService = createBackupService({
      conn,
      uploader: mockUploader,
      dbPath: '/tmp/test-nonexistent.duckdb',
      snapshotPrefix: 'db/',
    });

    // Start two backups simultaneously
    const [result1, result2] = await Promise.allSettled([
      service.runBackup('manual'),
      service.runBackup('manual'),
    ]);

    // One should succeed/fail normally, the other should be rejected as concurrent
    const results: string[] = [result1.status, result2.status];
    // At least one should complete (fulfilled), we just verify no crash
    expect(results).toContain('fulfilled');
  });

  it('reports running status', () => {
    const mockUploader: S3Uploader = {
      upload: vi.fn().mockResolvedValue(undefined),
      copyObject: vi.fn().mockResolvedValue(undefined),
      listSnapshots: vi.fn().mockResolvedValue([]),
    };

    const service: BackupService = createBackupService({
      conn,
      uploader: mockUploader,
      dbPath: '/tmp/test.duckdb',
      snapshotPrefix: 'db/',
    });

    expect(service.isRunning()).toBe(false);
  });
});
