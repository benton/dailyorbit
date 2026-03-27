# EBS Persistent Volume + Parquet Disaster Recovery

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce instance replacement downtime from ~8 minutes to ~10-30 seconds (Phase 1) and provide a fast disaster-recovery fallback that can serve queries in ~8 seconds even if the EBS volume is lost (Phase 2).

**Architecture:** Phase 1 replaces ephemeral NVMe storage with a persistent EBS gp3 volume that survives spot instance replacement. Phase 2 adds a nightly Parquet export of core tables to S3, a fast `IMPORT` startup path, and background FTS/vector index rebuilding with a UI degraded-mode indicator.

**Tech Stack:** AWS CDK (TypeScript), DuckDB, Hono (API), React (frontend), `@aws-sdk/client-s3`

**Background:** See [doc/s3-storage-tradeoffs.md](../s3-storage-tradeoffs.md) for the full analysis.

---

## Context

### Current Boot Sequence (user-data.sh)

1. Install AWS CLI, associate EIP
2. Detect NVMe ephemeral devices → create ZFS pool on `/data`
3. `aws s3 cp` latest `db/YYYYMMDD-HHMM.duckdb` snapshot to `/data/daily-orbit.duckdb` (~8 min for 40GB)
4. Install Docker, pull image, start container via systemd
5. CloudWatch agent, shutdown snapshot hook

### Current Infrastructure

- ASG: 1 spot instance, `PRICE_CAPACITY_OPTIMIZED` allocation (may pick any AZ)
- Instance type: `r6gd.xlarge` (ARM64, 4 vCPU, 32GB RAM, 237GB NVMe)
- S3 bucket: `daily-orbit-storage` — holds timestamped `.duckdb` snapshots, encryption key, attachments
- VPC: `vpc-6201f10b` in us-east-2

### Database Composition

- **39 GiB** total DuckDB file
- **~4-5 GiB** core relational data (filings, attachments metadata, embeddings, frequencies, etc.)
- **~35 GiB** derived data: 4 FTS indexes (`fts_main_attachment` is largest), vector indexes
- FTS indexes are rebuildable via `rebuildAllFtsIndexes()` in `packages/server/src/search/fts-index.ts`

---

## Phase 1: Persistent EBS Volume

### Task 1: Pin ASG to a Single AZ

**Files:**
- Modify: `deploy/lib/stack.ts`
- Modify: `deploy/lib/config.ts`

**Step 1: Add `availabilityZone` to SeedConfig**

In `deploy/lib/config.ts`, add to the `SeedConfig` interface:
```typescript
availabilityZone: string;
```

Add to `REQUIRED_FIELDS`:
```typescript
'availabilityZone',
```

**Step 2: Update the production seed config**

In `deploy/config/aws-665226324657-us-east-2-seed.json`, add:
```json
"availabilityZone": "us-east-2a"
```

(Verify the correct AZ by checking where the current spot instance is running: `aws ec2 describe-instances --filters "Name=tag:Project,Values=daily-orbit"`)

**Step 3: Constrain the ASG to a single subnet**

In `deploy/lib/stack.ts`, modify the VPC lookup or ASG configuration to use only subnets in the pinned AZ. When the VPC is looked up via `fromLookup`, select the subnet matching `config.availabilityZone`:

```typescript
const asg = new autoscaling.AutoScalingGroup(this, 'Asg', {
  vpc,
  vpcSubnets: {
    availabilityZones: [config.availabilityZone],
    subnetType: ec2.SubnetType.PUBLIC, // or PRIVATE_WITH_EGRESS if behind NAT
  },
  // ... rest of existing config
});
```

**Verification:** `cdk diff` should show the ASG subnet list narrowed to one AZ.

---

### Task 2: Create Persistent EBS Volume in CDK

**Files:**
- Modify: `deploy/lib/stack.ts`
- Modify: `deploy/lib/config.ts`

**Step 1: Add EBS config to SeedConfig**

In `config.ts`, add optional fields with defaults:
```typescript
ebsVolumeSize: number;    // default: 60 (GiB, headroom over 39GB)
ebsVolumeIops: number;    // default: 6000
ebsVolumeThroughput: number; // default: 500 (MB/s)
```

