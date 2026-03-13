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
): Promise<void> {
  const sql: string = generateCreateTableSql(tableDef, extraColumnCount);
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
 * Loads rows into a staging table via Appender, then MERGEs into the
 * production table with change tracking column updates.
 *
 * - New rows: all three tracking columns set to now()
 * - Modified rows: _last_seen_at and _modified_at set to now()
 * - Unchanged rows: only _last_seen_at set to now()
 * - Deleted rows (in production but not in staging): left untouched
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

  const stagingName: string = `${tableDef.appName}_staging`;

  // Create staging table (same schema, no tracking columns needed in staging)
  const dataColDefs: string[] = tableDef.columns.map((col) => {
    const nullConstraint: string = col.nullable ? '' : ' NOT NULL';
    return `"${col.name}" ${col.duckdbType}${nullConstraint}`;
  });
  const ddlColCount: number = tableDef.columns.length;
  for (let i: number = 0; i < extraColumnCount; i++) {
    const idx: number = ddlColCount + i + 1;
    dataColDefs.push(`"_extra_${String(idx)}" VARCHAR`);
  }
  await conn.run(`DROP TABLE IF EXISTS "${stagingName}"`);
  await conn.run(
    `CREATE TEMP TABLE "${stagingName}" (${dataColDefs.join(', ')})`,
  );

  // Load rows into staging via Appender
  const appender: DuckDBAppender = await conn.createAppender(stagingName);
  const dataColNames: string[] = tableDef.columns.map((c) => c.name);
  for (let i: number = 0; i < extraColumnCount; i++) {
    dataColNames.push(`_extra_${String(ddlColCount + i + 1)}`);
  }

  for (const row of rows) {
    for (const colName of dataColNames) {
      const type: DuckDbType = columnType(tableDef, colName);
      appendValue(appender, row[colName] ?? null, type);
    }
    appender.endRow();
  }
  appender.flushSync();
  appender.closeSync();

  // Build MERGE statement
  const pk: string[] = tableDef.primaryKey;
  const onClause: string = pk
    .map((k) => `target."${k}" = source."${k}"`)
    .join(' AND ');

  // All non-PK data columns for comparison and update
  const nonPkCols: string[] = dataColNames.filter((c) => !pk.includes(c));

  // Hash comparison for detecting modifications
  const hashExpr = (prefix: string): string =>
    `md5(${nonPkCols.map((c) => `COALESCE(CAST(${prefix}."${c}" AS VARCHAR), '')`).join(" || '|' || ")})`;

  // SET clause: update all data columns + tracking
  const updateSets: string[] = [
    ...nonPkCols.map((c) => `"${c}" = source."${c}"`),
    '"_last_seen_at" = current_timestamp',
    `"_modified_at" = CASE WHEN ${hashExpr('source')} != ${hashExpr('target')} THEN current_timestamp ELSE target."_modified_at" END`,
  ];

  // INSERT columns
  const insertCols: string = dataColNames.map((c) => `"${c}"`).join(', ');
  const insertVals: string = dataColNames
    .map((c) => `source."${c}"`)
    .join(', ');

  const mergeSql: string = `
    MERGE INTO "${tableDef.appName}" AS target
    USING "${stagingName}" AS source
    ON ${onClause}
    WHEN MATCHED THEN UPDATE SET ${updateSets.join(', ')}
    WHEN NOT MATCHED THEN INSERT (${insertCols}, "_first_seen_at", "_last_seen_at", "_modified_at")
      VALUES (${insertVals}, current_timestamp, current_timestamp, current_timestamp)
  `;

  const result = await conn.runAndReadAll(mergeSql);
  const changes = result.getRowObjectsJS();

  // Clean up staging
  await conn.run(`DROP TABLE IF EXISTS "${stagingName}"`);

  // DuckDB MERGE doesn't return insert/update counts directly,
  // so we return the total row count as inserted for initial loads
  const totalRows: number = rows.length;
  const isInitialLoad: boolean = changes.length === 0 || nonPkCols.length === 0;

  return isInitialLoad
    ? { inserted: totalRows, updated: 0 }
    : { inserted: 0, updated: totalRows };
}
