import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PipelineContext,
  PipelineStage,
  StageResult,
} from './registry.ts';
import {
  ConflictError,
  getRunner,
  resetRunner,
  type LogLine,
  type RunSummary,
} from './runner.ts';

// ── Mock DB + shutdown so the runner never touches real resources ────

vi.mock('../lib/db.ts', () => {
  let db: DuckDBInstance | null = null;
  return {
    getDb: async () => {
      if (db == null) {
        db = await DuckDBInstance.create(':memory:');
      }
      return db;
    },
    __resetDb: () => {
      db = null;
    },
  };
});

vi.mock('../lib/graceful-shutdown.ts', () => ({
  trackConnection: () => {},
  untrackConnection: () => {},
}));

// ── Mock registry so we control which stages exist ──────────────────

vi.mock('./registry.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry.ts')>();
  const fakeStages = new Map<string, PipelineStage>();
  return {
    ...actual,
    getStage: (id: string) => fakeStages.get(id),
    __registerFake: (stage: PipelineStage) => fakeStages.set(stage.id, stage),
    __clearFakes: () => fakeStages.clear(),
  };
});

const { __registerFake, __clearFakes } =
  (await import('./registry.ts')) as unknown as {
    __registerFake: (stage: PipelineStage) => void;
    __clearFakes: () => void;
  };

const { __resetDb } = (await import('../lib/db.ts')) as unknown as {
  __resetDb: () => void;
};

// ── Helpers ─────────────────────────────────────────────────────────

function makeFakeStage(
  id: string,
  opts: {
    durationMs?: number;
    shouldFail?: boolean;
    defaultConcurrency?: number;
  } = {},
): PipelineStage {
  return {
    id,
    group: 'test',
    name: `Test stage ${id}`,
    description: `Fake stage for testing (${id})`,
    defaultConcurrency: opts.defaultConcurrency ?? 1,
    parallelizable: (opts.defaultConcurrency ?? 1) > 1,
    run: async (ctx: PipelineContext): Promise<StageResult> => {
      ctx.log('info', `Running ${id}`);
      const delay: number = opts.durationMs ?? 10;
      await new Promise((r) => setTimeout(r, delay));
      if (opts.shouldFail === true) {
        throw new Error(`Stage ${id} intentionally failed`);
      }
      ctx.onProgress(1, 1);
      return { itemsProcessed: 1, itemsFailed: 0, durationMs: delay };
    },
  };
}

function waitForDone(runId: string): Promise<RunSummary> {
  const runner = getRunner();
  return new Promise<RunSummary>((resolve) => {
    const handler = (summary: RunSummary): void => {
      if (summary.runId === runId) {
        runner.emitter.removeListener('done', handler);
        resolve(summary);
      }
    };
    runner.emitter.on('done', handler);
  });
}

// ── Test suite ──────────────────────────────────────────────────────

