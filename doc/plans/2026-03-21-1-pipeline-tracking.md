# Pipeline Run Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist every pipeline run and its per-stage results to DuckDB so the team can analyze content ingestion cadence (how often FCC posts new filings, what hours, batch vs. trickle) and provide a watermark for the upcoming saved-search alerting system.

**Architecture:** Add `pipeline_run` and `pipeline_stage_run` tables to DuckDB. Hook into the existing `PipelineRunner.executeRun` method to write rows at run-start, stage-start, stage-end, and run-end — alongside (not replacing) the in-memory `ReplayBuffer` + SSE streaming that already works. Add `itemsDiscovered` to `StageResult` so ingest stages can report new-item counts as structured data. Expose a read-only API for historical run queries.

**Tech Stack:** DuckDB (existing), Hono API routes (existing), TypeScript

---

### Task 1: Schema — `pipeline_run` and `pipeline_stage_run` tables

**Files:**
- Create: `packages/server/src/pipeline/schema.ts`

**Step 1: Write the schema file**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensurePipelineTrackingTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS pipeline_run_id_seq START 1;
    CREATE TABLE IF NOT EXISTS pipeline_run (
      id            INTEGER NOT NULL DEFAULT nextval('pipeline_run_id_seq') PRIMARY KEY,
      started_at    TIMESTAMP NOT NULL DEFAULT current_timestamp,
      finished_at   TIMESTAMP,
      status        VARCHAR NOT NULL DEFAULT 'running',
      triggered_by  VARCHAR NOT NULL DEFAULT 'manual',
      summary       VARCHAR
    );

    CREATE SEQUENCE IF NOT EXISTS pipeline_stage_run_id_seq START 1;
    CREATE TABLE IF NOT EXISTS pipeline_stage_run (
      id               INTEGER NOT NULL DEFAULT nextval('pipeline_stage_run_id_seq') PRIMARY KEY,
      pipeline_run_id  INTEGER NOT NULL REFERENCES pipeline_run(id),
      stage_id         VARCHAR NOT NULL,
      started_at       TIMESTAMP NOT NULL DEFAULT current_timestamp,
      finished_at      TIMESTAMP,
      status           VARCHAR NOT NULL DEFAULT 'running',
      items_discovered INTEGER NOT NULL DEFAULT 0,
      items_processed  INTEGER NOT NULL DEFAULT 0,
      items_failed     INTEGER NOT NULL DEFAULT 0,
      summary          VARCHAR
    );
  `);
}
```

**Step 2: Commit**

```bash
git add packages/server/src/pipeline/schema.ts
git commit -m "feat(pipeline): add schema for pipeline_run and pipeline_stage_run tables"
```

---

### Task 2: Add `itemsDiscovered` to `StageResult`

**Files:**
- Modify: `packages/server/src/pipeline/registry.ts` (the `StageResult` type at line 12-17)

**Step 1: Update the type**

Add `itemsDiscovered?: number;` to `StageResult`:

```typescript
export type StageResult = {
  itemsDiscovered?: number;
  itemsProcessed: number;
  itemsFailed: number;
  durationMs: number;
  summary?: string;
};
```

**Step 2: Update the ICFS ingest stage to populate `itemsDiscovered`**

In the `ingest.icfs` stage definition (same file, ~line 55-80), the return statement currently is:
```typescript
return {
  itemsProcessed: result.filingsIngested,
  itemsFailed: result.filingsFailed,
  durationMs: Date.now() - start,
  summary: `Discovered ${String(result.filingsDiscovered)}, ingested ${String(result.filingsIngested)}`,
};
```

Add `itemsDiscovered`:
```typescript
return {
  itemsDiscovered: result.filingsDiscovered,
  itemsProcessed: result.filingsIngested,
  itemsFailed: result.filingsFailed,
  durationMs: Date.now() - start,
  summary: `Discovered ${String(result.filingsDiscovered)}, ingested ${String(result.filingsIngested)}`,
};
```

**Step 3: Update the news fetch stage to populate `itemsDiscovered`**

In the `news.fetch` stage definition (~line 450-480), add `itemsDiscovered: totalInserted` to the return (for news, discovered ≈ inserted since RSS dedup happens at insert time):
```typescript
return {
  itemsDiscovered: totalInserted,
  itemsProcessed: totalInserted,
  itemsFailed: errors,
  durationMs: Date.now() - start,
  summary: `${String(results.length)} sources, ${String(totalInserted)} new items`,
};
```

