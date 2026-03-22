import type { DuckDBConnection } from '@duckdb/node-api';
import {
  type PaginatedRequest,
  type PaginatedResponse,
  buildPaginatedQuery,
  buildPaginatedResponse,
} from '../lib/pagination.ts';

export type PipelineRunMode = 'probe' | 'full';

export type PipelineRunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  triggered_by: string;
  mode: PipelineRunMode;
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
  mode: PipelineRunMode = 'full',
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `INSERT INTO pipeline_run (triggered_by, mode) VALUES ($1, $2) RETURNING id`,
    [triggeredBy, mode],
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
            status, triggered_by, mode, summary
     FROM pipeline_run ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return reader.getRowObjectsJS() as PipelineRunRow[];
}

/** Get the most recent completed pipeline run with the given mode. */
export async function getLastSuccessfulRun(
  conn: DuckDBConnection,
  mode: PipelineRunMode,
): Promise<PipelineRunRow | null> {
  const reader = await conn.runAndReadAll(
    `SELECT id, started_at::VARCHAR AS started_at, finished_at::VARCHAR AS finished_at,
            status, triggered_by, mode, summary
     FROM pipeline_run
     WHERE status = 'completed' AND mode = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [mode],
  );
  const rows = reader.getRowObjectsJS() as PipelineRunRow[];
  return rows.length > 0 ? rows[0]! : null;
}

/** Row type for pipeline runs joined with ICFS stage stats. */
export type PipelineRunWithIcfsStats = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  triggered_by: string;
  mode: PipelineRunMode;
  summary: string | null;
  items_discovered: number;
  items_processed: number;
  items_failed: number;
  stage_summary: string | null;
};

/** Get recent pipeline runs joined with ICFS ingest stage stats (for charting). */
export async function getRunsWithIcfsStats(
  conn: DuckDBConnection,
  limit: number,
): Promise<PipelineRunWithIcfsStats[]> {
  const reader = await conn.runAndReadAll(
    `SELECT pr.id, pr.started_at::VARCHAR AS started_at, pr.finished_at::VARCHAR AS finished_at,
            pr.status, pr.triggered_by, pr.mode, pr.summary,
            COALESCE(psr.items_discovered, 0)::INTEGER AS items_discovered,
            COALESCE(psr.items_processed, 0)::INTEGER AS items_processed,
            COALESCE(psr.items_failed, 0)::INTEGER AS items_failed,
            psr.summary AS stage_summary
     FROM pipeline_run pr
     LEFT JOIN pipeline_stage_run psr ON psr.pipeline_run_id = pr.id
       AND psr.stage_id = 'ingest.icfs'
     ORDER BY pr.started_at DESC
     LIMIT $1`,
    [limit],
  );
  return reader.getRowObjectsJS() as PipelineRunWithIcfsStats[];
}

const HISTORY_ALLOWED_COLUMNS: ReadonlySet<string> = new Set([
  'started_at',
  'finished_at',
  'status',
  'mode',
  'items_discovered',
  'items_processed',
  'items_failed',
]);

/** Return a paginated list of pipeline runs with ICFS stage stats. */
export async function listPipelineRuns(
  conn: DuckDBConnection,
  request: PaginatedRequest,
): Promise<PaginatedResponse<PipelineRunWithIcfsStats>> {
  const baseSql: string = `
    SELECT pr.id, pr.started_at::VARCHAR AS started_at, pr.finished_at::VARCHAR AS finished_at,
           pr.status, pr.triggered_by, pr.mode, pr.summary,
           COALESCE(psr.items_discovered, 0)::INTEGER AS items_discovered,
           COALESCE(psr.items_processed, 0)::INTEGER AS items_processed,
           COALESCE(psr.items_failed, 0)::INTEGER AS items_failed,
           psr.summary AS stage_summary
    FROM pipeline_run pr
    LEFT JOIN pipeline_stage_run psr ON psr.pipeline_run_id = pr.id
      AND psr.stage_id = 'ingest.icfs'
  `;

  const { sql, params, countSql, countParams } = buildPaginatedQuery(
    baseSql,
    [],
    request,
    HISTORY_ALLOWED_COLUMNS,
    'started_at',
  );

  const countReader = await conn.runAndReadAll(countSql, countParams);
  const totalRows: number = Number(
    (countReader.getRowObjectsJS() as Array<{ total: number }>)[0]?.total ?? 0,
  );

  const reader = await conn.runAndReadAll(sql, params);
  const data = reader.getRowObjectsJS() as PipelineRunWithIcfsStats[];

  return buildPaginatedResponse(data, totalRows, request);
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
