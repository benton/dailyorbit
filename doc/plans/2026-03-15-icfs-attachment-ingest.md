# Plan: Populate attachment table during ICFS ingest

## Problem

The ICFS ingest pipeline (`icfs/pipeline.ts`) fetches full filing details
from the ICFS ServiceNow API, which include parsed attachment metadata
(`IcfsFilingDetail.attachments: IcfsAttachment[]`). But `upsertIcfsFiling()`
only writes filing-level data — **attachments are parsed then discarded**.

As a result, 86K+ filings have zero rows in the `attachment` table, and
the "Download Application Filing" button never appears on their detail pages.

The separate `daily-orbit attachments discover` pipeline scrapes fcc.report
HTML for attachment metadata, but it has only been run for ~56K filings and
is unnecessary for ICFS-sourced filings that already carry attachment data.

## Goal

Write ICFS attachment metadata to the `attachment` table during the existing
ICFS ingest pipeline, so that every filing detail page shows its attachments
(and the download button) without requiring a separate discovery step.

## Request efficiency

**Zero additional HTTP requests.** The ICFS `getFilingDetail()` API call
already returns both filing metadata and attachment metadata in a single
JSON response. This plan extracts the attachment data from that response
and persists it — no second scrape pass is needed.

The request flow per filing stays exactly the same:

```
1 search request per (subsystem × appType × month)  → file number list
1 detail request per filing                          → filing + attachments + pleadings
```

After implementation, `daily-orbit ingest icfs` is the **only command
needed** to populate both the `filing` and `attachment` tables for
ICFS-sourced filings. The `attachments discover` / `attachments sync`
commands (which scrape fcc.report HTML separately) remain available for
legacy IBFS-only filings that were never fetched through ICFS.

### Pre-existing concern: redundant re-fetch on re-run

`discoverNewFilings()` does not filter out filings already in the DB.
Re-running the pipeline for the same date range re-fetches every filing
detail, even if nothing has changed. The upserts are idempotent so this
is correct but wasteful. This is a pre-existing issue, not introduced by
this plan, but worth addressing as a follow-up (e.g., skip file numbers
where `icfs_last_fetched_at` is recent, unless `--force` is passed).

## Data mapping: `IcfsAttachment` → `AttachmentMetadata`

```
IcfsAttachment                     AttachmentMetadata
────────────────                   ──────────────────
sysId (string, ICFS record ID)  →  attachmentKey (number) — hash sysId to int
documentName                    →  attachmentName
links[].url                     →  downloadUrl (one row per link)
links[].displayValue            →  description
(derived: 'attachment')         →  source
(from filing)                   →  filingKey
(from filing)                   →  fileNumber (FileNumber)
```

### Key decisions

1. **`attachmentKey` generation**: ICFS gives us a string `sysId`, but the
   attachment table expects an integer `attachment_key`. Use a deterministic
   hash (e.g., FNV-1a producing a positive 32-bit int) so re-running ingest
   produces the same key and the upsert logic deduplicates correctly.

2. **Multiple links per attachment**: Each `IcfsAttachment` may have multiple
   links (PDF, HTML, etc.). Create **one row per link** — each gets its own
   `attachment_key` (hash of `sysId + link index`). The `description` field
   carries the link's `displayValue` ("PDF", "HTML", etc.).

3. **`source` value**: Use `'attachment'` to match the existing fcc.report
   convention, since these are application filing documents (not comments).

## Implementation steps

### Step 1: Add `icfsAttachmentsToMetadata()` conversion function

**File:** `packages/server/src/icfs/repository.ts` (or a new
`icfs/attachments.ts` if preferred)

```typescript
import type { FileNumber } from '../lib/file-number.ts';
import type { AttachmentMetadata } from '../attachments/types.ts';
import type { IcfsAttachment } from './types.ts';

function sysIdToInt(sysId: string, suffix: number): number {
  // Deterministic hash: FNV-1a, producing a positive 32-bit int
  let hash = 2166136261;
  const input = `${sysId}:${String(suffix)}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0; // unsigned 32-bit
}

export function icfsAttachmentsToMetadata(
  attachments: IcfsAttachment[],
  filingKey: number,
  fileNumber: FileNumber,
): AttachmentMetadata[] {
  const result: AttachmentMetadata[] = [];
  for (const att of attachments) {
    for (let i = 0; i < att.links.length; i++) {
      const link = att.links[i]!;
      result.push({
        attachmentKey: sysIdToInt(att.sysId, i),
        filingKey,
        fileNumber,
        source: 'attachment',
        attachmentName: att.documentName,
        description: link.displayValue,
        downloadUrl: link.url,
      });
    }
  }
  return result;
}
```

### Step 2: Call `upsertAttachments()` in the ICFS pipeline

**File:** `packages/server/src/icfs/pipeline.ts`, after line 140:

```typescript
import { upsertAttachments, createAttachmentTable } from '../attachments/repository.ts';
import { icfsAttachmentsToMetadata } from './repository.ts'; // or ./attachments.ts

// In the pipeline setup, after DB connection:
await createAttachmentTable(conn);

