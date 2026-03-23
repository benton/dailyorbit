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

/** Mark an alert run's email_sent flag as true. */
export async function markAlertRunEmailed(
  conn: DuckDBConnection,
  alertRunId: number,
): Promise<void> {
  await conn.run(
    'UPDATE alert_run SET email_sent = true WHERE id = $1',
    [alertRunId],
  );
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
  const rows: AlertRunRow[] = reader.getRowObjectsJS() as AlertRunRow[];
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
