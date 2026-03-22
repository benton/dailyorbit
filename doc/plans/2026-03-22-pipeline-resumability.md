# Pipeline Resumability: Skip Previously-Failed Matches

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the `companies.attribute` and `companies.extract-ownership` pipeline stages skip previously-failed match attempts, with a UI button to reset failures for re-processing.

**Architecture:** Add `company_match_attempted_at` and `ownership_match_attempted_at` timestamp columns to the `filing` table. Pipeline stages stamp every processed filing (whether matched or not), so subsequent runs skip already-attempted records. A "Reset failed matches" button per-stage NULLs the timestamps on unmatched records, allowing the next run to re-attempt them (e.g. after adding new company aliases).

**Tech Stack:** DuckDB (schema migration), Hono (API route), React + Lucide (UI button)

**Current waste per re-run:**
- Attribution: 82,626 filings re-scanned (~250k queries) for the same no-match result
- Ownership extraction: 12,279 filings re-scanned (~25k queries) for the same no-match result

---

### Task 1: Add timestamp columns to filing table schema

**Files:**
- Modify: `packages/server/src/companies/schema.ts` (the `ensureCompanyFk` function)

**Step 1: Add the two new columns**

In `ensureCompanyFk()`, after the existing `ADD COLUMN IF NOT EXISTS company_id INTEGER`, add:

```typescript
await conn.run(
  `ALTER TABLE filing ADD COLUMN IF NOT EXISTS company_match_attempted_at TIMESTAMP`,
);
await conn.run(
  `ALTER TABLE filing ADD COLUMN IF NOT EXISTS ownership_match_attempted_at TIMESTAMP`,
);
```

**Step 2: Verify locally**

