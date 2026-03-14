# ICFS Filing Ingestion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the frozen IBFS FTP bulk ingest pipeline with a new ICFS-based pipeline that discovers and ingests filing data from the FCC's ServiceNow portal, including the v0.1.6 enrichment fields (red light status, transfer parties, service types).

**Architecture:** Two-phase HTTP-only pipeline using the unauthenticated ICFS ServiceNow SP APIs. Phase 1 (Search API) enumerates file numbers for a date range. Phase 2 (SP Page API) fetches full filing detail per file number and upserts into DuckDB. The existing attachment *download* pipeline is unaffected — this plan only replaces filing metadata and attachment *discovery*.

**Tech Stack:** TypeScript, native `fetch`, `node-html-parser` (for parsing inline HTML in comment attachment links), DuckDB via `@duckdb/node-api`, Vitest for tests.

---

## Background

### What exists today

1. **IBFS FTP ingest** (`packages/server/src/ingest/`): Downloads a ~300MB zip from `ftp://ftp.fcc.gov/.../IBFS.zip`, parses pipe-delimited `.dat` files via Sybase DDL schema, bulk-loads into DuckDB. **Frozen since 2025-06-18.**

2. **fcc.report attachment discovery** (`packages/server/src/attachments/`): Scrapes HTML from `fcc.report/IBFS/{file-number}` to find attachment metadata (names, download URLs). **Stale since June 2023.**

Both data sources are dead. The FCC migrated to ICFS (ServiceNow) on 2025-06-24.

### What the ICFS APIs provide (confirmed 2026-03-14)

**Search API** (`POST /api/now/sp/search`) — unauthenticated:
- Text search against `ibfs-search-applications` source
- Returns file numbers + applicant names + sys_ids
- Useful for enumerating new filings by date partition (e.g., `SAT-LOA-202503`)

**SP Page API** (`GET /api/now/sp/page?id=ibfs_application_summary&portal_id={portal_id}&number={file_number}`) — unauthenticated:
- Returns 41 summary fields (dates, status, applicant, contact, description, etc.)
- Filing Documents tab with attachment metadata (names, sys_ids, download URLs)
- Pleadings & Comments tab with filer names and exhibit links
- Transfer/assignment party data (`tc_asg_summary`)
- ITC 214 service type flags (`itc214ServiceTypes`)

Full details: `doc/fcc-filing-history.md` §4.1–4.4 and `doc/icfs-field-mapping.md`.

### What this plan does NOT cover

- Attachment binary file downloads (require authenticated sessions — separate project)
- Replacing the existing IBFS bulk data already loaded in DuckDB (it stays as-is for pre-2025-06-18 filings)
- Frontend changes

---

## Task 1: ICFS API Client — Types and Response Parsing

**Files:**
- Create: `packages/server/src/icfs/types.ts`
- Create: `packages/server/src/icfs/parse.ts`
- Create: `packages/server/src/icfs/parse.test.ts`

This task defines the TypeScript types for ICFS API responses and pure functions that extract structured data from them. No HTTP calls — just parsing.

### Step 1: Define ICFS types

Create `packages/server/src/icfs/types.ts`:

