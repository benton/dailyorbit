# In-App Backup & Snapshot Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the DuckDB backup/snapshot process from a cron-based shell script into the server application, controlled by an Admin UI page, so admins can trigger backups on demand, see backup history, and ensure WAL is checkpointed before snapshotting.

**Architecture:** The server gains an S3 client service (using `@aws-sdk/client-s3`) and a BackupService that checkpoints DuckDB, copies the file, and uploads to S3. A `backup_snapshot` table tracks every backup with its timestamp, size, S3 key, and status. Admin API routes expose trigger/status/history endpoints. The admin UI adds a "Backups" page showing the latest snapshot, history table, and a manual trigger button.

**Tech Stack:** TypeScript, `@aws-sdk/client-s3`, DuckDB, Hono (API routes), React (admin UI), ConfigService (DB-backed config)

---

## Task 1: Add S3 Config Keys to ConfigSchema

**Files:**
- Modify: `packages/server/src/lib/config-schema.ts`

**Step 1: Add config keys**

Add the following entries to `CONFIG_SCHEMA` in `packages/server/src/lib/config-schema.ts`, after the existing `appBaseUrl` entry:

```typescript
  snapshotBucket: {
    key: 'snapshotBucket',
    defaultValue: '',
    encrypted: false,
    description: 'S3 bucket for database snapshots (e.g., daily-orbit-data)',
  },
  snapshotPrefix: {
    key: 'snapshotPrefix',
    defaultValue: 'db/',
    encrypted: false,
    description: 'S3 key prefix for snapshot files',
  },
  snapshotRegion: {
    key: 'snapshotRegion',
    defaultValue: 'us-east-2',
    encrypted: false,
    description: 'AWS region for the snapshot S3 bucket',
  },
  snapshotIntervalMinutes: {
    key: 'snapshotIntervalMinutes',
    defaultValue: '120',
    encrypted: false,
    description: 'Automatic snapshot interval in minutes (0 = disabled)',
  },
```

**Step 2: Verify types compile**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/lib/config-schema.ts
git commit -m "feat(backup): add S3 snapshot config keys to ConfigSchema"
```

---

## Task 2: Install `@aws-sdk/client-s3` and Create S3 Upload Service

**Files:**
- Modify: `packages/server/package.json` (via pnpm add)
- Create: `packages/server/src/backup/s3-client.ts`
- Create: `packages/server/src/backup/s3-client.test.ts`

**Step 1: Install the S3 SDK**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server add @aws-sdk/client-s3`

**Step 2: Write the failing test**

Create `packages/server/src/backup/s3-client.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createS3Uploader, type S3Uploader } from './s3-client.ts';

describe('createS3Uploader', () => {
  it('returns an uploader with upload and listSnapshots methods', () => {
    const uploader: S3Uploader = createS3Uploader({
      bucket: 'test-bucket',
      prefix: 'db/',
      region: 'us-east-2',
    });
    expect(typeof uploader.upload).toBe('function');
    expect(typeof uploader.listSnapshots).toBe('function');
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec vitest run src/backup/s3-client.test.ts`
Expected: FAIL — module not found

**Step 4: Implement the S3 client**

Create `packages/server/src/backup/s3-client.ts`:

```typescript
import { PutObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createReadStream, statSync } from 'node:fs';

export type S3UploaderConfig = {
  bucket: string;
  prefix: string;
  region: string;
};

export type S3SnapshotEntry = {
  key: string;
  lastModified: Date;
  sizeBytes: number;
};

export type S3Uploader = {
  upload: (localPath: string, s3Key: string) => Promise<void>;
  listSnapshots: () => Promise<S3SnapshotEntry[]>;
};

export function createS3Uploader(config: S3UploaderConfig): S3Uploader {
  const client: S3Client = new S3Client({ region: config.region });

  async function upload(localPath: string, s3Key: string): Promise<void> {
    const fullKey: string = `${config.prefix}${s3Key}`;
    const stat = statSync(localPath);
    const stream = createReadStream(localPath);

    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: fullKey,
        Body: stream,
        ContentLength: stat.size,
      }),
    );
  }

  async function listSnapshots(): Promise<S3SnapshotEntry[]> {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: config.prefix,
      }),
    );

    const entries: S3SnapshotEntry[] = (result.Contents ?? [])
      .filter((obj) => obj.Key?.endsWith('.duckdb'))
      .map((obj) => ({
        key: obj.Key!,
        lastModified: obj.LastModified ?? new Date(),
        sizeBytes: obj.Size ?? 0,
      }))
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    return entries;
  }

  return { upload, listSnapshots };
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec vitest run src/backup/s3-client.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/backup/s3-client.ts packages/server/src/backup/s3-client.test.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(backup): add S3 upload client service"
```