Run: `duckdb data/daily-orbit-for-querying.duckdb "DESCRIBE filing" 2>&1 | rg 'match_attempted'`
Expected: no results yet (columns don't exist in the copy — that's fine, they'll appear after the server runs the schema migration).

**Step 3: Commit**

```
feat(companies): add match_attempted_at columns to filing table
```

---

### Task 2: Update attribution to stamp attempted_at on every processed filing

**Files:**
- Modify: `packages/server/src/companies/attribution.ts` — `runBatchAttribution()`

**Step 1: Change the SELECT query to skip already-attempted filings**

Replace the existing query:
```sql
SELECT filing_key, address_attention, applicant_frn
FROM filing
WHERE company_id IS NULL
```

With:
```sql
SELECT filing_key, address_attention, applicant_frn
FROM filing
WHERE company_id IS NULL
  AND company_match_attempted_at IS NULL
```

**Step 2: Stamp the timestamp on every processed filing (matched or not)**

After the `if (companyId != null)` block that does the UPDATE, change the logic so that *every* filing gets stamped regardless of match result. Replace the existing loop body (lines 86-100) with:

```typescript
const companyId: number | null = await attributeFiling(
  conn,
  addressName,
  applicantFrn,
);

if (companyId != null) {
  await conn.run(
    `UPDATE filing SET company_id = $1, company_match_attempted_at = current_timestamp WHERE filing_key = $2`,
    [companyId, filingKey] as DuckDBValue[],
  );
  attributed++;
} else {
  await conn.run(
    `UPDATE filing SET company_match_attempted_at = current_timestamp WHERE filing_key = $1`,
    [filingKey] as DuckDBValue[],
  );
  skipped++;
}
```

**Step 3: Run test suite**

Run: `make test`

**Step 4: Commit**

```
feat(companies): skip previously-failed attribution attempts
```

---

### Task 3: Update ownership extraction to stamp attempted_at

**Files:**
- Modify: `packages/server/src/companies/repository.ts` — `extractOwnershipEvents()`

**Step 1: Change the SELECT query to also exclude already-attempted filings**

Replace the existing WHERE clause:
```sql
WHERE f.app_type_code IN ('T/C', 'ASG')
  AND (f.transferor_name IS NOT NULL OR f.transferee_name IS NOT NULL)
  AND f.file_number NOT IN (SELECT filing_file_number FROM ownership_event)
```

With:
```sql
WHERE f.app_type_code IN ('T/C', 'ASG')
  AND (f.transferor_name IS NOT NULL OR f.transferee_name IS NOT NULL)
  AND f.file_number NOT IN (SELECT filing_file_number FROM ownership_event)
  AND f.ownership_match_attempted_at IS NULL
```

**Step 2: Stamp the timestamp on every processed filing**

After the `if (transferorCompany == null && transfereeCompany == null)` skip block (line 602-609), add a timestamp stamp:

```typescript
if (transferorCompany == null && transfereeCompany == null) {
  // Stamp as attempted so we don't retry next run
  await conn.run(
    `UPDATE filing SET ownership_match_attempted_at = current_timestamp
     WHERE file_number = $1`,
    [fileNumber] as DuckDBValue[],
  );
  skipped++;
  const processed: number = created + skipped;
  if (onProgress != null && processed % 500 === 0) {
    onProgress(processed, total);
  }
  continue;
}
```

Also stamp successfully created events. After the `createOwnershipEvent()` call and `created++`, add:

```typescript
await conn.run(
  `UPDATE filing SET ownership_match_attempted_at = current_timestamp
   WHERE file_number = $1`,
  [fileNumber] as DuckDBValue[],
);
```

**Step 3: Run test suite**

Run: `make test`

**Step 4: Commit**

```
feat(companies): skip previously-failed ownership extraction attempts
```

---

### Task 4: Add reset API endpoint

**Files:**
- Modify: `packages/server/src/pipeline/routes.ts`
- Modify: `packages/server/src/pipeline/registry.ts` (add `resettable` flag to stage type)

**Step 1: Add `resettable` flag to PipelineStage type**

In `registry.ts`, add to the `PipelineStage` type:

```typescript
/** Whether this stage supports resetting failed matches. */
resettable?: boolean;
```

Add `resettable: true` to the `companies.attribute` and `companies.extract-ownership` stage definitions.

**Step 2: Expose `resettable` in the GET /status response**

In `routes.ts`, in the `GET /status` handler, add `resettable` to the stage map:

```typescript
resettable: s.resettable ?? false,
```

**Step 3: Add POST /reset-matches/:stageId endpoint**

In `routes.ts`, add a new route:

```typescript
// ── POST /reset-matches/:stageId ────────────────────────────────────

pipelineRoutes.post('/reset-matches/:stageId', async (c) => {
  const stageId: string = c.req.param('stageId');

  const RESET_QUERIES: Record<string, string> = {
    'companies.attribute': `
      UPDATE filing
      SET company_match_attempted_at = NULL
      WHERE company_id IS NULL AND company_match_attempted_at IS NOT NULL
    `,
    'companies.extract-ownership': `
      UPDATE filing
      SET ownership_match_attempted_at = NULL
      WHERE ownership_match_attempted_at IS NOT NULL
        AND file_number NOT IN (SELECT filing_file_number FROM ownership_event)
    `,
  };

  const sql: string | undefined = RESET_QUERIES[stageId];
  if (sql == null) {
    return c.json({ error: `Stage ${stageId} does not support reset` }, 400);
  }

  const db = await getDb();
  const conn = await DuckDBConnection.create(db);
  try {
    const reader = await conn.runAndReadAll(sql);
    const affected: number = reader.rowCount;
    return c.json({ stageId, reset: affected });
  } finally {
    conn.closeSync();
  }
});
```

Note: DuckDB's `runAndReadAll` on an UPDATE returns the count of affected rows via `rowCount`. If that doesn't work, use a COUNT query before and after, or use `changes()`. Verify during implementation.

**Step 4: Run test suite**

Run: `make test`

**Step 5: Commit**

```
feat(pipeline): add reset-matches API endpoint for resettable stages
```

---

### Task 5: Add "Reset failed matches" button to PipelineStep UI

**Files:**
- Modify: `packages/web/src/admin/pipeline/PipelineStep.tsx`
- Modify: `packages/web/src/admin/pipeline/PipelineGroup.tsx`
- Modify: `packages/web/src/admin/pipeline/PipelinePage.tsx`

**Step 1: Add `resettable` and `onReset` props to PipelineStep**

In `PipelineStep.tsx`, extend `PipelineStepProps`:

```typescript
type PipelineStepProps = {
  concurrency: number;
  description: string;
  disabled: boolean;
  id: string;
  name: string;
  onConcurrencyChange: (stageId: string, value: number) => void;
  onReset?: (stageId: string) => void;
  onRun: (stageId: string) => void;
  parallelizable: boolean;
  resettable: boolean;
  status: StageStatus;
};
```

Add a `RotateCcw` icon import from `lucide-react`.

**Step 2: Render the reset button next to the status badge**

Add the button right after the `<Badge>` element, before the concurrency input:

```tsx
{/* Reset failed matches button (only for idle resettable stages) */}
{resettable && status === 'idle' && onReset != null && (
  <Button
    disabled={disabled}
    onClick={() => onReset(id)}
    size="sm"
    title="Clear previously-failed match attempts so next run retries them"
    type="button"
    variant="ghost"
  >
    <RotateCcw className="mr-1 h-3 w-3" />
    Reset failed
  </Button>
)}
```

**Step 3: Thread props through PipelineGroup**

In `PipelineGroup.tsx`, add `resettable` to `StageInfo` type and `onReset` to `PipelineGroupProps`. Pass them through to `PipelineStep`:

```typescript
// In StageInfo type:
resettable: boolean;

// In PipelineGroupProps:
onReset: (stageId: string) => void;

// In PipelineStep usage:
<PipelineStep
  ...existing props...
  onReset={onReset}
  resettable={stage.resettable}
/>
```

**Step 4: Wire up in PipelinePage**

In `PipelinePage.tsx`:

1. Add `resettable` to the `StageInfo` type:
```typescript
type StageInfo = {
  ...existing fields...
  resettable: boolean;
};
```

2. Add a `handleReset` callback:
```typescript
const handleReset = useCallback(async (stageId: string) => {
  try {
    const resp = await apiFetch<{ stageId: string; reset: number }>(
      `/api/admin/pipeline/reset-matches/${stageId}`,
      { method: 'POST' },
    );
    // Show result in log panel
    setLogLines((prev) => [
      ...prev,
      {
        runId: 'reset',
        stage: stageId,
        level: 'info' as const,
        message: `Reset ${String(resp.reset)} failed match attempts — next run will retry them`,
        timestamp: new Date().toISOString(),
      },
    ]);
  } catch (error_: unknown) {
    setError(error_ instanceof Error ? error_.message : 'Reset failed');
  }
}, []);
```

3. Pass `resettable` into the groupStages map and `onReset` into `PipelineGroup`:
```typescript
// In the groupStages map:
resettable: s.resettable,

// In PipelineGroup:
<PipelineGroup
  ...existing props...
  onReset={(stageId: string) => void handleReset(stageId)}
/>
```

**Step 5: Run test suite and verify in browser**

Run: `make test`

Then open `http://localhost:5173/admin/pipeline` and verify the "Reset failed" button appears next to the Idle badge on the Attribution and Ownership Extraction steps.

**Step 6: Commit**

```
feat(web): add reset-failed-matches button to resettable pipeline stages
```

---

### Task 6: Manual verification via Playwright

**Step 1: Navigate to pipeline page**

Open `http://localhost:5173/admin/pipeline` in Playwright. Verify the Companies group shows "Reset failed" buttons on both `Attribute Filings` and `Extract Ownership` steps.

**Step 2: Run attribution, observe it processes only new filings**

Click Run on Attribute Filings. It should report a much smaller number of filings to process (only truly new ones since the timestamp columns were added — on first run after migration, it will process all unattributed filings and stamp them).

**Step 3: Run attribution again immediately**

Click Run on Attribute Filings again. It should complete nearly instantly with 0 attributed, 0 skipped (all already stamped).

**Step 4: Click "Reset failed" then run again**

Click "Reset failed" on Attribute Filings. Log panel should show the count of reset records. Then Run again — it should re-process only the previously-failed matches (the ~82k that had no alias match).

**Step 5: Repeat for Extract Ownership**

Same flow: run, run again (should be fast no-op), reset, run (should re-process the ~12k).

**Step 6: Commit any fixes found during testing**

---

### Summary of changes

| File | Change |
|------|--------|
| `packages/server/src/companies/schema.ts` | Add 2 timestamp columns |
| `packages/server/src/companies/attribution.ts` | Filter by and stamp `company_match_attempted_at` |
| `packages/server/src/companies/repository.ts` | Filter by and stamp `ownership_match_attempted_at` |
| `packages/server/src/pipeline/registry.ts` | Add `resettable` flag to type + 2 stages |
| `packages/server/src/pipeline/routes.ts` | Add `POST /reset-matches/:stageId` endpoint |
| `packages/web/src/admin/pipeline/PipelineStep.tsx` | Add reset button |
| `packages/web/src/admin/pipeline/PipelineGroup.tsx` | Thread `resettable` + `onReset` props |
| `packages/web/src/admin/pipeline/PipelinePage.tsx` | Wire `handleReset`, expose `resettable` |
