import type { DuckDBConnection } from '@duckdb/node-api';
import type { BulkFlagInput, ContentFlagRow, CreateFlagInput } from './types.ts';

/** Create or re-activate a single flag. Returns the flag ID. */
export async function createFlag(
  conn: DuckDBConnection,
  userId: string,
  input: CreateFlagInput,
): Promise<number> {
  const source: string = input.source ?? 'manual';
  const savedSearchId: number = input.saved_search_id ?? 0;
  const reason: string | null = input.reason ?? null;

  // Upsert: insert or re-activate if dismissed
  await conn.run(
    `INSERT INTO user_content_flag (user_id, content_type, content_key, source, saved_search_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, content_type, content_key, saved_search_id)
     DO UPDATE SET dismissed_at = NULL, reason = COALESCE($6, user_content_flag.reason)`,
    [userId, input.content_type, input.content_key, source, savedSearchId, reason],
  );

  // Fetch the actual row id (avoids DuckDB sequence quirk with ON CONFLICT RETURNING)
  const reader = await conn.runAndReadAll(
    `SELECT id FROM user_content_flag
     WHERE user_id = $1 AND content_type = $2 AND content_key = $3
       AND saved_search_id = $4`,
    [userId, input.content_type, input.content_key, savedSearchId],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Create flags for multiple content keys at once. Returns the flag IDs. */
export async function createBulkFlags(
  conn: DuckDBConnection,
  userId: string,
  input: BulkFlagInput,
): Promise<number[]> {
  const ids: number[] = [];
  for (const key of input.content_keys) {
    const flagInput: CreateFlagInput = {
      content_type: input.content_type,
      content_key: key,
    };
    if (input.reason != null) flagInput.reason = input.reason;
    const id: number = await createFlag(conn, userId, flagInput);
    ids.push(id);
  }
  return ids;
}

/** Soft-delete a flag by setting dismissed_at. */
export async function dismissFlag(
  conn: DuckDBConnection,
  flagId: number,
  userId: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `UPDATE user_content_flag SET dismissed_at = current_timestamp
     WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL
     RETURNING id`,
    [flagId, userId],
  );
  return reader.getRowObjectsJS().length > 0;
}

/** Re-activate a previously dismissed flag. */
export async function undismissFlag(
  conn: DuckDBConnection,
  flagId: number,
  userId: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `UPDATE user_content_flag SET dismissed_at = NULL
     WHERE id = $1 AND user_id = $2 AND dismissed_at IS NOT NULL
     RETURNING id`,
    [flagId, userId],
  );
  return reader.getRowObjectsJS().length > 0;
}

/** Get all active (non-dismissed) flags for a user, filtered by content type. */
export async function getActiveFlagsForUser(
  conn: DuckDBConnection,
  userId: string,
  contentType: string,
): Promise<ContentFlagRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, content_type, content_key, source,
            saved_search_id, reason,
            created_at::VARCHAR AS created_at,
            dismissed_at::VARCHAR AS dismissed_at
     FROM user_content_flag
     WHERE user_id = $1 AND content_type = $2 AND dismissed_at IS NULL
     ORDER BY created_at DESC`,
    [userId, contentType],
  );
  return reader.getRowObjectsJS() as ContentFlagRow[];
}

/** Check which content keys are actively flagged — for bulk UI display. */
export async function getActiveFlagKeys(
  conn: DuckDBConnection,
  userId: string,
  contentType: string,
  contentKeys: string[],
): Promise<Set<string>> {
  if (contentKeys.length === 0) return new Set();
  const placeholders: string = contentKeys.map((_: string, i: number) => `$${i + 3}`).join(', ');
  const reader = await conn.runAndReadAll(
    `SELECT content_key FROM user_content_flag
     WHERE user_id = $1 AND content_type = $2 AND dismissed_at IS NULL
       AND content_key IN (${placeholders})`,
    [userId, contentType, ...contentKeys],
  );
  return new Set(
    reader.getRowObjectsJS().map((row) => String((row as Record<string, unknown>).content_key)),
  );
}
