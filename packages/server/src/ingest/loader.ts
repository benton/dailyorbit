import type { DuckDBAppender, DuckDBConnection } from '@duckdb/node-api';
import { DuckDBTimestampValue } from '@duckdb/node-api';
import type { DuckDbType, TableDef } from './types.ts';

/** Change tracking columns appended to every table */
const TRACKING_COLUMN_DEFS: string = [
  '"_first_seen_at" TIMESTAMP',
  '"_last_seen_at" TIMESTAMP',
  '"_modified_at" TIMESTAMP',
].join(', ');

/**
 * Returns the full ordered list of column names for a table,
 * including any extra columns and the three tracking columns.
 */
function allColumnNames(
  tableDef: TableDef,
  extraColumnCount: number,
): string[] {
  const names: string[] = tableDef.columns.map((c) => c.name);
  const ddlColCount: number = tableDef.columns.length;
  for (let i: number = 0; i < extraColumnCount; i++) {
    names.push(`_extra_${String(ddlColCount + i + 1)}`);
  }
  names.push('_first_seen_at', '_last_seen_at', '_modified_at');
  return names;
}

/**
 * Returns the DuckDB type for a column by name, considering DDL columns,
 * extra columns (always VARCHAR), and tracking columns (always TIMESTAMP).
 */
function columnType(tableDef: TableDef, colName: string): DuckDbType {
  if (
    colName === '_first_seen_at' ||
    colName === '_last_seen_at' ||
    colName === '_modified_at'
  ) {
    return 'TIMESTAMP';
  }
  if (colName.startsWith('_extra_')) {
    return 'VARCHAR';
  }
  const col = tableDef.columns.find((c) => c.name === colName);
  if (col != null) {
    return col.duckdbType;
  }
  return 'VARCHAR';
}

/**
 * Generates the CREATE TABLE SQL for a TableDef, using the appName as the
 * table name and appending change tracking columns.
 */
export function generateCreateTableSql(
  tableDef: TableDef,
  extraColumnCount: number = 0,
  tableName?: string,
): string {
  const name: string = tableName ?? tableDef.appName;
  const colDefs: string[] = tableDef.columns.map((col) => {
    const nullConstraint: string = col.nullable ? '' : ' NOT NULL';
    return `"${col.name}" ${col.duckdbType}${nullConstraint}`;
  });

  const ddlColCount: number = tableDef.columns.length;
  for (let i: number = 0; i < extraColumnCount; i++) {
    const idx: number = ddlColCount + i + 1;
    colDefs.push(`"_extra_${String(idx)}" VARCHAR`);
  }

  const allCols: string = [...colDefs, TRACKING_COLUMN_DEFS].join(', ');
  return `CREATE TABLE IF NOT EXISTS "${name}" (${allCols})`;
}

/**
 * Creates a table in DuckDB from a TableDef.
 */
export async function createTable(
  conn: DuckDBConnection,
  tableDef: TableDef,
  extraColumnCount: number = 0,
  tableName?: string,
): Promise<void> {
  const sql: string = generateCreateTableSql(
    tableDef,
    extraColumnCount,
    tableName,
  );
  await conn.run(sql);
}

/**
 * Converts a JS value to the appropriate DuckDB Appender call.
 */
function appendValue(
  appender: DuckDBAppender,
  value: unknown,
  duckdbType: DuckDbType,
): void {
  if (value == null) {
    appender.appendNull();
    return;
  }

  switch (duckdbType) {
    case 'INTEGER':
      appender.appendInteger(value as number);
      break;
    case 'TINYINT':
      appender.appendTinyInt(value as number);
      break;
    case 'SMALLINT':
      appender.appendSmallInt(value as number);
      break;
    case 'DOUBLE':
      appender.appendDouble(value as number);
      break;
    case 'VARCHAR':
      appender.appendVarchar(value as string);
      break;
    case 'TIMESTAMP': {
      // Convert ISO string or Date to DuckDBTimestampValue (micros since epoch)
      const date: Date =
        value instanceof Date ? value : new Date(value as string);
      const micros: bigint = BigInt(date.getTime()) * 1000n;
      appender.appendTimestamp(new DuckDBTimestampValue(micros));
      break;
    }
  }
}

/**
 * Inserts rows into a DuckDB table using the fast Appender API.
 * Automatically sets _first_seen_at, _last_seen_at, _modified_at to now().
 */
export async function insertBatch(
  conn: DuckDBConnection,
  tableDef: TableDef,
  rows: Record<string, unknown>[],
  extraColumnCount: number = 0,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const appender: DuckDBAppender = await conn.createAppender(tableDef.appName);
  const colNames: string[] = allColumnNames(tableDef, extraColumnCount);
  const now: Date = new Date();

  for (const row of rows) {
    for (const colName of colNames) {
      const type: DuckDbType = columnType(tableDef, colName);
      if (
        colName === '_first_seen_at' ||
        colName === '_last_seen_at' ||
        colName === '_modified_at'
      ) {
        appendValue(appender, now, 'TIMESTAMP');
      } else {
        appendValue(appender, row[colName] ?? null, type);
      }
    }
    appender.endRow();
  }

  appender.flushSync();
  appender.closeSync();
}

/**
 * Upserts by dropping and reloading, then reconciling _first_seen_at
 * from the previous table snapshot.
 *
 * MERGE cannot be used because the DDL-declared primary keys contain
 * duplicate values in the FCC source data (e.g. space_station has
 * 144k rows but only 837 unique PKs), which causes cartesian-product
 * explosion in the MERGE join.
 *
 * Instead, we:
 * 1. Rename the existing table to a backup
 * 2. Create a fresh table and bulk-load via Appender
 * 3. UPDATE _first_seen_at from the backup using a row-content hash
 * 4. Drop the backup
 */
export async function upsertBatch(
  conn: DuckDBConnection,
  tableDef: TableDef,
  rows: Record<string, unknown>[],
  extraColumnCount: number = 0,
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const table: string = tableDef.appName;
  const backupName: string = `${table}_old`;

  // Build list of data column names (DDL + extras, no tracking)
  const dataColNames: string[] = tableDef.columns.map((c) => c.name);
  const ddlColCount: number = tableDef.columns.length;
  for (let i: number = 0; i < extraColumnCount; i++) {
    dataColNames.push(`_extra_${String(ddlColCount + i + 1)}`);
  }

  // Step 1: Rename old table
  await conn.run(`ALTER TABLE "${table}" RENAME TO "${backupName}"`);

  // Step 2: Create fresh table and load new snapshot via Appender
  await createTable(conn, tableDef, extraColumnCount);
  await insertBatch(conn, tableDef, rows, extraColumnCount);

  // Step 3: Carry forward _first_seen_at from matching rows in the old table.
  // Because DDL-declared PKs may contain duplicates in the source data,
  // we match rows by a hash of all data columns for a reliable join.
  const hashCols: string = dataColNames
    .map((c) => `COALESCE(CAST("${c}" AS VARCHAR), '')`)
    .join(" || '|' || ");
  await conn.run(
    `UPDATE "${table}" SET "_first_seen_at" = o."_first_seen_at"
     FROM (SELECT DISTINCT ON (md5(${hashCols})) md5(${hashCols}) AS _rh, "_first_seen_at"
           FROM "${backupName}") o
     WHERE md5(${hashCols}) = o._rh
       AND o."_first_seen_at" < "${table}"."_first_seen_at"`,
  );

  // Step 4: Drop backup
  await conn.run(`DROP TABLE IF EXISTS "${backupName}"`);

  return { inserted: rows.length, updated: 0 };
}
