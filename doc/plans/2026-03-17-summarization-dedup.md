# Plan: Summarization Deduplication via Text Checksums

**Date:** 2026-03-17
**Status:** Draft

## Context

Summarization is the most expensive step in the ingestion pipeline — each call hits AWS Bedrock (Nova Pro). Analysis of the current dataset reveals significant text duplication:

| Metric | Count |
|---|---|
| Attachments with extracted text | 206,055 |
| Unique texts (by MD5) | 149,293 |
| **Duplicates** | **56,762 (27.5%)** |

The top duplicate text appears **1,547 times**. Many are boilerplate FCC forms (OMB applications, antenna statements, frequency coordination letters) that are filed identically across hundreds of applications.

### Current savings opportunity

| Category | Count |
|---|---|
| Pending summaries | 94,315 |
| Can copy from existing summary | 10,326 |
| Need actual API call | 83,989 |

That's **10,326 API calls saved immediately**, plus ongoing savings as new filings reuse the same boilerplate.

---

## Approach

### 1. Add `text_checksum` column to attachment table

**Modify: `packages/server/src/attachments/repository.ts`**

Add to both `CREATE_TABLE_SQL` and `MIGRATE_COLUMNS_SQL`:
```sql
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS text_checksum VARCHAR
```

The checksum is computed as `MD5(full_text)` — fast, deterministic, and sufficient for content deduplication (we're not using it for security).

### 2. Compute checksums after text extraction

**New pipeline stage: Stage 2d.5 — Checksum** (between extraction and summarization)

**New file: `packages/server/src/attachments/checksum-pipeline.ts`**

```typescript
export async function runChecksumPipeline(options): Promise<ChecksumPipelineResult>
```

- Query: `SELECT attachment_key, full_text FROM attachment WHERE full_text IS NOT NULL AND text_checksum IS NULL`
- For each row: compute `MD5(full_text)` and `UPDATE attachment SET text_checksum = $1 WHERE attachment_key = $2`
- This is a pure DB operation — no external calls, very fast

**Alternative (simpler):** Compute the checksum inline during extraction, immediately after `full_text` is populated. This avoids a separate pipeline stage but couples checksumming to extraction. Given that checksumming is trivial (single MD5), inline is probably better.

**Recommendation:** Inline approach — compute checksum in `extract-pipeline.ts` and `pipeline.ts` wherever `full_text` is written. Add a one-time backfill for existing rows:

```sql
UPDATE attachment SET text_checksum = md5(full_text) WHERE full_text IS NOT NULL AND text_checksum IS NULL
```

### 3. Modify summarization to check for existing summaries

**Modify: `packages/server/src/attachments/repository.ts`**

Add `findExistingSummaryByChecksum`:
```typescript
export async function findExistingSummaryByChecksum(
  conn: DuckDBConnection,
  textChecksum: string,
): Promise<string | null>
```

Query:
```sql
SELECT summary FROM attachment
WHERE text_checksum = $1 AND summary IS NOT NULL
LIMIT 1
```

### 4. Wire dedup into summarization loop

**Modify: `packages/server/src/attachments/pipeline.ts`** (Stage 6 — summarization)
**Modify: `packages/server/src/cli/inference/summarize.ts`** (standalone CLI)

Before calling the inference API for each row:
```typescript
const existing = await findExistingSummaryByChecksum(conn, row.textChecksum);
if (existing) {
  await saveSummary(conn, row.attachmentKey, existing, 'copied');
  stats.copied++;
} else {
  // ... existing API call logic
}
```

Track `copied` count separately in pipeline results so the user can see how many API calls were saved.

### 5. Update `getPendingSummarizations` to include checksum

**Modify: `packages/server/src/attachments/repository.ts`**

Add `text_checksum` to the `PendingSummarizationRow` type and SELECT list so the summarization loop has it available without a second query.

### 6. Add index for checksum lookups

```sql
CREATE INDEX IF NOT EXISTS idx_attachment_text_checksum ON attachment(text_checksum)
```

This makes the `findExistingSummaryByChecksum` lookup fast even at 200k+ rows. Add to `MIGRATE_COLUMNS_SQL` or a dedicated migration block.

---

## Execution Order

### Phase A — Pre-checksum the current workload (do before running summarization)

These steps can be done immediately with just SQL, before any code changes ship. This lets us copy existing summaries to duplicates right away, reducing the pending summarization count before the next big run.

1. Add `text_checksum` column: `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS text_checksum VARCHAR`
2. Backfill checksums: `UPDATE attachment SET text_checksum = md5(full_text) WHERE full_text IS NOT NULL AND text_checksum IS NULL`
3. Create index: `CREATE INDEX IF NOT EXISTS idx_attachment_text_checksum ON attachment(text_checksum)`
4. Copy summaries to duplicates:
   ```sql
   UPDATE attachment AS target
   SET summary = source.summary,
       summarized_by = 'copied',
       summarized_at = current_timestamp
   FROM (
     SELECT text_checksum, summary
     FROM attachment
     WHERE summary IS NOT NULL AND text_checksum IS NOT NULL
     QUALIFY ROW_NUMBER() OVER (PARTITION BY text_checksum ORDER BY summarized_at ASC) = 1
   ) AS source
   WHERE target.text_checksum = source.text_checksum
     AND target.summary IS NULL
     AND target.full_text IS NOT NULL
   ```
5. Verify: `SELECT summarized_by, COUNT(*) FROM attachment WHERE summary IS NOT NULL GROUP BY summarized_by` — expect ~10k with `summarized_by = 'copied'`

### Phase B — Code changes (make it permanent)

6. Add `text_checksum` column to `CREATE_TABLE_SQL` and `MIGRATE_COLUMNS_SQL` in repository.ts
7. Add inline checksum computation to extraction code paths (extract-pipeline.ts, pipeline.ts)
8. Add `findExistingSummaryByChecksum` repository function
9. Add checksum to `PendingSummarizationRow` / `getPendingSummarizations`
10. Wire dedup check into both summarization paths (pipeline + CLI)
11. Tests
12. Update `doc/ingestion-pipeline.md`

## Tests

**Modify: `packages/server/src/attachments/repository.test.ts`**

- `findExistingSummaryByChecksum` returns existing summary when checksum matches
- `findExistingSummaryByChecksum` returns null when no match
- `getPendingSummarizations` includes `textChecksum` field
- Backfill: rows with `full_text` get checksums, rows without don't

**New or modify extraction tests:**

- After extraction, `text_checksum` is populated
- Checksum is deterministic (same text = same hash)

**New summarization dedup test:**

- Two attachments with identical text: first gets API-summarized, second gets copied summary
- Copied summary has `summarized_by = 'copied'` (or similar marker)

## Verification

1. `pnpm test` — all tests pass
2. `pnpm --filter @daily-orbit/server build` — clean build
3. Backfill: `UPDATE attachment SET text_checksum = md5(full_text) WHERE full_text IS NOT NULL AND text_checksum IS NULL` — should update 206k rows
4. `SELECT COUNT(*) FROM attachment WHERE text_checksum IS NOT NULL` — matches extracted count
5. Run summarization with `--limit 100 --verbose` — observe "copied" vs "generated" counts in output
6. Check DB: `SELECT summarized_by, COUNT(*) FROM attachment WHERE summary IS NOT NULL GROUP BY summarized_by`

## Open Questions

1. **Should `summarized_by` for copied summaries be `'copied'` or `'copied:<original_model>'`?** The latter preserves which model generated the original. Recommendation: `'copied'` is simpler and the original model is discoverable via the checksum.

2. **Should we also dedup at the embedding stage?** Embeddings are cheaper than summarization but the same logic applies. Deferring unless embedding costs become significant.

3. **MD5 vs faster hash?** MD5 is available natively in DuckDB (`md5()` function) making backfill trivial. Collision risk is negligible for content dedup at this scale. No reason to use anything else.
