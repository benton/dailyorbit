import type { DuckDBConnection } from '@duckdb/node-api';
import type { SavedSearchResponse } from '../saved-search/types.ts';
import { executeSavedSearch } from '../saved-search/execute.ts';
import {
  createFlag,
  getEmailedContentKeys,
  markFlagsEmailed,
} from '../content-flag/repository.ts';
import { insertAlertRun, getLastAlertRun } from './repository.ts';
import { getSettingsByUserId } from '../user-settings/repository.ts';
import { renderAlertDigest } from '../email/alert-digest.ts';
import type { DigestSearchGroup, DigestItem } from '../email/alert-digest.ts';
import type { EmailService } from '../email/email-service.ts';

export type EvaluationResult = {
  searchesEvaluated: number;
  totalMatched: number;
  totalFlagged: number;
  errors: number;
};

export type EvaluationWithEmailResult = EvaluationResult & {
  emailsSent: number;
};

type AlertEnabledSearch = SavedSearchResponse & { user_id: string };

/** Per-search match result, accumulated during evaluation. */
type SearchMatchResult = {
  search: AlertEnabledSearch;
  contentKeys: string[];
  flagIds: number[];
};

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
function extractContentKeys(
  contentType: string,
  results: unknown[],
): string[] {
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
  const result: EvaluationWithEmailResult = await evaluateAlertsWithEmail(
    conn,
    pipelineRunId,
    null,
    '',
  );
  return {
    searchesEvaluated: result.searchesEvaluated,
    totalMatched: result.totalMatched,
    totalFlagged: result.totalFlagged,
    errors: result.errors,
  };
}

/**
 * Look up user email and name from the user table.
 */
async function getUserInfo(
  conn: DuckDBConnection,
  userId: string,
): Promise<{ email: string; name: string } | null> {
  const reader = await conn.runAndReadAll(
    `SELECT email, name FROM "user" WHERE id = $1`,
    [userId],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  const row: Record<string, unknown> = rows[0] as Record<string, unknown>;
  return { email: String(row.email), name: String(row.name) };
}

/**
 * Build a filing title from the filing table for email digest.
 */
async function getFilingTitle(
  conn: DuckDBConnection,
  fileNumber: string,
): Promise<string> {
  const reader = await conn.runAndReadAll(
    `SELECT COALESCE(address_attention, '') AS attn,
            subsystem_code || '-' || app_type_code AS type_label
     FROM filing WHERE file_number = $1 LIMIT 1`,
    [fileNumber],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return fileNumber;
  const row: Record<string, unknown> = rows[0] as Record<string, unknown>;
  const attn: string = String(row.attn);
  const typeLabel: string = String(row.type_label);
  return attn.length > 0
    ? `${attn} — ${typeLabel}`
    : `${fileNumber} (${typeLabel})`;
}

/**
 * Build a news item title from the news_item table for email digest.
 */
async function getNewsTitle(
  conn: DuckDBConnection,
  newsItemId: string,
): Promise<string> {
  const reader = await conn.runAndReadAll(
    `SELECT title FROM news_item WHERE id = $1 LIMIT 1`,
    [Number(newsItemId)],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return `News #${newsItemId}`;
  return String((rows[0] as Record<string, unknown>).title);
}

/**
 * Run alert evaluation and optionally send email digests for users with matches.
 * When emailService is null, email delivery is skipped (evaluation-only mode).
 */
export async function evaluateAlertsWithEmail(
  conn: DuckDBConnection,
  pipelineRunId: number,
  emailService: EmailService | null,
  baseUrl: string,
): Promise<EvaluationWithEmailResult> {
  const searches: AlertEnabledSearch[] =
    await getAlertEnabledSearches(conn);

  let searchesEvaluated: number = 0;
  let totalMatched: number = 0;
  let totalFlagged: number = 0;
  let errors: number = 0;
  let emailsSent: number = 0;

  // Accumulate per-user match results for email grouping
  const userMatches: Map<string, SearchMatchResult[]> = new Map();

  for (const search of searches) {
    try {
      const watermark: string = await getWatermark(conn, search);

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

      const flagIds: number[] = [];
      for (const key of contentKeys) {
        const flagId: number = await createFlag(conn, search.user_id, {
          content_type: search.content_type,
          content_key: key,
          source: 'alert',
          saved_search_id: search.id,
          reason: `Matched saved search: ${search.name}`,
        });
        flagIds.push(flagId);
      }

      await insertAlertRun(conn, {
        savedSearchId: search.id,
        pipelineRunId,
        itemsMatched: contentKeys.length,
        itemsFlagged: flagIds.length,
        emailSent: false, // Updated after email delivery
      });

      searchesEvaluated++;
      totalMatched += contentKeys.length;
      totalFlagged += flagIds.length;

      // Accumulate for email grouping
      if (contentKeys.length > 0) {
        const existing: SearchMatchResult[] =
          userMatches.get(search.user_id) ?? [];
        existing.push({ search, contentKeys, flagIds });
        userMatches.set(search.user_id, existing);
      }
    } catch (err: unknown) {
      errors++;
      const msg: string = err instanceof Error ? err.message : String(err);
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

  // Email delivery phase
  if (emailService != null) {
    for (const [userId, matchResults] of userMatches) {
      try {
        // Check user's email preference
        const settings = await getSettingsByUserId(conn, userId);
        if (settings == null || !settings.emailDailyOrbit) continue;

        // Look up user info
        const userInfo = await getUserInfo(conn, userId);
        if (userInfo == null) continue;

        // Build digest groups, deduplicating already-emailed content
        const digestGroups: DigestSearchGroup[] = [];
        const flagIdsToMark: number[] = [];

        for (const mr of matchResults) {
          // Check which content keys were already emailed (across any search)
          const alreadyEmailed: Set<string> = await getEmailedContentKeys(
            conn,
            userId,
            mr.search.content_type,
            mr.contentKeys,
          );

          const items: DigestItem[] = [];
          for (let i: number = 0; i < mr.contentKeys.length; i++) {
            const key: string = mr.contentKeys[i]!;
            if (alreadyEmailed.has(key)) continue;

            const title: string =
              mr.search.content_type === 'filing'
                ? await getFilingTitle(conn, key)
                : await getNewsTitle(conn, key);
            const url: string =
              mr.search.content_type === 'filing'
                ? `${baseUrl}/filings/${key}`
                : `${baseUrl}/news/${key}`;
            items.push({ key, title, url });
            flagIdsToMark.push(mr.flagIds[i]!);
          }

          if (items.length > 0) {
            digestGroups.push({
              searchName: mr.search.name,
              contentType: mr.search.content_type,
              items,
            });
          }
        }

        // Skip if all items were already emailed
        if (digestGroups.length === 0) continue;

        const digest = renderAlertDigest({
          userName: userInfo.name,
          matches: digestGroups,
        });

        await emailService.sendMail({
          to: userInfo.email,
          subject: digest.subject,
          text: digest.text,
          html: digest.html,
        });

        // Mark flags as emailed
        await markFlagsEmailed(conn, flagIdsToMark);
        emailsSent++;
      } catch {
        // Best-effort email delivery — don't fail the pipeline
      }
    }
  }

  return {
    searchesEvaluated,
    totalMatched,
    totalFlagged,
    errors,
    emailsSent,
  };
}
