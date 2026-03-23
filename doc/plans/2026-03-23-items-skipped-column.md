# Add `items_skipped` Column to Pipeline Stage Tracking

**Date:** 2026-03-23
**Problem:** The "Filings Ingested per Run" chart on the Pipeline History page shows ~400 filings every run because `items_processed` counts all upserted filings (new inserts + updates to existing records). The 15-minute probe scrape registers all scraped filings as "new" in the chart even when most are already known. The `skippedKnown` count exists in `IcfsIngestResult` but is only written into the text `summary` field — it's not stored as a dedicated column.

**Goal:** Add `items_skipped` as a first-class column in `pipeline_stage_run`, flow it through all layers, and fix the chart to show genuinely new filings.

---

## Files to Change

### 1. Schema — `packages/server/src/pipeline/schema.ts`

Add migration after the existing `mode` migration:

```sql
ALTER TABLE pipeline_stage_run ADD COLUMN IF NOT EXISTS items_skipped INTEGER NOT NULL DEFAULT 0;
```

### 2. StageResult type — `packages/server/src/pipeline/registry.ts`

Add optional field to `StageResult`:

```typescript
export type StageResult = {
  itemsDiscovered?: number;
  itemsProcessed: number;
  itemsSkipped?: number;    // <-- NEW
  itemsFailed: number;
  durationMs: number;
  summary?: string;
};
```

### 3. Tracking repository — `packages/server/src/pipeline/tracking-repository.ts`

**3a. `StageRunRow`** — add `items_skipped: number`

**3b. `FinishStageInput`** — add `itemsSkipped?: number`

**3c. `finishStageRun()`** — add `items_skipped = $N` to the UPDATE SQL and bind `input.itemsSkipped ?? 0`

**3d. `PipelineRunWithIcfsStats`** — add `items_skipped: number`

**3e. All SELECT queries** that touch `pipeline_stage_run` — add `items_skipped` to the column list:
- `getRunsWithIcfsStats()` — add `COALESCE(psr.items_skipped, 0)::INTEGER AS items_skipped`
- `listPipelineRuns()` — same
- `getStageRunsForPipeline()` — add `items_skipped`
- `HISTORY_ALLOWED_COLUMNS` — add `'items_skipped'`

### 4. Runner — `packages/server/src/pipeline/runner.ts`

In the `finishStageRun` call (~line 316), pass the new field:

```typescript
await finishStageRun(conn, dbStageRunId, {
  status: 'completed',
  itemsDiscovered: result.itemsDiscovered ?? 0,
  itemsProcessed: result.itemsProcessed,
  itemsSkipped: result.itemsSkipped ?? 0,   // <-- NEW
  itemsFailed: result.itemsFailed,
  summary: result.summary ?? '',
});
```

### 5. ICFS ingest stage — `packages/server/src/pipeline/registry.ts` (~line 174)

Map `skippedKnown` from the ICFS result into the new `StageResult` field:

```typescript
return {
  itemsDiscovered: result.filingsDiscovered,
  itemsProcessed: result.filingsIngested,
  itemsSkipped: result.skippedKnown,        // <-- NEW
  itemsFailed: result.filingsFailed,
  durationMs: Date.now() - start,
  summary: `Discovered ${String(result.filingsDiscovered)}, ingested ${String(result.filingsIngested)}, skipped ${String(result.skippedKnown)}`,
};
```

### 6. Frontend — `packages/web/src/admin/pipeline/PipelineHistoryPage.tsx`

**6a. Types** — add `items_skipped: number` to both `PipelineRunStats` and `StageRun`

**6b. Chart — filter to probe-mode runs only.** Full-mode runs have no way to distinguish inserts from updates, so their `items_processed` count is misleading. Probe-mode runs already have accurate "new filings" counts because `skipKnown=true` filters known filings before processing.

```typescript
const chartData = runs
  .filter((r) => r.started_at != null && r.mode === 'probe')  // <-- only probe runs
  .map((r) => ({
    count: r.items_processed,
    status: r.status,
    time: new Date(r.started_at),
  }))
  .reverse();
```

Change Y-axis label from `'Filings Ingested'` to `'New Filings Detected'`.
Change section heading from `'Filings Ingested per Run'` to `'New Filings Detected per Run'`.

**6c. Table columns** — add a "Skipped" column after the existing "Ingested" column:
```typescript
{
  accessorKey: 'items_skipped',
  header: 'Skipped',
  size: 90,
},
```

**6d. Stage detail sub-table** — add "Skipped" column header and cell between "Processed" and "Failed".

---

## Notes

- Existing rows will have `items_skipped = 0` (the `DEFAULT 0` in the migration). This is honest — we didn't track it before.
- In probe mode (`skipKnown=true`), `items_processed` already only counts genuinely new filings because known ones are filtered before fetch. The `items_skipped` count records how many were filtered.
- In full mode (`skipKnown=false`), `skippedKnown` will be 0 and `items_processed` includes updates to existing records. The chart filters these out by only showing probe-mode runs. The table still shows all runs for full visibility.
- A future improvement could distinguish inserts from updates at the upsert level in `upsertIcfsFiling()`, making full-mode runs chartable too.
- No test changes needed beyond ensuring the new column flows through the existing integration tests.
