import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PipelineContext,
  PipelineStage,
  StageResult,
} from './registry.ts';
import { resetRunner } from './runner.ts';
import { PipelineScheduler, resetScheduler } from './scheduler.ts';

// ── Mock DB + shutdown ──────────────────────────────────────────────

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

// ── Mock registry ───────────────────────────────────────────────────

vi.mock('./registry.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry.ts')>();
  const fakeStages = new Map<string, PipelineStage>();
  return {
    ...actual,
    getStage: (id: string) => fakeStages.get(id),
    getAllStages: () => [...fakeStages.values()],
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

function makeFakeIngest(processedCount: number = 0): PipelineStage {
  return {
    id: 'ingest.icfs',
    group: 'ingest',
    name: 'ICFS Ingest',
    description: 'Fake ingest',
    defaultConcurrency: 1,
    parallelizable: false,
    run: async (_ctx: PipelineContext): Promise<StageResult> => ({
      itemsDiscovered: processedCount > 0 ? processedCount : 50,
      itemsProcessed: processedCount,
      itemsFailed: 0,
      durationMs: 5,
    }),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('PipelineScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __clearFakes();
    resetRunner();
    resetScheduler();
    __registerFake(makeFakeIngest(0));
  });

  afterEach(() => {
    resetScheduler();
    __clearFakes();
    __resetDb();
    resetRunner();
    vi.useRealTimers();
  });

  it('starts and stops without error', () => {
    const scheduler = new PipelineScheduler({
      probeIntervalMs: 1000,
      refreshIntervalMs: 5000,
    });

    scheduler.start();
    expect(scheduler.status().running).toEqual(true);

    scheduler.stop();
    expect(scheduler.status().running).toEqual(false);
  });

  it('reports correct config in status', () => {
    const scheduler = new PipelineScheduler({
      probeIntervalMs: 2000,
      refreshIntervalMs: 10000,
    });

    const status = scheduler.status();
    expect(status.probeIntervalMs).toEqual(2000);
    expect(status.refreshIntervalMs).toEqual(10000);
    expect(status.running).toEqual(false);
    expect(status.lastProbeAt).toBeNull();
    expect(status.lastRefreshAt).toBeNull();
  });

  it('start is idempotent — calling twice does not double-schedule', () => {
    const scheduler = new PipelineScheduler({
      probeIntervalMs: 1000,
      refreshIntervalMs: 5000,
    });

    scheduler.start();
    scheduler.start();
    expect(scheduler.status().running).toEqual(true);

    scheduler.stop();
    expect(scheduler.status().running).toEqual(false);
  });

  it('runProbe skips when runner is already busy', async () => {
    // Register a blocking stage
    let resolveStage: (() => void) | null = null;
    __registerFake({
      id: 'ingest.icfs',
      group: 'ingest',
      name: 'Blocking Ingest',
      description: 'Blocks',
      defaultConcurrency: 1,
      parallelizable: false,
      run: (_ctx: PipelineContext): Promise<StageResult> =>
        new Promise<StageResult>((resolve) => {
          resolveStage = () =>
            resolve({ itemsProcessed: 0, itemsFailed: 0, durationMs: 0 });
        }),
    });

    const scheduler = new PipelineScheduler();
    // Start a first probe that will block
    const firstProbe = scheduler.runProbe();
    // Wait for stage to be called
    await vi.waitFor(() => expect(resolveStage).not.toBeNull(), {
      timeout: 2000,
    });

    // Second probe should skip (runner is busy)
    const secondResult = await scheduler.runProbe();
    expect(secondResult).toBeNull();

    // Unblock the first
    resolveStage!();
    const firstResult = await firstProbe;
    expect(firstResult).not.toBeNull();
    expect(firstResult!.stagesCompleted).toEqual(1);
  });

  it('runProbe skips while refresh is in progress', async () => {
    let resolveStage: (() => void) | null = null;
    __registerFake({
      id: 'ingest.icfs',
      group: 'ingest',
      name: 'Blocking Ingest',
      description: 'Blocks',
      defaultConcurrency: 1,
      parallelizable: false,
      run: (_ctx: PipelineContext): Promise<StageResult> =>
        new Promise<StageResult>((resolve) => {
          resolveStage = () =>
            resolve({
              itemsDiscovered: 5,
              itemsProcessed: 5,
              itemsFailed: 0,
              durationMs: 0,
            });
        }),
    });

    const scheduler = new PipelineScheduler();
    // Start a refresh (which sets refreshInProgress)
    const refreshPromise = scheduler.runRefresh();
    await vi.waitFor(() => expect(resolveStage).not.toBeNull(), {
      timeout: 2000,
    });

    // Probe should skip because refresh is in progress
    const probeResult = await scheduler.runProbe();
    expect(probeResult).toBeNull();
    expect(scheduler.status().refreshInProgress).toEqual(true);

    resolveStage!();
    await refreshPromise;
    expect(scheduler.status().refreshInProgress).toEqual(false);
  });
});