describe('PipelineRunner', () => {
  beforeEach(() => {
    __clearFakes();
    resetRunner();
  });

  afterEach(() => {
    __clearFakes();
    __resetDb();
    resetRunner();
  });

  it('runs a single stage and emits done with correct summary', async () => {
    __registerFake(makeFakeStage('test.single'));

    const runner = getRunner();
    const runId: string = await runner.start(['test.single']);
    expect(runId).toMatch(/^[0-9a-f]{8}$/);

    const summary: RunSummary = await waitForDone(runId);
    expect(summary.runId).toEqual(runId);
    expect(summary.stagesCompleted).toEqual(1);
    expect(summary.stagesFailed).toEqual(0);
    expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits log lines that appear in the replay buffer', async () => {
    __registerFake(makeFakeStage('test.logged'));

    const runner = getRunner();
    const logs: LogLine[] = [];
    runner.emitter.on('log', (line: LogLine) => logs.push(line));

    const runId: string = await runner.start(['test.logged']);
    await waitForDone(runId);

    const stageMessages: string[] = logs
      .filter((l: LogLine) => l.stage === 'test.logged')
      .map((l: LogLine) => l.message);
    expect(
      stageMessages.some((m: string) => m.startsWith('Starting:')),
    ).toEqual(true);
    expect(
      stageMessages.some((m: string) => m.startsWith('Completed in')),
    ).toEqual(true);

    const buffered: LogLine[] = runner.getReplayBuffer(runId);
    expect(buffered.length).toBeGreaterThanOrEqual(2);
  });

  it('reports failed stages in the summary', async () => {
    __registerFake(makeFakeStage('test.ok'));
    __registerFake(makeFakeStage('test.fail', { shouldFail: true }));

    const runner = getRunner();
    const runId: string = await runner.start(['test.ok', 'test.fail']);
    const summary: RunSummary = await waitForDone(runId);

    expect(summary.stagesCompleted).toEqual(1);
    expect(summary.stagesFailed).toEqual(1);
  });

  it('throws ConflictError when a run is already active', async () => {
    __registerFake(makeFakeStage('test.slow', { durationMs: 500 }));

    const runner = getRunner();
    const runId: string = await runner.start(['test.slow']);

    // Runner is now active — second start should throw
    await expect(runner.start(['test.slow'])).rejects.toThrow(ConflictError);

    await waitForDone(runId);
  });

  it('passes per-stage concurrency override to stage context', async () => {
    let capturedConcurrency: number = 0;
    const stage: PipelineStage = {
      id: 'test.concurrency',
      group: 'test',
      name: 'Concurrency Test',
      description: 'Captures concurrency from context',
      defaultConcurrency: 3,
      parallelizable: true,
      run: async (ctx: PipelineContext): Promise<StageResult> => {
        capturedConcurrency = ctx.concurrency;
        return { itemsProcessed: 0, itemsFailed: 0, durationMs: 0 };
      },
    };
    __registerFake(stage);

    const runner = getRunner();
    const runId: string = await runner.start(['test.concurrency'], {
      'test.concurrency': 7,
    });
    await waitForDone(runId);
    expect(capturedConcurrency).toEqual(7);
  });

  it('uses stage defaultConcurrency when no override is given', async () => {
    let capturedConcurrency: number = 0;
    const stage: PipelineStage = {
      id: 'test.default-conc',
      group: 'test',
      name: 'Default Concurrency',
      description: 'Uses default concurrency',
      defaultConcurrency: 5,
      parallelizable: true,
      run: async (ctx: PipelineContext): Promise<StageResult> => {
        capturedConcurrency = ctx.concurrency;
        return { itemsProcessed: 0, itemsFailed: 0, durationMs: 0 };
      },
    };
    __registerFake(stage);

    const runner = getRunner();
    const runId: string = await runner.start(['test.default-conc']);
    await waitForDone(runId);
    expect(capturedConcurrency).toEqual(5);
  });

  it('skips unknown stages and counts them as failed', async () => {
    const runner = getRunner();
    const runId: string = await runner.start(['nonexistent.stage']);
    const summary: RunSummary = await waitForDone(runId);

    expect(summary.stagesCompleted).toEqual(0);
    expect(summary.stagesFailed).toEqual(1);
  });

  it('getState reflects running status during execution', async () => {
    let resolveStage: (() => void) | null = null;
    const stage: PipelineStage = {
      id: 'test.blocking',
      group: 'test',
      name: 'Blocking',
      description: 'Blocks until released',
      defaultConcurrency: 1,
      parallelizable: false,
      run: (_ctx: PipelineContext): Promise<StageResult> => {
        return new Promise<StageResult>((resolve) => {
          resolveStage = () =>
            resolve({ itemsProcessed: 0, itemsFailed: 0, durationMs: 0 });
        });
      },
    };
    __registerFake(stage);

    const runner = getRunner();
    const runId: string = await runner.start(['test.blocking']);

    // Give the async executeRun a tick to enter the stage
    await new Promise((r) => setTimeout(r, 50));

    const state = runner.getState();
    expect(state.running).toEqual(true);
    expect(state.runId).toEqual(runId);
    expect(state.currentStageId).toEqual('test.blocking');

    resolveStage!();
    await waitForDone(runId);

    const finalState = runner.getState();
    expect(finalState.running).toEqual(false);
  });
});
