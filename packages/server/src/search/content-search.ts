import type { DuckDBConnection } from '@duckdb/node-api';
import {
  buildPaginatedResponse,
  normalizePaginatedRequest,
  type PaginatedRequest,
  type PaginatedResponse,
} from '../lib/pagination.ts';
import { extractSnippet } from './snippet.ts';
import type {
  ContentSearchHit,
  ContentSearchQuery,
  FilingSearchFilters,
} from './types.ts';

/** Columns that can be used for sorting content search results */
const CONTENT_SORTABLE_COLUMNS: ReadonlySet<string> = new Set([
  'score',
  'file_number',
  'date_filed',
  'subsystem_code',
  'address_attention',
  'company_name',
]);

/** Escape a string for safe interpolation into SQL single-quoted literals */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Search across filing descriptions, attachment full_text, and pleading content
 * using BM25 full-text search, with optional metadata filters.
 *
 * Results are deduplicated by file_number (best score per filing wins) and
 * returned in descending relevance order.
 */
export async function searchFilingContent(
  conn: DuckDBConnection,
  query: ContentSearchQuery,
  filters: FilingSearchFilters,
  pagination: PaginatedRequest,
): Promise<PaginatedResponse<ContentSearchHit>> {
  const { page, pageSize, sort, order } = normalizePaginatedRequest(pagination);
  const offset: number = (page - 1) * pageSize;
  const sortColumn: string =
    sort != null && CONTENT_SORTABLE_COLUMNS.has(sort) ? sort : 'score';
  // Default to DESC for score, ASC for everything else
  const sortOrder: string =
    order !== 'asc' && order !== 'desc'
      ? sortColumn === 'score'
        ? 'desc'
        : 'asc'
      : order;
  const q: string = query.q.trim();

  if (q === '') {
    return buildPaginatedResponse([], 0, pagination);
  }

  const escapedQ: string = escapeSqlString(q);

  // Build filter conditions (no parameters needed — filters are whitelisted values)
  const conditions: string[] = [];

  if (
    filters.subsystem_code != null &&
    filters.subsystem_code.length > 0
  ) {
    const values: string = filters.subsystem_code
      .map((v: string) => `'${escapeSqlString(v)}'`)
      .join(', ');
    conditions.push(`f.subsystem_code IN (${values})`);
  }

  if (
    filters.app_type_code != null &&
    filters.app_type_code.length > 0
  ) {
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

  if (
    filters.date_filed_to != null &&
    filters.date_filed_to.trim() !== ''
  ) {
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

  const filterClause: string =
    conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';

  // Union BM25 results from all three tables, deduplicate by file_number keeping best score.
  const sql: string = `
    WITH filing_hits AS (
      SELECT f.file_number, 'filing' AS source, NULL AS source_key,
        fts_main_filing.match_bm25(f.file_number, '${escapedQ}', fields := 'description,brief_description') AS score,
        f.description AS matched_text,
        f.callsign, f.address_attention, f.subsystem_code, f.app_type_code, f.status_code, f.date_filed, f.company_id
      FROM filing f
      WHERE fts_main_filing.match_bm25(f.file_number, '${escapedQ}', fields := 'description,brief_description') IS NOT NULL
        ${filterClause}
    ),
    attachment_hits AS (
      SELECT f.file_number, 'attachment' AS source, CAST(a.attachment_key AS VARCHAR) AS source_key,
        fts_main_attachment.match_bm25(a.attachment_key, '${escapedQ}', fields := 'full_text,summary') AS score,
        a.full_text AS matched_text,
        f.callsign, f.address_attention, f.subsystem_code, f.app_type_code, f.status_code, f.date_filed, f.company_id
      FROM attachment a
      JOIN filing f ON a.file_number = f.file_number
      WHERE fts_main_attachment.match_bm25(a.attachment_key, '${escapedQ}', fields := 'full_text,summary') IS NOT NULL
        ${filterClause}
    ),
    pleading_hits AS (
      SELECT f.file_number, 'pleading' AS source, CAST(p.pleading_key AS VARCHAR) AS source_key,
        fts_main_pleading.match_bm25(p.pleading_key, '${escapedQ}', fields := 'filer_name,exhibit_attachment_html') AS score,
        p.exhibit_attachment_html AS matched_text,
        f.callsign, f.address_attention, f.subsystem_code, f.app_type_code, f.status_code, f.date_filed, f.company_id
      FROM pleading p
      JOIN filing f ON p.filing_key = f.filing_key
      WHERE fts_main_pleading.match_bm25(p.pleading_key, '${escapedQ}', fields := 'filer_name,exhibit_attachment_html') IS NOT NULL
        ${filterClause}
    ),
    all_hits AS (
      SELECT * FROM filing_hits
      UNION ALL
      SELECT * FROM attachment_hits
      UNION ALL
      SELECT * FROM pleading_hits
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY file_number ORDER BY score DESC) AS rn
      FROM all_hits
    )
    SELECT r.file_number, r.source, r.source_key, r.score, r.matched_text,
      r.callsign, r.address_attention, r.subsystem_code, r.app_type_code, r.status_code, r.date_filed,
      (SELECT co.name FROM company co WHERE co.id = r.company_id) AS company_name
    FROM ranked r
    WHERE r.rn = 1
    ORDER BY r."${sortColumn}" ${sortOrder}
    LIMIT ${String(pageSize)} OFFSET ${String(offset)}
  `;

  const countSql: string = `
    WITH filing_hits AS (
      SELECT f.file_number
      FROM filing f
      WHERE fts_main_filing.match_bm25(f.file_number, '${escapedQ}', fields := 'description,brief_description') IS NOT NULL
        ${filterClause}
    ),
    attachment_hits AS (
      SELECT f.file_number
      FROM attachment a JOIN filing f ON a.file_number = f.file_number
      WHERE fts_main_attachment.match_bm25(a.attachment_key, '${escapedQ}', fields := 'full_text,summary') IS NOT NULL
        ${filterClause}
    ),
    pleading_hits AS (
      SELECT f.file_number
      FROM pleading p JOIN filing f ON p.filing_key = f.filing_key
      WHERE fts_main_pleading.match_bm25(p.pleading_key, '${escapedQ}', fields := 'filer_name,exhibit_attachment_html') IS NOT NULL
        ${filterClause}
    )
    SELECT COUNT(DISTINCT file_number) AS total FROM (
      SELECT file_number FROM filing_hits
      UNION ALL SELECT file_number FROM attachment_hits
      UNION ALL SELECT file_number FROM pleading_hits
    )
  `;

  const [dataReader, countReader] = await Promise.all([
    conn.runAndReadAll(sql),
    conn.runAndReadAll(countSql),
  ]);

  const totalRows: number = Number(
    countReader.getRowObjectsJS()[0]?.total ?? 0,
  );

  const data: ContentSearchHit[] = dataReader
    .getRowObjectsJS()
    .map((row: Record<string, unknown>) => {
      const matchedText: string | null =
        row.matched_text != null ? String(row.matched_text) : null;
      const { snippet } = extractSnippet(matchedText, q, 200);

      return {
        file_number: String(row.file_number ?? ''),
        source: String(row.source) as 'filing' | 'attachment' | 'pleading',
        source_key:
          row.source_key != null ? String(row.source_key) : null,
        score: Number(row.score ?? 0),
        snippet,
        callsign:
          row.callsign != null ? String(row.callsign) : null,
        address_attention:
          row.address_attention != null
            ? String(row.address_attention)
            : null,
        subsystem_code: String(row.subsystem_code ?? ''),
        app_type_code: String(row.app_type_code ?? ''),
        status_code:
          row.status_code != null ? String(row.status_code) : null,
        date_filed:
          row.date_filed != null ? String(row.date_filed) : null,
        company_name:
          row.company_name != null ? String(row.company_name) : null,
      };
    });

  return buildPaginatedResponse(data, totalRows, pagination);
}
