# Fast Probe & Multi-Stage Alerts

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect new ICFS filings within ~1 minute of appearance and trigger alerts as early as possible, without re-running the full pipeline on every check.

**Architecture:** Split the existing monolithic pipeline into two scheduling tiers — a fast probe (every ~1 min) that short-circuits when nothing is new, and a full refresh (every ~15 min) that catches updates to existing filings. Alert evaluation moves from a single final stage to three evaluation points distributed across the pipeline.

**Tech Stack:** Existing pipeline infrastructure (PipelineRunner, stage registry, tracking tables), DuckDB, Hono.

**Depends on:** [scraping-strategy.md](../scraping-strategy.md) for rationale and constraints.

---

## Design Decisions

### D1: Where to store the "last known file numbers" set

**Decision:** New `discovery_snapshot` table with columns `(id, snapshot_hash, file_numbers, created_at)`. The `snapshot_hash` is a SHA-256 of the sorted, deduplicated file number list. The fast probe compares its discovery hash against the most recent snapshot to decide whether to continue or short-circuit.

**Alternative considered:** Comparing discovered file numbers against the `filing` table directly. This works but is slower (hundreds of DB lookups vs. one hash comparison) and doesn't distinguish "new filing appeared" from "we failed to ingest it last time." The snapshot approach answers "did the ICFS search results change?" which is the precise question.

### D2: Fast probe pipeline shape

**Decision:** The fast probe is a new pipeline mode, not a separate pipeline. The existing `PipelineRunner` gains a `mode` parameter: `'probe'` or `'full'`. In probe mode:

1. Run `ingest.icfs` stage with a `skipKnown: true` flag — discovery runs normally, but detail-fetch is limited to file numbers not in the DB
2. If discovery found 0 new file numbers, the stage reports `items_discovered: 0` and the runner short-circuits (skips all subsequent stages)
3. If new filings exist, continue through the remaining stages normally

### D3: Multi-stage alert evaluation

**Decision:** Replace the single `alerts.evaluate` stage at the end of the pipeline with three instances:

| Stage ID | Position | Fires on |
|----------|----------|----------|
| `alerts.evaluate-metadata` | After `ingest.icfs` | Metadata-only saved searches (applicant, subsystem, file number patterns) |
| `alerts.evaluate-keyword` | After `search.rebuild-index` | Keyword/FTS-based saved searches |
| `alerts.evaluate-semantic` | After `attachments.embed` | Semantic/vector similarity saved searches |