// In the per-filing loop, after upsertIcfsFiling(conn, detail):
if (detail.attachments.length > 0 && detail.summary != null) {
  const attMeta = icfsAttachmentsToMetadata(
    detail.attachments,
    Number(detail.summary.legacyFilingKey),
    detail.summary.fileNumber as FileNumber,
  );
  await upsertAttachments(conn, attMeta);
}
```

### Step 3: Handle the `filingKey` correctly

The `filingKey` in the `filing` table comes from ICFS's `legacyFilingKey`
(stored as a negative number for ICFS-sourced filings — check
`upsertIcfsFiling` for exact logic). The attachment row must use the same
key so the JOIN in `fetchAttachments()` works.

### Step 4: Add tests

- Unit test for `icfsAttachmentsToMetadata()` — verify mapping, hash
  determinism, multi-link expansion
- Integration test: seed ICFS filing detail with attachments, run pipeline,
  verify attachment rows exist in DB

### Step 5: Backfill existing filings

After deploying the change, re-running the ICFS ingest pipeline
(`daily-orbit ingest icfs`) will populate attachment records for all filings
that already have ICFS detail data, since it re-fetches and upserts.

## Step 6: Pipeline scripts

After the implementation is complete, create two scripts:

### 6a. `scripts/ingest-full.sh` — Clean-state full ingest

For bootstrapping from an empty database. Runs the complete pipeline in
order: IBFS bulk load, ICFS ingest (with attachments), company seed +
attribution, ownership extraction, enrichment, and attachment download.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Full pipeline from a clean database.
#
# Usage:
#   ./scripts/ingest-full.sh 2>&1 | tee data/full-ingest.log

DB="${DB:-data/daily-orbit.duckdb}"

echo "=== Stage 1a: IBFS bulk ingest ==="
./daily-orbit ingest ibfs --database "$DB" --download

echo "=== Stage 1b: ICFS ingest (all subsystems, includes attachments) ==="
# This is the existing ingest-all-icfs.sh, which already covers all 13
# subsystems with appropriate date-range chunking.
# After the plan is implemented, each filing detail fetch also populates
# the attachment table — no separate attachment discover step is needed.
./scripts/ingest-all-icfs.sh

echo "=== Stage 2: Download attachment files ==="
# Only downloads — attachment metadata was already populated by Stage 1b.
./daily-orbit attachments download \
  --database "$DB" --concurrency 10 --delay 200 --skip-existing

echo "=== Stage 3: Company seed + attribution ==="
./daily-orbit companies seed --database "$DB"
./daily-orbit companies attribute --database "$DB"

echo "=== Stage 4: Ownership extraction ==="
./daily-orbit companies extract-ownership --database "$DB"

echo "=== Stage 5: External enrichment ==="
./daily-orbit companies enrich --database "$DB"

echo "=== Done ==="
./daily-orbit companies stats --database "$DB"
```

Note: Stage 2 here is `attachments download` only — not `attachments discover`.
The `attachments discover` step (which scrapes fcc.report HTML) is no longer
needed because ICFS ingest now writes attachment metadata directly. It remains
available for backfilling legacy IBFS-only filings if needed in the future.

### 6b. `scripts/remediate-attachments.sh` — Backfill missing attachment metadata

For the current situation: 143K filings already ingested, but 86K have no
attachment records because the original ICFS ingest discarded them. This
script re-runs the ICFS ingest to re-fetch filing details and persist the
attachment metadata that was previously thrown away.

This re-fetches each filing detail from the ICFS API (one request per filing),
which is unavoidable since the attachment data was never stored. But it does
NOT run a separate attachment discovery pass — the attachment metadata comes
from the same detail response as the filing metadata.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Remediate missing attachment metadata by re-running ICFS ingest.
#
# After the plan is implemented, `ingest icfs` also calls
# upsertAttachments() for each filing detail response.
# Re-running ingest for existing filings will:
#   1. Re-fetch the detail (1 request per filing — unavoidable)
#   2. Upsert filing metadata (idempotent, no-op for unchanged data)
#   3. Upsert attachment metadata (NEW — this is what we're backfilling)
#
# The upsert is idempotent: filings that already have attachment records
# (the 56K from the fcc.report pipeline) will just get existing++ counts.
#
# Usage:
#   ./scripts/remediate-attachments.sh 2>&1 | tee data/remediate-attachments.log

CONCURRENCY="${ICFS_CONCURRENCY:-10}"
DELAY="${ICFS_DELAY:-200}"
DB="${ICFS_DB:-data/daily-orbit.duckdb}"

echo "Remediate missing attachments — re-ingest ICFS filings"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Re-use the existing ingest-all-icfs.sh which already has all the
# subsystem/date-range chunking tuned for the dataset.
# The only difference vs the initial ingest: this time, the ICFS pipeline
# also persists attachment metadata from the same API response.
ICFS_CONCURRENCY="$CONCURRENCY" ICFS_DELAY="$DELAY" ICFS_DB="$DB" \
  ./scripts/ingest-all-icfs.sh

echo ""
echo "=== Remediation complete ==="
echo ""

# Show attachment coverage
duckdb "$DB" -c "
  SELECT
    count(*) AS total_filings,
    count(*) FILTER (WHERE filing_key IN (
      SELECT DISTINCT filing_key FROM attachment
    )) AS with_attachments
  FROM filing;
"
```

Note on request cost: the original full ingest made ~143K detail requests.
This remediation pass makes the same ~143K requests again because
`discoverNewFilings` doesn't skip already-ingested filings. A future
optimisation (filtering by `icfs_last_fetched_at`) would eliminate this
redundancy, but for a one-time backfill the simplicity of re-running the
existing script is preferable.

## Out of scope

- Downloading the actual attachment files (handled by existing download pipeline)
- Pleadings/comments (similar pattern but different data shape — separate task)
- Removing the fcc.report discovery pipeline (still useful for legacy IBFS data)
- Optimizing re-runs to skip already-fetched filings (pre-existing issue)
