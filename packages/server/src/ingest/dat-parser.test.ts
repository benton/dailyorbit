import { describe, expect, it } from 'vitest';
import { parseRecords, coerceValue } from './dat-parser.ts';
import type { ColumnDef, TableDef } from './types.ts';

/** Helper to build a minimal TableDef for testing */
function makeTableDef(columns: ColumnDef[]): TableDef {
  return {
    ddlName: 'TEST',
    appName: 'test',
    datFile: 'test.dat',
    columns,
    primaryKey: ['id'],
  };
}

/** Helper to build a ColumnDef */
function col(
  name: string,
  duckdbType: ColumnDef['duckdbType'],
  nullable: boolean = true,
): ColumnDef {
  return { name, sybaseType: '', duckdbType, nullable };
}

/**
 * Encodes rows as a .dat buffer with |^|\r\n record terminators
 * and | field delimiters.
 */
function encodeDat(rows: string[][]): Buffer {
  const lines: string = rows.map((r) => r.join('|')).join('|^|\r\n');
  return Buffer.from(lines + '|^|\r\n');
}

describe('coerceValue', () => {
  it('returns null for empty string', () => {
    expect(coerceValue('', 'VARCHAR')).toBeNull();
    expect(coerceValue('', 'INTEGER')).toBeNull();
  });

  it('passes through VARCHAR values trimming trailing spaces', () => {
    expect(coerceValue('hello   ', 'VARCHAR')).toBe('hello');
  });

  it('parses INTEGER values', () => {
    expect(coerceValue('42', 'INTEGER')).toBe(42);
    expect(coerceValue('-2099999680', 'INTEGER')).toBe(-2099999680);
  });

  it('returns sentinel for invalid INTEGER', () => {
    expect(coerceValue('abc', 'INTEGER')).toBe(-2147483648);
  });

  it('parses TINYINT values', () => {
    expect(coerceValue('1', 'TINYINT')).toBe(1);
  });

  it('returns sentinel for invalid TINYINT', () => {
    expect(coerceValue('xyz', 'TINYINT')).toBe(-128);
  });

  it('parses SMALLINT values', () => {
    expect(coerceValue('300', 'SMALLINT')).toBe(300);
  });

  it('returns sentinel for invalid SMALLINT', () => {
    expect(coerceValue('nope', 'SMALLINT')).toBe(-2147483648);
  });

  it('parses DOUBLE values', () => {
    expect(coerceValue('3.14', 'DOUBLE')).toBe(3.14);
  });

  it('returns NaN sentinel for invalid DOUBLE', () => {
    expect(coerceValue('not-a-number', 'DOUBLE')).toBeNaN();
  });

  it('parses IBFS datetime format to ISO string', () => {
    const result: unknown = coerceValue(
      'Feb 28 1996 12:00:00:000AM',
      'TIMESTAMP',
    );
    expect(result).toBe('1996-02-28T00:00:00.000');
  });

  it('parses PM datetimes correctly', () => {
    const result: unknown = coerceValue(
      'Mar 25 2021 12:26:11:243PM',
      'TIMESTAMP',
    );
    expect(result).toBe('2021-03-25T12:26:11.243');
  });

  it('parses non-12 PM times correctly', () => {
    const result: unknown = coerceValue(
      'Jun  5 2009  5:40:43:633PM',
      'TIMESTAMP',
    );
    expect(result).toBe('2009-06-05T17:40:43.633');
  });

  it('parses 12:00 AM as midnight', () => {
    const result: unknown = coerceValue(
      'Dec 17 1991 12:00:00:000AM',
      'TIMESTAMP',
    );
    expect(result).toBe('1991-12-17T00:00:00.000');
  });

  it('returns sentinel for invalid TIMESTAMP', () => {
    expect(coerceValue('not-a-date', 'TIMESTAMP')).toBe('0001-01-01T00:00:00');
  });
});

describe('parseRecords', () => {
  const tableDef: TableDef = makeTableDef([
    col('id', 'INTEGER', false),
    col('name', 'VARCHAR'),
    col('value', 'DOUBLE'),
  ]);

  it('parses a single record', () => {
    const buf: Buffer = encodeDat([['1', 'hello', '3.14']]);
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

    expect(rows).toEqual([{ id: 1, name: 'hello', value: 3.14 }]);
  });

  it('parses multiple records', () => {
    const buf: Buffer = encodeDat([
      ['1', 'alpha', '1.0'],
      ['2', 'beta', '2.0'],
    ]);
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 1, name: 'alpha', value: 1.0 });
    expect(rows[1]).toEqual({ id: 2, name: 'beta', value: 2.0 });
  });

  it('handles empty/null fields', () => {
    const buf: Buffer = encodeDat([['1', '', '']]);
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

    expect(rows).toEqual([{ id: 1, name: null, value: null }]);
  });

  it('handles records with embedded newlines in fields', () => {
    // The field "line1\nline2" contains a bare newline, but the record
    // terminator is |^|\r\n, so the parser should keep it as one record.
    const raw: string = '1|line1\nline2|3.14|^|\r\n';
    const buf: Buffer = Buffer.from(raw);
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('line1\nline2');
  });

  it('adds _extra columns for fields beyond the DDL definition', () => {
    const buf: Buffer = encodeDat([['1', 'hello', '3.14', 'bonus1', 'bonus2']]);
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

    expect(rows[0]).toEqual({
      id: 1,
      name: 'hello',
      value: 3.14,
      _extra_4: 'bonus1',
      _extra_5: 'bonus2',
    });
  });

  it('handles fewer fields than columns by filling nulls', () => {
    const buf: Buffer = encodeDat([['1', 'hello']]);
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

    expect(rows[0]).toEqual({ id: 1, name: 'hello', value: null });
  });

  it('handles |^|\\n terminator (without \\r)', () => {
    const raw: string = '1|hello|3.14|^|\n2|world|2.72|^|\n';
    const buf: Buffer = Buffer.from(raw);
    const rows: Record<string, unknown>[] = parseRecords(buf, tableDef);

    expect(rows).toHaveLength(2);
  });
});
