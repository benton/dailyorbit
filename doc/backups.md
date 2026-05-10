# Database Backups

The application provides in-app DuckDB backup management: checkpoint the WAL, snapshot the database file, and upload it to S3. Backups can be triggered manually from the admin UI, via CLI, or (once wired in) on a scheduled interval.

## How It Works

A backup runs these steps in order:

1. **Checkpoint** — `CHECKPOINT` flushes the DuckDB write-ahead log into the main file
2. **Copy** — async copy of the DB file to `<db-path>.snap` (non-blocking)
3. **Upload** — multipart upload of the snapshot to S3 as `<prefix><YYYYMMDD-HHMM>.duckdb` (100 MB parts, 4 concurrent streams)
4. **Upload key** — if `<db-path>.key` exists, upload it as `<prefix>daily-orbit.key`
5. **Cleanup** — delete the local `.snap` temp file
6. **Record** — write status, S3 key, and size to the `backup_snapshot` table
7. **Prune** — if `retentionCount` is set, delete older `.duckdb` snapshots beyond that count (non-fatal: snapshot already succeeded)
8. **Parquet DR export** — if configured, export all base tables to Parquet (non-fatal)

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

The `BackupScheduler` (`packages/server/src/backup/scheduler.ts`) starts automatically on server startup when `snapshotIntervalMinutes > 0`. It reads that value from config and calls `runBackup('scheduled')` on the interval, skipping runs if a backup is already in progress.

## S3 Layout

With the default prefix `db/`, a typical bucket looks like:

```
s3://daily-orbit-data/db/20260323-1815.duckdb
s3://daily-orbit-data/db/20260324-0600.duckdb
s3://daily-orbit-data/db/daily-orbit.key         <- encryption key (if present)
```

## Retention

The backup service prunes older `.duckdb` snapshots after each successful upload. The default in production is `retentionCount: 2` (set in `backup/routes.ts` and `cli/db/snapshot.ts`), which keeps the two most-recent snapshots and deletes everything older. Pruning is non-fatal — a snapshot that uploads successfully but fails to prune is still considered complete.

Without retention, every snapshot accumulates indefinitely in S3 Standard. At a 2-hour interval and a 150 GB+ DuckDB file, this can reach tens of TiB and many hundreds of dollars per month within weeks.

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
| `packages/server/src/cli/db/snapshot.ts` | CLI snapshot command |
| `packages/server/src/cli/db/export-parquet.ts` | CLI Parquet export (DR) |
| `packages/server/src/cli/db/import-parquet.ts` | CLI Parquet import (DR) |
| `packages/server/src/search/index-status.ts` | In-memory FTS/vector index readiness registry |
| `packages/web/src/admin/BackupsPage.tsx` | Admin UI page |

## Parquet Disaster Recovery (Phase 2)

In addition to full `.duckdb` snapshots, the app provides a fast disaster-recovery path via Parquet exports. This is a **fallback only** — used when the EBS persistent volume is lost or corrupted, not on normal instance replacement.

### Export

```bash
./daily-orbit db export-parquet --database data/daily-orbit.duckdb --keyFile data/daily-orbit.key
```

Exports every `main`-schema base table to S3 as individual Parquet files, plus `schema.sql` (DDL) and `_manifest.json` (table list, row counts, timestamp). Uses the `snapshotBucket` and `snapshotRegion` config values by default; override with `--bucket` and `--prefix`.

**S3 layout** (default prefix `parquet/`):
```
s3://daily-orbit-storage/parquet/_manifest.json
s3://daily-orbit-storage/parquet/schema.sql
s3://daily-orbit-storage/parquet/filing.parquet
s3://daily-orbit-storage/parquet/attachment.parquet
...
```

Run after each regular snapshot to keep DR files current.

### Import (disaster recovery)

```bash
./daily-orbit db import-parquet --database data/daily-orbit.duckdb --keyFile data/daily-orbit.key
```

Downloads `_manifest.json` and `schema.sql` from S3, creates a fresh database, recreates all tables, and bulk-loads each table from its Parquet file. Completes in ~8 seconds for ~4-5 GiB of core data. **FTS and vector indexes are not included** — they rebuild in the background after the server starts.

### Background Index Rebuild

When the API server starts and detects that FTS schemas are missing (e.g. after a Parquet DR restore), it:

1. Marks all FTS indexes as `not ready` in an in-memory registry
2. Starts serving requests immediately
3. Rebuilds all FTS indexes in the background

The search page shows a degraded-mode banner during rebuild. FTS search modes (`keyword`, `hybrid`) are disabled with a `(rebuilding…)` label until complete. The status endpoint is `GET /api/search/index-status`.

## Shutdown Hook

`deploy/lib/user-data.sh` installs a systemd unit (`db-snapshot-on-shutdown.service`) that calls `docker exec daily-orbit ./daily-orbit db snapshot` when the instance stops. This runs the same CLI path as a manual snapshot, so retention is enforced on shutdown the same way it is on the scheduled interval.