**Step 4: Run tests**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=pipeline`
Expected: existing pipeline tests still pass (no breaking change — field is optional).

**Step 5: Commit**

```bash
git add packages/server/src/pipeline/registry.ts
git commit -m "feat(pipeline): add itemsDiscovered to StageResult for cadence tracking"
```

---

### Task 3: Repository — CRUD for pipeline run tracking

**Files:**
- Create: `packages/server/src/pipeline/tracking-repository.ts`
- Create: `packages/server/src/pipeline/tracking-repository.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensurePipelineTrackingTables } from './schema.ts';
import {
  insertPipelineRun,
  finishPipelineRun,
  insertStageRun,
  finishStageRun,
  getRecentRuns,
  getStageRunsForPipeline,
} from './tracking-repository.ts';

describe('pipeline tracking repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensurePipelineTrackingTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should record a full pipeline run lifecycle', async () => {
    const runId: number = await insertPipelineRun(conn, 'manual');
    expect(runId).toBeGreaterThan(0);

    const stageRunId: number = await insertStageRun(conn, runId, 'ingest.icfs');
    expect(stageRunId).toBeGreaterThan(0);

    await finishStageRun(conn, stageRunId, {
      status: 'completed',
      itemsDiscovered: 42,
      itemsProcessed: 40,
      itemsFailed: 2,
      summary: 'Discovered 42, ingested 40',
    });

    await finishPipelineRun(conn, runId, 'completed', '1 stage completed');

    const runs = await getRecentRuns(conn, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(expect.objectContaining({
      id: runId,
      status: 'completed',
      triggered_by: 'manual',
    }));
    expect(runs[0]!.finished_at).not.toBeNull();

    const stages = await getStageRunsForPipeline(conn, runId);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toEqual(expect.objectContaining({
      stage_id: 'ingest.icfs',
      status: 'completed',
      items_discovered: 42,
      items_processed: 40,
      items_failed: 2,
    }));
  });

  it('should return runs in reverse chronological order', async () => {
    const run1: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, run1, 'completed');
    const run2: number = await insertPipelineRun(conn, 'cli');
    await finishPipelineRun(conn, run2, 'completed');

    const runs = await getRecentRuns(conn, 10);
    const ids: number[] = runs.map((r) => r.id);
    expect(ids[0]).toBeGreaterThan(ids[1]!);
  });

  it('should limit results with the limit parameter', async () => {
    const runs = await getRecentRuns(conn, 1);
    expect(runs).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=tracking-repository`
Expected: FAIL — module not found.

**Step 3: Write the repository implementation**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export type PipelineRunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  triggered_by: string;
  summary: string | null;
};

export type StageRunRow = {
  id: number;
  pipeline_run_id: number;
  stage_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  items_discovered: number;
  items_processed: number;
  items_failed: number;
  summary: string | null;
};

export type FinishStageInput = {
  status: string;
  itemsDiscovered?: number;
  itemsProcessed?: number;
  itemsFailed?: number;
  summary?: string;
};

/** Insert a new pipeline run. Returns the auto-generated run ID. */
export async function insertPipelineRun(
  conn: DuckDBConnection,
  triggeredBy: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `INSERT INTO pipeline_run (triggered_by) VALUES ($1) RETURNING id`,
    [triggeredBy],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Mark a pipeline run as finished. */
export async function finishPipelineRun(
  conn: DuckDBConnection,
  runId: number,
  status: string,
  summary?: string,
): Promise<void> {
  await conn.run(
    `UPDATE pipeline_run SET finished_at = current_timestamp, status = $1, summary = $2 WHERE id = $3`,
    [status, summary ?? null, runId],
  );
}

/** Insert a new stage run within a pipeline run. Returns the stage run ID. */
export async function insertStageRun(
  conn: DuckDBConnection,
  pipelineRunId: number,
  stageId: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `INSERT INTO pipeline_stage_run (pipeline_run_id, stage_id) VALUES ($1, $2) RETURNING id`,
    [pipelineRunId, stageId],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Mark a stage run as finished with its results. */
export async function finishStageRun(
  conn: DuckDBConnection,
  stageRunId: number,
  input: FinishStageInput,
): Promise<void> {
  await conn.run(
    `UPDATE pipeline_stage_run
     SET finished_at = current_timestamp,
         status = $1,
         items_discovered = $2,
         items_processed = $3,
         items_failed = $4,
         summary = $5
     WHERE id = $6`,
    [
      input.status,
      input.itemsDiscovered ?? 0,
      input.itemsProcessed ?? 0,
      input.itemsFailed ?? 0,
      input.summary ?? null,
      stageRunId,
    ],
  );
}

/** Get recent pipeline runs, most recent first. */
export async function getRecentRuns(
  conn: DuckDBConnection,
  limit: number,
): Promise<PipelineRunRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, started_at::VARCHAR AS started_at, finished_at::VARCHAR AS finished_at,
            status, triggered_by, summary
     FROM pipeline_run ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return reader.getRowObjectsJS() as PipelineRunRow[];
}

/** Get all stage runs for a given pipeline run, ordered by start time. */
export async function getStageRunsForPipeline(
  conn: DuckDBConnection,
  pipelineRunId: number,
): Promise<StageRunRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, pipeline_run_id, stage_id,
            started_at::VARCHAR AS started_at, finished_at::VARCHAR AS finished_at,
            status, items_discovered, items_processed, items_failed, summary
     FROM pipeline_stage_run WHERE pipeline_run_id = $1 ORDER BY started_at`,
    [pipelineRunId],
  );
  return reader.getRowObjectsJS() as StageRunRow[];
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=tracking-repository`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/pipeline/tracking-repository.ts packages/server/src/pipeline/tracking-repository.test.ts
git commit -m "feat(pipeline): add tracking repository for pipeline run persistence"
```

---

### Task 4: Hook `PipelineRunner` to persist runs to DB

**Files:**
- Modify: `packages/server/src/pipeline/runner.ts`

This is the core integration. The `executeRun` method already follows the pattern: run-start → for-each-stage(stage-start → run → stage-end) → run-end. We add DB writes at each of those points.

**Step 1: Import schema and repository at top of runner.ts**

```typescript
import { ensurePipelineTrackingTables } from './schema.ts';
import {
  insertPipelineRun,
  finishPipelineRun as finishPipelineRunRecord,
  insertStageRun,
  finishStageRun,
} from './tracking-repository.ts';
```

**Step 2: Add `triggeredBy` parameter to `start()`**

Update the `start` method signature:
```typescript
async start(
  stageIds: string[],
  concurrency: number = 0,
  triggeredBy: string = 'manual',
): Promise<string> {
```

Pass it through to `executeRun`:
```typescript
this.executeRun(runId, stageIds, buffer, concurrency, triggeredBy).catch(
```

**Step 3: Update `executeRun` to persist tracking data**

Update `executeRun` signature to accept `triggeredBy`:
```typescript
private async executeRun(
  runId: string,
  stageIds: string[],
  buffer: ReplayBuffer,
  concurrencyOverride: number = 0,
  triggeredBy: string = 'manual',
): Promise<void> {
```

After the DB connection is established (after the `try { db = await getDb(); conn = ... }` block), add:

```typescript
// Persist run tracking
await ensurePipelineTrackingTables(conn);
const dbRunId: number = await insertPipelineRun(conn, triggeredBy);
```

Inside the stage loop, **after** setting the stage state to 'running' and emitting 'stage-start':

```typescript
const dbStageRunId: number = await insertStageRun(conn, dbRunId, stageId);
```

In the stage **success** path (after `completed++`), add:

```typescript
await finishStageRun(conn, dbStageRunId, {
  status: 'completed',
  itemsDiscovered: result.itemsDiscovered,
  itemsProcessed: result.itemsProcessed,
  itemsFailed: result.itemsFailed,
  summary: result.summary,
});
```

In the stage **catch** block (after `failed++`), add:

```typescript
await finishStageRun(conn, dbStageRunId, {
  status: 'failed',
  summary: msg,
});
```

In the **finally** block, before closing the connection, add:

```typescript
const runStatus: string = failed > 0 ? 'failed' : 'completed';
const runSummary: string = `${String(completed)} completed, ${String(failed)} failed`;
await finishPipelineRunRecord(conn, dbRunId, runStatus, runSummary).catch(
  () => { /* best-effort — connection may already be bad */ },
);
```

**Step 4: Update the `start()` caller in routes.ts**

In `packages/server/src/pipeline/routes.ts`, the POST `/run` handler calls `runner.start(stageIds, concurrency)`. Add `'manual'` as the third argument:

```typescript
const runId = await runner.start(stageIds, concurrency, 'manual');
```

**Step 5: Run existing pipeline tests**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=pipeline`
Expected: PASS — existing tests should still pass since the DB tracking is additive.

**Step 6: Commit**

```bash
git add packages/server/src/pipeline/runner.ts packages/server/src/pipeline/routes.ts
git commit -m "feat(pipeline): persist run and stage results to DuckDB tracking tables"
```

---

### Task 5: API endpoint for historical pipeline runs

**Files:**
- Modify: `packages/server/src/pipeline/routes.ts`

**Step 1: Add GET `/history` and GET `/history/:runId` routes**

After the existing routes in `routes.ts`, add:

```typescript
import {
  getRecentRuns,
  getStageRunsForPipeline,
} from './tracking-repository.ts';

// GET /api/pipeline/history
pipelineRoutes.get('/history', async (c) => {
  const limit: number = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const conn = await getConn();
  try {
    const runs = await getRecentRuns(conn, limit);
    return c.json(runs);
  } finally {
    conn.closeSync();
  }
});

// GET /api/pipeline/history/:runId
pipelineRoutes.get('/history/:runId', async (c) => {
  const runId: number = Number(c.req.param('runId'));
  const conn = await getConn();
  try {
    const stages = await getStageRunsForPipeline(conn, runId);
    return c.json(stages);
  } finally {
    conn.closeSync();
  }
});
```

Note: check how the existing routes obtain a connection (likely via `getDb()` + `DuckDBConnection.create()`). Use the same pattern — look at the existing `pipelineRoutes.get('/status')` handler for reference.

**Step 2: Commit**

```bash
git add packages/server/src/pipeline/routes.ts
git commit -m "feat(pipeline): add /history API endpoints for pipeline run queries"
```

---

### Task 6: Integration test — full pipeline run persists tracking data

**Files:**
- Create: `packages/server/src/pipeline/tracking-integration.test.ts`

**Step 1: Write the integration test**

This test runs a real (lightweight) pipeline stage and verifies tracking data was persisted.

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensurePipelineTrackingTables } from './schema.ts';
import { getRecentRuns, getStageRunsForPipeline } from './tracking-repository.ts';
import { PipelineRunner, resetRunner } from './runner.ts';

describe('pipeline tracking integration', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensurePipelineTrackingTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  afterEach(() => {
    resetRunner();
  });

  it('should persist run and stage data after pipeline execution', async () => {
    // This test will need to mock getDb() to return the in-memory instance.
    // The exact mocking approach depends on how the existing runner.test.ts works.
    // Follow the same pattern used in packages/server/src/pipeline/runner.test.ts.

    // After running a pipeline with at least one stage:
    const runs = await getRecentRuns(conn, 10);
    // Verify at least one run exists with status 'completed' or 'failed'
    // Verify stage runs exist with items_discovered populated
    expect(runs.length).toBeGreaterThan(0);
  });
});
```

Note: this test skeleton needs to be adapted to match the existing test patterns in `runner.test.ts`. Read that file first to understand how DB mocking is set up, then mirror the approach. The key assertion is that after a pipeline run completes, `getRecentRuns` returns data and `getStageRunsForPipeline` returns stage-level detail with `items_discovered` populated.

**Step 2: Run test**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=tracking-integration`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/server/src/pipeline/tracking-integration.test.ts
git commit -m "test(pipeline): add integration test for pipeline run tracking persistence"
```

---

### Task 7: Update ingestion pipeline documentation

**Files:**
- Modify: `doc/ingestion-pipeline.md`

**Step 1: Add a section documenting the tracking tables**

Add a new section titled "## Pipeline Run Tracking" that documents:
- The `pipeline_run` and `pipeline_stage_run` tables and their schemas
- That tracking is automatic — every pipeline execution (manual, CLI, or scheduled) persists results
- That `items_discovered` on ingest stages (`ingest.icfs`, `news.fetch`) tracks new content arrival for cadence analysis
- The `/api/pipeline/history` and `/api/pipeline/history/:runId` endpoints
- That this data will be consumed by the upcoming saved-search alerting system as watermarks

**Step 2: Commit**

```bash
git add doc/ingestion-pipeline.md
git commit -m "docs(pipeline): document pipeline run tracking tables and API"
```

---

## Summary of Deliverables

| What | Where |
|------|-------|
| Schema DDL | `packages/server/src/pipeline/schema.ts` |
| `StageResult.itemsDiscovered` | `packages/server/src/pipeline/registry.ts` |
| Tracking repository + tests | `packages/server/src/pipeline/tracking-repository.ts` + `.test.ts` |
| Runner integration | `packages/server/src/pipeline/runner.ts` (modified) |
| History API routes | `packages/server/src/pipeline/routes.ts` (modified) |
| Integration test | `packages/server/src/pipeline/tracking-integration.test.ts` |
| Documentation | `doc/ingestion-pipeline.md` (modified) |

## What This Unblocks

This is the first piece of the Monitoring & Alerting epic. Once pipeline runs are tracked with `items_discovered` counts, the subsequent features can build on it:

1. **Saved Searches** — `saved_search` table + API (next plan)
2. **Viewing History expansion** — `user_news_view` + `user_content_flag` tables (next plan)
3. **Alert evaluation** — `alert_run` table referencing `pipeline_run.id` as watermark (next plan)
4. **Alert UI + email delivery** (next plan)
