import type { FilingSearchFilters } from '../search/types.ts';

/** News search filters — free-text query with optional mode. */
export type NewsSearchFilters = {
  q: string;
  mode?: 'keyword' | 'semantic' | 'hybrid';
};

export type SavedSearchContentType = 'filing' | 'news';

/** Alert evaluation tier for this saved search. */
export type SearchType = 'metadata' | 'keyword' | 'semantic';

export type SavedSearchRow = {
  id: number;
  user_id: string;
  name: string;
  content_type: SavedSearchContentType;
  filters: string; // JSON string from DB
  include_time_scope: boolean;
  alert_enabled: boolean;
  search_type: SearchType;
  created_at: string;
  updated_at: string;
};

export type SavedSearchResponse = {
  id: number;
  name: string;
  content_type: SavedSearchContentType;
  filters: FilingSearchFilters | NewsSearchFilters;
  include_time_scope: boolean;
  alert_enabled: boolean;
  search_type: SearchType;
  created_at: string;
  updated_at: string;
};

export type CreateSavedSearchInput = {
  name: string;
  content_type: SavedSearchContentType;
  filters: FilingSearchFilters | NewsSearchFilters;
  /** Optional override — auto-classified from filters if omitted. */
  search_type?: SearchType;
};

/**
 * Auto-classify a saved search based on its parameters.
 * - 'semantic': news search with mode 'semantic' or 'hybrid'
 * - 'keyword': has a text query (news q or filing with FTS terms)
 * - 'metadata': structured filters only (applicant, subsystem, dates, etc.)
 */
export function classifySearchType(
  contentType: SavedSearchContentType,
  filters: FilingSearchFilters | NewsSearchFilters,
): SearchType {
  if (contentType === 'news') {
    const nf = filters as NewsSearchFilters;
    if (nf.mode === 'semantic' || nf.mode === 'hybrid') return 'semantic';
    if (nf.q != null && nf.q.trim() !== '') return 'keyword';
    return 'metadata';
  }
  // Filing searches are currently metadata-only (no FTS query field on FilingSearchFilters)
  return 'metadata';
}
