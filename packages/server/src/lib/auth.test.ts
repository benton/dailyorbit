import { describe, expect, it } from 'vitest';
import { buildWhereClause } from './auth-helpers.ts';

describe('buildWhereClause', () => {
  it('returns empty string and no params when where list is empty', () => {
    const { sql, params } = buildWhereClause([]);
    expect(sql).toEqual('');
    expect(params).toEqual([]);
  });

  it('builds an eq clause for a single condition', () => {
    const { sql, params } = buildWhereClause([
      { field: 'id', value: '42', operator: 'eq' },
    ]);
    expect(sql).toEqual('WHERE "id" = $1');
    expect(params).toEqual(['42']);
  });

  it('builds an IN clause for multiple values', () => {
    const { sql, params } = buildWhereClause([
      { field: 'status', value: ['active', 'pending'], operator: 'in' },
    ]);
    expect(sql).toEqual('WHERE "status" IN ($1, $2)');
    expect(params).toEqual(['active', 'pending']);
  });

  it('builds a LIKE clause for contains operator', () => {
    const { sql, params } = buildWhereClause([
      { field: 'name', value: 'orbit', operator: 'contains' },
    ]);
    expect(sql).toEqual('WHERE "name" LIKE $1');
    expect(params).toEqual(['%orbit%']);
  });

  it('joins multiple conditions with AND and increments param indices', () => {
    const { sql, params } = buildWhereClause([
      { field: 'id', value: '1', operator: 'eq' },
      { field: 'email', value: 'test@example.com', operator: 'eq' },
    ]);
    expect(sql).toEqual('WHERE "id" = $1 AND "email" = $2');
    expect(params).toEqual(['1', 'test@example.com']);
  });

  it('defaults to eq when operator is omitted', () => {
    const { sql, params } = buildWhereClause([{ field: 'id', value: '7' }]);
    expect(sql).toEqual('WHERE "id" = $1');
    expect(params).toEqual(['7']);
  });
});