```typescript
/** ICFS ServiceNow portal constants */
export const ICFS_BASE_URL =
  'https://fccprod.servicenowservices.com' as const;
export const ICFS_PORTAL_ID =
  '6865628b1bd2625069c154e2604bcbf2' as const;

/** A single result from the ICFS search API */
export type IcfsSearchResult = {
  sysId: string;
  fileNumber: string;
  applicantName: string;
  subsystem: string;
};

/** Summary fields from the SP Page API filing detail */
export type IcfsFilingSummary = {
  fileNumber: string;
  sysId: string;
  callSign: string;
  applicantName: string;
  applicantFrn: string;
  applicantStreet: string;
  applicantCity: string;
  applicantState: string;
  applicantZipCode: string;
  applicantCountry: string;
  contactName: string;
  contactStreet: string;
  contactCity: string;
  contactState: string;
  contactZipCode: string;
  contactCountry: string;
  briefDescription: string;
  natureOfService: string;
  status: string;
  statusDate: string;
  submissionDate: string;
  grantDate: string;
  beginDate: string;
  expirationDate: string;
  lastAction: string;
  lastActionDate: string;
  afpnDate: string;
  actionPnDate: string;
  daNumber: string;
  redLightStatus: string;
  streamlined: string;
  environmentalImpact: string;
  legacyFilingKey: string;
  releaseDate: string;
  adoptedDate: string;
  acceptedPnDaNumber: string;
  actionPnDaNumber: string;
};

/** Transfer/assignment party data (populated for T/C and ASG filings) */
export type IcfsTransferParties = {
  transferorName: string;
  transferorStreet: string;
  transferorCity: string;
  transferorZipCode: string;
  transfereeName: string;
  transfereeStreet: string;
  transfereeCity: string;
  transfereeZipCode: string;
};

/** A single ITC 214 service type flag */
export type IcfsServiceType = {
  fieldName: string;
  label: string;
  value: string;
};

/** Attachment metadata from the Filing Documents tab */
export type IcfsAttachment = {
  sysId: string;
  documentName: string;
  description: string;
  createdOn: string;
  attachmentType: string;
};

/** A pleading/comment entry */
export type IcfsPleading = {
  number: string;
  sysId: string;
  pleadingType: string;
  filerName: string;
  createdOn: string;
  /** Raw HTML containing exhibit/attachment links */
  exhibitAttachmentHtml: string;
};

/** Complete parsed result from the SP Page API */
export type IcfsFilingDetail = {
  found: boolean;
  summary: IcfsFilingSummary | null;
  transferParties: IcfsTransferParties | null;
  serviceTypes: IcfsServiceType[];
  attachments: IcfsAttachment[];
  pleadings: IcfsPleading[];
};
```

### Step 2: Write failing tests for response parsing

Create `packages/server/src/icfs/parse.test.ts` with test fixtures. The test fixtures should be minimal subsets of real API responses — just enough structure to exercise the parser.

**Tests to write:**
- `parseSearchResponse` extracts file numbers and applicant names from search results
- `parseSearchResponse` returns empty array for zero results
- `parseFilingDetail` extracts all 36 summary fields from a real-shaped response
- `parseFilingDetail` returns `{ found: false }` for a missing filing
- `parseFilingDetail` extracts transfer parties from `tc_asg_summary`
- `parseFilingDetail` returns `null` transfer parties when `tc_asg_summary` is empty
- `parseFilingDetail` extracts service types from `itc214ServiceTypes`
- `parseFilingDetail` extracts attachment metadata from Filing Documents tab
- `parseFilingDetail` extracts pleading metadata from Pleadings & Comments tab

The test fixtures should be saved as JSON files in `packages/server/src/icfs/fixtures/` for readability. Create fixtures from the actual responses captured during the deep-dive (see `/tmp/icfs_page.json` or re-fetch live):
- `fixtures/search-sat-loa-2025.json` — trimmed to 2 results
- `fixtures/filing-detail-sat-loa-20250221-00050.json` — the ICEYE filing (has attachments, pleadings)
- `fixtures/filing-detail-sat-tc-20250917-00287.json` — the Eutelsat transfer (has tc_asg_summary)
- `fixtures/filing-detail-not-found.json` — a filing that returns `found: false`

Run: `pnpm test packages/server/src/icfs/parse.test.ts`
Expected: FAIL — `parseSearchResponse` and `parseFilingDetail` don't exist yet.

### Step 3: Implement parsers

Create `packages/server/src/icfs/parse.ts`:

```typescript
import type {
  IcfsAttachment,
  IcfsFilingDetail,
  IcfsFilingSummary,
  IcfsPleading,
  IcfsSearchResult,
  IcfsServiceType,
  IcfsTransferParties,
} from './types.ts';
```

**`parseSearchResponse(json: unknown): IcfsSearchResult[]`**
- Navigate `result.results` array
- Extract `sys_id` → `sysId`, `label` → `fileNumber`, and iterate `fields` for Applicant Name and Subsystem
- Return empty array if `result.results` is missing or empty

**`parseFilingDetail(json: unknown): IcfsFilingDetail`**
- Navigate to `result.containers[2].rows[0].columns[0].widgets[0].widget.data`
- If `data.found` is falsy, return `{ found: false, summary: null, transferParties: null, serviceTypes: [], attachments: [], pleadings: [] }`
- Extract `data.summary` — each field is `{ display_value, label }`. Map to `IcfsFilingSummary` by reading `display_value` for each key.
- Extract `data.record_id` → `sysId`
- Extract `data.tc_asg_summary` → `IcfsTransferParties` (null if empty/absent)
- Extract `data.itc214ServiceTypes` → `IcfsServiceType[]`
- Navigate `data.tabs.data.widgets[0].widgets[0].data.all_data` → attachment metadata
- Navigate `data.tabs.data.widgets[1].widgets[0].data.all_data` → pleading metadata

