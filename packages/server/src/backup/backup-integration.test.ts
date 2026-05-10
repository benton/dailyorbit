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
    try {
      unlinkSync(tmpDb);
    } catch {
      /* ignore */
    }
  });

  it('runs a full backup cycle: checkpoint -> copy -> upload -> record', async () => {
    const uploads: Array<{ localPath: string; s3Key: string }> = [];
    const mockUploader: S3Uploader = {
      upload: vi
        .fn()
        .mockImplementation(async (localPath: string, s3Key: string) => {
          uploads.push({ localPath, s3Key });
        }),
      copyObject: vi.fn().mockResolvedValue(undefined),
      listSnapshots: vi.fn().mockResolvedValue([]),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };

    const service: BackupService = createBackupService({
      conn,
      uploader: mockUploader,
      dbPath: tmpDb,
      snapshotPrefix: 'db/',
    });

    await service.runBackup('test');

    // Should have uploaded timestamped snapshot only (no latest.duckdb copy)
    expect(uploads.length).toBe(1);
    expect(uploads[0]!.s3Key).toMatch(/^\d{8}-\d{4}\.duckdb$/);
    expect(mockUploader.copyObject).not.toHaveBeenCalled();

    // Should have recorded in backup_snapshot table
    const snapshots: BackupSnapshot[] = await listBackupSnapshots(conn, 1);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.status).toBe('completed');
    expect(snapshots[0]!.triggered_by).toBe('test');
    expect(snapshots[0]!.size_bytes).toBeGreaterThan(0);

    // Temp snap file should be cleaned up
    expect(existsSync(`${tmpDb}.snap`)).toBe(false);
  });

  it('prunes snapshots beyond retentionCount after a successful upload', async () => {
    // listSnapshots returns 5 entries, newest first (matching prod sort order)
    const snapshots = [
      {
        key: 'db/20260510-1400.duckdb',
        lastModified: new Date(5),
        sizeBytes: 1,
      },
      {
        key: 'db/20260510-1200.duckdb',
        lastModified: new Date(4),
        sizeBytes: 1,
      },
      {
        key: 'db/20260510-1000.duckdb',
        lastModified: new Date(3),
        sizeBytes: 1,
      },
      {
        key: 'db/20260510-0800.duckdb',
        lastModified: new Date(2),
        sizeBytes: 1,
      },
      {
        key: 'db/20260510-0600.duckdb',
        lastModified: new Date(1),
        sizeBytes: 1,
      },
    ];
    const mockUploader: S3Uploader = {
      upload: vi.fn().mockResolvedValue(undefined),
      copyObject: vi.fn().mockResolvedValue(undefined),
      listSnapshots: vi.fn().mockResolvedValue(snapshots),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };

    const service: BackupService = createBackupService({
      conn,
      uploader: mockUploader,
      dbPath: tmpDb,
      snapshotPrefix: 'db/',
      retentionCount: 2,
    });

    await service.runBackup('test');

    // 5 existing - 2 retained = 3 deleted (oldest first)
    expect(mockUploader.deleteObject).toHaveBeenCalledTimes(3);
    expect(mockUploader.deleteObject).toHaveBeenCalledWith(
      'db/20260510-1000.duckdb',
    );
    expect(mockUploader.deleteObject).toHaveBeenCalledWith(
      'db/20260510-0800.duckdb',
    );
    expect(mockUploader.deleteObject).toHaveBeenCalledWith(
      'db/20260510-0600.duckdb',
    );
  });
});
