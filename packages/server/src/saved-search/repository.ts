import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { FilingSearchFilters } from '../search/types.ts';
import type {
  CreateSavedSearchInput,
  SavedSearchResponse,
  SavedSearchRow,
  SearchType,
} from './types.ts';
import { classifySearchType } from './types.ts';

/** Determine if filing filters contain date constraints. */
function hasTimeScope(input: CreateSavedSearchInput): boolean {
  if (input.content_type === 'news') return false;
  const f = input.filters as FilingSearchFilters;
  return (
    (f.date_filed_from != null && f.date_filed_from.trim() !== '') ||
    (f.date_filed_to != null && f.date_filed_to.trim() !== '')
  );
}

function rowToResponse(row: SavedSearchRow): SavedSearchResponse {
  return {
    id: row.id,
    name: row.name,
    content_type: row.content_type,
    filters: JSON.parse(row.filters),
    include_time_scope: row.include_time_scope,
    alert_enabled: row.alert_enabled,
    search_type: row.search_type,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Create a saved search. Returns the new ID. */
export async function createSavedSearch(
  conn: DuckDBConnection,
  userId: string,
  input: CreateSavedSearchInput,
): Promise<number> {
  const includeTimeScope: boolean = hasTimeScope(input);
  const searchType: SearchType =
    input.search_type ?? classifySearchType(input.content_type, input.filters);
  const reader = await conn.runAndReadAll(
    `INSERT INTO saved_search (user_id, name, content_type, filters, include_time_scope, search_type)
     VALUES ($1, $2, $3, $4::JSON, $5, $6)
     RETURNING id`,
    [
      userId,
      input.name,
      input.content_type,
      JSON.stringify(input.filters),
      includeTimeScope,
      searchType,
    ],
  );
  return Number(reader.getRowObjectsJS()[0]!.id);
}

/** Get a single saved search by ID. */
export async function getSavedSearchById(
  conn: DuckDBConnection,
  id: number,
): Promise<SavedSearchResponse | null> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, name, content_type, filters::VARCHAR AS filters,
            include_time_scope, alert_enabled, search_type,
            created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
     FROM saved_search WHERE id = $1`,
    [id],
  );
  const rows = reader.getRowObjectsJS() as SavedSearchRow[];
  if (rows.length === 0) return null;
  return rowToResponse(rows[0]!);
}

/** Get all saved searches for a user, most recent first. */
export async function getSavedSearchesForUser(
  conn: DuckDBConnection,
  userId: string,
): Promise<(SavedSearchResponse & { user_id: string })[]> {
  const reader = await conn.runAndReadAll(
    `SELECT id, user_id, name, content_type, filters::VARCHAR AS filters,
            include_time_scope, alert_enabled, search_type,
            created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
     FROM saved_search WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return (reader.getRowObjectsJS() as SavedSearchRow[]).map((r) => ({
    ...rowToResponse(r),
    user_id: r.user_id,
  }));
}

/** Update a saved search (only the owning user may update). */
export async function updateSavedSearch(
  conn: DuckDBConnection,
  id: number,
  userId: string,
  updates: { name?: string; alert_enabled?: boolean; search_type?: SearchType },
): Promise<boolean> {
  const sets: string[] = [];
  const params: DuckDBValue[] = [];
  let paramIndex: number = 1;

  if (updates.name != null) {
    sets.push(`name = $${String(paramIndex)}`);
    params.push(updates.name);
    paramIndex++;
  }
  if (updates.alert_enabled != null) {
    sets.push(`alert_enabled = $${String(paramIndex)}`);
    params.push(updates.alert_enabled);
    paramIndex++;
  }
  if (updates.search_type != null) {
    sets.push(`search_type = $${String(paramIndex)}`);
    params.push(updates.search_type);
    paramIndex++;
  }
  if (sets.length === 0) return false;

  sets.push('updated_at = current_timestamp');
  params.push(id, userId);

  const reader = await conn.runAndReadAll(
    `UPDATE saved_search SET ${sets.join(', ')} WHERE id = $${String(paramIndex)} AND user_id = $${String(paramIndex + 1)} RETURNING id`,
    params,
  );
  return reader.getRowObjectsJS().length > 0;
}

/** Delete a saved search (only the owning user may delete). Returns true if deleted. */
export async function deleteSavedSearch(
  conn: DuckDBConnection,
  id: number,
  userId: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `DELETE FROM saved_search WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  return reader.getRowObjectsJS().length > 0;
}
