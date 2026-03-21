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
    expect(runs[0]).toEqual(
      expect.objectContaining({
        saved_search_id: 1,
        pipeline_run_id: 10,
        items_matched: 5,
        items_flagged: 3,
        email_sent: false,
        error: null,
      }),
    );
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
