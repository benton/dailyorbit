import type { DuckDbType, TableDef } from './types.ts';

/** Sentinel values for fields that are present but fail to parse */
const SENTINELS: Record<DuckDbType, unknown> = {
  VARCHAR: '$$INVALID$$',
  INTEGER: -2147483648,
  TINYINT: -128,
  SMALLINT: -2147483648,
  DOUBLE: NaN,
  TIMESTAMP: '0001-01-01T00:00:00',
};

const MONTH_MAP: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

/**
 * Parses the IBFS datetime format: "Mon DD YYYY HH:MM:SS:mmmAM/PM"
 * Returns an ISO-8601 string without timezone, or null on failure.
 *
 * Examples:
 *   "Feb 28 1996 12:00:00:000AM" → "1996-02-28T00:00:00.000"
 *   "Mar 25 2021 12:26:11:243PM" → "2021-03-25T12:26:11.243"
 *   "Jun  5 2009  5:40:43:633PM" → "2009-06-05T17:40:43.633"
 */
function parseIbfsDatetime(raw: string): string | null {
  const re: RegExp =
    /^(\w{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2}):(\d{3})(AM|PM)$/i;
  const m: RegExpExecArray | null = re.exec(raw.trim());
  if (m == null) {
    return null;
  }

  const month: string | undefined = MONTH_MAP[m[1]!];
  if (month == null) {
    return null;
  }

  const day: string = m[2]!.padStart(2, '0');
  const year: string = m[3]!;
  let hour: number = parseInt(m[4]!, 10);
  const min: string = m[5]!;
  const sec: string = m[6]!;
  const ms: string = m[7]!;
  const ampm: string = m[8]!.toUpperCase();

  if (ampm === 'PM' && hour !== 12) {
    hour += 12;
  } else if (ampm === 'AM' && hour === 12) {
    hour = 0;
  }

  const hh: string = String(hour).padStart(2, '0');
  return `${year}-${month}-${day}T${hh}:${min}:${sec}.${ms}`;
}

/**
 * Coerces a raw string field value to the appropriate JS type for a given DuckDB type.
 *
 * - Empty string → null (field was absent/empty in source)
 * - Parse failure → sentinel value (field was present but invalid)
 */
export function coerceValue(raw: string, duckdbType: DuckDbType): unknown {
  if (raw === '') {
    return null;
  }

  switch (duckdbType) {
    case 'VARCHAR':
      return raw.trimEnd();

    case 'INTEGER':
    case 'TINYINT':
    case 'SMALLINT': {
      const n: number = parseInt(raw, 10);
      if (Number.isNaN(n)) {
        return SENTINELS[duckdbType];
      }
      return n;
    }

    case 'DOUBLE': {
      const n: number = parseFloat(raw);
      if (Number.isNaN(n)) {
        return SENTINELS.DOUBLE;
      }
      return n;
    }

    case 'TIMESTAMP': {
      const iso: string | null = parseIbfsDatetime(raw);
      if (iso == null) {
        return SENTINELS.TIMESTAMP;
      }
      return iso;
    }
  }
}

/**
 * Splits a raw .dat file buffer into records using the |^|\r\n (or |^|\n)
 * record terminator, then parses each record's pipe-delimited fields
 * according to the provided TableDef.
 *
 * Fields beyond the DDL column count are added as _extra_N (1-based index).
 * Fields fewer than the DDL column count are filled with null.
 */
export function parseRecords(
  buf: Buffer,
  tableDef: TableDef,
): Record<string, unknown>[] {
  const text: string = buf.toString('utf-8');

  // Split on |^|\r\n or |^|\n
  const rawRecords: string[] = text.split(/\|\^\|(?:\r\n|\n)/);
  const rows: Record<string, unknown>[] = [];

  for (const rawRecord of rawRecords) {
    if (rawRecord === '') {
      continue;
    }

    const fields: string[] = rawRecord.split('|');
    const row: Record<string, unknown> = {};
    const colCount: number = tableDef.columns.length;

    // Map known columns
    for (let i: number = 0; i < colCount; i++) {
      const colDef = tableDef.columns[i]!;
      const rawValue: string = i < fields.length ? fields[i]! : '';
      row[colDef.name] = coerceValue(rawValue, colDef.duckdbType);
    }

    // Map extra columns beyond the DDL definition
    for (let i: number = colCount; i < fields.length; i++) {
      const extraName: string = `_extra_${String(i + 1)}`;
      const rawValue: string = fields[i]!;
      row[extraName] = rawValue === '' ? null : rawValue.trimEnd();
    }

    rows.push(row);
  }

  return rows;
}
