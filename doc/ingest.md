# Data Ingest

The ingest pipeline loads FCC IBFS bulk data into the application's DuckDB database.

## Quick Start

```bash
# Download, extract, and load all tables in one command
make ingest-download

# Load from already-extracted data in tmp/IBFS/
make ingest

# Dry run — validate data without writing to DB
make ingest-dry-run

# Load specific tables
make ingest ARGS="--tables filing,status_code,frequency"
```

## Prerequisites

The pipeline needs IBFS data in `tmp/IBFS/`. Two options:

**Option A: Automatic download** (recommended)
```bash
make ingest-download
```
This fetches `IBFS.zip` via FTP, extracts it, and runs the full ingest.

**Option B: Manual download**
1. Download `IBFS.zip` from `ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip`
2. Unzip to `tmp/IBFS/`
3. Ensure `tmp/ibfs-schema.txt` exists (the Sybase DDL from the same FTP directory)
4. Run `make ingest`

## CLI Options

```
node packages/server/src/ingest/cli.ts [options]

--database    Path to DuckDB file       (default: data/daily-orbit.duckdb)
--ddl         Path to Sybase DDL file    (default: tmp/ibfs-schema.txt)
--dat-dir     Path to extracted .dat dir (default: tmp/IBFS)
--tables      Comma-separated table list (default: all available)
--dry-run     Parse and validate only
--download    Download and extract IBFS.zip before ingesting
--source-url  Override the FTP URL       (default: ftp://ftp.fcc.gov/...)
```

## Pipeline Stages

1. **Load table definitions** — Parses the Sybase DDL into `TableDef[]` structures with column names, types, and primary keys. The DDL is from 2008; tables with more data columns than DDL columns get `_extra_N` VARCHAR columns appended automatically.

2. **Validate** — Checks which `.dat` files exist and are non-empty. Optionally compares against the `counts` manifest (a `wc -l` output — note that line counts differ from record counts because some text fields contain embedded newlines).

3. **Parse** — Splits each `.dat` file on the `|^|\r\n` record terminator, then splits fields on `|`. Type coercion maps Sybase types to DuckDB types. Parse failures produce sentinel values (not NULLs) so "missing" and "invalid" are distinguishable.

4. **Deduplicate** — The FCC source data contains massive duplicate primary keys (e.g. `space_station` has 144,004 raw rows but only 837 unique `space_station_key` values). After parsing, rows are deduplicated by primary key, keeping the last occurrence per unique PK combination.

5. **Load** — On first load, uses the DuckDB Appender API for fast bulk insert. On subsequent loads, uses a swap-and-reconcile pattern (see below).

6. **Reconcile** — On upsert, the pipeline uses a **swap-and-reconcile** strategy instead of `MERGE INTO`:
   1. Rename the existing table to a backup (`_old` suffix)
   2. Create a fresh table and bulk-load the new snapshot via Appender
   3. Carry forward `_first_seen_at` from the backup using an MD5 hash of all data columns to match rows
   4. Drop the backup

   This avoids DuckDB's `MERGE INTO`, which cannot be used because duplicate PKs in the source data cause cartesian-product explosion in the MERGE join (O(n²) per PK group). The swap-and-reconcile approach is also faster than staging + MERGE for full-snapshot refreshes.

   Three change-tracking columns are maintained:
   - `_first_seen_at` — set on initial insert; preserved across reloads via row-content hash matching
   - `_last_seen_at` — set to `now()` on every load (all rows in the new snapshot get the current timestamp)
   - `_modified_at` — set to `now()` on every load (content change detection is implicit: rows whose content hash matches the backup retain their original `_first_seen_at`)

   Rows absent from a new snapshot are dropped (full snapshot reload). Stale records can be detected by comparing `_last_seen_at` across ingest runs via the `ingest_log` table.

## Architecture

```
runIngest(options)          — top-level orchestrator (pipeline.ts)
├── loadTableDefsFromDdl()  — DDL parser (ddl-parser.ts)
├── parseCountsManifest()   — manifest validation (pipeline.ts)
└── loadTable() per table   — per-table orchestration (pipeline.ts)
    ├── parseRecords()      — .dat parser (dat-parser.ts)
    ├── dedup by PK         — removes duplicate primary keys (pipeline.ts)
    ├── insertBatch()       — Appender bulk insert (loader.ts)
    └── upsertBatch()       — swap-and-reconcile upsert (loader.ts)
```

`runIngest()` is a standalone function with no server dependency. It can be called from:
- The CLI (`make ingest` or `make ingest-download`)
- The server process (admin UI), using the shared DuckDB instance:

```typescript
import { getDb } from './lib/db.ts';
import { runIngest } from './ingest/index.ts';

const db = await getDb();
const result = await runIngest({
  dbInstance: db,
  ddlPath: 'tmp/ibfs-schema.txt',
  datDir: 'tmp/IBFS',
  onProgress: (msg) => websocket.send(msg),
});
```

When `dbInstance` is provided, `databaseUrl` is ignored. The pipeline creates its own connection from the instance and closes it when done. DuckDB MVCC ensures readers are not blocked during the load.

## Metadata Tables

Two application-internal tables track ingest state:

- **`ingest_log`** — records each ingest run with `started_at`, `completed_at`, `status` (`running`/`completed`/`failed`), `source_url`, `zip_size_bytes`, `error_message`, and `table_results` (JSON array of per-table load results). The `ingest_id` is returned in `IngestResult` for programmatic access.
- **`unknown_columns`** — tracks extra columns beyond the DDL definition, with sample values for manual identification

## Table Naming

The FCC's central table is called `MAIN` in the DDL and stored as `main.dat`. In the application, this table is named **`filing`** to match the domain concept. All other tables use their lowercase DDL name.

## Sentinel Values

| DuckDB Type | Sentinel | Meaning |
|---|---|---|
| `VARCHAR` | `$$INVALID$$` | Field present but unparseable |
| `INTEGER` | `-2147483648` | Field present but not a valid integer |
| `DOUBLE` | `NaN` | Field present but not a valid number |
| `TIMESTAMP` | `0001-01-01T00:00:00` | Field present but not a valid datetime |
| `TINYINT` | `-128` | Field present but not a valid tinyint |

`NULL` means the field was empty or absent in the source data.

## Performance

Benchmarks on Apple Silicon (no parallelism):

| Scenario | Tables | Records | Time |
|---|---|---|---|
| Fresh load (all tables) | 67 | ~3.15M | ~15s |
| Upsert (swap-and-reconcile) | 67 | ~3.15M | ~20s |

The DuckDB Appender API handles 100k+ row inserts in under 1 second per table. The upsert overhead (~5s) comes from the rename → reload → hash-join → drop cycle per table.

Note: The raw FCC data contains ~3.5M rows, but after PK deduplication the actual record count is ~3.15M.
