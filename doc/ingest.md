# Data Ingest

The ingest pipeline loads FCC IBFS bulk data into the application's DuckDB database.

## Quick Start

```bash
# Dry run — validate data without writing to DB
make ingest-dry-run

# Load all available tables
make ingest

# Load specific tables
make ingest ARGS="--tables filing,status_code,frequency"
```

## Prerequisites

The pipeline expects extracted IBFS data in `tmp/IBFS/`. To obtain it:

1. Download `IBFS.zip` from `ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip`
2. Unzip to `tmp/IBFS/`
3. Ensure `tmp/ibfs-schema.txt` exists (the Sybase DDL from the same FTP directory)

## CLI Options

```
node packages/server/src/ingest/cli.ts [options]

--database   Path to DuckDB file       (default: data/daily-orbit.duckdb)
--ddl        Path to Sybase DDL file    (default: tmp/ibfs-schema.txt)
--dat-dir    Path to extracted .dat dir (default: tmp/IBFS)
--tables     Comma-separated table list (default: all available)
--dry-run    Parse and validate only
```

## Pipeline Stages

1. **Load table definitions** — Parses the Sybase DDL into `TableDef[]` structures with column names, types, and primary keys. The DDL is from 2008; tables with more data columns than DDL columns get `_extra_N` VARCHAR columns appended automatically.

2. **Validate** — Checks which `.dat` files exist and are non-empty. Optionally compares against the `counts` manifest (a `wc -l` output — note that line counts differ from record counts because some text fields contain embedded newlines).

3. **Parse** — Splits each `.dat` file on the `|^|\r\n` record terminator, then splits fields on `|`. Type coercion maps Sybase types to DuckDB types. Parse failures produce sentinel values (not NULLs) so "missing" and "invalid" are distinguishable.

4. **Load** — On first load, uses the DuckDB Appender API for fast bulk insert. On subsequent loads, uses a staging table + `MERGE INTO` for upsert with change detection.

5. **Reconcile** — The MERGE step compares incoming rows against existing rows using primary keys and an MD5 hash of non-key columns. Three change-tracking columns are maintained:
   - `_first_seen_at` — set once on initial insert
   - `_last_seen_at` — updated every time the row appears in a snapshot
   - `_modified_at` — updated only when non-key column content changes

   Rows missing from a new snapshot are **not deleted** (soft delete). Their `_last_seen_at` stops advancing, allowing the app to detect stale records.

## Architecture

```
runIngest(options)          — top-level orchestrator (pipeline.ts)
├── loadTableDefsFromDdl()  — DDL parser (ddl-parser.ts)
├── parseCountsManifest()   — manifest validation (pipeline.ts)
└── loadTable() per table   — per-table orchestration (pipeline.ts)
    ├── parseRecords()      — .dat parser (dat-parser.ts)
    ├── insertBatch()       — Appender bulk insert (loader.ts)
    └── upsertBatch()       — staging + MERGE upsert (loader.ts)
```

`runIngest()` is a standalone function with no server dependency. It can be called from:
- The CLI (`make ingest`)
- The server process (future admin UI), using a second DuckDB connection from the shared instance

## Metadata Tables

Two application-internal tables track ingest state:

- **`ingest_log`** — records each ingest run (start/end time, status, error message, table results)
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

Benchmarks on a single core (no parallelism):

| Tables | Records | Time |
|---|---|---|
| 3 lookup tables | 127 | <1s |
| 6 core tables (incl. filing + frequency) | 674,571 | ~6s |

The DuckDB Appender API handles 100k+ row inserts in under 1 second per table.
