# Data Ingest Plan (v0.1.0)

## 1. Data Source

The FCC publishes the complete IBFS database as a nightly bulk download:

- **URL**: `ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip`
- **Size**: ~48 MB compressed, ~297 MB uncompressed
- **Freshness**: Updated daily at midnight Eastern
- **Status**: Still active as of 2026-03-13, despite IBFS being renamed to ICFS in June 2025

The archive contains **71 pipe-delimited `.dat` files** totaling ~3.5M rows, plus a `counts` manifest.

### 1.1. Official Schema

An official Sybase DDL is published at `ftp://ftp.fcc.gov/pub/Bureaus/International/databases/ibfs.txt` (3,086 lines, last updated 2008). It defines all table structures, primary keys, and foreign key indexes. A local copy is saved at `tmp/ibfs-schema.txt`.

**Schema gap**: The DDL is from 2008. The actual data has extra columns (e.g. MAIN: 53 DDL columns vs ~71 data columns). We will use the DDL for the known columns and add the extra columns as `VARCHAR` with generated names (e.g. `_extra_54`, `_extra_55`, ...) until we can identify them. This is low-risk because DuckDB handles dynamic schema well.

### 1.2. File Format

| Property | Value |
|----------|-------|
| Delimiter | `\|` (pipe) |
| Record terminator | `\|^\|CRLF` (pipe, caret, pipe, CR, LF) |
| Headers | None — column order matches DDL |
| Quoting | None |
| Encoding | ASCII (with occasional extended-ASCII in `cond.dat`, `transmitter.dat`) |
| Date format | `Mon DD YYYY HH:MM:SS:mmmAM/PM` (e.g. `Feb 28 1996 12:00:00:000AM`) |
| Nulls | Empty string between delimiters |

The `|^|` terminator exists because some `text`/`varchar` fields contain embedded CR/LF characters. Parsers **must** split on `|^|\r\n` (or `|^|\n`), not on bare newlines.

---

## 2. Table Inventory

### 2.1. Core Entity Tables

These are the primary tables for the application's data model:

| Table (.dat) | Rows | Schema Cols | Data Cols | PK | Description |
|---|---|---|---|---|---|
| **FILING** (main.dat) | 160,001 | 53 | ~71 | filing_key | Central filing record: file number, subsystem, status, dates, applicant/contact refs. Source file is `main.dat`; app uses the name `filing` to avoid ambiguity. |
| **FORM_312** (form_312.dat) | 113,458 | 29 | ~41 | filing_key | Space & Earth Station app details: satellite, orbit, facility type, compliance flags |
| **SITE** (site.dat) | 96,221 | 30 | TBD | site_key | Earth station locations: lat/lon, elevation, address |
| **ANTENNA** (anten.dat) | 101,786 | 17 | TBD | antenna_key | Antenna specs: diameter, height, manufacturer, model, power |
| **FREQUENCY** (freq.dat) | 389,276 | 10 | ~14 | frequency_key | Frequency assignments: polarization, EIRP, emission, band |
| **ATTACHMENT** (attach.dat) | TBD | 7 | TBD | attachment_key | Filed documents: name, description, dates |
| **COMMENT** (comment.dat) | TBD | 5 | TBD | filing_key, date_entered | Public comments: commenter name, file reference |
| **ADDRESS** (address.dat) | 141,072 | 10 | ~15 | address_key | Applicant addresses |
| **CONTACT** (contact.dat) | 112,283 | 11 | ~13 | contact_key | Filing contacts |
| **SPACE_STATION** (space_sta.dat) | 144,004 | 5 | ~8 | space_station_key | Satellite reference: US name, ITU name, orbit location |
| **STATUS_TRACKING** (stat_track.dat) | 401,025 | 4 | ~5 | filing_key, status_code, status_date | Status change history |
| **FILING_HISTORY** (fil_hist.dat) | 140,333 | 3 | ~4 | filing_key, refer_filing_key, original_filing_key | Filing version chain |
| **PTCOMM** (ptcomm.dat) | 145,856 | TBD | TBD | ptcomm_key | Points of communication (site ↔ satellite links) |

### 2.2. Lookup/Code Tables

These are small reference tables (< 250 rows each):

| Table | Rows | Purpose |
|---|---|---|
| SUBSYSTEM_CODE | 18 | Subsystem identifiers (SAT, SES, ITC, ...) |
| APP_TYPE_CODE | 105 | Application type codes (LOA, AMD, STA, ...) |
| STATUS_CODE | 82 | Status codes (GRA, DFT, ...) |
| ACTION_CODE | 27 | Action codes |
| TYPE_APPLICANT_CODE | 10 | Applicant types |
| CLASS_OF_STATION_CODE | 18 | Station classes (FES, HUB, MES, ...) |
| COUNTRY_CODE | 248 | Country codes |
| STATE | 56 | US state codes |
| POLARIZATION_CODE | 8 | Polarization codes |
| NATURE_OF_SERVICE_CODE | 38 | Service codes (FSS, MSS, DBS, ...) |
| SECTION_214_CODE | 30 | Section 214 authority types |
| NOTE_TYPE_CODE | 10 | Note types |
| PURPOSE_CODE | 15 | Purpose codes |
| BLOCKED_REASON_CODE | 7 | Block reason codes |
| FREQUENCY_BAND | 42 | Frequency band definitions |

