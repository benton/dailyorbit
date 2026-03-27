# DuckDB S3 Storage Tradeoffs: Reducing Instance Replacement Downtime

> Last updated: 2026-03-26

## Problem Statement

The current production setup runs DuckDB on ephemeral NVMe instance storage (ZFS-striped on `r6gd.xlarge`). When a spot instance is replaced, the new instance must download a 40GB database snapshot from S3, which takes ~8 minutes. During this time the application is down.

The goal is to dramatically reduce this recovery time while preserving as much of the current architecture's simplicity and performance as possible.

## Current Architecture

- **Instance**: `r6gd.xlarge` (ARM64, 4 vCPU, 32GB RAM, 1x237GB NVMe SSD)
- **Storage**: ZFS pool on ephemeral NVMe instance store, mounted at `/data`
- **Database**: 39 GiB DuckDB file
  - ~4-5 GiB core relational data (filings, attachments, embeddings, frequencies, etc.)
  - ~35 GiB derived data: FTS indexes (`fts_main_attachment` alone is 215 MiB estimated in-memory), vector indexes, full-text search dictionaries
- **Backup**: In-process `BackupService` does `FORCE CHECKPOINT` + file copy + S3 upload as timestamped `db/YYYYMMDD-HHMM.duckdb`
- **Restore**: `aws s3 cp` of latest snapshot during EC2 user-data boot
- **Shutdown hook**: systemd service triggers `./daily-orbit db snapshot` before termination

## Key Insight: Indexes Are Derived Data

The 39 GiB database breaks down as:

| Category | Estimated Size | Rebuildable? |
|----------|---------------|-------------|
| FTS indexes (4 schemas) | ~30-33 GiB | Yes — rebuilt from attachment/filing/pleading/news_item text |
| Vector embeddings table | ~350K rows | Partially — raw vectors stored, index structure rebuildable |
| Core relational tables | ~4-5 GiB | No — this is the source of truth |

This means you only need to download ~4-5 GiB to start serving, not 39 GiB.

---

## Strategies Evaluated

### Strategy 1: Persistent EBS Volume

**Recovery time: ~10-30 seconds (volume attach + Docker pull)**

Replace ephemeral NVMe with a persistent EBS gp3 volume that survives instance replacement.

| Factor | Detail |
|--------|--------|
| How it works | Create an EBS gp3 volume in the target AZ. User-data script finds it by tag, attaches, mounts. No S3 download needed |
| Performance vs NVMe | gp3 baseline: 3,000 IOPS / 125 MB/s. Provisionable up to 16,000 IOPS / 1,000 MB/s. ~2-5x slower than NVMe for sequential IO, but DuckDB's OLAP workload is typically CPU/memory-bound |
| AZ constraint | EBS volumes are AZ-specific. ASG must be pinned to a single AZ |
| Cost | 50GB gp3 = ~$4.00/mo. Provisioned IOPS extra if needed |
| Complexity | Low — CDK stack changes + user-data.sh modifications |
| Data loss window | Zero — volume persists across instance replacement |

**Verdict**: Simplest, highest-impact change. Eliminates the S3 download bottleneck entirely for the common case.

### Strategy 2: Partitioned Parquet Export + Lazy Index Rebuild

**Recovery time: ~8 seconds to serving (core data only), 10-15 min to full FTS**

Export core tables as Parquet to S3. On startup, download only core data, rebuild FTS indexes in background.

