# Alert Evaluation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an `alerts.evaluate` pipeline stage that, after content ingestion completes, runs all alert-enabled saved searches against newly discovered items, writes matches as flags in `user_content_flag`, and records each evaluation in an `alert_run` log table.

**Architecture:** New `alerts` pipeline group with a single `alerts.evaluate` stage. The stage short-circuits if no ingest stages discovered new items in the current run. Otherwise, it fetches all saved searches where `alert_enabled = true`, determines each search's watermark from its most recent `alert_run`, executes the search scoped to items newer than that watermark via `executeSavedSearch()`, writes matches to `user_content_flag` with `source='alert'`, and logs the evaluation in `alert_run`. Per-saved-search watermarking ensures independent progress tracking.

**Tech Stack:** DuckDB (existing), pipeline runner (existing), saved-search execution service (from saved-searches plan), content-flag repository (from viewing-history plan)

**Depends on:**
- Pipeline Run Tracking (merged)
- Saved Searches plan (for `saved_search` table and `executeSavedSearch()`)
- Viewing History & Flagging plan (for `user_content_flag` table and `createFlag()`)

---

### Task 1: Schema — `alert_run` table

**Files:**
- Create: `packages/server/src/alerts/schema.ts`

**Step 1: Write the schema file**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureAlertTables(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(`
    CREATE SEQUENCE IF NOT EXISTS alert_run_id_seq START 1;
    CREATE TABLE IF NOT EXISTS alert_run (
      id               INTEGER NOT NULL DEFAULT nextval('alert_run_id_seq') PRIMARY KEY,
      saved_search_id  INTEGER NOT NULL,
      pipeline_run_id  INTEGER NOT NULL,
      executed_at      TIMESTAMP NOT NULL DEFAULT current_timestamp,
      items_matched    INTEGER NOT NULL DEFAULT 0,
      items_flagged    INTEGER NOT NULL DEFAULT 0,
      email_sent       BOOLEAN NOT NULL DEFAULT false,
      error            VARCHAR
    );
  `);
}
```

Note: `saved_search_id` and `pipeline_run_id` are plain INTEGERs without FK constraints to allow independent deployment ordering. FKs can be added later via ALTER TABLE.

**Step 2: Commit**

```bash
git add packages/server/src/alerts/schema.ts
git commit -m "feat(alerts): add schema for alert_run table"
```

---

### Task 2: Alert run repository and tests

**Files:**
- Create: `packages/server/src/alerts/repository.ts`
- Create: `packages/server/src/alerts/repository.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureAlertTables } from './schema.ts';
import {
  insertAlertRun,
  getLastAlertRun,
  getAlertRunsForSearch,
} from './repository.ts';

