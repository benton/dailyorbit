# Database Backups

The application provides in-app DuckDB backup management: checkpoint the WAL, snapshot the database file, and upload it to S3. Backups can be triggered manually from the admin UI, via CLI, or (once wired in) on a scheduled interval.

## How It Works

A backup runs these steps in order:

1. **Checkpoint** — `CHECKPOINT` flushes the DuckDB write-ahead log into the main file
2. **Copy** — async copy of the DB file to `<db-path>.snap` (non-blocking)
3. **Upload** — multipart upload of the snapshot to S3 as `<prefix><YYYYMMDD-HHMM>.duckdb` (100 MB parts, 4 concurrent streams)
4. **Copy latest** — S3 server-side `CopyObject` to `<prefix>latest.duckdb` (instant, no data transfer)
5. **Upload key** — if `<db-path>.key` exists, upload it as `<prefix>daily-orbit.key`
6. **Cleanup** — delete the local `.snap` temp file
7. **Record** — write status, S3 key, and size to the `backup_snapshot` table

A mutex prevents concurrent backups. If a backup is already running, new requests are rejected.

Failures at any step are caught and recorded in `backup_snapshot` with status `failed` and the error message.

## Configuration

Set these in the admin Settings page (`/admin/settings`) or via `./daily-orbit config set`:

| Key | Default | Description |
|-----|---------|-------------|
| `snapshotBucket` | _(empty)_ | S3 bucket name (required) |
| `snapshotPrefix` | `db/` | S3 key prefix for all snapshot files |
| `snapshotRegion` | `us-east-2` | AWS region for the S3 bucket |
| `snapshotIntervalMinutes` | `120` | Scheduled interval in minutes (0 = disabled) |

Backups are disabled until `snapshotBucket` is set. AWS credentials are resolved from the standard SDK chain (instance profile, env vars, `~/.aws/credentials`).

## Triggering a Backup

### Admin UI

Navigate to `/admin/backups`. Click **Trigger Backup**. The page polls every 10 seconds and shows the running/completed/failed status.

### CLI

```bash
./daily-orbit db snapshot --database data/daily-orbit.duckdb --keyFile data/daily-orbit.key
```

Reads config from the database. Useful for manual snapshots via SSH or as a shutdown hook.

### API

```
POST /api/admin/backups/trigger
```

Returns `202 Accepted` immediately. The backup runs in the background.

Other endpoints:

- `GET /api/admin/backups` — list recent snapshots (query param: `?limit=20`)
- `GET /api/admin/backups/latest` — most recent snapshot
- `GET /api/admin/backups/status` — `{ running: boolean, configured?: boolean }`

## Scheduled Backups

A `BackupScheduler` exists in `packages/server/src/backup/scheduler.ts` but is **not yet wired into the server startup**. When enabled, it will read `snapshotIntervalMinutes` from config and call `runBackup('scheduled')` on that interval, skipping if a backup is already in progress.

## S3 Layout

With the default prefix `db/`, a typical bucket looks like:

```
s3://daily-orbit-data/db/20260323-1815.duckdb
s3://daily-orbit-data/db/20260324-0600.duckdb
s3://daily-orbit-data/db/latest.duckdb          <- always points to most recent
s3://daily-orbit-data/db/daily-orbit.key         <- encryption key (if present)
```

## Database Schema

The `backup_snapshot` table tracks every backup attempt:

| Column | Type | Description |
|--------|------|-------------|
| `id` | `INTEGER` | Auto-increment primary key |
| `started_at` | `TIMESTAMP` | When the backup began |
| `finished_at` | `TIMESTAMP` | When it completed or failed |
| `status` | `VARCHAR` | `running`, `completed`, or `failed` |
| `s3_key` | `VARCHAR` | Full S3 key of the uploaded snapshot |
| `size_bytes` | `BIGINT` | Size of the uploaded file |
| `triggered_by` | `VARCHAR` | `manual`, `cli`, `scheduled` |
| `error` | `VARCHAR` | Error message (if failed) |

## Source Files

| File | Purpose |
|------|---------|
| `packages/server/src/backup/backup-service.ts` | Core backup logic |
| `packages/server/src/backup/s3-client.ts` | S3 upload/copy/list |
| `packages/server/src/backup/repository.ts` | `backup_snapshot` CRUD |
| `packages/server/src/backup/schema.ts` | Table DDL |
| `packages/server/src/backup/routes.ts` | Admin API endpoints |
| `packages/server/src/backup/scheduler.ts` | Interval-based scheduler |
| `packages/server/src/cli/db/snapshot.ts` | CLI command |
| `packages/web/src/admin/BackupsPage.tsx` | Admin UI page |

## Coexistence with Cron Script

The existing cron-based `db-snapshot.sh` in `deploy/lib/user-data.sh` can run alongside in-app backups safely. The BackupService mutex only prevents concurrent in-app backups; the cron script's `cp` is atomic at the filesystem level. Once in-app backups are proven stable, the cron script can be retired in favor of the scheduler and/or the shutdown hook calling `./daily-orbit db snapshot`.