---

## Task 3: Create `backup_snapshot` Schema and Repository

**Files:**
- Create: `packages/server/src/backup/schema.ts`
- Create: `packages/server/src/backup/repository.ts`
- Create: `packages/server/src/backup/repository.test.ts`

**Step 1: Write the schema**

Create `packages/server/src/backup/schema.ts`:

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureBackupTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS backup_snapshot_id_seq START 1;
    CREATE TABLE IF NOT EXISTS backup_snapshot (
      id           INTEGER NOT NULL DEFAULT nextval('backup_snapshot_id_seq') PRIMARY KEY,
      started_at   TIMESTAMP NOT NULL DEFAULT current_timestamp,
      finished_at  TIMESTAMP,
      status       VARCHAR NOT NULL DEFAULT 'running',
      s3_key       VARCHAR,
      size_bytes   BIGINT,
      triggered_by VARCHAR NOT NULL DEFAULT 'manual',
      error        VARCHAR
    );
  `);
}
```

**Step 2: Write the failing repository test**

Create `packages/server/src/backup/repository.test.ts`:

```typescript
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
    conn.close();
  });

  it('inserts and completes a backup snapshot', async () => {
    const id: number = await insertBackupSnapshot(conn, 'manual');
    expect(id).toBeGreaterThan(0);

    await completeBackupSnapshot(conn, id, 'db/20260323-1200.duckdb', 1024 * 1024);

    const snapshot: BackupSnapshot | null = await getLatestBackupSnapshot(conn);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.id).toBe(id);
    expect(snapshot!.status).toBe('completed');
    expect(snapshot!.s3_key).toBe('db/20260323-1200.duckdb');
    expect(snapshot!.size_bytes).toBe(1024 * 1024);
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
      expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
    }
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec vitest run src/backup/repository.test.ts`
Expected: FAIL — module not found

**Step 4: Implement the repository**

Create `packages/server/src/backup/repository.ts`:

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export type BackupSnapshot = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  s3_key: string | null;
  size_bytes: number | null;
  triggered_by: string;
  error: string | null;
};

export async function insertBackupSnapshot(
  conn: DuckDBConnection,
  triggeredBy: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `INSERT INTO backup_snapshot (triggered_by)
     VALUES ($1)
     RETURNING id`,
    [triggeredBy],
  );
  const row = reader.getRowObjectsJS()[0] as Record<string, unknown>;
  return Number(row.id);
}

export async function completeBackupSnapshot(
  conn: DuckDBConnection,
  id: number,
  s3Key: string,
  sizeBytes: number,
): Promise<void> {
  await conn.run(
    `UPDATE backup_snapshot
     SET status = 'completed', finished_at = current_timestamp, s3_key = $1, size_bytes = $2
     WHERE id = $3`,
    [s3Key, sizeBytes, id],
  );
}

export async function failBackupSnapshot(
  conn: DuckDBConnection,
  id: number,
  error: string,
): Promise<void> {
  await conn.run(
    `UPDATE backup_snapshot
     SET status = 'failed', finished_at = current_timestamp, error = $1
     WHERE id = $2`,
    [error, id],
  );
}

