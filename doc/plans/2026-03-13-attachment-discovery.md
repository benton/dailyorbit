# v0.1.5: Attachment Discovery and Download

## Context

The FCC IBFS bulk FTP download (`IBFS.zip`) does **not** include attachment data — `attach.dat` is missing despite the Sybase DDL defining an `ATTACHMENT` table. Meanwhile, fcc.report (a third-party mirror) has attachment metadata and downloadable PDFs for every filing. The official FCC licensing site is currently offline (government funding lapse).

This plan adds a new `attachments` module that discovers attachment metadata by scraping fcc.report, stores it in DuckDB, and downloads the actual files to local storage (S3 later). The module is fully isolated from the existing FTP ingest pipeline and assumes it has already run.

## Key Discoveries

- **File numbers** are stored compact in DB (`SATSTA2023061400142`) but fcc.report uses hyphenated URLs (`SAT-STA-20230614-00142`). Conversion requires `subsystem_code` + `app_type_code` columns from the `filing` table.
- **fcc.report pages are server-side rendered** — simple HTML tables, no JS rendering. Standard fetch + HTML parsing suffices.
- **Attachment IDs** are large positive integers (e.g., `22902690`) in the URL path.
- **Download URLs**: `https://fcc.report/IBFS/{hyphenated-file-number}/{attachment-id}.pdf`
- **141K filings** in DB across 13 subsystems. SES dominates (105K), then ITC (15K), SAT (7K).

## Module Structure

```
packages/server/src/attachments/
  types.ts              — Shared types
  file-number.ts        — Compact <-> hyphenated file number conversion
  html-parser.ts        — Pure fn: HTML string -> AttachmentMetadata[]
  repository.ts         — DuckDB attachment table ops (Repository pattern)
  storage.ts            — Deterministic path generation + local fs download
  provider.ts           — DiscoveryProvider interface + factory
  fcc-report.ts         — FccReportProvider (scrapes fcc.report)
  fcc-gov.ts            — FccGovProvider (stub, prints message)
  pipeline.ts           — Orchestrator: discover -> store metadata -> download
  cli.ts                — CLI entry point (parseArgs)
  index.ts              — Public exports
  *.test.ts             — Tests alongside source
```

## Implementation Steps

### Step 1: Types (`types.ts`)

```typescript
type AttachmentMetadata = {
  attachmentKey: number;       // integer ID from fcc.report URL
  filingKey: number;           // FK to filing.filing_key
  fileNumber: string;          // compact format (from DB)
  attachmentName: string;      // link text from scraper
  description: string;         // type column from scraper
  downloadUrl: string;         // full URL
};

type DiscoveryScope = {
  fileNumbers?: string[];      // compact file_numbers
  subsystems?: string[];       // e.g. ['SAT', 'SES']
  dateFrom?: string;           // ISO date
  dateTo?: string;
  limit?: number;
};

type DiscoveryProvider = {
  name: string;
  discover(fileNumber: string, filingKey: number): Promise<AttachmentMetadata[]>;
};

type AttachmentPipelineOptions = {
  databaseUrl?: string;
  dbInstance?: DuckDBInstance;
  storageBasePath: string;
  provider?: 'fcc-report' | 'fcc-gov';
  scope: DiscoveryScope;
  discoverOnly?: boolean;
  retryFailed?: boolean;
  delayMs?: number;            // default 500
  onProgress?: (msg: string) => void;
};

type AttachmentPipelineResult = {
  filingsProcessed: number;
  attachmentsDiscovered: number;
  attachmentsDownloaded: number;
  attachmentsFailed: number;
  durationMs: number;
};
```

### Step 2: File Number Conversion (`file-number.ts`)

Pure function. Uses `subsystem_code` + `app_type_code` from DB to split compact format:
- `compactToHyphenated('SATSTA2023061400142', 'SAT', 'STA')` -> `'SAT-STA-20230614-00142'`
- Handles edge case: `T/C` app type code (contains `/`)

Tested with parameterized cases covering SAT, SES, ITC, 325, T/C types.

### Step 3: HTML Parser (`html-parser.ts`)

Pure function: `parseAttachmentsFromHtml(html: string, fileNumber: string, filingKey: number): AttachmentMetadata[]`

Uses `node-html-parser` (lightweight, zero-dep). Finds the attachments table, extracts from each row:
- Attachment name (link text)
- Attachment ID (from href path: `/IBFS/{file-number}/{id}`)
- Description/type (second column)
- Constructs download URL

Tested with saved HTML fixture strings. Edge cases: no attachments, malformed HTML, missing columns.

### Step 4: Repository (`repository.ts`)

DuckDB operations following Repository pattern (D-1). Extended schema beyond DDL:

```sql
CREATE TABLE IF NOT EXISTS attachment (
  attachment_key INTEGER NOT NULL PRIMARY KEY,
  filing_key INTEGER NOT NULL,
  attachment_name VARCHAR NOT NULL,
  description VARCHAR NOT NULL DEFAULT '',
  download_url VARCHAR NOT NULL,
  download_status VARCHAR NOT NULL DEFAULT 'pending',
  file_size_bytes BIGINT,
  local_path VARCHAR,
  discovered_at TIMESTAMP NOT NULL,
  downloaded_at TIMESTAMP
)
```

