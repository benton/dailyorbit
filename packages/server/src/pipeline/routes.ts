/**
 * Admin pipeline API routes.
 *
 * GET  /status       — current run state + last results per stage
 * POST /run          — kick off a run with { stages: [...] }
 * GET  /logs/:runId  — SSE endpoint: replays buffered lines then streams live
 */

import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getDb } from '../lib/db.ts';
import { getAllStages, PIPELINE_GROUPS } from './registry.ts';
import { ConflictError, getRunner } from './runner.ts';
import type { LogLine, RunSummary } from './runner.ts';
import { getScheduler } from './scheduler.ts';
import { ensurePipelineTrackingTables } from './schema.ts';
import type { PaginatedRequest } from '../lib/pagination.ts';
import {
  getRecentRuns,
  getRunsWithIcfsStats,
  getStageRunsForPipeline,
  listPipelineRuns,
} from './tracking-repository.ts';

export const pipelineRoutes = new Hono();

// ── GET /status ─────────────────────────────────────────────────────

pipelineRoutes.get('/status', (c) => {
  const runner = getRunner();
  const state = runner.getState();
  const stages = getAllStages().map((s) => ({
    id: s.id,
    group: s.group,
    name: s.name,
    description: s.description,
    defaultConcurrency: s.defaultConcurrency,
    parallelizable: s.parallelizable,
    resettable: s.resettable ?? false,
    status: state.stages[s.id]?.status ?? 'idle',
    lastResult: state.stages[s.id]?.lastResult ?? null,
    startedAt: state.stages[s.id]?.startedAt ?? null,
    finishedAt: state.stages[s.id]?.finishedAt ?? null,
  }));
  return c.json({
    runId: state.runId || null,
    running: state.running,
    currentStageId: state.currentStageId,
    groups: PIPELINE_GROUPS,
    stages,
  });
});

// ── POST /run ───────────────────────────────────────────────────────

pipelineRoutes.post('/run', async (c) => {
  const body = await c.req.json<{
    stages: string[];
    concurrencyOverrides?: Record<string, number>;
  }>();
  const stageIds: string[] = body.stages;
  const concurrencyOverrides: Record<string, number> =
    body.concurrencyOverrides != null &&
    typeof body.concurrencyOverrides === 'object'
      ? body.concurrencyOverrides
      : {};

  if (!Array.isArray(stageIds) || stageIds.length === 0) {
    return c.json({ error: 'stages array is required' }, 400);
  }

  const runner = getRunner();
  try {
    const runId: string = await runner.start(
      stageIds,
      concurrencyOverrides,
      'manual',
    );
    return c.json({ runId });
  } catch (err: unknown) {
    if (err instanceof ConflictError) {
      return c.json({ error: err.message, runId: runner.getRunId() }, 409);
    }
    throw err;
  }
});

// ── POST /stop ──────────────────────────────────────────────────────

pipelineRoutes.post('/stop', (c) => {
  const runner = getRunner();
  if (!runner.isRunning()) {
    return c.json({ error: 'No pipeline run is active' }, 404);
  }
  const stopped: boolean = runner.stop();
  return c.json({ stopped, runId: runner.getRunId() });
});

// ── GET /logs/:runId — SSE ──────────────────────────────────────────

pipelineRoutes.get('/logs/:runId', (c) => {
  const runId: string = c.req.param('runId');
  const runner = getRunner();

  return streamSSE(c, async (stream) => {
    let eventId: number = 0;

    // Helper to send a log line as an SSE event
    const sendLog = async (line: LogLine): Promise<void> => {
      await stream.writeSSE({
        id: String(eventId++),
        event: 'log',
        data: JSON.stringify(line),
      });
    };

    // Replay buffered lines first
    const buffered: LogLine[] = runner.getReplayBuffer(runId);
    for (const line of buffered) {
      await sendLog(line);
    }

    // If the run is already done and we just replayed, send done and close
    if (!runner.isRunning() || runner.getRunId() !== runId) {
      await stream.writeSSE({
        id: String(eventId++),
        event: 'done',
        data: JSON.stringify({ runId, message: 'Run already finished' }),
      });
      return;
    }

    // Stream live events
    const onLog = async (line: LogLine): Promise<void> => {
      if (line.runId === runId) {
        await sendLog(line);
      }
    };

    const onDone = async (summary: RunSummary): Promise<void> => {
      if (summary.runId === runId) {
        await stream.writeSSE({
          id: String(eventId++),
          event: 'done',
          data: JSON.stringify(summary),
        });
        cleanup();
      }
    };

    const cleanup = (): void => {
      runner.emitter.removeListener('log', onLog);
      runner.emitter.removeListener('done', onDone);
    };

    runner.emitter.on('log', onLog);
    runner.emitter.on('done', onDone);

    // Keep the connection alive until done or client disconnects
    stream.onAbort(() => {
      cleanup();
    });

    // Wait for the done event to close the stream
    await new Promise<void>((resolve) => {
      const originalOnDone = onDone;
      runner.emitter.removeListener('done', originalOnDone);
      runner.emitter.on('done', async (summary: RunSummary) => {
        if (summary.runId === runId) {
          await stream.writeSSE({
            id: String(eventId++),
            event: 'done',
            data: JSON.stringify(summary),
          });
          cleanup();
          resolve();
        }
      });

      // Also resolve if already finished
      if (!runner.isRunning() || runner.getRunId() !== runId) {
        cleanup();
        resolve();
      }
    });
  });
});

// ── POST /reset-matches/:stageId ────────────────────────────────────

