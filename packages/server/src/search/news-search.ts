import type { DuckDBConnection } from '@duckdb/node-api';
import { extractSnippet } from './snippet.ts';

export type NewsSearchHit = {
  news_item_id: number;
  title: string;
  source_name: string;
  published_at: string | null;
  snippet: string;
  score: number;
  source_url: string;
  company_name: string | null;
};

/** Escape a string for safe interpolation into SQL single-quoted literals. */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * BM25 keyword search over news_item using the FTS index on title, full_text, summary.
 * Returns results ranked by BM25 score descending.
 */
export async function searchNewsByKeyword(
  conn: DuckDBConnection,
  query: string,
  limit: number,
): Promise<NewsSearchHit[]> {
  const q: string = query.trim();
  if (q === '') return [];

  const escapedQ: string = escapeSqlString(q);

  const sql: string = `
    SELECT
      ni.id AS news_item_id,
      ni.title,
      ns.name AS source_name,
      ni.published_at,
      COALESCE(ni.full_text, ni.summary, ni.title) AS matched_text,
      fts_main_news_item.match_bm25(ni.id, '${escapedQ}', fields := 'title,full_text,summary') AS score,
      ni.source_url,
      (SELECT co.name FROM company co WHERE co.id = ni.company_id) AS company_name
    FROM news_item ni
    JOIN news_source ns ON ni.news_source_id = ns.id
    WHERE fts_main_news_item.match_bm25(ni.id, '${escapedQ}', fields := 'title,full_text,summary') IS NOT NULL
    ORDER BY score DESC
    LIMIT ${String(limit)}
  `;

  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJS().map((row: Record<string, unknown>) => {
    const matchedText: string | null =
      row.matched_text != null ? String(row.matched_text) : null;
    const { snippet } = extractSnippet(matchedText, q, 200);

    return {
      news_item_id: Number(row.news_item_id),
      title: String(row.title ?? ''),
      source_name: String(row.source_name ?? ''),
      published_at: row.published_at != null ? String(row.published_at) : null,
      snippet,
      score: Number(row.score ?? 0),
      source_url: String(row.source_url ?? ''),
      company_name: row.company_name != null ? String(row.company_name) : null,
    };
  });
}

/**
 * Vector similarity search over news_item embeddings.
 * Queries the embedding table where source_table = 'news_item'.
 */
export async function searchNewsByVector(
  conn: DuckDBConnection,
  embedding: number[],
  limit: number,
): Promise<NewsSearchHit[]> {
  const embeddingParam: string = JSON.stringify(embedding);
  const fetchLimit: number = limit * 3; // over-fetch for dedup across chunks

  const sql: string = `
    WITH vector_hits AS (
      SELECT e.source_key,
             array_cosine_similarity(e.embedding, '${embeddingParam}'::FLOAT[512]) AS similarity
      FROM embedding e
      WHERE e.source_table = 'news_item'
      ORDER BY similarity DESC
      LIMIT ${String(fetchLimit)}
    ),
    deduped AS (
      SELECT source_key, MAX(similarity) AS similarity
      FROM vector_hits
      GROUP BY source_key
    )
    SELECT
      ni.id AS news_item_id,
      ni.title,
      ns.name AS source_name,
      ni.published_at,
      COALESCE(ni.full_text, ni.summary, ni.title) AS matched_text,
      d.similarity AS score,
      ni.source_url,
      (SELECT co.name FROM company co WHERE co.id = ni.company_id) AS company_name
    FROM deduped d
    JOIN news_item ni ON CAST(ni.id AS VARCHAR) = d.source_key
    JOIN news_source ns ON ni.news_source_id = ns.id
    ORDER BY d.similarity DESC
    LIMIT ${String(limit)}
  `;

  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJS().map((row: Record<string, unknown>) => {
    const matchedText: string | null =
      row.matched_text != null ? String(row.matched_text) : null;
    // For vector search, snippet is a prefix of the content (no keyword highlighting)
    const snippet: string =
      matchedText != null
        ? matchedText.slice(0, 200) + (matchedText.length > 200 ? '...' : '')
        : '';

    return {
      news_item_id: Number(row.news_item_id),
      title: String(row.title ?? ''),
      source_name: String(row.source_name ?? ''),
      published_at: row.published_at != null ? String(row.published_at) : null,
      snippet,
      score: Number(row.score ?? 0),
      source_url: String(row.source_url ?? ''),
      company_name: row.company_name != null ? String(row.company_name) : null,
    };
  });
}