Each stage calls the same `evaluateAlerts()` function. The existing `getEmailedContentKeys()` dedup ensures no item alerts twice. The `alert_run` watermark advances independently per saved search, so a search that was already evaluated at the metadata stage is a no-op at later stages (unless new content appeared in between — e.g., extracted text now matches a keyword search that the raw metadata didn't match).

**Saved search classification:** Add a `search_type` field to `saved_search`: `'metadata'`, `'keyword'`, or `'semantic'`. Each alert stage evaluates only searches matching its type. Default is `'keyword'` for backward compatibility.

### D4: Scheduling

**Decision:** Scheduling is external to the pipeline runner — a new `PipelineScheduler` class that manages two recurring timers:

- **Probe timer:** Fires every 60 seconds. Runs the pipeline in `probe` mode. If a probe run is still in progress when the timer fires, the tick is skipped (no queue buildup).
- **Refresh timer:** Fires every 15 minutes. Runs the pipeline in `full` mode. The probe timer pauses while a full refresh is running.

The scheduler is started by `./daily-orbit serve api` (or a new `./daily-orbit serve scheduler` subcommand) and exposes status via the existing pipeline API.

### D5: How the probe decides "nothing new"

**Decision:** After the discovery phase of `ingest.icfs`, compute a snapshot hash and compare to the most recent `discovery_snapshot`. If hashes match AND the most recent full pipeline run completed successfully, short-circuit. If hashes match but the last full run failed (e.g., crashed mid-pipeline), fall through to full mode so incomplete work gets retried.

This requires checking `pipeline_run.status` for the most recent `mode = 'full'` run.

---

## Tasks

### Task 1: `discovery_snapshot` table and repository

**File:** `packages/server/src/icfs/snapshot-repository.ts` (new)
**File:** `packages/server/src/icfs/schema.ts` (modify)

Create the `discovery_snapshot` table:

```sql
CREATE TABLE IF NOT EXISTS discovery_snapshot (
  id INTEGER PRIMARY KEY DEFAULT nextval('discovery_snapshot_seq'),
  snapshot_hash VARCHAR NOT NULL,
  file_numbers TEXT NOT NULL,       -- JSON array of sorted file numbers
  file_count INTEGER NOT NULL,
  new_count INTEGER NOT NULL,       -- count of file numbers not in filing table at snapshot time
  pipeline_run_id INTEGER,          -- FK to pipeline_run, nullable
  created_at TIMESTAMP DEFAULT current_timestamp
);
```

Repository functions:
- `saveSnapshot(conn, hash, fileNumbers, newCount, runId?)` — insert a new row
- `getLatestSnapshot(conn)` — return the most recent snapshot
- `computeSnapshotHash(fileNumbers: string[])` — sort, dedupe, SHA-256

Add table creation to `ensureIcfsColumns()`.

**Test:** Unit test in `snapshot-repository.test.ts` — round-trip save/load, hash stability, new_count accuracy.

---

### Task 2: Split `runIcfsIngest` to support `skipKnown` mode

**File:** `packages/server/src/icfs/pipeline.ts` (modify)

Add `skipKnown?: boolean` to `IcfsIngestOptions`. When true:

1. After discovery, query the `filing` table for all discovered file numbers
2. Filter the file number list to only those not in the DB
3. If the filtered list is empty, return early with `filingsDiscovered: <total>, filingsIngested: 0` and a new `skippedKnown: <count>` field
4. Otherwise, fetch details only for the filtered file numbers

Add `skippedKnown` to `IcfsIngestResult`.

Also: after discovery (regardless of mode), compute and save a discovery snapshot.

**Test:** Integration test — run ingest in skipKnown mode with a pre-populated DB, verify only new file numbers are fetched.

---

### Task 3: Add `mode` to pipeline runner

**File:** `packages/server/src/pipeline/runner.ts` (modify)
**File:** `packages/server/src/pipeline/tracking-repository.ts` (modify)

Add `mode: 'probe' | 'full'` to `PipelineRunOptions` and persist it in the `pipeline_run` table (new `mode` column, default `'full'`).

In probe mode, after the `ingest.icfs` stage completes:
- If the stage result indicates 0 new items discovered (`items_discovered === 0` or `skippedKnown === filingsDiscovered`), mark the run as `completed` with summary "No new filings" and skip all remaining stages
- Otherwise, continue normally

Add a helper `getLastSuccessfulRun(conn, mode)` that returns the most recent `pipeline_run` with `status = 'completed'` and the given mode.

**Test:** Unit test — probe mode short-circuits when no new items; probe mode continues when new items exist.

---

### Task 4: Add `search_type` to saved searches

**File:** `packages/server/src/search/schema.ts` (modify — add column)
**File:** `packages/server/src/search/repository.ts` (modify — include in queries)
**File:** `packages/server/src/search/routes.ts` (modify — expose in API)

Add `search_type VARCHAR DEFAULT 'keyword'` column to `saved_search`. Valid values: `'metadata'`, `'keyword'`, `'semantic'`.

- `'metadata'` — searches that filter only on structured fields (applicant, subsystem, file number, date ranges)
- `'keyword'` — searches that include full-text keyword terms
- `'semantic'` — searches that use vector similarity

The classification can be auto-detected from the search parameters: if the search has no `query` text and no vector component, it's `'metadata'`; if it has a `query` but no vector, it's `'keyword'`; if it has a vector component, it's `'semantic'`. Expose an auto-classify helper and allow manual override via the API.

**Test:** Unit test for auto-classification logic.

---

### Task 5: Multi-stage alert evaluation in registry

**File:** `packages/server/src/pipeline/registry.ts` (modify)
**File:** `packages/server/src/alerts/evaluator.ts` (modify)

Replace the single `alerts.evaluate` stage with three stages:

```
alerts.evaluate-metadata   — after ingest.icfs
alerts.evaluate-keyword    — after search.rebuild-index
alerts.evaluate-semantic   — after attachments.embed
```

Each stage passes a `searchType` filter to `evaluateAlerts()`. Modify `evaluateAlerts()` to accept an optional `searchType` parameter and filter `saved_search` rows accordingly.

Update the stage ordering in the registry. The new pipeline order becomes:

```
ingest.icfs
alerts.evaluate-metadata          ← NEW
attachments.discover-download
attachments.extract
attachments.validate
attachments.summarize
attachments.embed
alerts.evaluate-semantic          ← NEW
companies.seed
companies.attribute
companies.extract-ownership
companies.enrich
news.seed
news.fetch
news.extract
news.summarize
news.attribute
search.rebuild-index
alerts.evaluate-keyword           ← NEW (was: alerts.evaluate)
```

**Test:** Integration test — create three saved searches (one per type), run pipeline, verify each fires at the correct stage and dedup prevents double-alerting.

---

### Task 6: `PipelineScheduler`

**File:** `packages/server/src/pipeline/scheduler.ts` (new)

Implement a scheduler class:

```typescript
type SchedulerConfig = {
  probeIntervalMs: number;    // default: 60_000
  refreshIntervalMs: number;  // default: 900_000 (15 min)
};
```

Behavior:
- Maintains two `setInterval` timers
- Probe timer: calls `PipelineRunner.executeRun({ mode: 'probe', stages: [...] })`
- Refresh timer: calls `PipelineRunner.executeRun({ mode: 'full', stages: [...] })`
- If a run is already in progress (check `PipelineRunner.isRunning()`), skip the tick
- Refresh timer pauses the probe timer for its duration
- Exposes `start()`, `stop()`, `status()` methods

Wire into the API server or create a `./daily-orbit serve scheduler` CLI subcommand.

Add API routes:
- `GET /api/pipeline/scheduler` — current scheduler status (running, next probe, next refresh, last probe result)
- `POST /api/pipeline/scheduler/start` — start the scheduler
- `POST /api/pipeline/scheduler/stop` — stop the scheduler

**Test:** Unit test with mocked timers — verify scheduling cadence, skip-when-busy, pause-during-refresh.

---

### Task 7: Admin UI for scheduler

**File:** `packages/app/src/admin/pipeline/` (modify existing pipeline admin page)

Add a scheduler control panel to the existing pipeline admin page:

- Start/stop toggle
- Probe interval and refresh interval inputs (with sensible defaults)
- Status display: last probe time, result (new filings found or short-circuited), next scheduled probe
- Last refresh time, next scheduled refresh
- Log of recent probe results (from `discovery_snapshot` table)

---

### Task 8: Update `doc/ingestion-pipeline.md`

Document the two-tier scheduling model, the three alert evaluation points, and the discovery snapshot mechanism. Include a diagram of the probe vs. full pipeline flow.

---

## Verification

After all tasks are complete:

1. Run `make test` — all existing tests pass, new tests pass
2. Start the scheduler, verify probe runs complete in <10 seconds when no new filings exist
3. Manually insert a test filing via the ICFS CLI (`--file-numbers`), verify the next probe detects it and alerts fire at the metadata stage
4. Verify the full refresh re-fetches all filings in the 2-month window
5. Verify dedup: a filing that triggered a metadata alert does not trigger again at the keyword stage (unless it matches a different saved search)