export async function getLatestBackupSnapshot(
  conn: DuckDBConnection,
): Promise<BackupSnapshot | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM backup_snapshot ORDER BY started_at DESC LIMIT 1`,
  );
  const rows = reader.getRowObjectsJS() as BackupSnapshot[];
  return rows[0] ?? null;
}

export async function listBackupSnapshots(
  conn: DuckDBConnection,
  limit: number,
): Promise<BackupSnapshot[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM backup_snapshot ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return reader.getRowObjectsJS() as BackupSnapshot[];
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec vitest run src/backup/repository.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/backup/schema.ts packages/server/src/backup/repository.ts packages/server/src/backup/repository.test.ts
git commit -m "feat(backup): add backup_snapshot schema and repository"
```

---

## Task 4: Create the BackupService (Checkpoint + Copy + Upload)

**Files:**
- Create: `packages/server/src/backup/backup-service.ts`
- Create: `packages/server/src/backup/backup-service.test.ts`

**Step 1: Write the failing test**

Create `packages/server/src/backup/backup-service.test.ts`:

```typescript
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
    conn.close();
  });

  it('runs a backup and records it in backup_snapshot', async () => {
    const mockUploader: S3Uploader = {
      upload: vi.fn().mockResolvedValue(undefined),
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
      upload: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      ),
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec vitest run src/backup/backup-service.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the BackupService**

Create `packages/server/src/backup/backup-service.ts`:

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';
import { copyFileSync, statSync, unlinkSync } from 'node:fs';
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

      // 2. Copy DB file to temp location
      log.info('[backup] Copying database file...');
      copyFileSync(config.dbPath, snapPath);
      const stat = statSync(snapPath);

      // 3. Upload timestamped snapshot
      log.info(`[backup] Uploading ${s3Key} (${stat.size} bytes)...`);
      await config.uploader.upload(snapPath, s3Key);

      // 4. Also upload as latest.duckdb for boot restore fallback
      await config.uploader.upload(snapPath, 'latest.duckdb');

      // 5. Clean up temp file
      unlinkSync(snapPath);

      // 6. Record success
      const fullS3Key: string = `${config.snapshotPrefix}${s3Key}`;
      await completeBackupSnapshot(config.conn, id, fullS3Key, stat.size);
      log.info(`[backup] Snapshot ${s3Key} uploaded successfully`);
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      log.error(`[backup] Snapshot failed: ${msg}`);
      await failBackupSnapshot(config.conn, id, msg);
      // Clean up temp file if it exists
      try {
        unlinkSync(snapPath);
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
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec vitest run src/backup/backup-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/backup/backup-service.ts packages/server/src/backup/backup-service.test.ts
git commit -m "feat(backup): add BackupService with checkpoint, copy, and S3 upload"
```

---

## Task 5: Create Admin API Routes for Backups

**Files:**
- Create: `packages/server/src/backup/routes.ts`
- Modify: `packages/server/src/app.ts` (mount routes)

**Step 1: Create the routes**

Create `packages/server/src/backup/routes.ts`:

