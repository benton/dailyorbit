# Plan: Improve Ingest Pipeline Concurrency Control

## Context

The pipeline UI has a single global concurrency override (default 20) that applies uniformly to all stages. Most stage defaults are too low (1 or 5), and several stages that could benefit from concurrency don't wire it through at all. Additionally, there's no way to stop a running pipeline — the only option is killing the server.

This plan updates defaults, adds per-stage concurrency controls, wires concurrency into stages that lack it, and adds a stop button.

---

## Task 1: Update Default Concurrency Values in Registry

**File:** `packages/server/src/pipeline/registry.ts`

Update `defaultConcurrency` for all stages:

| Stage ID | Current Default | New Default |
|----------|:-:|:-:|
| `ingest.icfs` | 1 | **20** |
| `attachments.discover-download` | 5 | **20** |
| `attachments.extract` | _(none)_ | **20** |
| `attachments.validate` | _(none)_ | **20** |
| `attachments.summarize` | 10 | **15** |
| `attachments.embed` | 10 | **15** |
| `companies.seed` | _(none)_ | 1 |
| `companies.attribute` | _(none)_ | **10** |
| `companies.extract-ownership` | _(none)_ | 1 |
| `companies.enrich` | _(none)_ | 1 |
| `news.seed` | _(none)_ | 1 |
| `news.fetch` | _(none)_ | **10** |
| `news.extract` | 3 | **20** |
| `news.summarize` | 5 | **15** |
| `news.attribute` | _(none)_ | **10** |
| `search.rebuild-index` | _(none)_ | 1 |
| `alerts.evaluate` | _(none)_ | **10** |

---

## Task 2: Wire Concurrency Into Stages That Currently Ignore It

Six stages have loops that can be parallelized but don't pass `ctx.concurrency` through. Use the existing `processWithConcurrency()` utility from `packages/server/src/lib/concurrency.ts`.

### 2a. `attachments.extract` — `runExtractionPipeline()`
**File:** `packages/server/src/attachments/extract-pipeline.ts`
- Add `concurrency` parameter to `runExtractionPipeline()`
- Replace the sequential `for` loop over `pending` with `processWithConcurrency(pending, concurrency, ...)`
- Pass `ctx.concurrency` from registry stage definition

### 2b. `attachments.validate` — `runValidationPipeline()`
**File:** `packages/server/src/attachments/validate-pipeline.ts`
- Add `concurrency` parameter to `runValidationPipeline()`
- Replace sequential `for` loop with `processWithConcurrency()`
- Pass `ctx.concurrency` from registry stage definition

### 2c. `companies.attribute` — `runBatchAttribution()`
**File:** `packages/server/src/companies/attribution.ts`
- Add `concurrency` parameter to `runBatchAttribution()`
- Replace sequential `for` loop with `processWithConcurrency()`
- Pass `ctx.concurrency` from registry stage definition

### 2d. `news.fetch` — `fetchAllDueSources()`
**File:** `packages/server/src/news/rss-fetcher.ts`
- Add `concurrency` parameter to `fetchAllDueSources()`
- Replace sequential `for` loop with `processWithConcurrency()`
- Pass `ctx.concurrency` from registry stage definition

### 2e. `news.attribute` — `attributeNewsItems()`
**File:** `packages/server/src/news/attribute-news.ts`
- Add `concurrency` parameter to `attributeNewsItems()`
- Replace sequential `for` loop with `processWithConcurrency()`
- Pass `ctx.concurrency` from registry stage definition

### 2f. `alerts.evaluate` — `evaluateAlertsWithEmail()`
**File:** `packages/server/src/alerts/evaluator.ts`
- Add `concurrency` parameter to `evaluateAlertsWithEmail()`
- Parallelize the per-search evaluation loop (the email grouping phase stays sequential)
- Pass `ctx.concurrency` from registry stage definition

---

## Task 3: Add Per-Stage Concurrency to API

**File:** `packages/server/src/pipeline/routes.ts`

Change the POST `/run` body from:
```typescript
{ stages: string[], concurrency?: number }
```
to:
```typescript
{ stages: string[], concurrencyOverrides?: Record<string, number> }
```

**File:** `packages/server/src/pipeline/runner.ts`

Change `start()` and `executeRun()` signatures to accept `concurrencyOverrides: Record<string, number>` instead of a single `concurrencyOverride: number`.

