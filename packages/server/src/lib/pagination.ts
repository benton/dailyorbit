import type { DuckDBValue } from '@duckdb/node-api';

/** Default page size when none is specified */
const DEFAULT_PAGE_SIZE: number = 25;

/** Maximum allowed page size */
const MAX_PAGE_SIZE: number = 100;

/** Sort direction */
export type SortOrder = 'asc' | 'desc';

/** Incoming pagination + sort parameters from the client */
export type PaginatedRequest = {
  /** 1-based page number (default: 1) */
  page?: number;
  /** Rows per page (default: 25, max: 100) */
  pageSize?: number;
  /** Column to sort by (must be in the allowed columns set) */
  sort?: string;
  /** Sort direction (default: 'asc') */
  order?: SortOrder;
};

/** Paginated API response envelope */
export type PaginatedResponse<T> = {
  data: T[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
};

/** Output of buildPaginatedQuery */
export type PaginatedQueryResult = {
  sql: string;
  params: DuckDBValue[];
  countSql: string;
  countParams: DuckDBValue[];
};

/**
 * Validate and normalize pagination parameters.
 * Clamps page to >= 1 and pageSize to [1, MAX_PAGE_SIZE].
 */
export function normalizePaginatedRequest(req: PaginatedRequest): {
  page: number;
  pageSize: number;
  sort: string | undefined;
  order: SortOrder;
} {
  const page: number = Math.max(1, Math.floor(req.page ?? 1));
  const rawSize: number = Math.floor(req.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize: number = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  const order: SortOrder = req.order === 'desc' ? 'desc' : 'asc';
  return { page, pageSize, sort: req.sort, order };
}

/**
 * Build paginated SQL from a base query.
 *
 * The base query should be a complete SELECT statement (without ORDER BY,
 * LIMIT, or OFFSET). Any WHERE-clause parameters should already be in
 * `baseParams`.
 *
 * `allowedColumns` is a Set of column names that are valid for sorting.
 * If the requested sort column is not in the set, the `defaultSort` column
 * is used instead.
 *
 * Returns both the paginated data query and a COUNT(*) query sharing the
 * same WHERE clause.
 */
export function buildPaginatedQuery(
  baseSql: string,
  baseParams: DuckDBValue[],
  request: PaginatedRequest,
  allowedColumns: ReadonlySet<string>,
  defaultSort: string,
  defaultOrder: SortOrder = 'asc',
  tiebreaker?: string,
): PaginatedQueryResult {
  const {
    page,
    pageSize,
    sort,
    order: reqOrder,
  } = normalizePaginatedRequest(request);
  // Use the caller's default order when the client didn't specify one
  const order: SortOrder = request.order != null ? reqOrder : defaultOrder;

  const sortColumn: string =
    sort != null && allowedColumns.has(sort) ? sort : defaultSort;

  // Validate defaultSort is in the allowed set
  if (!allowedColumns.has(sortColumn)) {
    throw new Error(
      `Default sort column "${defaultSort}" is not in the allowed columns set`,
    );
  }

  const offset: number = (page - 1) * pageSize;

  // Build the data query with ORDER BY + LIMIT + OFFSET
  // Column name is safe because it was validated against the whitelist
  const tieClause: string =
    tiebreaker != null && tiebreaker !== sortColumn
      ? `, "${tiebreaker}" ${order}`
      : '';
  const sql: string = `${baseSql} ORDER BY "${sortColumn}" ${order}${tieClause} LIMIT ${pageSize} OFFSET ${offset}`;

  // Build the count query by wrapping the base SQL
  const countSql: string = `SELECT COUNT(*) AS total FROM (${baseSql}) AS _count`;

  return {
    sql,
    params: [...baseParams],
    countSql,
    countParams: [...baseParams],
  };
}

/**
 * Construct a PaginatedResponse from query results.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  totalRows: number,
  request: PaginatedRequest,
): PaginatedResponse<T> {
  const { page, pageSize } = normalizePaginatedRequest(request);
  const totalPages: number = Math.max(1, Math.ceil(totalRows / pageSize));
  return { data, page, pageSize, totalRows, totalPages };
}
