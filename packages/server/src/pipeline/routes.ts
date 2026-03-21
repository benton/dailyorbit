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
import { ensurePipelineTrackingTables } from './schema.ts';
import {
  getRecentRuns,
  getStageRunsForPipeline,
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
  const body = await c.req.json<{ stages: string[]; concurrency?: number }>();
  const stageIds: string[] = body.stages;
  const concurrency: number =
    typeof body.concurrency === 'number' ? body.concurrency : 0;

  if (!Array.isArray(stageIds) || stageIds.length === 0) {
    return c.json({ error: 'stages array is required' }, 400);
  }

  const runner = getRunner();
  try {
    const runId: string = await runner.start(stageIds, concurrency, 'manual');
    return c.json({ runId });
  } catch (err: unknown) {
    if (err instanceof ConflictError) {
      return c.json({ error: err.message, runId: runner.getRunId() }, 409);
    }
    throw err;
  }
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

// ── GET /history ──────────────────────────────────────────────────────

pipelineRoutes.get('/history', async (c) => {
  const limit: number = Math.min(Number(c.req.query('limit') ?? '50'), 200);
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
