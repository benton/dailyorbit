import { describe, expect, it } from 'vitest';
import {
  buildPaginatedQuery,
  buildPaginatedResponse,
  normalizePaginatedRequest,
} from './pagination.ts';
import type { PaginatedRequest } from './pagination.ts';

const ALLOWED_COLUMNS: ReadonlySet<string> = new Set([
  'file_number',
  'date_filed',
  'applicant_name',
  'status_code',
]);

const BASE_SQL: string = 'SELECT * FROM filing WHERE subsystem_code = $1';
const BASE_PARAMS: string[] = ['SAT'];

describe('normalizePaginatedRequest', () => {
  it('returns defaults when no params are provided', () => {
    const result = normalizePaginatedRequest({});
    expect(result).toEqual({
      page: 1,
      pageSize: 25,
      sort: undefined,
      order: 'asc',
    });
  });

  it('clamps page to minimum of 1', () => {
    const result = normalizePaginatedRequest({ page: 0 });
    expect(result.page).toEqual(1);

    const negative = normalizePaginatedRequest({ page: -5 });
    expect(negative.page).toEqual(1);
  });

  it('clamps pageSize to [1, 100]', () => {
    const tooSmall = normalizePaginatedRequest({ pageSize: 0 });
    expect(tooSmall.pageSize).toEqual(1);

    const tooLarge = normalizePaginatedRequest({ pageSize: 500 });
    expect(tooLarge.pageSize).toEqual(100);
  });

  it('floors fractional page and pageSize values', () => {
    const result = normalizePaginatedRequest({ page: 2.9, pageSize: 10.7 });
    expect(result.page).toEqual(2);
    expect(result.pageSize).toEqual(10);
  });

  it('normalizes order to asc for invalid values', () => {
    const result = normalizePaginatedRequest({
      order: 'invalid' as 'asc',
    });
    expect(result.order).toEqual('asc');
  });

  it('preserves desc order', () => {
    const result = normalizePaginatedRequest({ order: 'desc' });
    expect(result.order).toEqual('desc');
  });
});

describe('buildPaginatedQuery', () => {
  it('generates correct SQL for page 1 with defaults', () => {
    const result = buildPaginatedQuery(
      BASE_SQL,
      BASE_PARAMS,
      {},
      ALLOWED_COLUMNS,
      'file_number',
    );

    expect(result.sql).toEqual(
      'SELECT * FROM filing WHERE subsystem_code = $1 ORDER BY "file_number" asc LIMIT 25 OFFSET 0',
    );
    expect(result.params).toEqual(['SAT']);
    expect(result.countSql).toEqual(
      'SELECT COUNT(*) AS total FROM (SELECT * FROM filing WHERE subsystem_code = $1) AS _count',
    );
    expect(result.countParams).toEqual(['SAT']);
  });

  it('calculates correct offset for page 3, pageSize 10', () => {
    const request: PaginatedRequest = { page: 3, pageSize: 10 };
    const result = buildPaginatedQuery(
      BASE_SQL,
      BASE_PARAMS,
      request,
      ALLOWED_COLUMNS,
      'file_number',
    );

    expect(result.sql).toContain('LIMIT 10 OFFSET 20');
  });

  it('applies requested sort column when it is in the allowed set', () => {
    const request: PaginatedRequest = { sort: 'date_filed', order: 'desc' };
    const result = buildPaginatedQuery(
      BASE_SQL,
      BASE_PARAMS,
      request,
      ALLOWED_COLUMNS,
      'file_number',
    );

    expect(result.sql).toContain('ORDER BY "date_filed" desc');
  });

  it('falls back to default sort when requested column is not allowed', () => {
    const request: PaginatedRequest = {
      sort: 'DROP TABLE filing; --',
      order: 'desc',
    };
    const result = buildPaginatedQuery(
      BASE_SQL,
      BASE_PARAMS,
      request,
      ALLOWED_COLUMNS,
      'file_number',
    );

    expect(result.sql).toContain('ORDER BY "file_number" desc');
    expect(result.sql).not.toContain('DROP');
  });

  it('throws if defaultSort is not in the allowed columns set', () => {
    expect(() =>
      buildPaginatedQuery(
        BASE_SQL,
        BASE_PARAMS,
        {},
        ALLOWED_COLUMNS,
        'nonexistent_column',
      ),
    ).toThrow(
      'Default sort column "nonexistent_column" is not in the allowed columns set',
    );
  });

  it('does not mutate the original baseParams array', () => {
    const params: string[] = ['SAT'];
    const result = buildPaginatedQuery(
      BASE_SQL,
      params,
      {},
      ALLOWED_COLUMNS,
      'file_number',
    );

    result.params.push('injected' as never);
    expect(params).toEqual(['SAT']);
  });

  it('works with an empty base params array', () => {
    const result = buildPaginatedQuery(
      'SELECT * FROM filing',
      [],
      { page: 2, pageSize: 5 },
      ALLOWED_COLUMNS,
      'file_number',
    );

    expect(result.sql).toEqual(
      'SELECT * FROM filing ORDER BY "file_number" asc LIMIT 5 OFFSET 5',
    );
    expect(result.params).toEqual([]);
    expect(result.countParams).toEqual([]);
  });
});

describe('buildPaginatedResponse', () => {
  it('computes totalPages correctly', () => {
    const response = buildPaginatedResponse([{ id: 1 }, { id: 2 }], 47, {
      page: 1,
      pageSize: 10,
    });

    expect(response).toEqual({
      data: [{ id: 1 }, { id: 2 }],
      page: 1,
      pageSize: 10,
      totalRows: 47,
      totalPages: 5,
    });
  });

  it('returns totalPages of 1 when totalRows is 0', () => {
    const response = buildPaginatedResponse([], 0, { page: 1, pageSize: 25 });
    expect(response.totalPages).toEqual(1);
  });

  it('computes totalPages as 1 when totalRows equals pageSize', () => {
    const response = buildPaginatedResponse(
      Array.from({ length: 10 }, (_, i) => ({ id: i })),
      10,
      { page: 1, pageSize: 10 },
    );
    expect(response.totalPages).toEqual(1);
  });

  it('rounds totalPages up for partial last page', () => {
    const response = buildPaginatedResponse([{ id: 1 }], 101, {
      page: 11,
      pageSize: 10,
    });
    expect(response.totalPages).toEqual(11);
  });
});