describe('alert run repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureAlertTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should insert an alert run and retrieve it', async () => {
    const id: number = await insertAlertRun(conn, {
      savedSearchId: 1,
      pipelineRunId: 10,
      itemsMatched: 5,
      itemsFlagged: 3,
      emailSent: false,
    });
    expect(id).toBeGreaterThan(0);

    const runs = await getAlertRunsForSearch(conn, 1, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(expect.objectContaining({
      saved_search_id: 1,
      pipeline_run_id: 10,
      items_matched: 5,
      items_flagged: 3,
      email_sent: false,
      error: null,
    }));
  });

  it('should return the most recent alert run for a saved search', async () => {
    await insertAlertRun(conn, {
      savedSearchId: 1,
      pipelineRunId: 11,
      itemsMatched: 2,
      itemsFlagged: 2,
      emailSent: true,
    });

    const last = await getLastAlertRun(conn, 1);
    expect(last).not.toBeNull();
    expect(last!.pipeline_run_id).toEqual(11);
  });

  it('should return null when no alert runs exist for a search', async () => {
    const last = await getLastAlertRun(conn, 999);
    expect(last).toBeNull();
  });

  it('should record an error on a failed alert run', async () => {
    const id: number = await insertAlertRun(conn, {
      savedSearchId: 2,
      pipelineRunId: 10,
      itemsMatched: 0,
      itemsFlagged: 0,
      emailSent: false,
      error: 'Search query failed',
    });

    const runs = await getAlertRunsForSearch(conn, 2, 10);
    const run = runs.find((r) => r.id === id);
    expect(run!.error).toEqual('Search query failed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=alerts/repository`
Expected: FAIL — module not found.

**Step 3: Write the repository**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';

export type AlertRunRow = {
  id: number;
  saved_search_id: number;
  pipeline_run_id: number;
  executed_at: string;
  items_matched: number;
  items_flagged: number;
  email_sent: boolean;
  error: string | null;
};

export type InsertAlertRunInput = {
  savedSearchId: number;
  pipelineRunId: number;
  itemsMatched: number;
  itemsFlagged: number;
  emailSent: boolean;
  error?: string;
};

/** Insert an alert run record. Returns the new ID. */
export async function insertAlertRun(
  conn: DuckDBConnection,
  input: InsertAlertRunInput,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `INSERT INTO alert_run (saved_search_id, pipeline_run_id, items_matched, items_flagged, email_sent, error)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.savedSearchId,
      input.pipelineRunId,
      input.itemsMatched,
      input.itemsFlagged,
      input.emailSent,
      input.error ?? null,
    ],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Get the most recent alert run for a given saved search. */
export async function getLastAlertRun(
  conn: DuckDBConnection,
  savedSearchId: number,
): Promise<AlertRunRow | null> {
  const reader = await conn.runAndReadAll(
    `SELECT id, saved_search_id, pipeline_run_id,
            executed_at::VARCHAR AS executed_at,
            items_matched, items_flagged, email_sent, error
     FROM alert_run
     WHERE saved_search_id = $1
     ORDER BY executed_at DESC
     LIMIT 1`,
    [savedSearchId],
  );
  const rows = reader.getRowObjectsJS() as AlertRunRow[];
  return rows.length > 0 ? rows[0]! : null;
}

/** Get alert run history for a saved search, most recent first. */
export async function getAlertRunsForSearch(
  conn: DuckDBConnection,
  savedSearchId: number,
  limit: number,
): Promise<AlertRunRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, saved_search_id, pipeline_run_id,
            executed_at::VARCHAR AS executed_at,
            items_matched, items_flagged, email_sent, error
     FROM alert_run
     WHERE saved_search_id = $1
     ORDER BY executed_at DESC
     LIMIT $2`,
    [savedSearchId, limit],
  );
  return reader.getRowObjectsJS() as AlertRunRow[];
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=alerts/repository`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/alerts/repository.ts packages/server/src/alerts/repository.test.ts
git commit -m "feat(alerts): add alert_run repository with insert, getLastAlertRun, and history"
```

---

### Task 3: Alert evaluator — core evaluation logic

**Files:**
- Create: `packages/server/src/alerts/evaluator.ts`
- Create: `packages/server/src/alerts/evaluator.test.ts`

This is the core logic: given a pipeline run context, fetch alert-enabled searches, determine watermarks, execute searches, and write flags.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureAlertTables } from './schema.ts';
import { ensureSavedSearchTables } from '../saved-search/schema.ts';
import { ensureContentFlagTables } from '../content-flag/schema.ts';
import { ensurePipelineTrackingTables } from '../pipeline/schema.ts';
import { createSavedSearch, updateSavedSearch } from '../saved-search/repository.ts';
import { insertPipelineRun, finishPipelineRun } from '../pipeline/tracking-repository.ts';
import { getActiveFlagsForUser } from '../content-flag/repository.ts';
import { evaluateAlerts } from './evaluator.ts';

describe('alert evaluator', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const userId: string = 'test-user-001';

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    // Create required tables
    await conn.run(`
      CREATE TABLE IF NOT EXISTS "user" (
        id VARCHAR NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL UNIQUE,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image VARCHAR,
        "createdAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        role VARCHAR NOT NULL DEFAULT 'user',
        banned BOOLEAN NOT NULL DEFAULT false,
        "banReason" VARCHAR,
        "banExpires" TIMESTAMP
      );
      INSERT INTO "user" (id, name, email) VALUES ('test-user-001', 'Test', 'test@example.com');
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        callsign VARCHAR,
        address_attention VARCHAR,
        subsystem_code VARCHAR NOT NULL,
        app_type_code VARCHAR NOT NULL,
        status_code VARCHAR,
        date_filed TIMESTAMP,
        company_id INTEGER,
        _first_seen_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        parent_company_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        summary VARCHAR,
        attachment_name VARCHAR
      );
    `);
    await ensurePipelineTrackingTables(conn);
    await ensureSavedSearchTables(conn);
    await ensureContentFlagTables(conn);
    await ensureAlertTables(conn);

    // Seed a filing that was "just discovered"
    await conn.run(`
      INSERT INTO filing VALUES
        (1, 'SAT-LOA-20260321-00001', 'E100', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2026-03-21', NULL, current_timestamp);
    `);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should flag new content matching an alert-enabled saved search', async () => {
    // Create a saved search and enable alerting
    const searchId: number = await createSavedSearch(conn, userId, {
      name: 'All SAT filings',
      content_type: 'filing',
      filters: { subsystem_code: ['SAT'] },
    });
    await updateSavedSearch(conn, searchId, userId, { alert_enabled: true });

    // Create a pipeline run to reference
    const pipelineRunId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, pipelineRunId, 'completed');

    // Evaluate alerts
    const result = await evaluateAlerts(conn, pipelineRunId);
    expect(result.searchesEvaluated).toEqual(1);
    expect(result.totalMatched).toBeGreaterThanOrEqual(1);
    expect(result.totalFlagged).toBeGreaterThanOrEqual(1);

    // Verify flag was written
    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const match = flags.find((f) => f.content_key === 'SAT-LOA-20260321-00001');
    expect(match).toBeDefined();
    expect(match!.source).toEqual('alert');
    expect(match!.saved_search_id).toEqual(searchId);
  });

  it('should not duplicate flags on repeated evaluations', async () => {
    const pipelineRunId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, pipelineRunId, 'completed');

    const result = await evaluateAlerts(conn, pipelineRunId);
    // Should match but not flag (already flagged from previous run)
    expect(result.searchesEvaluated).toEqual(1);

    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const matches = flags.filter((f) => f.content_key === 'SAT-LOA-20260321-00001');
    expect(matches).toHaveLength(1); // Still just one flag
  });

  it('should not evaluate searches that are not alert-enabled', async () => {
    await createSavedSearch(conn, userId, {
      name: 'Non-alert search',
      content_type: 'filing',
      filters: { subsystem_code: ['SES'] },
    });
    // Not calling updateSavedSearch to enable alerting

    const pipelineRunId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, pipelineRunId, 'completed');

    const result = await evaluateAlerts(conn, pipelineRunId);
    // Should still only evaluate 1 search (the alert-enabled one)
    expect(result.searchesEvaluated).toEqual(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=alerts/evaluator`
Expected: FAIL — module not found.

**Step 3: Write the evaluator**

```typescript
import type { DuckDBConnection } from '@duckdb/node-api';
import type { SavedSearchResponse } from '../saved-search/types.ts';
import { executeSavedSearch } from '../saved-search/execute.ts';
import { createFlag } from '../content-flag/repository.ts';
import { insertAlertRun, getLastAlertRun } from './repository.ts';

export type EvaluationResult = {
  searchesEvaluated: number;
  totalMatched: number;
  totalFlagged: number;
  errors: number;
};

/** Fetch all alert-enabled saved searches. */
async function getAlertEnabledSearches(
  conn: DuckDBConnection,
): Promise<(SavedSearchResponse & { user_id: string })[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, name, content_type, filters::VARCHAR AS filters,
            include_time_scope, alert_enabled,
            created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
     FROM saved_search
     WHERE alert_enabled = true`,
  );
  return reader.getRowObjectsJS().map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      user_id: String(r.user_id),
      name: String(r.name),
      content_type: String(r.content_type) as 'filing' | 'news',
      filters: JSON.parse(String(r.filters)),
      include_time_scope: Boolean(r.include_time_scope),
      alert_enabled: Boolean(r.alert_enabled),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  });
}

/**
 * Determine the watermark timestamp for a saved search.
 * Returns the executed_at of the most recent alert_run for this search,
 * or the search's created_at if it has never been evaluated.
 */
async function getWatermark(
  conn: DuckDBConnection,
  savedSearch: SavedSearchResponse & { user_id: string },
): Promise<string> {
  const lastRun = await getLastAlertRun(conn, savedSearch.id);
  if (lastRun != null) {
    return lastRun.executed_at;
  }
  // First evaluation — use the search's creation time as baseline
  // so we don't alert on pre-existing content
  return savedSearch.created_at;
}

/**
 * Extract content keys from search results.
 * Filing results have `file_number`, news results have `news_item_id`.
 */
function extractContentKeys(
  contentType: string,
  results: unknown[],
): string[] {
  return results.map((r) => {
    const row = r as Record<string, unknown>;
    if (contentType === 'filing') {
      return String(row.file_number);
    }
    return String(row.news_item_id);
  });
}

/**
 * Evaluate all alert-enabled saved searches against new content.
 * Called as part of the pipeline's alerts.evaluate stage.
 */
export async function evaluateAlerts(
  conn: DuckDBConnection,
  pipelineRunId: number,
): Promise<EvaluationResult> {
  const searches = await getAlertEnabledSearches(conn);

  let searchesEvaluated: number = 0;
  let totalMatched: number = 0;
  let totalFlagged: number = 0;
  let errors: number = 0;

  for (const search of searches) {
    try {
      const watermark: string = await getWatermark(conn, search);

      // Execute the saved search scoped to items since the watermark
      const result = await executeSavedSearch(
        conn,
        search.content_type,
        search.filters,
        { page: 1, pageSize: 500 },
        watermark,
      );

      const contentKeys: string[] = extractContentKeys(
        search.content_type,
        result.data as unknown[],
      );

      let flagged: number = 0;
      for (const key of contentKeys) {
        // createFlag upserts — won't duplicate if already flagged
        await createFlag(conn, search.user_id, {
          content_type: search.content_type,
          content_key: key,
          source: 'alert',
          saved_search_id: search.id,
          reason: `Matched saved search: ${search.name}`,
        });
        flagged++;
      }

      // Record the alert run
      await insertAlertRun(conn, {
        savedSearchId: search.id,
        pipelineRunId,
        itemsMatched: contentKeys.length,
        itemsFlagged: flagged,
        emailSent: false, // Email delivery is a separate plan
      });

      searchesEvaluated++;
      totalMatched += contentKeys.length;
      totalFlagged += flagged;
    } catch (err: unknown) {
      errors++;
      const msg: string = err instanceof Error ? err.message : String(err);
      // Record the failed alert run
      await insertAlertRun(conn, {
        savedSearchId: search.id,
        pipelineRunId,
        itemsMatched: 0,
        itemsFlagged: 0,
        emailSent: false,
        error: msg,
      }).catch(() => { /* best-effort */ });
    }
  }

  return { searchesEvaluated, totalMatched, totalFlagged, errors };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=alerts/evaluator`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/alerts/evaluator.ts packages/server/src/alerts/evaluator.test.ts
git commit -m "feat(alerts): add core alert evaluation logic with per-search watermarking"
```

---

### Task 4: Pipeline stage — `alerts.evaluate`

**Files:**
- Modify: `packages/server/src/pipeline/registry.ts`

**Step 1: Add the alerts stage and group**

At the end of the `STAGES` array (after `search.rebuild-index`), add:

```typescript
// ── Alerts ───────────────────────────────────────────────────
{
  id: 'alerts.evaluate',
  group: 'alerts',
  name: 'Evaluate Alerts',
  description: 'Run alert-enabled saved searches against newly ingested content',
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { ensureAlertTables } = await import('../alerts/schema.ts');
    const { evaluateAlerts } = await import('../alerts/evaluator.ts');
    const { ensureSavedSearchTables } = await import('../saved-search/schema.ts');
    const { ensureContentFlagTables } = await import('../content-flag/schema.ts');
    const start: number = Date.now();

    await ensureAlertTables(ctx.conn);
    await ensureSavedSearchTables(ctx.conn);
    await ensureContentFlagTables(ctx.conn);

    // Short-circuit: check if any ingest stages discovered new items in this run
    const { getStageRunsForPipeline } = await import('../pipeline/tracking-repository.ts');
    const { getRunner } = await import('../pipeline/runner.ts');
    const runner = getRunner();
    const runState = runner.getState();

    // Check in-memory stage states for discovery counts from this run
    const ingestStageIds: string[] = ['ingest.icfs', 'news.fetch'];
    let totalDiscovered: number = 0;
    for (const stageId of ingestStageIds) {
      const stageState = runState.stages[stageId];
      if (stageState?.lastResult?.itemsDiscovered != null) {
        totalDiscovered += stageState.lastResult.itemsDiscovered;
      }
    }

    if (totalDiscovered === 0) {
      ctx.log('info', 'No new content discovered in this run, skipping alert evaluation');
      return {
        itemsDiscovered: 0,
        itemsProcessed: 0,
        itemsFailed: 0,
        durationMs: Date.now() - start,
        summary: 'Skipped — no new content',
      };
    }

    ctx.log('info', `${String(totalDiscovered)} new items discovered, evaluating alerts`);

    // Determine the pipeline run ID from the tracking tables
    // The current run should be the most recent one
    const { getRecentRuns } = await import('../pipeline/tracking-repository.ts');
    const recentRuns = await getRecentRuns(ctx.conn, 1);
    const pipelineRunId: number = recentRuns.length > 0 ? recentRuns[0]!.id : 0;

    const result = await evaluateAlerts(ctx.conn, pipelineRunId);

    ctx.log('info',
      `Evaluated ${String(result.searchesEvaluated)} searches: ${String(result.totalMatched)} matched, ${String(result.totalFlagged)} flagged`,
    );

    return {
      itemsDiscovered: result.totalMatched,
      itemsProcessed: result.searchesEvaluated,
      itemsFailed: result.errors,
      durationMs: Date.now() - start,
      summary: `${String(result.searchesEvaluated)} searches, ${String(result.totalMatched)} matches, ${String(result.totalFlagged)} flagged`,
    };
  },
},
```

**Step 2: Add the alerts group to PIPELINE_GROUPS**

At the end of the `PIPELINE_GROUPS` array:

```typescript
{ id: 'alerts', name: 'Alerts', stageIds: ['alerts.evaluate'] },
```

**Step 3: Run existing pipeline tests**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=pipeline`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/server/src/pipeline/registry.ts
git commit -m "feat(alerts): register alerts.evaluate as pipeline stage with short-circuit on empty ingest"
```

---

### Task 5: API routes — alert history

**Files:**
- Create: `packages/server/src/alerts/routes.ts`
- Modify: `packages/server/src/app.ts`

**Step 1: Write the routes**

Expose read-only endpoints for viewing alert run history, useful for the admin UI and the upcoming alert UI plan.

```typescript
import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import { ensureAlertTables } from './schema.ts';
import { getAlertRunsForSearch } from './repository.ts';

const alertRoutes = new Hono();

// GET /api/alerts/history/:savedSearchId — alert run history for a saved search
alertRoutes.get('/history/:savedSearchId', async (c) => {
  const savedSearchId: number = Number(c.req.param('savedSearchId'));
  const limit: number = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureAlertTables(conn);
    const runs = await getAlertRunsForSearch(conn, savedSearchId, limit);
    return c.json(runs);
  } finally {
    conn.closeSync();
  }
});

// GET /api/alerts/summary — summary of recent alert activity for current user
alertRoutes.get('/summary', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureAlertTables(conn);
    // Get recent alert runs for this user's saved searches
    const reader = await conn.runAndReadAll(
      `SELECT ar.id, ar.saved_search_id, ss.name AS search_name,
              ar.pipeline_run_id, ar.executed_at::VARCHAR AS executed_at,
              ar.items_matched, ar.items_flagged, ar.email_sent, ar.error
       FROM alert_run ar
       JOIN saved_search ss ON ss.id = ar.saved_search_id
       WHERE ss.user_id = $1
       ORDER BY ar.executed_at DESC
       LIMIT 50`,
      [user.id],
    );
    return c.json(reader.getRowObjectsJS());
  } finally {
    conn.closeSync();
  }
});