pipelineRoutes.post('/reset-matches/:stageId', async (c) => {
  const stageId: string = c.req.param('stageId');

  const RESET_QUERIES: Record<string, { count: string; update: string }> = {
    'companies.attribute': {
      count: `SELECT COUNT(*)::INTEGER AS cnt FROM filing WHERE company_id IS NULL AND company_match_attempted_at IS NOT NULL`,
      update: `UPDATE filing SET company_match_attempted_at = NULL WHERE company_id IS NULL AND company_match_attempted_at IS NOT NULL`,
    },
    'companies.extract-ownership': {
      count: `SELECT COUNT(*)::INTEGER AS cnt FROM filing WHERE ownership_match_attempted_at IS NOT NULL AND file_number NOT IN (SELECT filing_file_number FROM ownership_event)`,
      update: `UPDATE filing SET ownership_match_attempted_at = NULL WHERE ownership_match_attempted_at IS NOT NULL AND file_number NOT IN (SELECT filing_file_number FROM ownership_event)`,
    },
    'news.attribute': {
      count: `SELECT COUNT(*)::INTEGER AS cnt FROM news_item WHERE company_id IS NULL AND company_match_attempted_at IS NOT NULL`,
      update: `UPDATE news_item SET company_match_attempted_at = NULL WHERE company_id IS NULL AND company_match_attempted_at IS NOT NULL`,
    },
    'attachments.embed': {
      count: `SELECT COUNT(*)::INTEGER AS cnt FROM attachment WHERE indexed_by = 'failed'`,
      update: `UPDATE attachment SET indexed_by = NULL, indexed_at = NULL WHERE indexed_by = 'failed'`,
    },
    'companies.enrich': {
      count: `SELECT COUNT(*)::INTEGER AS cnt FROM company WHERE (gleif_lei IS NULL OR wikidata_id IS NULL) AND enrichment_attempted_at IS NOT NULL`,
      update: `UPDATE company SET enrichment_attempted_at = NULL WHERE (gleif_lei IS NULL OR wikidata_id IS NULL) AND enrichment_attempted_at IS NOT NULL`,
    },
  };

  const queries = RESET_QUERIES[stageId];
  if (queries == null) {
    return c.json({ error: `Stage ${stageId} does not support reset` }, 400);
  }

  const db = await getDb();
  const conn = await DuckDBConnection.create(db);
  try {
    const countReader = await conn.runAndReadAll(queries.count);
    const affected: number = Number(countReader.getRowObjectsJS()[0]?.cnt ?? 0);
    await conn.run(queries.update);
    return c.json({ stageId, reset: affected });
  } finally {
    conn.closeSync();
  }
});

// ── GET /history/stats — chart data ──────────────────────────────────

pipelineRoutes.get('/history/stats', async (c) => {
  const limit: number = Math.min(Number(c.req.query('limit') ?? '200'), 500);
  const db = await getDb();
  const conn = await DuckDBConnection.create(db);
  try {
    const runs = await getRunsWithIcfsStats(conn, limit);
    return c.json(runs);
  } finally {
    conn.closeSync();
  }
});

// ── GET /history — paginated list ────────────────────────────────────

pipelineRoutes.get('/history', async (c) => {
  const query: Record<string, string> = c.req.query();

  // Support both legacy ?limit= and paginated params
  if (query.page != null || query.pageSize != null || query.sort != null) {
    const request: PaginatedRequest = {};
    if (query.page != null) request.page = Number(query.page);
    if (query.pageSize != null) request.pageSize = Number(query.pageSize);
    if (query.sort != null) request.sort = query.sort;
    if (query.order === 'asc' || query.order === 'desc')
      request.order = query.order;

    const db = await getDb();
    const conn = await DuckDBConnection.create(db);
    try {
      const result = await listPipelineRuns(conn, request);
      return c.json(result);
    } finally {
      conn.closeSync();
    }
  }

  // Legacy: simple array response
  const limit: number = Math.min(Number(query.limit ?? '50'), 200);
  const db = await getDb();
  const conn = await DuckDBConnection.create(db);
  try {
    await ensurePipelineTrackingTables(conn);
    const runs = await getRecentRuns(conn, limit);
    return c.json(runs);
  } finally {
    conn.closeSync();
  }
});

// ── GET /history/:runId ───────────────────────────────────────────────

pipelineRoutes.get('/history/:runId', async (c) => {
  const runId: number = Number(c.req.param('runId'));
  const db = await getDb();
  const conn = await DuckDBConnection.create(db);
  try {
    await ensurePipelineTrackingTables(conn);
    const stages = await getStageRunsForPipeline(conn, runId);
    return c.json(stages);
  } finally {
    conn.closeSync();
  }
});

// ── GET /scheduler — scheduler status ───────────────────────────────

pipelineRoutes.get('/scheduler', (c) => {
  const scheduler = getScheduler();
  return c.json(scheduler.status());
});

// ── POST /scheduler/start — start the scheduler ────────────────────

pipelineRoutes.post('/scheduler/start', async (c) => {
  const body = await c.req
    .json<{
      probeIntervalMs?: number;
      refreshIntervalMs?: number;
    }>()
    .catch(() => ({}));
  const scheduler = getScheduler(body);
  scheduler.start();
  return c.json(scheduler.status());
});

// ── POST /scheduler/stop — stop the scheduler ──────────────────────

pipelineRoutes.post('/scheduler/stop', (c) => {
  const scheduler = getScheduler();
  scheduler.stop();
  return c.json(scheduler.status());
});
