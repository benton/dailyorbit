import type { DuckDBConnection } from '@duckdb/node-api';
import type { HiddenItemRow, HiddenItemScope, HideItemInput } from './types.ts';

/** Hide an item for a user (or system-wide). Returns the hidden item ID. */
export async function hideItem(
  conn: DuckDBConnection,
  userId: string,
  input: HideItemInput,
  scope: HiddenItemScope = 'user',
): Promise<number> {
  const reason: string | null = input.reason ?? null;

  // Upsert: insert or re-activate if previously removed
  await conn.run(
    `INSERT INTO hidden_item (user_id, content_type, content_key, scope, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, content_type, content_key, scope)
     DO UPDATE SET removed_at = NULL, reason = COALESCE($5, hidden_item.reason)`,
    [userId, input.content_type, input.content_key, scope, reason],
  );

  // Fetch the actual row id (avoids DuckDB sequence quirk with ON CONFLICT RETURNING)
  const reader = await conn.runAndReadAll(
    `SELECT id FROM hidden_item
     WHERE user_id = $1 AND content_type = $2 AND content_key = $3 AND scope = $4`,
    [userId, input.content_type, input.content_key, scope],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Soft-delete a user-scope hide by setting removed_at. */
export async function unhideItem(
  conn: DuckDBConnection,
  id: number,
  userId: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `UPDATE hidden_item SET removed_at = current_timestamp
     WHERE id = $1 AND user_id = $2 AND scope = 'user' AND removed_at IS NULL
     RETURNING id`,
    [id, userId],
  );
  return reader.getRowObjectsJS().length > 0;
}

/** Remove all user-scope hides for a user. Returns count of rows affected. */
export async function unhideAllForUser(
  conn: DuckDBConnection,
  userId: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `UPDATE hidden_item SET removed_at = current_timestamp
     WHERE user_id = $1 AND scope = 'user' AND removed_at IS NULL
     RETURNING id`,
    [userId],
  );
  return reader.getRowObjectsJS().length;
}

/**
 * Check which content keys are actively hidden for a user (user-scope or system-wide).
 * Returns a Set of hidden content keys from the provided candidates.
 */
export async function getActiveHiddenKeys(
  conn: DuckDBConnection,
  userId: string,
  contentType: string,
  contentKeys: string[],
): Promise<Set<string>> {
  if (contentKeys.length === 0) return new Set();
  const placeholders: string = contentKeys
    .map((_: string, i: number) => `$${i + 3}`)
    .join(', ');
  const reader = await conn.runAndReadAll(
    `SELECT DISTINCT content_key FROM hidden_item
     WHERE content_type = $1 AND removed_at IS NULL
       AND content_key IN (${placeholders})
       AND (scope = 'system' OR (scope = 'user' AND user_id = $2))`,
    [contentType, userId, ...contentKeys],
  );
  return new Set(
    reader
      .getRowObjectsJS()
      .map((row) => String((row as Record<string, unknown>).content_key)),
  );
}

/** Get active user-scope hides for a user (for user preferences list). */
export async function getActiveHidesForUser(
  conn: DuckDBConnection,
  userId: string,
  contentType: string,
): Promise<HiddenItemRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, content_type, content_key, scope, reason,
            created_at::VARCHAR AS created_at,
            removed_at::VARCHAR AS removed_at
     FROM hidden_item
     WHERE user_id = $1 AND content_type = $2 AND scope = 'user' AND removed_at IS NULL
     ORDER BY created_at DESC`,
    [userId, contentType],
  );
  return reader.getRowObjectsJS() as HiddenItemRow[];
}

/** Get active system-scope hides (for admin view). */
export async function getSystemHides(
  conn: DuckDBConnection,
  contentType: string,
): Promise<HiddenItemRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, content_type, content_key, scope, reason,
            created_at::VARCHAR AS created_at,
            removed_at::VARCHAR AS removed_at
     FROM hidden_item
     WHERE content_type = $1 AND scope = 'system' AND removed_at IS NULL
     ORDER BY created_at DESC`,
    [contentType],
  );
  return reader.getRowObjectsJS() as HiddenItemRow[];
}

/** Admin unhide: sets removed_at on a system-scope row (no user_id check). */
export async function unhideSystemItem(
  conn: DuckDBConnection,
  id: number,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `UPDATE hidden_item SET removed_at = current_timestamp
     WHERE id = $1 AND scope = 'system' AND removed_at IS NULL
     RETURNING id`,
    [id],
  );
  return reader.getRowObjectsJS().length > 0;
}
