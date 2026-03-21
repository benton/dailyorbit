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
    expect(runs[0]).toEqual(
      expect.objectContaining({
        id: runId,
        status: 'completed',
        triggered_by: 'manual',
      }),
    );
    expect(runs[0]!.finished_at).not.toBeNull();

    const stages = await getStageRunsForPipeline(conn, runId);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toEqual(
      expect.objectContaining({
        stage_id: 'ingest.icfs',
        status: 'completed',
        items_discovered: 42,
        items_processed: 40,
        items_failed: 2,
      }),
    );
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