Add to `DEFAULTS`:
```typescript
ebsVolumeSize: 60,
ebsVolumeIops: 6000,
ebsVolumeThroughput: 500,
```

**Step 2: Create the EBS volume resource**

In `stack.ts`, add after the storage section:
```typescript
const dataVolume = new ec2.Volume(this, 'DataVolume', {
  availabilityZone: config.availabilityZone,
  size: cdk.Size.gibibytes(config.ebsVolumeSize),
  volumeType: ec2.EbsDeviceVolumeType.GP3,
  iops: config.ebsVolumeIops,
  throughput: config.ebsVolumeThroughput,
  encrypted: true,
  removalPolicy: RemovalPolicy.RETAIN, // CRITICAL: never delete on stack update
});

Tags.of(dataVolume).add('Name', `${config.stackName}-data`);
Tags.of(dataVolume).add('daily-orbit-role', 'data-volume');
```

**Step 3: Grant the instance role permission to attach the volume**

```typescript
instanceRole.addToPolicy(
  new iam.PolicyStatement({
    actions: ['ec2:AttachVolume', 'ec2:DetachVolume', 'ec2:DescribeVolumes'],
    resources: ['*'],
  }),
);
```

**Step 4: Pass the volume ID to user-data**

Add to the `userDataRendered` replacements:
```typescript
.replaceAll('{{DATA_VOLUME_ID}}', dataVolume.volumeId)
```

**Step 5: Output the volume ID**

```typescript
new CfnOutput(this, 'DataVolumeId', {
  value: dataVolume.volumeId,
  description: 'EBS volume ID for persistent data storage',
});
```

**Verification:** `cdk diff` shows new Volume resource, IAM policy, and output.

---

### Task 3: Rewrite user-data.sh for EBS Attachment

**Files:**
- Modify: `deploy/lib/user-data.sh`

Replace the ZFS pool setup and S3 restore sections with EBS volume attachment logic. Keep the S3 restore as a fallback for first-boot or disaster recovery.

**New logic (replaces lines 30-76 of current user-data.sh):**

```bash
# ── Data Volume Setup ─────────────────────────────────────────────────────────
DATA_VOLUME_ID="{{DATA_VOLUME_ID}}"
DEVICE_PATH="/dev/xvdf"

# Attach the persistent EBS volume
echo "Attaching EBS volume $DATA_VOLUME_ID..."
aws ec2 attach-volume \
  --volume-id "$DATA_VOLUME_ID" \
  --instance-id "$INSTANCE_ID" \
  --device "$DEVICE_PATH" \
  --region "{{REGION}}"

# Wait for attachment (up to 60 seconds)
for i in $(seq 1 30); do
  if [ -b "$DEVICE_PATH" ] || [ -b "/dev/nvme1n1" ]; then
    echo "Volume attached"
    break
  fi
  sleep 2
done

# On Nitro instances, /dev/xvdf may appear as /dev/nvme1n1
ACTUAL_DEVICE="$DEVICE_PATH"
[ -b "/dev/nvme1n1" ] && ACTUAL_DEVICE="/dev/nvme1n1"

# Format if new (no filesystem), otherwise mount existing
if ! blkid "$ACTUAL_DEVICE" >/dev/null 2>&1; then
  echo "New volume detected — formatting as ext4"
  mkfs.ext4 -L daily-orbit-data "$ACTUAL_DEVICE"
  NEEDS_RESTORE=true
else
  echo "Existing filesystem found"
  NEEDS_RESTORE=false
fi

mkdir -p /data
mount "$ACTUAL_DEVICE" /data

# If the volume is empty (first boot or disaster), restore from S3
if [ "$NEEDS_RESTORE" = true ] || [ ! -f /data/daily-orbit.duckdb ]; then
  echo "No database found on volume — restoring from S3..."

  # Try Parquet fast-restore first (Phase 2), fall back to full snapshot
  if [ -f /data/parquet-restore.sh ]; then
    bash /data/parquet-restore.sh
  else
    DB_SNAPSHOT=$(aws s3 ls "s3://{{DB_SNAPSHOT_BUCKET}}/db/" --recursive \
      | grep -oE 'db/[0-9]{8}-[0-9]{4}\.duckdb$' \
      | sort | tail -1)

    if [ -n "$DB_SNAPSHOT" ]; then
      echo "Restoring snapshot: $DB_SNAPSHOT"
      aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/${DB_SNAPSHOT}" /data/daily-orbit.duckdb
    else
      echo "WARNING: No snapshot found — container will initialize fresh database"
    fi
  fi

  aws s3 cp "s3://{{DB_SNAPSHOT_BUCKET}}/db/daily-orbit.key" /data/daily-orbit.key \
    || echo "No encryption key found"
  mkdir -p /data/attachments
  aws s3 sync "s3://{{DB_SNAPSHOT_BUCKET}}/attachments/" /data/attachments/ \
    || echo "No attachments found in S3"
fi

chown -R ubuntu:ubuntu /data
```

