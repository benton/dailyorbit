# Plan: v0.3.5 — Comments & Pleadings

## Problem

The ICFS ingest pipeline fetches full filing details from the ServiceNow API,
which include parsed pleading/comment metadata (`IcfsFilingDetail.pleadings:
IcfsPleading[]`). But the pipeline only writes filing-level data and attachment
metadata — **pleadings are parsed then discarded**.

As a result, the "Comments & Petitions" section on filing detail pages is empty
for all ICFS-sourced filings. The legacy `petition_to_deny` table (from the
frozen IBFS bulk export) contains only 24 rows across 13 filings — effectively
useless.

## Goal

Persist ICFS pleading data during the existing ingest pipeline, expose it
through the API, and display it on the filing detail page — with zero
additional HTTP requests.

## Request efficiency

**Zero additional HTTP requests.** The ICFS `getFilingDetail()` call already
returns pleadings in the same JSON response as filing metadata and attachments.
This plan extracts the pleading data from that response and persists it.

The request flow per filing stays exactly the same:

```
1 search request per (subsystem × appType × month)  → file number list
1 detail request per filing                          → filing + attachments + pleadings
```

## Data model

### ICFS source fields (`IcfsPleading` — already parsed)

| Field                  | Example                              |
|------------------------|--------------------------------------|
| `number`               | `PC0106846`                          |
| `sysId`                | `14f75dbe97393e108031b22de053afb5`   |
| `pleadingType`         | `LETTER`, `PETITION`, `COMMENT`      |
| `filerName`            | `Nate Woodford`                      |
| `createdOn`            | `2025-12-17 07:23:47`                |
| `exhibitAttachmentHtml`| Raw HTML with `sys_attachment.do` links |

### Legacy `petition_to_deny` (24 rows, frozen)

| Column       | Type      |
|--------------|-----------|
| filing_key   | INTEGER   |
| filed_by     | VARCHAR   |
| date_filed   | TIMESTAMP |
| description  | VARCHAR   |

---

## Tasks

### Task 1: Create `pleading` table and repository

**Files:** `packages/server/src/icfs/repository.ts`, new test in `repository.test.ts`

Create a `pleading` table following the attachment table pattern:

```sql
CREATE TABLE IF NOT EXISTS pleading (
  pleading_key INTEGER NOT NULL,
  filing_key INTEGER NOT NULL,
  file_number VARCHAR NOT NULL,
  icfs_sys_id VARCHAR NOT NULL,
  pleading_number VARCHAR NOT NULL,
  pleading_type VARCHAR NOT NULL,
  filer_name VARCHAR NOT NULL,
  created_on TIMESTAMP,
  exhibit_attachment_html VARCHAR,
  ingested_at TIMESTAMP NOT NULL DEFAULT current_timestamp
)
```

Repository functions (mirror `attachments/repository.ts` pattern):

- `createPleadingTable(conn)` — CREATE TABLE IF NOT EXISTS
- `icfsPleadingsToRows(pleadings, filingKey, fileNumber)` — maps `IcfsPleading[]`
  to DB rows using `sysIdToInt(sysId, 0)` for deterministic `pleading_key`
- `upsertPleadings(conn, rows[])` — insert-if-not-exists by `pleading_key`

### Task 2: Hook into ICFS pipeline

**File:** `packages/server/src/icfs/pipeline.ts`

After the attachment upsert block (line ~163), add:

```typescript
if (detail.pleadings.length > 0 && detail.summary != null) {
  const rows = icfsPleadingsToRows(
    detail.pleadings,
    filingKey,
    fileNumber as FileNumber,
  );
  await upsertPleadings(conn, rows);
}
```

Also call `createPleadingTable(conn)` in the schema setup section (line ~68).

### Task 3: Migrate legacy `petition_to_deny` → `pleading`

**Rationale:** Only 24 rows in `petition_to_deny`. Rather than maintaining two
tables and a UNION query, migrate the 24 rows into the `pleading` table with
synthetic values:

- `pleading_key` = deterministic hash of `filing_key + filed_by + date_filed`
- `icfs_sys_id` = `'ibfs-legacy'`
- `pleading_number` = `''`
- `pleading_type` = `'PETITION'`
- `filer_name` = `filed_by`
- `created_on` = `date_filed`
- `exhibit_attachment_html` = `NULL`