### Step 4: Run tests and verify they pass

Run: `pnpm test packages/server/src/icfs/parse.test.ts`
Expected: PASS

### Step 5: Commit

```
feat(icfs): add response types and parsers for ICFS ServiceNow API
```

---

## Task 2: ICFS HTTP Client

**Files:**
- Create: `packages/server/src/icfs/client.ts`
- Create: `packages/server/src/icfs/client.test.ts`

This task wraps the HTTP calls to the two ICFS endpoints. Integration tests hit the live API (guarded by a check for network availability).

### Step 1: Write integration tests

Create `packages/server/src/icfs/client.test.ts`:

**Tests:**
- `searchFilings("SAT-LOA-2025")` returns results with valid file numbers
- `searchFilings("SAT-LOA-2025")` results all have `subsystem === "SAT"`
- `searchFilings` with nonsense query returns empty array
- `getFilingDetail("SAT-LOA-20250221-00050")` returns found=true with populated summary
- `getFilingDetail("SAT-LOA-20250221-00050")` summary has correct applicant name
- `getFilingDetail("NONEXISTENT-00000000-99999")` returns found=false
- `getFilingDetail("SAT-T/C-20250917-00287")` returns populated transfer parties

Guard all tests with:
```typescript
const LIVE_API = process.env['ICFS_LIVE_TESTS'] === '1';
const describeIf = LIVE_API ? describe : describe.skip;
```

Run: `ICFS_LIVE_TESTS=1 pnpm test packages/server/src/icfs/client.test.ts`
Expected: FAIL — `searchFilings` and `getFilingDetail` don't exist yet.

### Step 2: Implement client

Create `packages/server/src/icfs/client.ts`:

```typescript
import { parseFilingDetail, parseSearchResponse } from './parse.ts';
import type { IcfsFilingDetail, IcfsSearchResult } from './types.ts';
import { ICFS_BASE_URL, ICFS_PORTAL_ID } from './types.ts';

export type SearchOptions = {
  source?: string;
  count?: number;
};

export async function searchFilings(
  query: string,
  options: SearchOptions = {},
): Promise<IcfsSearchResult[]> {
  const source: string = options.source ?? 'ibfs-search-applications';
  const count: number = options.count ?? 200;

  const response: Response = await fetch(
    `${ICFS_BASE_URL}/api/now/sp/search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        portal: ICFS_PORTAL_ID,
        source,
        count,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`ICFS search failed: ${String(response.status)}`);
  }

  const json: unknown = await response.json();
  return parseSearchResponse(json);
}

export async function getFilingDetail(
  fileNumber: string,
): Promise<IcfsFilingDetail> {
  const url = new URL(`${ICFS_BASE_URL}/api/now/sp/page`);
  url.searchParams.set('id', 'ibfs_application_summary');
  url.searchParams.set('portal_id', ICFS_PORTAL_ID);
  url.searchParams.set('number', fileNumber);

  const response: Response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `ICFS filing detail failed: ${String(response.status)}`,
    );
  }

  const json: unknown = await response.json();
  return parseFilingDetail(json);
}
```

### Step 3: Run integration tests

Run: `ICFS_LIVE_TESTS=1 pnpm test packages/server/src/icfs/client.test.ts`
Expected: PASS

### Step 4: Commit

```
feat(icfs): add HTTP client for search and filing detail APIs
```

---

## Task 3: ICFS Filing Discovery (Search-Based Enumeration)

**Files:**
- Create: `packages/server/src/icfs/discovery.ts`
- Create: `packages/server/src/icfs/discovery.test.ts`

This task implements the logic for enumerating new filings by constructing date-partitioned search queries.

### Step 1: Write tests

**`buildDiscoveryQueries(subsystems, appTypes, dateFrom, dateTo)`** should generate query strings partitioned by month:
- `buildDiscoveryQueries(["SAT"], ["LOA","MOD"], "2025-07", "2025-09")` → `["SAT-LOA-202507", "SAT-LOA-202508", "SAT-LOA-202509", "SAT-MOD-202507", "SAT-MOD-202508", "SAT-MOD-202509"]`
- `buildDiscoveryQueries(["SAT","SES"], ["LOA"], "2026-01", "2026-01")` → `["SAT-LOA-202601", "SES-LOA-202601"]`

**`discoverNewFilings(queries, options)`** is an integration test (live API, guarded):
- Discovers file numbers for a narrow date range
- Returns deduplicated results

Run: `pnpm test packages/server/src/icfs/discovery.test.ts`
Expected: FAIL

### Step 2: Implement

```typescript
import { searchFilings } from './client.ts';
import type { IcfsSearchResult } from './types.ts';