**Also update the shutdown hook** — the existing `db-snapshot-on-shutdown` service should remain as-is (it snapshots to S3 for disaster recovery), but it no longer needs to be the primary recovery mechanism.

**Verification:**
1. Deploy to a test stack or the prod stack with `cdk deploy`
2. Terminate the running instance (ASG will replace it)
3. New instance should attach the existing EBS volume and start in ~2-3 minutes (no S3 download)
4. Verify `/data/daily-orbit.duckdb` is the same file (check size, run a query)

---

### Task 4: Add EBS Snapshot Backup (Belt and Suspenders)

**Files:**
- Modify: `deploy/lib/stack.ts`

Add a scheduled EBS snapshot via AWS Data Lifecycle Manager or a simple EventBridge + Lambda:

```typescript
// Simple approach: use AWS Backup or DLM
// For now, just document that periodic EBS snapshots should be configured
// via the AWS Console or a separate CDK construct.
```

This is a lower priority than Tasks 1-3. The existing S3 snapshot mechanism provides disaster recovery. EBS snapshots are an additional safety net that enables fast volume recreation in a different AZ if needed.

**Verification:** EBS snapshot appears in AWS Console after scheduled time.

---

## Phase 2: Parquet Export + Lazy Index Rebuild

### Task 5: Add `db export-parquet` CLI Subcommand

**Files:**
- Create: `packages/server/src/cli/db/export-parquet.ts`
- Modify: `packages/server/src/cli/db/index.ts` (register the subcommand)

**Step 1: Implement the export command**

