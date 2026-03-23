import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureBackupTables } from './schema.ts';
import {
  insertBackupSnapshot,
  completeBackupSnapshot,
  failBackupSnapshot,
  listBackupSnapshots,
  getLatestBackupSnapshot,
  type BackupSnapshot,
} from './repository.ts';

describe('backup repository', () => {
  let conn: DuckDBConnection;

  beforeAll(async () => {
    const db: DuckDBInstance = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureBackupTables(conn);
  });

  afterAll(async () => {
    conn.closeSync();
  });

  it('inserts and completes a backup snapshot', async () => {
    const id: number = await insertBackupSnapshot(conn, 'manual');
    expect(id).toBeGreaterThan(0);

    await completeBackupSnapshot(
      conn,
      id,
      'db/20260323-1200.duckdb',
      1024 * 1024,
    );

    const snapshot: BackupSnapshot | null = await getLatestBackupSnapshot(conn);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.id).toBe(id);
    expect(snapshot!.status).toBe('completed');
    expect(snapshot!.s3_key).toBe('db/20260323-1200.duckdb');
    expect(snapshot!.size_bytes).toBe(BigInt(1024 * 1024));
    expect(snapshot!.triggered_by).toBe('manual');
    expect(snapshot!.finished_at).not.toBeNull();
  });

  it('records a failed snapshot', async () => {
    const id: number = await insertBackupSnapshot(conn, 'scheduled');
    await failBackupSnapshot(conn, id, 'S3 upload timeout');

    const snapshot: BackupSnapshot | null = await getLatestBackupSnapshot(conn);
    expect(snapshot!.status).toBe('failed');
    expect(snapshot!.error).toBe('S3 upload timeout');
  });

  it('lists snapshots in reverse chronological order', async () => {
    const snapshots: BackupSnapshot[] = await listBackupSnapshots(conn, 10);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    const timestamps: number[] = snapshots.map((s) =>
      new Date(s.started_at).getTime(),
    );
    for (let i: number = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]!);
    }
  });
});