/** Build month-partitioned search queries for a date range */
export function buildDiscoveryQueries(
  subsystems: string[],
  appTypes: string[],
  dateFrom: string,   // "YYYY-MM"
  dateTo: string,     // "YYYY-MM"
): string[] {
  const months: string[] = generateMonthRange(dateFrom, dateTo);
  const queries: string[] = [];
  for (const sub of subsystems) {
    for (const app of appTypes) {
      for (const month of months) {
        queries.push(`${sub}-${app}-${month.replace('-', '')}`);
      }
    }
  }
  return queries;
}

/** Generate array of "YYYY-MM" strings from start to end inclusive */
export function generateMonthRange(from: string, to: string): string[] {
  // Parse "YYYY-MM", iterate months
  // ...
}

/** Run all discovery queries and return deduplicated file numbers */
export async function discoverNewFilings(
  queries: string[],
  options?: { delayMs?: number },
): Promise<IcfsSearchResult[]> {
  const seen = new Set<string>();
  const results: IcfsSearchResult[] = [];

  for (const query of queries) {
    const batch = await searchFilings(query);
    for (const r of batch) {
      if (!seen.has(r.fileNumber)) {
        seen.add(r.fileNumber);
        results.push(r);
      }
    }
    if (options?.delayMs) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
  }

  return results;
}
```

### Step 3: Run tests

Run: `pnpm test packages/server/src/icfs/discovery.test.ts`
Expected: PASS

### Step 4: Commit

```
feat(icfs): add date-partitioned filing discovery via search API
```

---

## Task 4: Schema Migration — Add ICFS Columns to Filing Table

**Files:**
- Create: `packages/server/src/icfs/schema.ts`
- Create: `packages/server/src/icfs/schema.test.ts`

This task adds new columns to the existing `filing` table for ICFS-sourced data and the v0.1.6 enrichment fields. It does NOT modify the existing ingest pipeline — it only extends the schema.

### Step 1: Write tests

Test that `ensureIcfsColumns(conn)` adds the expected columns to an existing `filing` table, and is idempotent (safe to run twice).

Use an in-memory DuckDB instance. Create a minimal `filing` table with just `file_number VARCHAR PRIMARY KEY`, then call `ensureIcfsColumns`, then verify the new columns exist via `information_schema.columns`.

### Step 2: Implement

Create `packages/server/src/icfs/schema.ts`:

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

/** New columns for ICFS-sourced filing data and v0.1.6 enrichment */
const ICFS_COLUMNS: Array<[string, string]> = [
  ['icfs_sys_id', 'VARCHAR'],
  ['applicant_frn', 'VARCHAR'],
  ['applicant_street', 'VARCHAR'],
  ['applicant_city', 'VARCHAR'],
  ['applicant_state', 'VARCHAR'],
  ['applicant_zip_code', 'VARCHAR'],
  ['applicant_country', 'VARCHAR'],
  ['contact_street', 'VARCHAR'],
  ['contact_city', 'VARCHAR'],
  ['contact_state', 'VARCHAR'],
  ['contact_zip_code', 'VARCHAR'],
  ['contact_country', 'VARCHAR'],
  ['da_number', 'VARCHAR'],
  ['red_light_status', 'VARCHAR'],
  ['streamlined', 'VARCHAR'],
  ['environmental_impact', 'VARCHAR'],
  ['nature_of_service', 'VARCHAR'],
  ['brief_description', 'VARCHAR'],
  ['transferor_name', 'VARCHAR'],
  ['transferor_street', 'VARCHAR'],
  ['transferor_city', 'VARCHAR'],
  ['transferor_zip_code', 'VARCHAR'],
  ['transferee_name', 'VARCHAR'],
  ['transferee_street', 'VARCHAR'],
  ['transferee_city', 'VARCHAR'],
  ['transferee_zip_code', 'VARCHAR'],
  ['icfs_service_types', 'VARCHAR'],   // JSON string of active service type flags
  ['icfs_last_fetched_at', 'TIMESTAMP'],
];

/**
 * Add ICFS-specific columns to the filing table.
 * Safe to call multiple times — uses ADD COLUMN IF NOT EXISTS.
 */
export async function ensureIcfsColumns(
  conn: DuckDBConnection,
): Promise<void> {
  for (const [name, type] of ICFS_COLUMNS) {
    await conn.run(
      `ALTER TABLE filing ADD COLUMN IF NOT EXISTS "${name}" ${type}`,
    );
  }
}
```