The command should:
1. Open the database read-only
2. List all tables in the `main` schema (skip `fts_main_*` schemas — those are derived)
3. For each table, run `COPY {table} TO 's3://{bucket}/{prefix}/parquet/{table}.parquet' (FORMAT PARQUET)`
4. Also export `schema.sql` separately (DuckDB's `EXPORT DATABASE` to S3 omits it — bug #9727)
5. Generate `schema.sql` by querying `information_schema` or by running `EXPORT DATABASE` to a local temp dir and uploading just the `.sql` files

The S3 path structure should be:
```
s3://daily-orbit-storage/
  db/
    YYYYMMDD-HHMM.duckdb          # existing full snapshots
    daily-orbit.key
  parquet/
    _manifest.json                 # timestamp, table list, row counts
    schema.sql                     # DDL to recreate tables
    filing.parquet
    attachment.parquet
    embedding.parquet
    frequency.parquet
    ... (all main schema tables)
```

The `_manifest.json` should contain:
```json
{
  "exported_at": "2026-03-26T05:00:00Z",
  "duckdb_version": "1.5.1",
  "tables": [
    { "name": "filing", "rows": 143054, "size_bytes": 12345678 },
    ...
  ]
}
```

**Step 2: Wire up the CLI**

In `packages/server/src/cli/db/index.ts`, add the `export-parquet` subcommand using the same pattern as existing `snapshot`, `checkpoint`, `query` subcommands.

Usage: `./daily-orbit db export-parquet [--database path] [--bucket name] [--prefix parquet/]`

**Step 3: Add to nightly pipeline**

The backup scheduler should run `export-parquet` after the regular snapshot completes. This ensures the Parquet export is always up-to-date alongside the full `.duckdb` snapshot.

**Verification:**
1. Run `./daily-orbit db export-parquet` locally against `data/daily-orbit-for-querying.duckdb`
2. Verify Parquet files appear in S3 under `parquet/`
3. Verify `_manifest.json` is correct
4. Verify `schema.sql` contains valid DDL

---

### Task 6: Add `db import-parquet` CLI Subcommand

**Files:**
- Create: `packages/server/src/cli/db/import-parquet.ts`
- Modify: `packages/server/src/cli/db/index.ts`

**Step 1: Implement the import command**

The command should:
1. Download `_manifest.json` from S3
2. Create a new local DuckDB database
3. Execute `schema.sql` to create all tables (without FTS indexes)
4. For each table in the manifest, run `INSERT INTO {table} SELECT * FROM 's3://{bucket}/{prefix}/parquet/{table}.parquet'`
5. Run `FORCE CHECKPOINT`
6. Print summary (tables loaded, total rows, elapsed time)

Usage: `./daily-orbit db import-parquet [--database path] [--bucket name] [--prefix parquet/]`

**Step 2: Create the S3 restore script**

Generate a shell script at `/data/parquet-restore.sh` that the user-data.sh fallback path can invoke (see Task 3's `NEEDS_RESTORE` branch). This script calls `./daily-orbit db import-parquet` inside the Docker container, or downloads Parquet files and runs DuckDB CLI commands directly.

**Verification:**
1. Export from the production DB, then import into a fresh DB
2. Compare row counts between original and imported
3. Verify the imported DB can serve API requests (minus FTS/vector search)

---

### Task 7: Add Index Readiness Tracking to the API

**Files:**
- Create: `packages/server/src/search/index-status.ts`
- Modify: `packages/server/src/search/routes.ts`
- Modify: `packages/server/src/app.ts` (or wherever server startup orchestration lives)

**Step 1: Create an in-memory index status registry**

```typescript
// packages/server/src/search/index-status.ts

export type IndexName = 'fts_filing' | 'fts_attachment' | 'fts_pleading' | 'fts_news_item' | 'vector';

export type IndexStatus = {
  ready: boolean;
  rebuilding: boolean;
  lastRebuiltAt: string | null;  // ISO timestamp
  error: string | null;
};

// Module-level singleton — fast, no DB query needed
const statuses: Map<IndexName, IndexStatus> = new Map();

export function getIndexStatus(name: IndexName): IndexStatus { ... }
export function getAllIndexStatuses(): Record<IndexName, IndexStatus> { ... }
export function setIndexRebuilding(name: IndexName): void { ... }
export function setIndexReady(name: IndexName): void { ... }
export function setIndexError(name: IndexName, error: string): void { ... }
```

**Step 2: Add a `/api/search/index-status` endpoint**

In `packages/server/src/search/routes.ts`, add:
```typescript
GET /api/search/index-status → returns getAllIndexStatuses()
```

Response shape:
```json
{
  "fts_filing": { "ready": true, "rebuilding": false, "lastRebuiltAt": "...", "error": null },
  "fts_attachment": { "ready": false, "rebuilding": true, "lastRebuiltAt": null, "error": null },
  "fts_pleading": { "ready": false, "rebuilding": true, "lastRebuiltAt": null, "error": null },
  "fts_news_item": { "ready": true, "rebuilding": false, "lastRebuiltAt": "...", "error": null },
  "vector": { "ready": true, "rebuilding": false, "lastRebuiltAt": "...", "error": null }
}
```

**Step 3: Integrate with `rebuildAllFtsIndexes()`**

Modify `packages/server/src/search/fts-index.ts` to call `setIndexRebuilding()` before each index build and `setIndexReady()` after. On startup, check if FTS schemas exist — if not, mark all FTS indexes as `rebuilding: false, ready: false` (not yet built).

**Step 4: Modify search routes to check index readiness**

In the search routes, before executing an FTS query, check `getIndexStatus('fts_attachment').ready`. If not ready, return an appropriate response (e.g., HTTP 503 with `Retry-After` header, or a 200 with a `degraded: true` flag and results from non-FTS search only).

Design decision for the API contract:
- Option A: Return 503 for FTS-dependent queries → frontend shows "rebuilding" banner
- Option B: Return 200 with `{ degraded: true, indexesRebuilding: [...] }` → frontend shows banner but still displays any available results
- **Recommended: Option B** — better UX, search still works for non-FTS modes (vector, metadata)

**Verification:**
1. Start server with FTS indexes missing
2. `GET /api/search/index-status` shows FTS indexes as not ready
3. Trigger FTS rebuild
4. Status transitions: not ready → rebuilding → ready
5. Search API returns degraded results during rebuild

---

### Task 8: Add "Rebuilding Indexes" UI Indicator on Search Page

**Files:**
- Modify: the search page component (find via `Grep` for the component that renders the search UI)
- Modify: any search hook or query that fetches search results

**Step 1: Fetch index status**

Add a React Query hook (or equivalent) that polls `GET /api/search/index-status` every 10 seconds when any index is not ready, and every 60 seconds otherwise.

**Step 2: Show a warning banner**

When any FTS index has `ready: false` or `rebuilding: true`, display a dismissible warning banner at the top of the search page:

```
⚠ Search indexes are being rebuilt. Full-text search is temporarily unavailable.
  Available: metadata search, vector similarity search
  Rebuilding: attachment text, filing text, pleading text, news articles
```

**Step 3: Disable FTS-dependent search controls**

- If the search UI has a "Search type" selector (e.g., "Full text", "Vector", "Metadata"), disable the "Full text" option and show a tooltip explaining why
- If there's a combined search that includes FTS, fall back to non-FTS modes only
- When all indexes become ready, remove the banner and re-enable controls automatically (via the polling hook)

**Verification:**
1. Start server without FTS indexes
2. Open search page — banner appears, FTS options disabled
3. Trigger FTS rebuild (via admin UI or CLI)
4. Banner updates to show progress
5. When rebuild completes, banner disappears and FTS options re-enable

---

### Task 9: Background FTS Rebuild on Startup

**Files:**
- Modify: `packages/server/src/cli/serve/api.ts` (or wherever the API server startup sequence lives)
- Modify: `packages/server/src/search/fts-index.ts`

**Step 1: Detect missing FTS indexes on startup**

During server startup, check whether the `fts_main_attachment` schema exists. If it doesn't, the FTS indexes need to be built. Mark all FTS indexes as not ready in the status registry.

```typescript
// Check for FTS schemas
const ftsSchemas = await conn.runAndReadAll(
  `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'fts_main_%'`
);
if (ftsSchemas.getRowObjectsJS().length < 4) {
  // Mark indexes as not ready, schedule background rebuild
}
```

**Step 2: Start serving immediately, rebuild in background**

The server should bind its port and start accepting requests **before** FTS indexes are built. Launch the FTS rebuild as an async background task (not awaited in the startup sequence):

```typescript
// Don't await — let the server start serving while indexes rebuild
void rebuildFtsInBackground(db, conn);
```

The `rebuildFtsInBackground` function should:
1. Set all FTS indexes to `rebuilding` status
2. Call `rebuildAllFtsIndexes(conn, db, true)` with `force: true`
3. On success, set all to `ready`
4. On failure, set `error` with the message, log the error

**Step 3: Also handle vector index rebuild if needed**

If the embedding table has rows but no HNSW index, rebuild it in the same background task.

**Verification:**
1. Create a DuckDB file with data but no FTS indexes (use `import-parquet`)
2. Start the API server pointing at it
3. Server starts accepting requests immediately
4. `/api/search/index-status` shows rebuilding
5. After rebuild completes, FTS search works

---

## Deployment Sequence

1. **Deploy Phase 1 (Tasks 1-3):** CDK changes + user-data.sh rewrite
   - First deploy: instance will still restore from S3 (EBS volume is new/empty)
   - Subsequent instance replacements: EBS volume persists, no S3 download
   - Task 4 (EBS snapshots) can be done later via AWS Console

2. **Deploy Phase 2 (Tasks 5-9):** Application changes
   - Merge Tasks 5-9 as a feature branch
   - After deploy, run `./daily-orbit db export-parquet` once to seed S3 Parquet files
   - Add to nightly pipeline schedule
   - Test disaster recovery by creating a fresh EBS volume and verifying Parquet fast-restore

## Rollback Plan

- Phase 1 rollback: Revert CDK to use NVMe + S3 restore (the old user-data.sh). The S3 snapshots continue running regardless.
- Phase 2 rollback: The Parquet export is additive — it doesn't affect the existing snapshot mechanism. Simply don't use `import-parquet` on startup.
