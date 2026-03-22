/**
 * Integration test: verifies that PipelineRunner persists tracking
 * data to the pipeline_run / pipeline_stage_run tables.
 */

import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PipelineContext,
  PipelineStage,
  StageResult,
} from './registry.ts';
import {
  getRecentRuns,
  getStageRunsForPipeline,
} from './tracking-repository.ts';

// ── Mock DB + shutdown (same pattern as runner.test.ts) ──────────────

let testDb: DuckDBInstance | null = null;

vi.mock('../lib/db.ts', () => ({
  getDb: async () => {
    if (testDb == null) {
      testDb = await DuckDBInstance.create(':memory:');
    }
    return testDb;
  },
}));

vi.mock('../lib/graceful-shutdown.ts', () => ({
  trackConnection: () => {},
  untrackConnection: () => {},
}));

// ── Mock registry with fake stages ──────────────────────────────────

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

import { getRunner, resetRunner, type RunSummary } from './runner.ts';

// ── Helpers ─────────────────────────────────────────────────────────

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

// ── Tests ───────────────────────────────────────────────────────────

describe('pipeline tracking integration', () => {
  beforeEach(() => {
    __clearFakes();
    resetRunner();
  });

  afterEach(() => {
    __clearFakes();
    resetRunner();
    testDb = null;
  });

  it('should persist run and stage data after a successful pipeline execution', async () => {
    const discoveredCount: number = 42;
    const processedCount: number = 40;
    const failedCount: number = 2;

    const stage: PipelineStage = {
      id: 'test.tracking',
      group: 'test',
      name: 'Tracking Test',
      description: 'Reports discovery counts for tracking verification',
      defaultConcurrency: 1,
      parallelizable: false,
      run: async (_ctx: PipelineContext): Promise<StageResult> => {
        await new Promise((r) => setTimeout(r, 10));
        return {
          itemsDiscovered: discoveredCount,
          itemsProcessed: processedCount,
          itemsFailed: failedCount,
          durationMs: 10,
          summary: 'test stage complete',
        };
      },
    };
    __registerFake(stage);

    const runner = getRunner();
    const runId: string = await runner.start(
      ['test.tracking'],
      {},
      'integration-test',
    );
    await waitForDone(runId);

    // Query tracking tables using the same in-memory DB
    const db = testDb!;
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    try {
      const runs = await getRecentRuns(conn, 10);
      expect(runs.length).toBeGreaterThanOrEqual(1);

      const latestRun = runs[0]!;
      expect(latestRun.status).toEqual('completed');
      expect(latestRun.triggered_by).toEqual('integration-test');
      expect(latestRun.finished_at).not.toBeNull();
      expect(latestRun.summary).toEqual('1 completed, 0 failed');

      const stages = await getStageRunsForPipeline(conn, latestRun.id);
      expect(stages).toHaveLength(1);
      expect(stages[0]).toEqual(
        expect.objectContaining({
          stage_id: 'test.tracking',
          status: 'completed',
          items_discovered: discoveredCount,
          items_processed: processedCount,
          items_failed: failedCount,
          summary: 'test stage complete',
        }),
      );
      expect(stages[0]!.finished_at).not.toBeNull();
    } finally {
      conn.closeSync();
    }
  });

  it('should record failed stage status in tracking tables', async () => {
    const stage: PipelineStage = {
      id: 'test.failing',
      group: 'test',
      name: 'Failing Stage',
      description: 'Always fails for testing',
      defaultConcurrency: 1,
      parallelizable: false,
      run: async (_ctx: PipelineContext): Promise<StageResult> => {
        throw new Error('intentional failure');
      },
    };
    __registerFake(stage);

    const runner = getRunner();
    const runId: string = await runner.start(['test.failing']);
    await waitForDone(runId);

    const db = testDb!;
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    try {
      const runs = await getRecentRuns(conn, 10);
      const latestRun = runs[0]!;
      expect(latestRun.status).toEqual('failed');
      expect(latestRun.summary).toEqual('0 completed, 1 failed');

      const stages = await getStageRunsForPipeline(conn, latestRun.id);
      expect(stages).toHaveLength(1);
      expect(stages[0]!.status).toEqual('failed');
      expect(stages[0]!.summary).toEqual('intentional failure');
    } finally {
      conn.closeSync();
    }
  });
});