### 2.3. Other Tables (lower priority)

ASSIGNMENT, SECTION_214, ACCOUNTING_CHANGE, FORM_325C, PETITION_TO_DENY, ROA, DNIC, ISPC, PUB_NOTICE_*, TRANSMITTER, ANTENNA_GAIN, COORD_*, CONDITION, LICENSE_CONDITION, NOTE, KEYWORD, and various internal/admin tables.

---

## 3. Relationship Map

```
FILING (filing_key) ───────┬─── 1:1 ──── FORM_312 (filing_key)
  │  [source: main.dat]     ├─── 1:N ──── STATUS_TRACKING (filing_key)
  │                         ├─── 1:N ──── FILING_HISTORY (filing_key)
  │                         ├─── 1:N ──── ATTACHMENT (filing_key)
  │                         ├─── 1:N ──── COMMENT (filing_key)
  │                         ├─── 1:N ──── SITE (filing_key)
  │                         │               └─── 1:N ──── ANTENNA (site_key)
  │                         │                               └─── 1:N ──── FREQUENCY (antenna_key)
  │                         ├─── 1:N ──── PTCOMM (filing_key? via site)
  │                         ├─── N:1 ──── ADDRESS (address_key)
  │                         └─── N:1 ──── CONTACT (contact_key)
  │
  ├── subsystem_code ──────────── FK ──── SUBSYSTEM_CODE
  ├── app_type_code ───────────── FK ──── APP_TYPE_CODE
  ├── status_code ─────────────── FK ──── STATUS_CODE
  ├── class_of_station_code ───── FK ──── CLASS_OF_STATION_CODE
  └── type_applicant_code ─────── FK ──── TYPE_APPLICANT_CODE

SPACE_STATION (space_station_key) ── referenced by PTCOMM
```

---

## 4. Data Typing Strategy

### 4.1. DuckDB Type Mapping

| Sybase Type | DuckDB Type | Notes |
|---|---|---|
| `int` / `integer` | `INTEGER` | Primary/foreign keys |
| `tinyint` | `TINYINT` | |
| `smallint` | `SMALLINT` | |
| `float` | `DOUBLE` | |
| `char(N)` | `VARCHAR` | No fixed-width in DuckDB; trim trailing spaces |
| `varchar(N)` | `VARCHAR` | |
| `text` | `VARCHAR` | May contain embedded CR/LF |
| `datetime` | `TIMESTAMP` | Parse from `Mon DD YYYY HH:MM:SS:mmmAM/PM` |

### 4.2. Change Tracking Columns

Every entity table (core and lookup) gets three metadata columns appended by the ingest pipeline. These are **not** present in the FCC source data:

| Column | DuckDB Type | Description |
|---|---|---|
| `_first_seen_at` | `TIMESTAMP` | Set to `now()` when the row is first inserted |
| `_last_seen_at` | `TIMESTAMP` | Updated to `now()` on every ingest run where the row appears |
| `_modified_at` | `TIMESTAMP` | Updated to `now()` only when non-key column content has changed (detected by hash comparison during reconciliation) |

These columns enable the application to answer "what's new since the user last logged in" (User Story 5.2) without requiring the FCC data to carry its own modification timestamps.

### 4.3. Nullability and Sentinel Values

Per the requirements, all columns except those essential for relational consistency must be optional. The approach:

1. **Required columns** (NOT NULL): Only primary keys and the foreign keys that define relationships (e.g. `filing_key`, `site_key`, `antenna_key`).
2. **All other columns**: Nullable.
3. **Sentinel values for invalid data**: Rather than using SQL NULL for both "missing" and "invalid", we use application-level sentinel values:

| DuckDB Type | Sentinel for "Invalid" | Rationale |
|---|---|---|
| `VARCHAR` | `'$$INVALID$$'` | Never appears in real FCC data |
| `INTEGER` | `-2147483648` (INT_MIN) | No real key or count is this value |
| `DOUBLE` | `NaN` | IEEE 754 NaN — distinct from any real measurement |
| `TIMESTAMP` | `'0001-01-01T00:00:00'` | Clearly out-of-domain for FCC filings (1991+) |
| `TINYINT` | `-128` | Min value, never used in real data |

