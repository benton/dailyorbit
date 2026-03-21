import type { DuckDBConnection } from '@duckdb/node-api';
import type { SavedSearchResponse } from '../saved-search/types.ts';
import { executeSavedSearch } from '../saved-search/execute.ts';
import { createFlag } from '../content-flag/repository.ts';
import { insertAlertRun, getLastAlertRun } from './repository.ts';

export type EvaluationResult = {
  searchesEvaluated: number;
  totalMatched: number;
  totalFlagged: number;
  errors: number;
};

type AlertEnabledSearch = SavedSearchResponse & { user_id: string };

/** Fetch all alert-enabled saved searches. */
async function getAlertEnabledSearches(
  conn: DuckDBConnection,
): Promise<AlertEnabledSearch[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, name, content_type, filters::VARCHAR AS filters,
            include_time_scope, alert_enabled,
            created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
     FROM saved_search
     WHERE alert_enabled = true`,
  );
  return reader.getRowObjectsJS().map((row) => {
    const r: Record<string, unknown> = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      user_id: String(r.user_id),
      name: String(r.name),
      content_type: String(r.content_type) as 'filing' | 'news',
      filters: JSON.parse(String(r.filters)),
      include_time_scope: Boolean(r.include_time_scope),
      alert_enabled: Boolean(r.alert_enabled),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  });
}

/**
 * Determine the watermark timestamp for a saved search.
 * Returns the executed_at of the most recent alert_run for this search,
 * or the search's created_at if it has never been evaluated.
 */
async function getWatermark(
  conn: DuckDBConnection,
  savedSearch: AlertEnabledSearch,
): Promise<string> {
  const lastRun = await getLastAlertRun(conn, savedSearch.id);
  if (lastRun != null) {
    return lastRun.executed_at;
  }
  // First evaluation — use epoch so the initial run catches all existing
  // matches. Subsequent runs use the prior alert_run's executed_at watermark.
  return '1970-01-01 00:00:00';
}

/**
 * Extract content keys from search results.
 * Filing results have `file_number`, news results have `news_item_id`.
 */
function extractContentKeys(contentType: string, results: unknown[]): string[] {
  return results.map((r) => {
    const row: Record<string, unknown> = r as Record<string, unknown>;
    if (contentType === 'filing') {
      return String(row.file_number);
    }
    return String(row.news_item_id);
  });
}

/**
 * Evaluate all alert-enabled saved searches against new content.
 * Called as part of the pipeline's alerts.evaluate stage.
 */
export async function evaluateAlerts(
  conn: DuckDBConnection,
  pipelineRunId: number,
): Promise<EvaluationResult> {
  const searches: AlertEnabledSearch[] = await getAlertEnabledSearches(conn);

  let searchesEvaluated: number = 0;
  let totalMatched: number = 0;
  let totalFlagged: number = 0;
  let errors: number = 0;

  for (const search of searches) {
    try {
      const watermark: string = await getWatermark(conn, search);

      // Execute the saved search scoped to items since the watermark
      const result = await executeSavedSearch(
        conn,
        search.content_type,
        search.filters,
        { page: 1, pageSize: 500 },
        watermark,
      );

      const contentKeys: string[] = extractContentKeys(
        search.content_type,
        result.data as unknown[],
      );

      let flagged: number = 0;
      for (const key of contentKeys) {
        // createFlag upserts — won't duplicate if already flagged
        await createFlag(conn, search.user_id, {
          content_type: search.content_type,
          content_key: key,
          source: 'alert',
          saved_search_id: search.id,
          reason: `Matched saved search: ${search.name}`,
        });
        flagged++;
      }

      // Record the alert run
      await insertAlertRun(conn, {
        savedSearchId: search.id,
        pipelineRunId,
        itemsMatched: contentKeys.length,
        itemsFlagged: flagged,
        emailSent: false, // Email delivery is a separate plan
      });

      searchesEvaluated++;
      totalMatched += contentKeys.length;
      totalFlagged += flagged;
    } catch (err: unknown) {
      errors++;
      const msg: string = err instanceof Error ? err.message : String(err);
      // Record the failed alert run
      await insertAlertRun(conn, {
        savedSearchId: search.id,
        pipelineRunId,
        itemsMatched: 0,
        itemsFlagged: 0,
        emailSent: false,
        error: msg,
      }).catch(() => {
        /* best-effort */
      });
    }
  }

  return { searchesEvaluated, totalMatched, totalFlagged, errors };
}
