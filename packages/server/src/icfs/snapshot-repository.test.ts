import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import {
  computeSnapshotHash,
  ensureDiscoverySnapshotTable,
  saveSnapshot,
  getLatestSnapshot,
} from './snapshot-repository.ts';

describe('discovery snapshot repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureDiscoverySnapshotTable(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  describe('computeSnapshotHash', () => {
    const FILE_NUMBERS_A: string[] = [
      'SAT-LOA-20250101-00001',
      'SAT-LOA-20250101-00002',
      'SES-STA-20250115-00010',
    ];

    it('produces a stable SHA-256 hex digest', () => {
      const hash: string = computeSnapshotHash(FILE_NUMBERS_A);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(computeSnapshotHash(FILE_NUMBERS_A)).toEqual(hash);
    });

    it('is order-independent: same set in different order yields same hash', () => {
      const reversed: string[] = [...FILE_NUMBERS_A].reverse();
      expect(computeSnapshotHash(reversed)).toEqual(
        computeSnapshotHash(FILE_NUMBERS_A),
      );
    });

    it('deduplicates before hashing', () => {
      const withDupes: string[] = [...FILE_NUMBERS_A, FILE_NUMBERS_A[0]!];
      expect(computeSnapshotHash(withDupes)).toEqual(
        computeSnapshotHash(FILE_NUMBERS_A),
      );
    });

    it('produces different hashes for different sets', () => {
      const other: string[] = ['SAT-LOA-20250201-00099'];
      expect(computeSnapshotHash(other)).not.toEqual(
        computeSnapshotHash(FILE_NUMBERS_A),
      );
    });

    it('handles empty input', () => {
      const hash: string = computeSnapshotHash([]);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('saveSnapshot / getLatestSnapshot', () => {
    const FILE_NUMBERS: string[] = [
      'SAT-LOA-20250101-00001',
      'SES-STA-20250115-00010',
    ];
    const HASH: string = computeSnapshotHash(FILE_NUMBERS);

    it('round-trips save and load', async () => {
      const id: number = await saveSnapshot(conn, HASH, FILE_NUMBERS, 1);
      expect(id).toBeGreaterThan(0);

      const latest = await getLatestSnapshot(conn);
      expect(latest).not.toBeNull();
      expect(latest!.id).toEqual(id);
      expect(latest!.snapshot_hash).toEqual(HASH);
      expect(latest!.file_numbers).toEqual(FILE_NUMBERS);
      expect(latest!.file_count).toEqual(2);
      expect(latest!.new_count).toEqual(1);
      expect(latest!.pipeline_run_id).toBeNull();
      expect(latest!.created_at).toBeTruthy();
    });

    it('getLatestSnapshot returns the most recent snapshot', async () => {
      const otherFileNumbers: string[] = ['SAT-MOD-20250301-00050'];
      const otherHash: string = computeSnapshotHash(otherFileNumbers);
      const id2: number = await saveSnapshot(
        conn,
        otherHash,
        otherFileNumbers,
        1,
        42,
      );

      const latest = await getLatestSnapshot(conn);
      expect(latest!.id).toEqual(id2);
      expect(latest!.snapshot_hash).toEqual(otherHash);
      expect(latest!.pipeline_run_id).toEqual(42);
    });

    it('returns null when no snapshots exist', async () => {
      const freshConn: DuckDBConnection = await DuckDBConnection.create(db);
      // Drop and recreate to get an empty table
      await freshConn.run('DELETE FROM discovery_snapshot');
      const latest = await getLatestSnapshot(freshConn);
      expect(latest).toBeNull();
      freshConn.closeSync();
    });
  });
});