The ingest pipeline applies these sentinels when a field is present but fails to parse to its expected type. `NULL` means the field was empty/absent in the source data.

### 4.4. Extra (Unknown) Columns

For columns beyond the DDL definition (the schema gap), we:
1. Load them as `VARCHAR` with names `_extra_N` (where N is the 1-based column index)
2. Track them in a metadata table so they can be retroactively identified and re-typed
3. Log a sample of values on first ingest for manual review

---

## 5. Ingest Pipeline Design

### 5.1. Concurrency Model

DuckDB is an in-process database with MVCC. Multiple connections from the same `DuckDBInstance` can read and write concurrently without blocking each other. The ingest pipeline runs **in-process** with the server, using a separate `DuckDBConnection` from the shared instance (`getDb()` in `src/lib/db.ts`). This avoids needing to stop/restart the server for data refreshes. Each table load runs in its own transaction; readers see the previous consistent state until the transaction commits.

### 5.2. Overview

```
CLI Command                    Pipeline Stages
─────────                      ────────────────
orbital data scrape            ┌─────────────────┐
  [--date YYYY-MM-DD]    ───►  │  1. Download     │  FTP fetch → tmp/IBFS.zip
  [--date-range FROM TO]       │  2. Extract      │  Unzip → tmp/IBFS/
                               │  3. Validate     │  Compare counts manifest
                               │  4. Parse & Load │  .dat → DuckDB tables
                               │  5. Reconcile    │  Diff vs. prior load
                               │  6. Cleanup      │  Remove tmp files
                               └─────────────────┘
```

### 5.3. Stage Details

#### Stage 1: Download
- Fetch `IBFS.zip` via FTP (or HTTP fallback) to `tmp/`
- Support date-range parameter for future incremental feeds (if FCC ever provides them)
- For now, only a single "latest" snapshot is available — the entire DB each night

#### Stage 2: Extract
- Unzip to `tmp/IBFS/`
- Verify all expected `.dat` files are present

#### Stage 3: Validate
- Parse the `counts` manifest file
- Compare declared row counts against actual line counts (using `|^|` as record delimiter, not newlines)
- Log warnings for mismatches but do not abort — the FCC data has known inconsistencies

#### Stage 4: Parse & Load
- **Parser**: Custom TypeScript module that:
  1. Reads each `.dat` file as a binary buffer
  2. Splits records on `|^|\r\n` (with `|^|\n` fallback)
  3. Splits fields on `|`
  4. Maps columns by ordinal position using the table definition
  5. Coerces types, applying sentinels for parse failures
  6. Streams rows into DuckDB via batch `INSERT`
- **Load order**: Lookup tables first (no FKs), then core tables respecting FK dependencies:
  1. All `*_CODE` lookup tables, STATE, COUNTRY_CODE, SPACE_STATION
  2. ADDRESS, CONTACT
  3. FILING (from `main.dat`)
  4. FORM_312, ASSIGNMENT, SECTION_214, etc.
  5. SITE → ANTENNA → FREQUENCY (hierarchical)
  6. PTCOMM, STATUS_TRACKING, FILING_HISTORY, ATTACHMENT, COMMENT
- **Batch size**: 5,000 rows per INSERT for balance of speed and memory
- **Transaction**: Each table load is a single transaction; rollback on failure

#### Stage 5: Reconcile
- Since the FCC provides a full snapshot (not a diff), we need to detect changes:
  1. Load new data into staging tables (`_staging` suffix)
  2. Compare staging vs. current using primary keys and a hash of non-key columns
  3. Classify rows as: **new**, **modified**, **deleted**, **unchanged**
  4. Apply changes to production tables, updating change tracking columns (Section 4.2):
     - **new** rows: set `_first_seen_at`, `_last_seen_at`, `_modified_at` to `now()`
     - **modified** rows: update `_last_seen_at` and `_modified_at` to `now()`
     - **unchanged** rows: update `_last_seen_at` to `now()` only
     - **deleted** rows: leave in place (do not delete); `_last_seen_at` will not be updated, allowing the app to detect stale records
  5. Record change summary in an `ingest_log` metadata table
- This enables the "new information" surfacing feature (User Story 5.2)

#### Stage 6: Cleanup
- Remove tmp files after successful load
- Retain the `counts` manifest and ingest log for audit

### 5.4. Metadata Tables

These are application-internal tables (not from FCC data):

