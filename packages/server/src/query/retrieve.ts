import type { DuckDBConnection } from '@duckdb/node-api';
import {
  searchFilingContent,
  type EmbeddingContext,
} from '../search/content-search.ts';
import {
  searchNewsByKeyword,
  searchNewsByVector,
  type NewsSearchHit,
} from '../search/news-search.ts';
import type { ContentSearchHit, FilingSearchFilters } from '../search/types.ts';
import type { RetrievedSource, RewrittenQuery } from './types.ts';

const MAX_RESULTS: number = 10;
const FETCH_WINDOW: number = 20;
const RRF_K: number = 60;

/**
 * Retrieve context for RAG answer generation by running hybrid search
 * for each rewritten query and merging results via RRF.
 *
 * Searches both filing content (filings, attachments, pleadings) and
 * news articles in parallel, then merges all results via cross-query RRF.
 */
export async function retrieveContext(
  queries: RewrittenQuery[],
  conn: DuckDBConnection,
  embeddingCtx?: EmbeddingContext,
): Promise<{ sources: RetrievedSource[]; retrievalMs: number }> {
  const start: number = performance.now();

  // Run filing and news searches in parallel for each query
  const allSources: RetrievedSource[][] = await Promise.all(
    queries.map(async (q: RewrittenQuery) => {
      const docTypes = q.filters?.docTypes;
      const searchFilings: boolean =
        docTypes == null || docTypes.some((t) => t !== 'news');
      const searchNews: boolean = docTypes == null || docTypes.includes('news');

      const filingPromise: Promise<RetrievedSource[]> = searchFilings
        ? searchFilingContent(
            conn,
            {
              q: q.text,
              mode: embeddingCtx != null ? 'hybrid' : 'keyword',
            },
            buildFilters(q),
            { page: 1, pageSize: FETCH_WINDOW },
            embeddingCtx,
          ).then((result) => result.data.map(hitToSource))
        : Promise.resolve([]);

      const newsPromise: Promise<RetrievedSource[]> = searchNews
        ? searchNewsForQuery(conn, q.text, FETCH_WINDOW, embeddingCtx)
        : Promise.resolve([]);

      const [filingSources, newsSources] = await Promise.all([
        filingPromise,
        newsPromise,
      ]);

      return [...filingSources, ...newsSources];
    }),
  );

  // Merge across queries using RRF, then deduplicate
  const merged: RetrievedSource[] = mergeQueryResults(allSources);
  const retrievalMs: number = Math.round(performance.now() - start);

  return { sources: merged.slice(0, MAX_RESULTS), retrievalMs };
}

/**
 * Search news articles by keyword and optionally by vector,
 * merging via RRF when both are available.
 */
async function searchNewsForQuery(
  conn: DuckDBConnection,
  queryText: string,
  limit: number,
  embeddingCtx?: EmbeddingContext,
): Promise<RetrievedSource[]> {
  const keywordHits: NewsSearchHit[] = await searchNewsByKeyword(
    conn,
    queryText,
    limit,
  );

  let allHits: NewsSearchHit[] = keywordHits;

  if (embeddingCtx != null) {
    const embeddingResp = await embeddingCtx.service.embedQuery(
      queryText,
      embeddingCtx.modelId,
      embeddingCtx.dimensions,
      embeddingCtx.normalize,
    );
    const vectorHits: NewsSearchHit[] = await searchNewsByVector(
      conn,
      embeddingResp.embedding,
      limit,
    );

    // RRF merge keyword + vector news results
    allHits = mergeNewsHitsRRF(keywordHits, vectorHits);
  }

  return allHits.map(newsHitToSource);
}

/** Merge two ranked NewsSearchHit lists via RRF. */
function mergeNewsHitsRRF(
  keywordHits: readonly NewsSearchHit[],
  vectorHits: readonly NewsSearchHit[],
): NewsSearchHit[] {
  const merged = new Map<number, { hit: NewsSearchHit; rrfScore: number }>();

  for (let rank = 0; rank < keywordHits.length; rank++) {
    const hit: NewsSearchHit = keywordHits[rank]!;
    merged.set(hit.news_item_id, { hit, rrfScore: 1 / (RRF_K + rank + 1) });
  }

  for (let rank = 0; rank < vectorHits.length; rank++) {
    const hit: NewsSearchHit = vectorHits[rank]!;
    const existing = merged.get(hit.news_item_id);
    const vectorScore: number = 1 / (RRF_K + rank + 1);
    if (existing != null) {
      existing.rrfScore += vectorScore;
      if (hit.snippet.length > existing.hit.snippet.length) {
        existing.hit = hit;
      }
    } else {
      merged.set(hit.news_item_id, { hit, rrfScore: vectorScore });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ hit, rrfScore }) => ({ ...hit, score: rrfScore }));
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
 * Merge pre-converted RetrievedSource arrays from multiple queries using RRF.
 * Deduplicates by type:id composite key.
 */
function mergeQueryResults(
  querySources: RetrievedSource[][],
): RetrievedSource[] {
  const scored = new Map<
    string,
    { source: RetrievedSource; rrfScore: number }
  >();

  for (const sources of querySources) {
    for (let rank = 0; rank < sources.length; rank++) {
      const source: RetrievedSource = sources[rank]!;
      const key: string = `${source.type}:${source.id}`;
      const rrfScore: number = 1 / (RRF_K + rank + 1);

      const existing = scored.get(key);
      if (existing != null) {
        existing.rrfScore += rrfScore;
        if (source.snippet.length > existing.source.snippet.length) {
          existing.source.snippet = source.snippet;
        }
      } else {
        scored.set(key, { source, rrfScore });
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

/** Convert a NewsSearchHit to a RetrievedSource. */
function newsHitToSource(hit: NewsSearchHit): RetrievedSource {
  const titleParts: string[] = [hit.title];
  if (hit.source_name) titleParts.push(hit.source_name);
  if (hit.company_name) titleParts.push(hit.company_name);

  return {
    type: 'news',
    id: String(hit.news_item_id),
    title: titleParts.join(' — '),
    snippet: hit.snippet,
    score: hit.score,
    url: hit.source_url,
  };
}
