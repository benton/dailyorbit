import type { DuckDBConnection } from '@duckdb/node-api';
import type { FilingSearchFilters } from '../search/types.ts';
import type { PaginatedRequest, PaginatedResponse } from '../lib/pagination.ts';
import type { NewsSearchFilters, SavedSearchContentType } from './types.ts';
import { searchFilings } from '../search/repository.ts';
import { searchNewsByKeyword } from '../search/news-search.ts';

/**
 * Execute a saved search against the database.
 * If `sinceTimestamp` is provided, only filings dated after that timestamp are returned.
 * This is used by the alert evaluation system to scope to new content.
 */
export async function executeSavedSearch(
  conn: DuckDBConnection,
  contentType: SavedSearchContentType,
  filters: FilingSearchFilters | NewsSearchFilters,
  pagination: PaginatedRequest,
  sinceTimestamp?: string,
): Promise<PaginatedResponse<unknown>> {
  if (contentType === 'filing') {
    const filingFilters: FilingSearchFilters = {
      ...(filters as FilingSearchFilters),
    };
    if (sinceTimestamp != null) {
      filingFilters.date_filed_from = sinceTimestamp;
    }
    return await searchFilings(conn, filingFilters, pagination);
  }

  if (contentType === 'news') {
    const newsFilters = filters as NewsSearchFilters;
    const hits = await searchNewsByKeyword(conn, newsFilters.q, pagination.pageSize ?? 25);
    return {
      data: hits,
      page: 1,
      pageSize: pagination.pageSize ?? 25,
      totalRows: hits.length,
      totalPages: 1,
    };
  }

  throw new Error(`Unsupported content type: ${contentType}`);
}
