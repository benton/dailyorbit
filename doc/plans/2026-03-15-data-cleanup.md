# Data Cleanup Plan

## Context

A debugging session on 2026-03-15 revealed several data integrity issues in the filing database:

- The XML bulk import used unhyphenated file numbers (`SESLIC1986030300312`) while the ICFS ingest uses hyphenated ones (`SES-LIC-19860303-00312`), creating ~116k duplicate rows for the same filings.
- ~21k unhyphenated filings have no matching ICFS row — these may be interim file numbers, app types not covered by the ingest script, or filings absent from ICFS.
- The ICFS search API caps at 350 results per query and does not support real pagination.
- Two timestamp columns (`last_scraped_at` and `icfs_last_fetched_at`) track overlapping concepts.

A new branded `FileNumber` type with normalization was introduced in `packages/server/src/lib/file-number.ts` to prevent format mismatches going forward.

---

## Step 1: Deduplicate the filing table

Merge unhyphenated rows into their hyphenated counterparts:

1. For each unhyphenated `file_number`, compute the normalized form using `normalizeFileNumber`
2. Where a matching hyphenated row exists, merge any data the unhyphenated row has that the hyphenated row lacks (e.g. legacy fields from the XML import)
3. Delete the unhyphenated duplicate rows
4. Update the `file_number` column for any remaining unhyphenated rows (those without a hyphenated match) to the normalized form

**Verification:** Total filing count should drop by ~116k. Every remaining `file_number` should pass `normalizeFileNumber` with `ok: true`.

---

## Step 2: Fix the XML import to normalize file numbers on ingest

Update the XML/DAT bulk loader to run `normalizeFileNumber` on every file number before inserting, so duplicates can never recur. This is the ingestion boundary where normalization should happen.

Key files:
- `packages/server/src/ingest/loader.ts`
- `packages/server/src/ingest/pipeline.ts`

---

## Step 3: Spot-check the ~21k unmatched filings against ICFS

These are unhyphenated file numbers with no matching hyphenated ICFS row. They fall into several categories:

- **Interim file numbers** (INTR prefix): ~8k — filings accepted before permanent number assignment
- **App types not in the ingest script**: MFS, PDR, AFS, MSC, NDS, MPL, etc.
- **Filings genuinely absent from ICFS**: may have been purged or never migrated

For each category:
1. Try the normalized file number on the ICFS detail page (`/api/now/sp/page?number=...`)
2. If found, add the missing app types to the ingest script and re-run
3. If not found, document which filings are ICFS-absent and whether the XML data is the only source

---

## Step 4: Consolidate `last_scraped_at` and `icfs_last_fetched_at`

Currently:
- `last_scraped_at` — set by the attachment discovery pipeline when it scrapes a filing's attachment page
- `icfs_last_fetched_at` — set by the ICFS ingest when it fetches a filing's detail page

These track different things but the names are confusing. The attachment scraper should not set a filing-level "scraped at" timestamp — attachment discovery is an attachment concern, not a filing concern.

Plan:
1. Remove `last_scraped_at` from the filing table
2. Track attachment discovery status on the attachment table or via a separate join (e.g. "filings with all attachments discovered")
3. Keep `icfs_last_fetched_at` as the canonical "when was this filing's metadata last refreshed from ICFS"
4. Update the attachment pipeline to stop writing `last_scraped_at` on the filing table
