/**
 * Pipeline runner — orchestrates sequential stage execution with
 * EventEmitter-based log streaming and single-run enforcement.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import {
  trackConnection,
  untrackConnection,
} from '../lib/graceful-shutdown.ts';
import type { PipelineContext, StageResult } from './registry.ts';
import { getStage } from './registry.ts';
import { ensurePipelineTrackingTables } from './schema.ts';
import {
  insertPipelineRun,
  finishPipelineRun as finishPipelineRunRecord,
  insertStageRun,
  finishStageRun,
} from './tracking-repository.ts';

// ── Types ───────────────────────────────────────────────────────────

export type StageStatus = 'idle' | 'running' | 'success' | 'failed';

export type StageState = {
  id: string;
  status: StageStatus;
  lastResult?: StageResult;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
};

export type RunState = {
  runId: string;
  running: boolean;
  currentStageId: string | null;
  stages: Record<string, StageState>;
};

export type LogLine = {
  runId: string;
  stage: string;
  level: 'info' | 'error' | 'progress';
  message: string;
  timestamp: string;
};

export type RunSummary = {
  runId: string;
  stagesCompleted: number;
  stagesFailed: number;
  totalDurationMs: number;
};

// ── Replay buffer ───────────────────────────────────────────────────

const REPLAY_BUFFER_SIZE: number = 500;

class ReplayBuffer {
  private readonly lines: LogLine[] = [];

  push(line: LogLine): void {
    this.lines.push(line);
    if (this.lines.length > REPLAY_BUFFER_SIZE) {
      this.lines.shift();
    }
  }

  getAll(): LogLine[] {
    return [...this.lines];
  }

  clear(): void {
    this.lines.length = 0;
  }
}

// ── Runner singleton ────────────────────────────────────────────────

class PipelineRunner {
  readonly emitter: EventEmitter = new EventEmitter();
  private running: boolean = false;
  private currentRunId: string | null = null;
  private currentStageId: string | null = null;
  private readonly stageStates: Map<string, StageState> = new Map();
  private readonly replayBuffers: Map<string, ReplayBuffer> = new Map();

  /** Check if a run is currently active. */
  isRunning(): boolean {
    return this.running;
  }

  /** Get the current run ID, or null if idle. */
  getRunId(): string | null {
    return this.currentRunId;
  }

  /** Get the current state snapshot. */
  getState(): RunState {
    const stages: Record<string, StageState> = {};
    for (const [id, state] of this.stageStates) {
      stages[id] = { ...state };
    }
    return {
      runId: this.currentRunId ?? '',
      running: this.running,
      currentStageId: this.currentStageId,
      stages,
    };
  }

  /** Get replay buffer for a run. */
  getReplayBuffer(runId: string): LogLine[] {
    return this.replayBuffers.get(runId)?.getAll() ?? [];
  }

  /**
   * Start a pipeline run with the given stage IDs.
   * Returns the run ID. Throws if a run is already active.
   * @param concurrency — per-stage concurrency override (0 = use stage default)
   */
  async start(
    stageIds: string[],
    concurrency: number = 0,
    triggeredBy: string = 'manual',
  ): Promise<string> {
    if (this.running) {
      throw new ConflictError('A pipeline run is already in progress');
    }

    const runId: string = randomUUID().slice(0, 8);
    this.running = true;
    this.currentRunId = runId;
    this.currentStageId = null;

    const buffer = new ReplayBuffer();
    this.replayBuffers.set(runId, buffer);

    // Initialize stage states
    for (const id of stageIds) {
      this.stageStates.set(id, { id, status: 'idle' });
    }

    // Run asynchronously — don't await
    this.executeRun(runId, stageIds, buffer, concurrency, triggeredBy).catch(
      (err: unknown) => {
        const msg: string = err instanceof Error ? err.message : String(err);
        this.emitLog(
          buffer,
          runId,
          'runner',
          'error',
          `Unhandled error: ${msg}`,
        );
        this.running = false;
        this.currentStageId = null;
      },
    );

    return runId;
  }

  // ── Internal execution ──────────────────────────────────────────

  private async executeRun(
    runId: string,
    stageIds: string[],
    buffer: ReplayBuffer,
    concurrencyOverride: number = 0,
    triggeredBy: string = 'manual',
  ): Promise<void> {
    const runStart: number = Date.now();
    let completed: number = 0;
    let failed: number = 0;

    let db: DuckDBInstance;
    let conn: DuckDBConnection;
    try {
      db = await getDb();
      conn = await DuckDBConnection.create(db);
      trackConnection(conn);
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      this.emitLog(
        buffer,
        runId,
        'runner',
        'error',
        `DB connection failed: ${msg}`,
      );
      this.running = false;
      this.currentRunId = null;
      this.emitter.emit('done', {
        runId,
        stagesCompleted: 0,
        stagesFailed: 0,
        totalDurationMs: 0,
      } satisfies RunSummary);
      return;
    }

    // Persist run tracking
    await ensurePipelineTrackingTables(conn);
    const dbRunId: number = await insertPipelineRun(conn, triggeredBy);

    try {
      for (const stageId of stageIds) {
        const stage = getStage(stageId);
        if (stage == null) {
          this.emitLog(
            buffer,
            runId,
            stageId,
            'error',
            `Unknown stage: ${stageId}`,
          );
          failed++;
          continue;
        }

        this.currentStageId = stageId;
        this.stageStates.set(stageId, {
          id: stageId,
          status: 'running',
          startedAt: new Date().toISOString(),
        });
        this.emitter.emit('stage-start', { runId, stageId });
        this.emitLog(buffer, runId, stageId, 'info', `Starting: ${stage.name}`);

        const dbStageRunId: number = await insertStageRun(conn, dbRunId, stageId);

        // Resolve concurrency: explicit override > stage default > 1
        const effectiveConcurrency: number =
          concurrencyOverride > 0
            ? concurrencyOverride
            : (stage.defaultConcurrency ?? 1);

        const ctx: PipelineContext = {
          db,
          conn,
          concurrency: effectiveConcurrency,
          log: (level: 'info' | 'error' | 'progress', message: string) => {
            this.emitLog(buffer, runId, stageId, level, message);
          },
          onProgress: (processed: number, total: number) => {
            const pct: string =
              total > 0 ? ((processed / total) * 100).toFixed(1) : '0';
            this.emitLog(
              buffer,
              runId,
              stageId,
              'progress',
              `${String(processed)}/${String(total)} (${pct}%)`,
            );
          },
        };

        try {
          const result: StageResult = await stage.run(ctx);
          this.stageStates.set(stageId, {
            id: stageId,
            status: 'success',
            lastResult: result,
            startedAt: this.stageStates.get(stageId)?.startedAt,
            finishedAt: new Date().toISOString(),
          });
          completed++;
          await finishStageRun(conn, dbStageRunId, {
            status: 'completed',
            itemsDiscovered: result.itemsDiscovered,
            itemsProcessed: result.itemsProcessed,
            itemsFailed: result.itemsFailed,
            summary: result.summary,
          });
          this.emitLog(
            buffer,
            runId,
            stageId,
            'info',
            `Completed in ${String(result.durationMs)}ms${result.summary != null ? ` — ${result.summary}` : ''}`,
          );
          this.emitter.emit('stage-end', { runId, stageId, result });
        } catch (err: unknown) {
          const msg: string = err instanceof Error ? err.message : String(err);
          this.stageStates.set(stageId, {
            id: stageId,
            status: 'failed',
            startedAt: this.stageStates.get(stageId)?.startedAt,
            finishedAt: new Date().toISOString(),
          });
          failed++;
          await finishStageRun(conn, dbStageRunId, {
            status: 'failed',
            summary: msg,
          });
          this.emitLog(buffer, runId, stageId, 'error', `Failed: ${msg}`);
          this.emitter.emit('stage-end', { runId, stageId, error: msg });
        }
      }
    } finally {
      const runStatus: string = failed > 0 ? 'failed' : 'completed';
      const runSummary: string = `${String(completed)} completed, ${String(failed)} failed`;
      await finishPipelineRunRecord(conn, dbRunId, runStatus, runSummary).catch(
        () => { /* best-effort — connection may already be bad */ },
      );
      try {
        untrackConnection(conn!);
        conn!.closeSync();
      } catch {
        /* cleanup best-effort */
      }
      this.running = false;
      this.currentStageId = null;
    }

    const summary: RunSummary = {
      runId,
      stagesCompleted: completed,
      stagesFailed: failed,
      totalDurationMs: Date.now() - runStart,
    };
    this.emitter.emit('done', summary);
  }

  private emitLog(
    buffer: ReplayBuffer,
    runId: string,
    stage: string,
    level: 'info' | 'error' | 'progress',
    message: string,
  ): void {
    const line: LogLine = {
      runId,
      stage,
      level,
      message,
      timestamp: new Date().toISOString(),
    };
    buffer.push(line);
    this.emitter.emit('log', line);
    const fn: (msg: string) => void =
      level === 'error' ? console.error : console.log;
    fn(`[pipeline:${stage}] ${message}`);
  }
}

// ── Error class ─────────────────────────────────────────────────────

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// ── Singleton export ────────────────────────────────────────────────

let _runner: PipelineRunner | null = null;

export function getRunner(): PipelineRunner {
  if (_runner == null) {
    _runner = new PipelineRunner();
  }
  return _runner;
}

/** Reset the singleton — test-only. */
export function resetRunner(): void {
  _runner = null;
}