export { alertRoutes };
```

**Step 2: Register in app.ts**

```typescript
import { alertRoutes } from './alerts/routes.ts';
// Mount inside the authenticated middleware group:
app.route('/api/alerts', alertRoutes);
```

**Step 3: Commit**

```bash
git add packages/server/src/alerts/routes.ts packages/server/src/app.ts
git commit -m "feat(alerts): add API routes for alert run history and summary"
```

---

### Task 6: Integration test — end-to-end alert evaluation

**Files:**
- Create: `packages/server/src/alerts/evaluator-integration.test.ts`

**Step 1: Write the integration test**

This test simulates the full flow: create user → create saved search → enable alerting → insert a new filing → run evaluateAlerts → verify flag written and alert_run recorded.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureAlertTables } from './schema.ts';
import { ensureSavedSearchTables } from '../saved-search/schema.ts';
import { ensureContentFlagTables } from '../content-flag/schema.ts';
import { ensurePipelineTrackingTables } from '../pipeline/schema.ts';
import { createSavedSearch, updateSavedSearch } from '../saved-search/repository.ts';
import { insertPipelineRun, finishPipelineRun } from '../pipeline/tracking-repository.ts';
import { getActiveFlagsForUser } from '../content-flag/repository.ts';
import { getLastAlertRun } from './repository.ts';
import { evaluateAlerts } from './evaluator.ts';

describe('alert evaluation integration', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const userId: string = 'integration-user';

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS "user" (
        id VARCHAR NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL UNIQUE,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image VARCHAR,
        "createdAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        role VARCHAR NOT NULL DEFAULT 'user',
        banned BOOLEAN NOT NULL DEFAULT false,
        "banReason" VARCHAR,
        "banExpires" TIMESTAMP
      );
      INSERT INTO "user" (id, name, email) VALUES ('integration-user', 'Integrator', 'int@example.com');
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER NOT NULL, file_number VARCHAR NOT NULL,
        callsign VARCHAR, address_attention VARCHAR,
        subsystem_code VARCHAR NOT NULL, app_type_code VARCHAR NOT NULL,
        status_code VARCHAR, date_filed TIMESTAMP,
        company_id INTEGER, _first_seen_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, parent_company_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER NOT NULL, file_number VARCHAR NOT NULL,
        summary VARCHAR, attachment_name VARCHAR
      );
    `);
    await ensurePipelineTrackingTables(conn);
    await ensureSavedSearchTables(conn);
    await ensureContentFlagTables(conn);
    await ensureAlertTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should evaluate alerts end-to-end: search → match → flag → log', async () => {
    // 1. Create and enable a saved search
    const searchId: number = await createSavedSearch(conn, userId, {
      name: 'SES earth station filings',
      content_type: 'filing',
      filters: { subsystem_code: ['SES'] },
    });
    await updateSavedSearch(conn, searchId, userId, { alert_enabled: true });

    // 2. Insert a filing that matches — simulating ingest
    await conn.run(`
      INSERT INTO filing VALUES
        (100, 'SES-LIC-20260321-00001', 'E999', 'ViaSat Inc', 'SES', 'LIC', 'A', '2026-03-21', NULL, current_timestamp);
    `);

    // 3. Create a pipeline run
    const runId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, runId, 'completed');

    // 4. Evaluate
    const result = await evaluateAlerts(conn, runId);
    expect(result.searchesEvaluated).toEqual(1);
    expect(result.totalMatched).toBeGreaterThanOrEqual(1);

    // 5. Verify flag exists
    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const match = flags.find((f) => f.content_key === 'SES-LIC-20260321-00001');
    expect(match).toBeDefined();
    expect(match!.source).toEqual('alert');
    expect(match!.saved_search_id).toEqual(searchId);
    expect(match!.reason).toContain('SES earth station filings');

    // 6. Verify alert_run was recorded
    const alertRun = await getLastAlertRun(conn, searchId);
    expect(alertRun).not.toBeNull();
    expect(alertRun!.pipeline_run_id).toEqual(runId);
    expect(alertRun!.items_matched).toBeGreaterThanOrEqual(1);
    expect(alertRun!.email_sent).toEqual(false);
  });
});
```

**Step 2: Run test**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=evaluator-integration`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/server/src/alerts/evaluator-integration.test.ts
git commit -m "test(alerts): add end-to-end integration test for alert evaluation"
```

---

## Summary of Deliverables

| What | Where |
|------|-------|
| `alert_run` schema | `packages/server/src/alerts/schema.ts` |
| Alert run repository + tests | `packages/server/src/alerts/repository.ts` + `.test.ts` |
| Core evaluator + tests | `packages/server/src/alerts/evaluator.ts` + `.test.ts` |
| Pipeline stage registration | `packages/server/src/pipeline/registry.ts` (modified) |
| Alert history API routes | `packages/server/src/alerts/routes.ts` |
| App registration | `packages/server/src/app.ts` (modified) |
| Integration test | `packages/server/src/alerts/evaluator-integration.test.ts` |

## What This Unblocks

With alert evaluation running as a pipeline stage:
- The Alert UI plan can query `user_content_flag WHERE source='alert'` for dashboard prominence
- The email delivery plan can check `alert_run WHERE email_sent = false` and aggregate unsent matches
- The admin pipeline UI already shows `alerts.evaluate` as a stage with run history
- Cadence analysis from pipeline tracking now includes alert evaluation timing