```sql
-- Tracks each ingest run
CREATE TABLE ingest_log (
    ingest_id       INTEGER PRIMARY KEY,
    started_at      TIMESTAMP NOT NULL,
    completed_at    TIMESTAMP,
    source_url      VARCHAR NOT NULL,
    zip_size_bytes  BIGINT,
    status          VARCHAR NOT NULL,  -- 'running', 'completed', 'failed'
    rows_inserted   INTEGER DEFAULT 0,
    rows_updated    INTEGER DEFAULT 0,
    rows_deleted    INTEGER DEFAULT 0,
    error_message   VARCHAR
);

-- Tracks unknown columns for future identification
CREATE TABLE unknown_columns (
    table_name      VARCHAR NOT NULL,
    column_index    INTEGER NOT NULL,
    column_alias    VARCHAR NOT NULL,   -- e.g. '_extra_54'
    sample_values   VARCHAR[],          -- first 10 non-null values seen
    identified_as   VARCHAR,            -- manually set once identified
    PRIMARY KEY (table_name, column_index)
);
```

---

## 6. Implementation Plan

### Step 1: Schema Definition Module
- Parse `ibfs.txt` DDL into a TypeScript data structure: `TableDef[]` with column names, types, nullability, PKs, FKs
- Map Sybase types to DuckDB types (per Section 4.1)
- Generate DuckDB `CREATE TABLE` statements
- Handle extra columns by detecting actual field count on first row of each `.dat` file

### Step 2: .dat File Parser
- Implement `IbfsParser` class/module:
  - `parseFile(filePath: string, tableDef: TableDef): AsyncIterable<Record<string, unknown>>`
  - Handles `|^|\r\n` record splitting
  - Handles pipe field splitting
  - Type coercion with sentinel fallback
  - Streaming (not full-file-in-memory) for the larger files

### Step 3: DuckDB Loader
- Implement `IbfsLoader`:
  - Creates/recreates tables from `TableDef[]`
  - Batch-inserts parsed rows
  - Transaction management per table

### Step 4: Reconciliation Logic
- Implement staging + diff for detecting new/modified/deleted rows
- Write to `ingest_log`

### Step 5: CLI Integration
- Wire into existing `orbital data scrape` command
- Add `--date`, `--date-range`, `--tables` (subset) flags
- Add `--dry-run` flag (download + validate + report, no DB writes)

### Step 6: Tests
- **Unit**: Parser tests with crafted .dat snippets (embedded CR/LF, missing fields, type coercion failures)
- **Integration**: Full load of a small subset into in-memory DuckDB
- **Validation**: Spot-check row counts and key field values against known data

---

## 7. Key Decisions and Risks

| Decision | Rationale |
|---|---|
| Full snapshot diff, not incremental | FCC only provides full snapshots; no delta feed exists |
| Custom parser, not DuckDB `read_csv` | The `\|^\|CRLF` terminator and embedded newlines make standard CSV readers unreliable |
| Sentinel values over NULL-overloading | Distinguishing "absent" from "invalid" is important for data quality reporting |
| Extra columns as VARCHAR | Safe default; can be re-typed once identified |
| Lookup tables loaded first | Ensures FK integrity if we ever enable constraints |
| `main.dat` → `filing` table | "MAIN" is too generic for app code; `filing` matches the domain concept (an ICFS Filing) |
| Soft-delete on reconcile | Rows missing from a snapshot are not deleted; `_last_seen_at` stops updating, preserving history |
| In-process ingest via second connection | DuckDB MVCC allows concurrent read/write; no server restart needed |

| Risk | Mitigation |
|---|---|
| FCC discontinues FTP feed | Monitor; the ICFS transition hasn't broken it yet. fcc.report RSS as backup signal |
| Schema drift (new columns appear) | Auto-detect via field count; log to `unknown_columns` |
| Embedded delimiters in text fields | The `\|^\|` terminator handles this; parser tested against known edge cases |
| Large file memory pressure | Streaming parser; batch inserts |
| Data quality issues | Lenient parsing with sentinels; validation report per ingest |

---

## 8. References

| Resource | URL |
|---|---|
| IBFS Bulk Download (ZIP) | `ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip` |
| IBFS Schema DDL | `ftp://ftp.fcc.gov/pub/Bureaus/International/databases/ibfs.txt` |
| SUSS Documentation (PDF) | `https://transition.fcc.gov/oet/info/software/suss/sussdoc.pdf` |
| ICFS User Guide (2025) | `https://www.fcc.gov/sites/default/files/ICFS-User-Guide.pdf` |
| FCC Form 312 Instructions | `https://transition.fcc.gov/Forms/Form312/312Fill.pdf` |
| data.gov Catalog Entry | `https://catalog.data.gov/dataset/international-bureau-filing-system-ibfs` |
| fcc.report Mirror + RSS | `https://fcc.report/IBFS/` |
| License View API | `https://www.fcc.gov/reports-research/developers/license-view-api` |
| Protected FSS Earth Station API | `https://opendata.fcc.gov/resource/acbv-jbb4.json` |
| node-uls (TypeScript reference) | `https://github.com/KW4JLB/node-uls` |
| GatiAher FCC Scrapers (Python) | `https://gatiaher.github.io/projects/fcc-data-scrapers/` |