Key functions:
- `createAttachmentTable(conn)`
- `upsertAttachments(conn, attachments[])` -> `{ inserted, existing }`
- `getFilingsForScope(conn, scope)` -> `{ filingKey, fileNumber, subsystemCode, appTypeCode }[]`
- `getPendingDownloads(conn, scope)` -> attachment rows with status='pending' or 'failed'
- `markDownloaded(conn, attachmentKey, localPath, fileSizeBytes)`
- `markFailed(conn, attachmentKey)`

### Step 5: Storage (`storage.ts`)

Deterministic path: `{basePath}/{subsystem}/{hyphenated-file-number}/{attachmentKey}.pdf`

Example: `data/attachments/SAT/SAT-STA-20230614-00142/22902690.pdf`

Functions:
- `attachmentStoragePath(basePath, subsystem, hyphenatedFileNumber, attachmentKey)` -> string
- `downloadFile(url: string, destPath: string)` -> `{ fileSizeBytes: number }`
- `fileExists(path: string)` -> boolean

Uses `fetch()` (Node 24 built-in) + `fs.writeFile`. Creates dirs with `mkdir({ recursive: true })`.

### Step 6: Provider Interface + Implementations

**`provider.ts`**: Factory `createProvider(name, options?)` -> `DiscoveryProvider`

**`fcc-report.ts`**: Full implementation.
- `discover(fileNumber, filingKey)`:
  1. Convert compact -> hyphenated file number
  2. `fetch('https://fcc.report/IBFS/{hyphenated}')`
  3. Parse HTML -> `AttachmentMetadata[]`
- Needs subsystem/apptype for conversion — get from filing row or derive from file_number prefix

**`fcc-gov.ts`**: Stub. `discover()` logs message, returns `[]`.

### Step 7: Pipeline (`pipeline.ts`)

`runAttachmentPipeline(options)` -> `AttachmentPipelineResult`

1. Connect to DB, ensure attachment table exists
2. Query filings matching scope (using repository)
3. For each filing (sequentially, with delay):
   a. Call `provider.discover()`
   b. Upsert metadata into attachment table
   c. Report progress
4. If not `discoverOnly`, iterate pending downloads:
   a. Compute storage path
   b. Check `fileExists()` — if yes, mark downloaded + skip
   c. Download file, mark downloaded or failed
   d. Respect delay between downloads
5. Return summary

### Step 8: CLI (`cli.ts`)

```
node packages/server/src/attachments/cli.ts [options]

Options:
  --database       DuckDB path (default: data/daily-orbit.duckdb)
  --storage-path   Base path for files (default: data/attachments)
  --filing         Comma-separated file numbers
  --subsystem      Comma-separated subsystem codes (SAT, SES, etc.)
  --date-from      YYYY-MM-DD
  --date-to        YYYY-MM-DD
  --limit          Max filings to process
  --discover-only  Discover metadata only, skip downloads
  --retry-failed   Re-attempt failed downloads
  --delay          ms between requests (default: 500)
  --provider       fcc-report (default) | fcc-gov
```

### Step 9: Makefile Targets

```makefile
attachments:          ## Discover and download attachments
attachments-discover: ## Discover attachment metadata only
```

## Dependency

Add `node-html-parser` to `packages/server/package.json`.

## Test Strategy

| File | Type | What |
|------|------|------|
| `file-number.test.ts` | Unit | Parameterized conversion tests (SAT, SES, ITC, 325, T/C) |
| `html-parser.test.ts` | Unit | Parse fixture HTML strings, edge cases |
| `repository.test.ts` | Integration | In-memory DuckDB: table creation, upsert idempotency, scoping queries |
| `storage.test.ts` | Unit | Path determinism; integration: actual fs write to tmp dir |
| `pipeline.test.ts` | Integration | Mock provider + in-memory DB + tmp dir, verify full flow + idempotency |

## Implementation Order (TDD)

1. `types.ts`
2. `file-number.ts` + test (pure logic first)
3. `html-parser.ts` + test (pure logic, fixture HTML)
4. `repository.ts` + test (in-memory DuckDB)
5. `storage.ts` + test (path logic + fs)
6. `fcc-gov.ts` (trivial stub)
7. `fcc-report.ts` (uses html-parser + file-number)
8. `provider.ts` (factory)
9. `pipeline.ts` + test (integration with mock provider)
10. `cli.ts` + `index.ts`
11. Makefile targets

## Verification

1. `make test` — all new tests pass
2. `make attachments-discover ARGS="--filing SATSTA2023061400142 --limit 1"` — discovers 3 attachments
3. `make attachments ARGS="--filing SATSTA2023061400142 --limit 1"` — downloads 3 PDFs to `data/attachments/SAT/SAT-STA-20230614-00142/`
4. Re-run same command — idempotent, 0 new downloads
5. `make attachments-discover ARGS="--subsystem SAT --limit 5"` — discovers attachments for 5 SAT filings