Add a one-time migration function. After migration, the `petition_to_deny`
table is no longer queried.

### Task 4: Update API layer

**Files:** `packages/server/src/filings/types.ts`, `packages/server/src/filings/repository.ts`

Update `FilingPetition` type:

```typescript
export type FilingPetition = {
  filingKey: number;
  partyName: string | null;
  dateFiled: string | null;
  description: string | null;
  pleadingType: string | null;    // NEW
  pleadingNumber: string | null;  // NEW
};
```

Replace `fetchPetitions()` to query the `pleading` table instead of
`petition_to_deny`:

```sql
SELECT filing_key, filer_name, created_on, pleading_type, pleading_number
FROM pleading
WHERE filing_key = $1
ORDER BY created_on
```

### Task 5: Enhance frontend

**File:** `packages/web/src/filings/FilingDetail.tsx`

Update the "Comments & Petitions" table:

- Add **Type** column with a styled badge/pill (e.g., LETTER in blue,
  PETITION in amber, COMMENT in gray)
- Add **Number** column (the pleading reference, e.g., `PC0106846`)
- Keep existing Party and Date columns
- Remove Description column (ICFS pleadings don't carry inline text — the
  content is in the exhibit attachments)

### Task 6: Parse exhibit attachment links (stretch)

**File:** `packages/server/src/icfs/parse.ts` (new function)

Parse `exhibitAttachmentHtml` to extract `<a href="...sys_attachment.do...">` URLs.
Insert into the `attachment` table with `source = 'pleading_exhibit'`, making them
downloadable through the existing attachment pipeline.

This reuses `node-html-parser` (already a dependency for attachment parsing).

### Task 7: Tests

**Unit tests:**
- `upsertPleadings()` with in-memory DuckDB — insert, dedup on re-insert
- `icfsPleadingsToRows()` — deterministic key generation, field mapping
- Legacy migration function — 24 rows migrate correctly

**Integration tests:**
- Pipeline round-trip: parse fixture → persist → query via `fetchPetitions()`
- API endpoint returns populated `petitions` array for a filing with pleadings

---

## Open questions

1. **Company attribution for filers** — `filer_name` could be attributed to
   companies via alias matching (same logic as `attributeFiling()`). This would
   enable "who is commenting on whose filings" analysis. Defer to v0.4+?

2. **Timeline view** — the roadmap mentions "timelines" alongside comments.
   A chronological view combining filing events, status changes, and pleadings
   would be a natural companion. Separate task or part of v0.3.5?

3. **Pleading type enumeration** — we've observed `LETTER`, `PETITION`,
   `COMMENT`. Need to discover the full set of `pleading_type` values from
   a broader sample of ICFS data. Run a discovery pass after the remediation
   completes.

---

## Dependency: remediation must finish first

The remediation script currently running will re-ingest all ICFS filings. Once
this plan is implemented and the pipeline is updated, a **second re-ingest
pass** will be needed to backfill pleading data for all previously ingested
filings (since the current pipeline discards pleadings).

Alternatively, implement Tasks 1-2 before the remediation completes, so the
re-ingest picks up pleadings automatically.

---

## File inventory

| Purpose                    | Path                                                |
|----------------------------|-----------------------------------------------------|
| ICFS types (IcfsPleading)  | `packages/server/src/icfs/types.ts`                 |
| ICFS parsing               | `packages/server/src/icfs/parse.ts`                 |
| ICFS repository            | `packages/server/src/icfs/repository.ts`            |
| ICFS pipeline              | `packages/server/src/icfs/pipeline.ts`              |
| Filing types               | `packages/server/src/filings/types.ts`              |
| Filing repository          | `packages/server/src/filings/repository.ts`         |
| Attachment repository      | `packages/server/src/attachments/repository.ts`     |
| Frontend detail page       | `packages/web/src/filings/FilingDetail.tsx`          |
| Test fixture (with pleadings) | `packages/server/src/icfs/fixtures/filing-detail-sat-loa-20250221-00050.json` |
| Ingestion pipeline doc     | `doc/ingestion-pipeline.md`                         |
