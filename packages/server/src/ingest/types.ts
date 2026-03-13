/** Sybase-to-DuckDB type mapping */
export type DuckDbType =
  | 'INTEGER'
  | 'TINYINT'
  | 'SMALLINT'
  | 'DOUBLE'
  | 'VARCHAR'
  | 'TIMESTAMP';

/** A single column definition parsed from the Sybase DDL */
export type ColumnDef = {
  name: string;
  sybaseType: string;
  duckdbType: DuckDbType;
  nullable: boolean;
};

/** A complete table definition parsed from the Sybase DDL */
export type TableDef = {
  /** Table name as it appears in the DDL (e.g. 'MAIN') */
  ddlName: string;
  /** Table name used in the app's DuckDB schema (e.g. 'filing') */
  appName: string;
  /** Source .dat filename (e.g. 'main.dat') */
  datFile: string;
  columns: ColumnDef[];
  primaryKey: string[];
};
