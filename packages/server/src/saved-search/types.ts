import type { FilingSearchFilters } from '../search/types.ts';

/** News search filters — free-text query with optional mode. */
export type NewsSearchFilters = {
  q: string;
  mode?: 'keyword' | 'semantic' | 'hybrid';
};

export type SavedSearchContentType = 'filing' | 'news';

export type SavedSearchRow = {
  id: number;
  user_id: string;
  name: string;
  content_type: SavedSearchContentType;
  filters: string; // JSON string from DB
  include_time_scope: boolean;
  alert_enabled: boolean;
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
  created_at: string;
  updated_at: string;
};

export type CreateSavedSearchInput = {
  name: string;
  content_type: SavedSearchContentType;
  filters: FilingSearchFilters | NewsSearchFilters;
};
