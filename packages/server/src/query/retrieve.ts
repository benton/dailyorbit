import type { DuckDBConnection } from '@duckdb/node-api';
import {
  searchFilingContent,
  type EmbeddingContext,
} from '../search/content-search.ts';
import type { ContentSearchHit, FilingSearchFilters } from '../search/types.ts';
import type { RetrievedSource, RewrittenQuery } from './types.ts';

const MAX_RESULTS: number = 10;
const FETCH_WINDOW: number = 20;
const RRF_K: number = 60;

/**
 * Retrieve context for RAG answer generation by running hybrid search
 * for each rewritten query and merging results via RRF.
 *
 * News search is deferred to a future session — currently only filings,
 * attachments, and pleadings are searched.
 */
export async function retrieveContext(
  queries: RewrittenQuery[],
  conn: DuckDBConnection,
  embeddingCtx?: EmbeddingContext,
): Promise<{ sources: RetrievedSource[]; retrievalMs: number }> {
  const start: number = performance.now();

  // Run all queries in parallel
  const allHits: ContentSearchHit[][] = await Promise.all(
    queries.map((q: RewrittenQuery) => {
      const filters: FilingSearchFilters = buildFilters(q);
      return searchFilingContent(
        conn,
        { q: q.text, mode: embeddingCtx != null ? 'hybrid' : 'keyword' },
        filters,
        { page: 1, pageSize: FETCH_WINDOW },
        embeddingCtx,
      ).then((result) => result.data);
    }),
  );

  // Merge across queries using RRF, then deduplicate
  const merged: RetrievedSource[] = mergeQueryResults(allHits);
  const retrievalMs: number = Math.round(performance.now() - start);

  return { sources: merged.slice(0, MAX_RESULTS), retrievalMs };
}

/** Map RewrittenQuery filters to FilingSearchFilters. */
function buildFilters(query: RewrittenQuery): FilingSearchFilters {
  const filters: FilingSearchFilters = {};
  const f = query.filters;
  if (f == null) return filters;

  if (f.dateFrom != null) filters.date_filed_from = f.dateFrom;
  if (f.dateTo != null) filters.date_filed_to = f.dateTo;
  if (f.subsystems != null && f.subsystems.length > 0)
    filters.subsystem_code = f.subsystems;
  if (f.company != null) filters.company = f.company;

  return filters;
}

/**
 * Merge results from multiple queries using Reciprocal Rank Fusion.
 * Deduplicates by source key (file_number + source + source_key).
 */
function mergeQueryResults(queryHits: ContentSearchHit[][]): RetrievedSource[] {
  const scored = new Map<
    string,
    { source: RetrievedSource; rrfScore: number }
  >();

  for (const hits of queryHits) {
    for (let rank = 0; rank < hits.length; rank++) {
      const hit: ContentSearchHit = hits[rank]!;
      const key: string = `${hit.file_number}:${hit.source}:${hit.source_key ?? ''}`;
      const rrfScore: number = 1 / (RRF_K + rank + 1);

      const existing = scored.get(key);
      if (existing != null) {
        existing.rrfScore += rrfScore;
        // Keep longer snippet
        if (hit.snippet.length > existing.source.snippet.length) {
          existing.source.snippet = hit.snippet;
        }
      } else {
        scored.set(key, {
          source: hitToSource(hit),
          rrfScore,
        });
      }
    }
  }

  return Array.from(scored.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ source, rrfScore }) => ({ ...source, score: rrfScore }));
}

/** Convert a ContentSearchHit to a RetrievedSource. */
function hitToSource(hit: ContentSearchHit): RetrievedSource {
  const title: string = [
    hit.file_number,
    hit.company_name,
    hit.address_attention,
  ]
    .filter(Boolean)
    .join(' — ');

  const url: string =
    hit.source === 'filing'
      ? `/filings/${hit.file_number}`
      : `/filings/${hit.file_number}#${hit.source}`;

  return {
    type: hit.source,
    id: hit.source_key ?? hit.file_number,
    title,
    snippet: hit.snippet,
    score: hit.score,
    url,
  };
}