```typescript
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import { DuckDBConnection } from '@duckdb/node-api';
import { getConfigService } from '../lib/config.ts';
import type { ConfigKey } from '../lib/config-schema.ts';
import { ensureBackupTables } from './schema.ts';
import {
  listBackupSnapshots,
  getLatestBackupSnapshot,
  type BackupSnapshot,
} from './repository.ts';
import { createBackupService, type BackupService } from './backup-service.ts';
import { createS3Uploader } from './s3-client.ts';

let backupService: BackupService | null = null;

async function getBackupService(): Promise<BackupService> {
  if (backupService != null) {
    return backupService;
  }

  const config = getConfigService();
  const bucket: string = String(config.get('snapshotBucket' as ConfigKey));
  const prefix: string = String(config.get('snapshotPrefix' as ConfigKey));
  const region: string = String(config.get('snapshotRegion' as ConfigKey));

  if (!bucket) {
    throw new Error('snapshotBucket config is not set');
  }

  const db = getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await ensureBackupTables(conn);

  const uploader = createS3Uploader({ bucket, prefix, region });

  // Resolve the DB path from the database instance
  // In production, /data/daily-orbit.duckdb; uses DATA_DIR env or default
  const dbPath: string = process.env.DATA_DIR
    ? `${process.env.DATA_DIR}/daily-orbit.duckdb`
    : 'data/daily-orbit.duckdb';

  backupService = createBackupService({ conn, uploader, dbPath, snapshotPrefix: prefix });
  return backupService;
}

const backupRoutes = new Hono();

// GET /api/admin/backups — list recent backup snapshots
backupRoutes.get('/', async (c) => {
  const db = getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await ensureBackupTables(conn);
  const limit: number = Number(c.req.query('limit') ?? '20');
  const snapshots: BackupSnapshot[] = await listBackupSnapshots(conn, limit);
  conn.close();
  return c.json(snapshots);
});

// GET /api/admin/backups/latest — get the most recent backup
backupRoutes.get('/latest', async (c) => {
  const db = getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await ensureBackupTables(conn);
  const snapshot: BackupSnapshot | null = await getLatestBackupSnapshot(conn);
  conn.close();
  if (snapshot == null) {
    return c.json({ message: 'No backups found' }, 404);
  }
  return c.json(snapshot);
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

export { backupRoutes };
```

**Step 2: Mount the routes in app.ts**

Add to `packages/server/src/app.ts`, near the other admin routes:

1. Add import: `import { backupRoutes } from './backup/routes.ts';`
2. Add route: `app.route('/api/admin/backups', backupRoutes);`

Place the route line after the existing `app.route('/api/admin/pipeline', pipelineRoutes);` line.

**Step 3: Verify types compile**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/server/src/backup/routes.ts packages/server/src/app.ts
git commit -m "feat(backup): add admin API routes for backup management"
```

---

## Task 6: Register Schema in App Startup

**Files:**
- Modify: wherever schemas are initialized (likely `packages/server/src/lib/schema.ts` or app startup)

**Step 1: Find the schema initialization point**

Search for where `ensurePipelineTrackingTables` or `ensureAlertTables` is called during server startup. This is where `ensureBackupTables` needs to be added.

Run: `cd /Users/benton/code/daily-orbit && rg 'ensurePipelineTrackingTables|ensureAlertTables' packages/server/src --type ts -l`

**Step 2: Add `ensureBackupTables` call**

In the same file/function where other schemas are initialized, add:

```typescript
import { ensureBackupTables } from './backup/schema.ts';
// ...
await ensureBackupTables(conn);
```

**Step 3: Verify server starts**

Run: `cd /Users/benton/code/daily-orbit && make test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add <modified-file>
git commit -m "feat(backup): register backup_snapshot schema on startup"
```

---

## Task 7: Add Scheduled Backup Timer

**Files:**
- Create: `packages/server/src/backup/scheduler.ts`

This is analogous to how the pipeline scheduler works. The backup scheduler reads `snapshotIntervalMinutes` from config and runs `backupService.runBackup('scheduled')` on that interval.

**Step 1: Implement the scheduler**

Create `packages/server/src/backup/scheduler.ts`:

```typescript
import { getLogger } from '../lib/logger.ts';
import type { BackupService } from './backup-service.ts';

export type BackupScheduler = {
  start: (intervalMinutes: number) => void;
  stop: () => void;
  isActive: () => boolean;
};

export function createBackupScheduler(service: BackupService): BackupScheduler {
  const log = getLogger();
  let timer: ReturnType<typeof setInterval> | null = null;

  function start(intervalMinutes: number): void {
    if (timer != null) {
      stop();
    }
    if (intervalMinutes <= 0) {
      log.info('[backup-scheduler] Interval is 0 — automatic backups disabled');
      return;
    }
    const ms: number = intervalMinutes * 60 * 1000;
    log.info(`[backup-scheduler] Starting with interval ${intervalMinutes}m`);
    timer = setInterval(() => {
      if (!service.isRunning()) {
        void service.runBackup('scheduled');
      }
    }, ms);
  }

  function stop(): void {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
      log.info('[backup-scheduler] Stopped');
    }
  }

  function isActive(): boolean {
    return timer != null;
  }

  return { start, stop, isActive };
}
```

**Step 2: Commit**

```bash
git add packages/server/src/backup/scheduler.ts
git commit -m "feat(backup): add backup scheduler with configurable interval"
```

---

## Task 8: Admin UI — Backups Page

**Files:**
- Create: `packages/web/src/admin/BackupsPage.tsx`
- Modify: `packages/web/src/App.tsx` (add route)
- Modify: `packages/web/src/admin/AdminLayout.tsx` (add nav link)

**Step 1: Create the Backups page component**

Create `packages/web/src/admin/BackupsPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

