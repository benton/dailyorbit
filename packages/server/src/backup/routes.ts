import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb, getDbPath } from '../lib/db.ts';
import { getConfigService } from '../lib/config.ts';
import { ensureBackupTables } from './schema.ts';
import {
  listBackupSnapshots,
  getLatestBackupSnapshot,
  type BackupSnapshot,
} from './repository.ts';
import { createBackupService, type BackupService } from './backup-service.ts';
import { createS3Uploader } from './s3-client.ts';

/** Convert bigint fields to number for JSON serialization */
function toJsonSafe(snapshot: BackupSnapshot): Record<string, unknown> {
  return {
    ...snapshot,
    size_bytes:
      snapshot.size_bytes != null ? Number(snapshot.size_bytes) : null,
  };
}

let backupService: BackupService | null = null;

async function getBackupService(): Promise<BackupService> {
  if (backupService != null) {
    return backupService;
  }

  const config = getConfigService();
  const bucket: string = String(config.get('snapshotBucket'));
  const prefix: string = String(config.get('snapshotPrefix'));
  const region: string = String(config.get('snapshotRegion'));

  if (!bucket) {
    throw new Error('snapshotBucket config is not set');
  }

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await ensureBackupTables(conn);

  const uploader = createS3Uploader({ bucket, prefix, region });
  const dbPath: string = getDbPath();

  backupService = createBackupService({
    conn,
    uploader,
    dbPath,
    snapshotPrefix: prefix,
  });
  return backupService;
}

const backupRoutes = new Hono();

// GET /api/admin/backups — list recent backup snapshots
backupRoutes.get('/', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await ensureBackupTables(conn);
  const limit: number = Number(c.req.query('limit') ?? '20');
  const snapshots: BackupSnapshot[] = await listBackupSnapshots(conn, limit);
  conn.closeSync();
  return c.json(snapshots.map(toJsonSafe));
});

// GET /api/admin/backups/latest — get the most recent backup
backupRoutes.get('/latest', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await ensureBackupTables(conn);
  const snapshot: BackupSnapshot | null = await getLatestBackupSnapshot(conn);
  conn.closeSync();
  if (snapshot == null) {
    return c.json({ message: 'No backups found' }, 404);
  }
  return c.json(toJsonSafe(snapshot));
});

// GET /api/admin/backups/status — is a backup currently running?
backupRoutes.get('/status', async (c) => {
  try {
    const service: BackupService = await getBackupService();
    return c.json({ running: service.isRunning() });
  } catch {
    return c.json({ running: false, configured: false });
  }
});

// POST /api/admin/backups/trigger — trigger a manual backup
backupRoutes.post('/trigger', async (c) => {
  try {
    const service: BackupService = await getBackupService();
    if (service.isRunning()) {
      return c.json({ error: 'A backup is already in progress' }, 409);
    }

    // Run backup in background so we return immediately
    void service.runBackup('manual');

    return c.json({ message: 'Backup started' }, 202);
  } catch (err: unknown) {
    const msg: string = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

export { backupRoutes, getBackupService };