| Factor | Detail |
|--------|--------|
| How it works | Nightly: export each table as Parquet to S3. On startup: download core Parquet files (~4-5 GiB, ~8 sec), import into local DuckDB, start serving, rebuild FTS/vector indexes in background |
| S3 download time | 4-5 GiB at EC2's ~5 Gbps to S3 = ~8 seconds |
| Latency impact | Zero after load — data is in local DuckDB |
| FTS availability | Delayed 10-15 minutes while indexes rebuild in background |
| EXPORT gotcha | `EXPORT DATABASE` to S3 does not write `schema.sql`/`load.sql` (DuckDB bug [#9727](https://github.com/duckdb/duckdb/issues/9727)). Must generate these separately or export locally first |
| Complexity | Medium — new CLI subcommand, modified startup sequence, background index rebuild |

**Verdict**: Excellent fallback for disaster recovery (AZ change, EBS loss). Combined with Strategy 1, provides belt-and-suspenders resilience.

### Strategy 3: DuckLake (Native Lakehouse on S3)

**Recovery time: near-instant (data stays in S3)**

DuckLake stores metadata in a SQL catalog (Postgres/MySQL/SQLite) and data as Parquet files on S3.

| Factor | Detail |
|--------|--------|
| Architecture | `ATTACH 'ducklake:postgres://catalog-db' AS lake (DATA_PATH 's3://bucket/data/')` |
| Read/write | Full ACID with multi-client support when catalog is Postgres/MySQL |
| Latency | Every query hits S3. With `cache-httpfs` extension, cached queries approach local speed. Uncached: 10-50ms per S3 request |
| FTS compatibility | FTS indexes do **not** work on attached DuckLake databases |
| Maturity | v0.3, very new. Not suitable for production OLTP workloads yet |
| Recovery | New instance connects to same catalog + S3 path. Zero data transfer |

**Verdict**: Architecturally elegant but premature. FTS incompatibility is a dealbreaker. Worth revisiting when DuckLake reaches v1.0+.

### Strategy 4: S3 Express One Zone

**Recovery time: ~33 seconds (faster S3 download)**

S3 Express One Zone provides single-digit millisecond latency and ~10x faster throughput than standard S3.

| Factor | Detail |
|--------|--------|
| Download time | ~33 seconds for 40GB (benchmarked at ~1.2 GB/s) vs 8 minutes with standard S3 |
| Cost | Storage: $0.16/GB/mo (vs $0.023 standard). 40GB = $6.40/mo vs $0.92/mo |
| Constraint | Same AZ as the directory bucket |
| API | Uses "directory buckets" — different API surface from standard S3 |

**Verdict**: Makes S3-download approaches faster, but doesn't change the fundamental architecture. Useful as an accelerator for Strategy 2.

### Strategy 5: Read-Only S3 ATTACH + Write Queuing

**Recovery time: ~30 seconds**

ATTACH the DuckDB file from S3 as read-only, serve reads immediately, queue writes until local DB is ready.

| Factor | Detail |
|--------|--------|
| DuckDB support | Confirmed: `ATTACH 's3://bucket/db.duckdb' AS db (READ_ONLY)` works since DuckDB 1.1 |
| Read latency | 50-500ms per query depending on data touched |
| Write support | None — S3 ATTACH is strictly read-only. Writes must be queued and replayed |
| Complexity | High — requires write-queuing infrastructure in the application layer |

**Verdict**: Creative but adds substantial application complexity for marginal benefit over Strategy 2.

### Strategy 6: Smallpond / Distributed DuckDB

**Not applicable.** Smallpond is a batch ETL framework for 100TB+ scale sorts ("no long-running services"). The serverless-parquet-repartitioner is Lambda-based batch processing. Neither supports persistent read-write workloads.

### Strategy 7: MotherDuck

MotherDuck uses a proprietary FUSE layer that intercepts DuckDB's block-level writes and converts them to append-only snapshot layers backed by S3. There is **no open-source equivalent**. Would require giving up self-hosted architecture.

---

## Fundamental Constraint: DuckDB Cannot Write to S3

DuckDB's `.duckdb` format uses 256KB block-level random-access writes. S3's API only supports uploading whole objects. This means:

- **Cannot** ATTACH a DuckDB file on S3 for read-write access
- **Cannot** ship WAL to S3 (DuckDB often skips WAL entirely for batch operations)
- **Cannot** use S3 as a read-write filesystem for `.duckdb` files

Every approach that attempts to put the live `.duckdb` file on S3 for read-write access is a dead end.

---

## DuckDB Storage Performance Guidance

From the official DuckDB documentation:

- **NVMe/SSD**: Optimal. XFS on Linux preferred
- **EBS gp3/io2**: Supported for read-write. "Reliable cloud disks that guarantee high IO" recommended
- **Network-attached storage (NFS/SMB)**: "Not recommended for read-write mode" — slow, unpredictable, spurious errors
- **S3**: Read-only ATTACH supported. Read/write via Parquet COPY operations only

---

## Recommended Approach: Strategy 1 + 2 Combined

### Phase 1: Persistent EBS Volume (quick win)

- Pin ASG to one AZ
- Create gp3 EBS volume, attach via user-data.sh
- Keep S3 snapshots as disaster recovery
- **Result**: Recovery drops from ~8 min to ~10-30 sec

### Phase 2: Parquet Export + Lazy Index Rebuild (disaster recovery)

- Add `./daily-orbit db export-parquet` CLI subcommand
- Nightly export of core tables to S3 as Parquet
- Modified startup: fast Parquet import + background FTS rebuild
- **Result**: Even if EBS is lost, recovery is ~8 sec to serving + 10-15 min to full FTS

### Summary Table

| Approach | Startup | Read Latency | Write Latency | Monthly Cost | Complexity |
|----------|---------|-------------|---------------|-------------|------------|
| **Current** (NVMe + S3 restore) | 8 min | Fastest | Fastest | $0.92 (S3) | Low |
| **Phase 1** (EBS gp3) | 10-30 sec | ~2-5x slower | ~2-5x slower | +$4.00 | Low |
| **Phase 2** (Parquet fallback) | ~8 sec* | Same as current | Same as current | +$0 | Medium |
| **Phase 1+2** (combined) | 10-30 sec | ~2-5x slower | ~2-5x slower | +$4.00 | Medium |

\* to first query; FTS available after 10-15 min rebuild

---

## Relevant DuckDB Extensions

| Extension | Purpose | Status |
|-----------|---------|--------|
| `httpfs` | S3/HTTP file access, read-only ATTACH over S3 | Stable, core |
| `aws` | AWS SDK credential chain (instance metadata, SSO, env) | Stable, core |
| `ducklake` | Lakehouse format: Parquet on S3 + SQL catalog | v0.3, experimental |
| `iceberg` | Apache Iceberg tables (read + write via REST catalog) | Stable |
| `delta` | Delta Lake format (read + blind insert only) | Stable |
| `cache-httpfs` (external) | Read caching layer for S3, LRU eviction, block-aligned | Community |

## Useful References

- [DuckDB S3 API docs](https://duckdb.org/docs/stable/core_extensions/httpfs/s3api.html)
- [DuckDB ATTACH over S3](https://duckdb.org/docs/stable/sql/statements/attach.html) — read-only only
- [DuckDB storage performance guidance](https://duckdb.org/docs/stable/guides/performance/environment.html)
- [DuckLake](https://ducklake.select/) — lakehouse format from the DuckDB team
- [cache-httpfs extension](https://github.com/dentiny/duck-read-cache-fs) — S3 read caching
- [awesome-duckdb](https://github.com/davidgasquez/awesome-duckdb) — curated list of DuckDB tools
- [S3 Express One Zone](https://aws.amazon.com/s3/storage-classes/express-one-zone/) — low-latency S3
- [EXPORT DATABASE bug #9727](https://github.com/duckdb/duckdb/issues/9727) — schema.sql not written to S3