### Step 3: Run tests

Run: `pnpm test packages/server/src/icfs/schema.test.ts`
Expected: PASS

### Step 4: Commit

```
feat(icfs): add schema migration for ICFS and v0.1.6 enrichment columns
```

---

## Task 5: ICFS Filing Upsert — Write Parsed Data to DuckDB

**Files:**
- Create: `packages/server/src/icfs/repository.ts`
- Create: `packages/server/src/icfs/repository.test.ts`

### Step 1: Write tests

Use in-memory DuckDB. Set up a filing table with the base schema + ICFS columns (from Task 4).

**Tests:**
- `upsertIcfsFiling` inserts a new filing when `file_number` doesn't exist
- `upsertIcfsFiling` updates existing filing with new ICFS fields (preserves existing IBFS-sourced fields)
- `upsertIcfsFiling` for a transfer filing populates transferor/transferee columns
- `upsertIcfsFiling` sets `icfs_last_fetched_at` to current timestamp
- `upsertIcfsFiling` for a new filing (no `legacy_filing_key`) generates a synthetic `filing_key`

### Step 2: Implement

Create `packages/server/src/icfs/repository.ts`:

**`upsertIcfsFiling(conn, detail: IcfsFilingDetail): Promise<void>`**
- Maps `IcfsFilingSummary` fields → filing table columns
- If `legacy_filing_key` is present and numeric, use it as `filing_key`
- Otherwise generate a synthetic key (e.g., hash of file_number, or negative auto-increment)
- Uses `INSERT OR REPLACE` / `MERGE` on `file_number` as the match key
- Flattens `transferParties` into the `transferor_*` / `transferee_*` columns
- Serializes active service types as JSON string into `icfs_service_types`
- Parses `subsystem_code` and `app_type_code` from the file number

### Step 3: Run tests

Run: `pnpm test packages/server/src/icfs/repository.test.ts`
Expected: PASS

### Step 4: Commit

```
feat(icfs): add repository layer for upserting ICFS filing data
```

---

## Task 6: ICFS Ingestion Pipeline

**Files:**
- Create: `packages/server/src/icfs/pipeline.ts`
- Create: `packages/server/src/icfs/pipeline.test.ts`

This is the orchestrator that ties discovery → detail fetch → upsert together.

### Step 1: Write tests

Integration test (guarded by `ICFS_LIVE_TESTS=1`):
- Pipeline discovers and ingests at least 1 filing for a narrow query (e.g., a single known file number)
- Uses in-memory DuckDB
- Verifies the filing row exists with populated ICFS fields after pipeline completes

