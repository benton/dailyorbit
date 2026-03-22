import type { DuckDBConnection } from '@duckdb/node-api';
import { extractSnippet } from './snippet.ts';
import type { ContentSearchHit, FilingSearchFilters } from './types.ts';

/** A raw vector search hit before joining to source metadata. */
export type VectorSearchHit = {
  readonly source_table: string;
  readonly source_key: string;
  readonly similarity: number;
};

/**
 * Escape a string for safe interpolation into SQL single-quoted literals.
 * (Same helper as in content-search.ts)
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build filter conditions for filing-level metadata filters.
 * Returns a SQL fragment suitable for a WHERE clause (without leading AND).
 */
function buildFilterClause(filters: FilingSearchFilters): string {
  const conditions: string[] = [];

  if (filters.subsystem_code != null && filters.subsystem_code.length > 0) {
    const values: string = filters.subsystem_code
      .map((v: string) => `'${escapeSqlString(v)}'`)
      .join(', ');
    conditions.push(`f.subsystem_code IN (${values})`);
  }

  if (filters.app_type_code != null && filters.app_type_code.length > 0) {
    const values: string = filters.app_type_code
      .map((v: string) => `'${escapeSqlString(v)}'`)
      .join(', ');
    conditions.push(`f.app_type_code IN (${values})`);
  }

  if (filters.status_code != null && filters.status_code.length > 0) {
    const values: string = filters.status_code
      .map((v: string) => `'${escapeSqlString(v)}'`)
      .join(', ');
    conditions.push(`f.status_code IN (${values})`);
  }

  if (
    filters.date_filed_from != null &&
    filters.date_filed_from.trim() !== ''
  ) {
    conditions.push(
      `f.date_filed >= '${escapeSqlString(filters.date_filed_from.trim())}'`,
    );
  }

  if (filters.date_filed_to != null && filters.date_filed_to.trim() !== '') {
    conditions.push(
      `f.date_filed <= '${escapeSqlString(filters.date_filed_to.trim())}'`,
    );
  }

  if (filters.company != null && filters.company.trim() !== '') {
    const escaped: string = escapeSqlString(filters.company.trim());
    conditions.push(`f.company_id IN (
      SELECT c.id FROM company c WHERE c.name ILIKE '%${escaped}%'
      UNION
      SELECT c.id FROM company c WHERE c.parent_company_id IN (SELECT c2.id FROM company c2 WHERE c2.name ILIKE '%${escaped}%')
    )`);
  }

  if (filters.callsign != null && filters.callsign.trim() !== '') {
    conditions.push(
      `f.callsign ILIKE '%${escapeSqlString(filters.callsign.trim())}%'`,
    );
  }

  if (filters.applicant != null && filters.applicant.trim() !== '') {
    conditions.push(
      `f.address_attention ILIKE '%${escapeSqlString(filters.applicant.trim())}%'`,
    );
  }

  if (!filters.show_hidden) {
    const scopeFilter: string =
      filters.user_id != null
        ? `(h.scope = 'system' OR (h.scope = 'user' AND h.user_id = '${escapeSqlString(filters.user_id)}'))`
        : `h.scope = 'system'`;
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM hidden_item h
      WHERE h.content_type = 'filing'
        AND h.content_key = f.file_number
        AND h.removed_at IS NULL
        AND ${scopeFilter}
    )`);
  }

  return conditions.length > 0 ? conditions.join(' AND ') : '1=1';
}

/**
 * Search for the most similar documents to a query embedding, applying
 * the same metadata filters as BM25 search. Results are deduplicated
 * by file_number (best similarity per filing wins).
 */
export async function searchByVector(
  conn: DuckDBConnection,
  queryEmbedding: number[],
  filters: FilingSearchFilters,
  query: string,
  limit: number,
  offset: number,
): Promise<{ hits: ContentSearchHit[]; total: number }> {
  const filterClause: string = buildFilterClause(filters);
  const embeddingParam: string = JSON.stringify(queryEmbedding);

  // Fetch more than needed to account for deduplication
  const fetchLimit: number = (offset + limit) * 3;

  const sql: string = `
    WITH vector_hits AS (
      SELECT e.source_table, e.source_key,
             array_cosine_similarity(e.embedding, '${embeddingParam}'::FLOAT[512]) AS similarity
      FROM embedding e
      ORDER BY similarity DESC
      LIMIT ${String(fetchLimit)}
    ),
    enriched AS (
      SELECT
        vh.source_table, vh.source_key, vh.similarity,
        CASE
          WHEN vh.source_table = 'filing' THEN vh.source_key
          WHEN vh.source_table = 'attachment' THEN (SELECT a.file_number FROM attachment a WHERE CAST(a.attachment_key AS VARCHAR) = vh.source_key LIMIT 1)
          WHEN vh.source_table = 'pleading' THEN (SELECT f2.file_number FROM pleading p JOIN filing f2 ON p.filing_key = f2.filing_key WHERE CAST(p.pleading_key AS VARCHAR) = vh.source_key LIMIT 1)
        END AS file_number,
        CASE
          WHEN vh.source_table = 'filing' THEN (SELECT f3.description FROM filing f3 WHERE f3.file_number = vh.source_key LIMIT 1)
          WHEN vh.source_table = 'attachment' THEN (SELECT a2.summary FROM attachment a2 WHERE CAST(a2.attachment_key AS VARCHAR) = vh.source_key LIMIT 1)
          WHEN vh.source_table = 'pleading' THEN (SELECT p2.exhibit_attachment_html FROM pleading p2 WHERE CAST(p2.pleading_key AS VARCHAR) = vh.source_key LIMIT 1)
        END AS matched_text
      FROM vector_hits vh
    ),
    filtered AS (
      SELECT e.*,
        f.callsign, f.address_attention, f.subsystem_code, f.app_type_code,
        f.status_code, f.date_filed, f.company_id
      FROM enriched e
      JOIN filing f ON e.file_number = f.file_number
      WHERE ${filterClause}
    ),
    deduped AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY file_number ORDER BY similarity DESC) AS rn
      FROM filtered
    )
    SELECT file_number, source_table AS source, source_key, similarity AS score,
      matched_text, callsign, address_attention, subsystem_code, app_type_code,
      status_code, date_filed,
      (SELECT co.name FROM company co WHERE co.id = company_id) AS company_name
    FROM deduped
    WHERE rn = 1
    ORDER BY similarity DESC
  `;

  // Run total count and paginated data
  const countSql: string = `SELECT COUNT(*) AS total FROM (${sql})`;
  const pagedSql: string = `${sql} LIMIT ${String(limit)} OFFSET ${String(offset)}`;

  const [dataReader, countReader] = await Promise.all([
    conn.runAndReadAll(pagedSql),
    conn.runAndReadAll(countSql),
  ]);

  const total: number = Number(countReader.getRowObjectsJS()[0]?.total ?? 0);

  const hits: ContentSearchHit[] = dataReader
    .getRowObjectsJS()
    .map((row: Record<string, unknown>) => {
      const matchedText: string | null =
        row.matched_text != null ? String(row.matched_text) : null;
      const { snippet } = extractSnippet(matchedText, query, 200);

      return {
        file_number: String(row.file_number ?? ''),
        source: String(row.source) as 'filing' | 'attachment' | 'pleading',
        source_key: row.source_key != null ? String(row.source_key) : null,
        score: Number(row.score ?? 0),
        snippet,
        callsign: row.callsign != null ? String(row.callsign) : null,
        address_attention:
          row.address_attention != null ? String(row.address_attention) : null,
        subsystem_code: String(row.subsystem_code ?? ''),
        app_type_code: String(row.app_type_code ?? ''),
        status_code: row.status_code != null ? String(row.status_code) : null,
        date_filed: row.date_filed != null ? String(row.date_filed) : null,
        company_name:
          row.company_name != null ? String(row.company_name) : null,
      };
    });

  return { hits, total };
}