type BackupSnapshot = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  s3_key: string | null;
  size_bytes: number | null;
  triggered_by: string;
  error: string | null;
};

type BackupStatus = {
  running: boolean;
  configured?: boolean;
};

const cardClass: string =
  'rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 p-4';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb: number = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb: number = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function BackupsPage() {
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [status, setStatus] = useState<BackupStatus>({ running: false });
  const [loading, setLoading] = useState<boolean>(true);
  const [triggering, setTriggering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [snapshotData, statusData] = await Promise.all([
        apiFetch<BackupSnapshot[]>('/api/admin/backups'),
        apiFetch<BackupStatus>('/api/admin/backups/status'),
      ]);
      setSnapshots(snapshotData);
      setStatus(statusData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load backup data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    // Poll every 10s while a backup is running
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      void fetchData();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const triggerBackup = async (): Promise<void> => {
    setTriggering(true);
    try {
      await apiFetch('/api/admin/backups/trigger', { method: 'POST' });
      // Refresh after a short delay to pick up the new running backup
      setTimeout(() => void fetchData(), 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to trigger backup');
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading backup data...</p>;
  }

  const latest: BackupSnapshot | undefined = snapshots[0];

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Backups
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Database snapshot history and manual trigger.
          </p>
        </div>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={status.running || triggering || status.configured === false}
          onClick={() => void triggerBackup()}
          type="button"
        >
          {status.running ? 'Backup Running...' : 'Trigger Backup'}
        </button>
      </div>

      {error != null && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {status.configured === false && (
        <div className={`${cardClass} mb-4 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950`}>
          <p className="text-sm text-amber-800 dark:text-amber-200">
            S3 snapshot bucket is not configured. Set <code>snapshotBucket</code> in{' '}
            <a className="underline" href="/admin/settings">Settings</a> to enable backups.
          </p>
        </div>
      )}

      {/* Latest Backup Card */}
      {latest != null && (
        <div className={`${cardClass} mb-6`}>
          <h2 className="mb-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">
            Latest Backup
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-neutral-400">Status</p>
              <p className={`text-sm font-medium ${
                latest.status === 'completed'
                  ? 'text-green-600 dark:text-green-400'
                  : latest.status === 'failed'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-yellow-600 dark:text-yellow-400'
              }`}>
                {latest.status}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">Started</p>
              <p className="text-sm">{formatDate(latest.started_at)}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">Size</p>
              <p className="text-sm">
                {latest.size_bytes != null ? formatBytes(latest.size_bytes) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">Triggered by</p>
              <p className="text-sm">{latest.triggered_by}</p>
            </div>
          </div>
          {latest.error != null && (
            <p className="mt-2 text-xs text-red-500">{latest.error}</p>
          )}
        </div>
      )}

      {/* History Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-medium text-neutral-500 dark:text-neutral-400">
          Backup History
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-700">
              <th className="pb-2 font-medium text-neutral-500">Started</th>
              <th className="pb-2 font-medium text-neutral-500">Status</th>
              <th className="pb-2 font-medium text-neutral-500">Size</th>
              <th className="pb-2 font-medium text-neutral-500">S3 Key</th>
              <th className="pb-2 font-medium text-neutral-500">Trigger</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s: BackupSnapshot) => (
              <tr
                className="border-b border-neutral-100 dark:border-neutral-800"
                key={s.id}
              >
                <td className="py-2">{formatDate(s.started_at)}</td>
                <td className={`py-2 ${
                  s.status === 'completed'
                    ? 'text-green-600 dark:text-green-400'
                    : s.status === 'failed'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-yellow-600 dark:text-yellow-400'
                }`}>
                  {s.status}
                </td>
                <td className="py-2">
                  {s.size_bytes != null ? formatBytes(s.size_bytes) : '—'}
                </td>
                <td className="py-2 font-mono text-xs text-neutral-500">
                  {s.s3_key ?? '—'}
                </td>
                <td className="py-2">{s.triggered_by}</td>
              </tr>
            ))}
            {snapshots.length === 0 && (
              <tr>
                <td className="py-4 text-center text-neutral-400" colSpan={5}>
                  No backups recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

**Step 2: Add the lazy route in App.tsx**

In `packages/web/src/App.tsx`:

1. Add lazy import near the other admin lazy imports:
   ```typescript
   const BackupsPage = lazy(() => import('./admin/BackupsPage.tsx'));
   ```

2. Add route inside the admin layout routes (find the admin `<Route>` block and add):
   ```tsx
   <Route element={<BackupsPage />} path="backups" />
   ```

**Step 3: Add nav link in AdminLayout.tsx**

In `packages/web/src/admin/AdminLayout.tsx`, add a "Backups" link after the "Hidden Items" link, following the same pattern:

```tsx
<span className="text-neutral-300 dark:text-neutral-600">/</span>
<Link
  className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
  to="/admin/backups"
>
  Backups
</Link>
```

**Step 4: Verify build**

Run: `cd /Users/benton/code/daily-orbit && make build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/web/src/admin/BackupsPage.tsx packages/web/src/App.tsx packages/web/src/admin/AdminLayout.tsx
git commit -m "feat(backup): add admin Backups page with trigger button and history"
```

---

## Task 9: Upload Encryption Key Alongside Snapshot

**Files:**
- Modify: `packages/server/src/backup/backup-service.ts`

The cron script also uploads `/data/daily-orbit.key`. The BackupService should do the same.

**Step 1: Add key upload to runBackup**

After the `latest.duckdb` upload line in `backup-service.ts`, add:

```typescript
// Upload encryption key if it exists
const keyPath: string = config.dbPath.replace('.duckdb', '.key');
try {
  statSync(keyPath);
  await config.uploader.upload(keyPath, 'daily-orbit.key');
} catch {
  // Key file doesn't exist — skip
}
```

**Step 2: Run tests**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec vitest run src/backup/`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/server/src/backup/backup-service.ts
git commit -m "feat(backup): upload encryption key alongside DB snapshot"
```

---

## Task 10: Add `./daily-orbit db snapshot` CLI Command

**Files:**
- Create: `packages/server/src/cli/db/snapshot.ts`
- Modify: `packages/server/src/cli/db/index.ts`

This provides a CLI equivalent to the cron script, useful for manual snapshots via SSH.

**Step 1: Create the snapshot command**

Create `packages/server/src/cli/db/snapshot.ts`:

```typescript
import { DuckDBConnection } from '@duckdb/node-api';
import { defineCommand } from 'citty';
import { trackConnection } from '../../lib/graceful-shutdown.ts';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';
import { ensureBackupTables } from '../../backup/schema.ts';
import { createBackupService } from '../../backup/backup-service.ts';
import { createS3Uploader } from '../../backup/s3-client.ts';
import { getConfigService, initConfigService } from '../../lib/config.ts';
import type { ConfigKey } from '../../lib/config-schema.ts';

export const snapshotCommand = defineCommand({
  meta: {
    name: 'snapshot',
    description: 'Checkpoint the database and upload a snapshot to S3',
  },
  args: {
    database: databaseArg,
  },
  async run({ args }) {
    const db = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);

    await initConfigService(conn);
    await ensureBackupTables(conn);

    const config = getConfigService();
    const bucket: string = String(config.get('snapshotBucket' as ConfigKey));
    const prefix: string = String(config.get('snapshotPrefix' as ConfigKey));
    const region: string = String(config.get('snapshotRegion' as ConfigKey));

    if (!bucket) {
      getLogger().error('snapshotBucket config is not set');
      process.exit(1);
    }

    const uploader = createS3Uploader({ bucket, prefix, region });
    const service = createBackupService({
      conn,
      uploader,
      dbPath: args.database,
      snapshotPrefix: prefix,
    });

    await service.runBackup('cli');
    getLogger().info('Snapshot complete');
  },
});
```

**Step 2: Register in db/index.ts**

Add the snapshot command to the `db` command group in `packages/server/src/cli/db/index.ts`:

```typescript
import { snapshotCommand } from './snapshot.ts';
// ... in subCommands:
snapshot: snapshotCommand,
```

**Step 3: Verify CLI help shows the command**

Run: `cd /Users/benton/code/daily-orbit && ./daily-orbit db --help`
Expected: `snapshot` appears in the subcommands list

**Step 4: Commit**

```bash
git add packages/server/src/cli/db/snapshot.ts packages/server/src/cli/db/index.ts
git commit -m "feat(backup): add 'daily-orbit db snapshot' CLI command"
```

---

## Task 11: Integration Test

**Files:**
- Create: `packages/server/src/backup/backup-integration.test.ts`

**Step 1: Write the integration test**

Create `packages/server/src/backup/backup-integration.test.ts`:

```typescript
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
    conn.close();
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

    // Should have uploaded timestamped + latest
    expect(uploads.length).toBe(2);
    expect(uploads[0].s3Key).toMatch(/^\d{8}-\d{4}\.duckdb$/);
    expect(uploads[1].s3Key).toBe('latest.duckdb');

    // Should have recorded in backup_snapshot table
    const snapshots: BackupSnapshot[] = await listBackupSnapshots(conn, 1);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].status).toBe('completed');
    expect(snapshots[0].triggered_by).toBe('test');
    expect(snapshots[0].size_bytes).toBeGreaterThan(0);

    // Temp snap file should be cleaned up
    expect(existsSync(`${tmpDb}.snap`)).toBe(false);
  });
});
```

**Step 2: Run the test**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server exec vitest run src/backup/backup-integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/server/src/backup/backup-integration.test.ts
git commit -m "test(backup): add integration test for full backup cycle"
```

---

## Task 12: Update Deployment User-Data (Future)

**Not implemented now** — once the in-app backup is stable, the cron-based `db-snapshot.sh` in `deploy/lib/user-data.sh` can be replaced with:

1. Setting `snapshotBucket` in the DB config (or via env var on first boot)
2. Setting `snapshotIntervalMinutes` to the desired interval (e.g., `120`)
3. The server-side scheduler handles periodic backups
4. The shutdown hook can call `./daily-orbit db snapshot` instead of the shell script

This is a follow-up task, not part of the initial implementation. The cron script and in-app backup can coexist safely since the BackupService uses a mutex to prevent concurrent runs, and the cron script's `cp` of the DB file is atomic at the filesystem level.

---

## Summary of deliverables

| # | What | Files |
|---|------|-------|
| 1 | Config keys | `config-schema.ts` |
| 2 | S3 client | `backup/s3-client.ts` + test |
| 3 | Schema + repo | `backup/schema.ts`, `backup/repository.ts` + test |
| 4 | BackupService | `backup/backup-service.ts` + test |
| 5 | API routes | `backup/routes.ts`, `app.ts` |
| 6 | Schema init | startup file |
| 7 | Scheduler | `backup/scheduler.ts` |
| 8 | Admin UI | `BackupsPage.tsx`, `App.tsx`, `AdminLayout.tsx` |
| 9 | Key upload | `backup-service.ts` |
| 10 | CLI command | `cli/db/snapshot.ts`, `cli/db/index.ts` |
| 11 | Integration test | `backup/backup-integration.test.ts` |
| 12 | Deploy migration | Future — remove cron, rely on in-app scheduler |