Update resolution logic:
```typescript
const effectiveConcurrency: number =
  (concurrencyOverrides[stageId] ?? 0) > 0
    ? concurrencyOverrides[stageId]
    : (stage.defaultConcurrency ?? 1);
```

---

## Task 4: Per-Stage Concurrency UI + Remove Global Control

**File:** `packages/web/src/admin/pipeline/PipelinePage.tsx`

### Remove
- The global `concurrency` state variable (currently default 20)
- The global concurrency `<input>` and its label

### Add
- A `concurrencyOverrides: Record<string, number>` state, initialized from stage defaults
- For each stage that supports concurrency (see list below), render a small number input **inline next to the stage's Run button**
- Stages with `defaultConcurrency === 1` that are not parallelizable get no input

### Stages that get a concurrency input
These stages have meaningful concurrency (their implementations use `ctx.concurrency`):

| Stage | Default shown in input |
|-------|:---:|
| `ingest.icfs` | 20 |
| `attachments.discover-download` | 20 |
| `attachments.extract` | 20 |
| `attachments.validate` | 20 |
| `attachments.summarize` | 15 |
| `attachments.embed` | 15 |
| `companies.attribute` | 10 |
| `news.fetch` | 10 |
| `news.extract` | 20 |
| `news.summarize` | 15 |
| `news.attribute` | 10 |
| `alerts.evaluate` | 10 |

### Stages with NO concurrency input (fixed at 1, not parallelizable)
- `companies.seed` — single seeding operation
- `companies.extract-ownership` — sequential LLM calls with context dependency
- `companies.enrich` — sequential LLM enrichment
- `news.seed` — single seeding operation
- `search.rebuild-index` — sequential SQL PRAGMA statements

### API payload change
When running stages, send per-stage overrides:
```typescript
body: JSON.stringify({
  stages: stageIds,
  concurrencyOverrides: Object.fromEntries(
    stageIds.map(id => [id, concurrencyOverrides[id]])
  ),
})
```

### Expose defaults from API
Add `defaultConcurrency` to the status endpoint's stage info so the UI can initialize inputs from server-defined defaults rather than hardcoding them.

---

## Task 5: Add Stop Button

### Server: Add cancel mechanism

**File:** `packages/server/src/pipeline/runner.ts`
- Add an `AbortController` created at the start of each run
- Store it as `this.abortController`
- Pass `abortController.signal` into `PipelineContext`
- Add a `stop()` method: calls `this.abortController.abort()`, sets `this.running = false`
- In `executeRun()`, check `signal.aborted` before starting each stage and between batches within `processWithConcurrency`

**File:** `packages/server/src/pipeline/routes.ts`
- Add `POST /api/admin/pipeline/stop` endpoint that calls `runner.stop()`
- Returns 200 if stopped, 404 if no run active

**File:** `packages/server/src/lib/concurrency.ts`
- Update `processWithConcurrency()` to accept an optional `AbortSignal`
- Check `signal.aborted` before starting each new work item; throw/return early if aborted

### UI: Add stop button

**File:** `packages/web/src/admin/pipeline/PipelinePage.tsx`
- Show a **"Stop All"** button when `running === true` (replaces or sits alongside the disabled run buttons)
- Calls `POST /api/admin/pipeline/stop`
- Style: red/destructive appearance to indicate it stops all work

### Behavior
- Stages run sequentially (one at a time) — confirmed in runner.ts
- Stop aborts the current stage and skips remaining stages
- In-flight concurrent work items within a stage are allowed to complete (graceful), but no new items start
- The run is marked as failed with a `'cancelled'` summary

---

## Task 6: Add `parallelizable` Flag to Stage Definitions

**File:** `packages/server/src/pipeline/registry.ts`

Add a `parallelizable: boolean` field to `PipelineStage` type. Set it for each stage:
- `true` for the 12 stages that get concurrency inputs
- `false` for the 5 that don't

This lets the UI and API determine which stages should show concurrency controls without hardcoding stage IDs in the frontend.

Include `parallelizable` in the `/status` endpoint response so the UI can use it.

---

## Verification

1. **Defaults**: Run each stage individually from the UI — log should show the new default concurrency
2. **Per-stage override**: Change a stage's concurrency input, run it, confirm log shows the overridden value
3. **Non-parallelizable stages**: Confirm no concurrency input appears for seed, enrich, extract-ownership, rebuild-index
4. **Stop button**: Start a long-running stage (e.g., discover-download), click Stop, confirm it halts gracefully
5. **Run tests**: `make test` — ensure existing tests pass, especially pipeline-related ones