Unit test (mock fetch):
- Pipeline handles `found: false` gracefully (skips, doesn't error)
- Pipeline reports progress via callback
- Pipeline respects `delayMs` between requests

### Step 2: Implement

```typescript
import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { getFilingDetail } from './client.ts';
import { discoverNewFilings, buildDiscoveryQueries } from './discovery.ts';
import { upsertIcfsFiling } from './repository.ts';
import { ensureIcfsColumns } from './schema.ts';
import type { IcfsFilingDetail, IcfsSearchResult } from './types.ts';

export type IcfsIngestOptions = {
  dbInstance: DuckDBInstance;
  /** Subsystems to discover (default: ["SAT", "SES"]) */
  subsystems?: string[];
  /** Application types to discover (default: common SAT/SES types) */
  appTypes?: string[];
  /** Start month "YYYY-MM" */
  dateFrom: string;
  /** End month "YYYY-MM" */
  dateTo: string;
  /** Specific file numbers to fetch (skips search-based discovery) */
  fileNumbers?: string[];
  /** Delay between API requests in ms (default: 500) */
  delayMs?: number;
  onProgress?: (msg: string) => void;
};

export type IcfsIngestResult = {
  filingsDiscovered: number;
  filingsIngested: number;
  filingsNotFound: number;
  filingsFailed: number;
  durationMs: number;
};

export async function runIcfsIngest(
  options: IcfsIngestOptions,
): Promise<IcfsIngestResult> {
  // 1. Ensure schema is ready
  // 2. Discover file numbers (search API) OR use provided fileNumbers
  // 3. For each file number, fetch detail and upsert
  // 4. Report results
}
```

### Step 3: Run tests

Run: `pnpm test packages/server/src/icfs/pipeline.test.ts`
Expected: PASS

### Step 4: Commit

```
feat(icfs): add ingestion pipeline orchestrator
```

---

## Task 7: CLI and Make Targets

**Files:**
- Create: `packages/server/src/icfs/cli.ts`
- Modify: `Makefile` — add `icfs-ingest` target
- Create: `packages/server/src/icfs/index.ts`

### Step 1: Implement CLI

Create `packages/server/src/icfs/cli.ts`:

```typescript
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { closeAll } from '../lib/graceful-shutdown.ts';
import { runIcfsIngest } from './pipeline.ts';

/**
 * CLI entry point for ICFS filing ingestion.
 *
 * Usage:
 *   node src/icfs/cli.ts [options]
 *
 * Options:
 *   --database      Path to DuckDB file (default: data/daily-orbit.duckdb)
 *   --date-from     Start month YYYY-MM (required)
 *   --date-to       End month YYYY-MM (default: same as date-from)
 *   --subsystems    Comma-separated subsystems (default: SAT,SES)
 *   --app-types     Comma-separated app types (default: LOA,MOD,STA,AMD,T/C,ASG,LIC,RWL)
 *   --file-numbers  Comma-separated specific file numbers (skips discovery)
 *   --delay         Delay between requests in ms (default: 500)
 */
```

CLI parses args, creates DuckDB instance, calls `runIcfsIngest`, prints summary, exits.

### Step 2: Add Makefile targets

Add to `Makefile`:

```makefile
icfs-ingest: ## Ingest filings from ICFS for a date range (requires DATE_FROM, optional DATE_TO)
	node --no-warnings packages/server/src/icfs/cli.ts --date-from $(DATE_FROM) --date-to $(DATE_TO) $(ARGS)

icfs-ingest-filing: ## Ingest specific filings from ICFS (requires FILE_NUMBERS)
	node --no-warnings packages/server/src/icfs/cli.ts --file-numbers $(FILE_NUMBERS) $(ARGS)
```

### Step 3: Create barrel export

Create `packages/server/src/icfs/index.ts` exporting the public API:
- `runIcfsIngest` and its types
- `searchFilings`, `getFilingDetail` for ad-hoc use

### Step 4: Manual smoke test

Run against a single known filing:
```bash
make icfs-ingest-filing FILE_NUMBERS=SAT-LOA-20250221-00050
```

Verify the row in DuckDB has populated ICFS fields.

### Step 5: Commit

```
feat(icfs): add CLI and make targets for ICFS filing ingestion
```

---

## Task 8: Update Documentation and Roadmap

**Files:**
- Modify: `doc/roadmap.md` — mark v0.1.6 complete, update description
- Modify: `doc/fcc-filing-history.md` — note that ICFS ingest pipeline is operational

### Step 1: Update roadmap

Change:
```
- v0.1.6 [ ] HTML-only filing data: supplemental filings, transfer parties, service type, red light status
```
To:
```
- v0.1.6 [✅] ICFS filing ingestion: transfer parties, service types, red light status, enriched metadata
```

### Step 2: Update data source documentation

Add a note to `doc/fcc-filing-history.md` §4 indicating the ICFS ingest pipeline is operational and which make targets to use.

### Step 3: Commit

```
docs: update roadmap and data source docs for v0.1.6 ICFS ingestion
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `pnpm test` — all existing tests still pass
- [ ] `pnpm test packages/server/src/icfs/` — all new tests pass
- [ ] `make icfs-ingest-filing FILE_NUMBERS=SAT-LOA-20250221-00050` — ingests one filing
- [ ] `make icfs-ingest DATE_FROM=2025-12 DATE_TO=2025-12` — discovers and ingests a month of filings
- [ ] DuckDB filing row has populated `red_light_status`, `applicant_frn`, `icfs_sys_id` for ingested filings
- [ ] Transfer filing (e.g., `SAT-T/C-20250917-00287`) has populated `transferor_name`, `transferee_name`
- [ ] Existing IBFS-sourced filings are untouched (pre-2025-06-18 data preserved)
