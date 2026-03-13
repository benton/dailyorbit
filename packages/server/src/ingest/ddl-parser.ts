import type { ColumnDef, DuckDbType, TableDef } from './types.ts';

/**
 * Maps a Sybase type string (e.g. 'char(5)', 'int', 'float') to a DuckDB type.
 */
function mapSybaseType(sybaseType: string): DuckDbType {
  const base: string = sybaseType.replace(/\(.*\)/, '').toLowerCase();
  switch (base) {
    case 'int':
    case 'integer':
      return 'INTEGER';
    case 'tinyint':
      return 'TINYINT';
    case 'smallint':
      return 'SMALLINT';
    case 'float':
    case 'numeric':
      return 'DOUBLE';
    case 'datetime':
      return 'TIMESTAMP';
    case 'char':
    case 'varchar':
    case 'text':
      return 'VARCHAR';
    default:
      return 'VARCHAR';
  }
}

/** Well-known DDL→dat file name overrides where the .dat name doesn't match lowercase DDL name */
const DAT_FILE_OVERRIDES: Record<string, string> = {
  ACCOUNTING_CHANGE: 'accnt.dat',
  ACCOUNTING_CHANGE_RATE: 'acct_rt.dat',
  ACTION_CODE: 'act_code.dat',
  ANTENNA: 'anten.dat',
  ANTENNA_CONDITION: 'ant_cond.dat',
  ANTENNA_FX: 'ant_fx.dat',
  ANTENNA_GAIN: 'ant_gain.dat',
  ANTENNA_TYPE_CODE: 'ant_type_code.dat',
  APP_TYPE_CODE: 'app_typ_code.dat',
  ASSIGNMENT: 'assign.dat',
  ASSIGN_LIST: 'assign_lst.dat',
  ATTACHMENT: 'attach.dat',
  BLOCKED_HISTORY: 'blk_hist.dat',
  BLOCKED_REASON_CODE: 'blk_reas_code.dat',
  CLASS_OF_STATION_CODE: 'class.dat',
  CONDITION: 'cond.dat',
  CONSTRAINTS: 'constr.dat',
  DESTINATION: 'destina.dat',
  EARTH_STATION_STA: 'earth_sta.dat',
  FILING_HISTORY: 'fil_hist.dat',
  FREQUENCY: 'freq.dat',
  FREQUENCY_CONDITION: 'freq_cond.dat',
  FREQ_COORD: 'freq_coord.dat',
  FREQUENCY_FX: 'freq_fx.dat',
  LICENSE_CONDITION: 'lic_cond.dat',
  LICENSEE_HISTORY: 'licensee_history.dat',
  MAIN: 'main.dat',
  NATURE_OF_SERVICE_CODE: 'nat_serv_code.dat',
  NATURE_OF_SERVICE: 'nat_serv.dat',
  NOTE_TYPE_CODE: 'note_type_code.dat',
  PAINT_LIGHT: 'pls.dat',
  PETITION_TO_DENY: 'petit_deny.dat',
  POLARIZATION_CODE: 'polar.dat',
  PTCOMM_FX: 'ptcomm_fx.dat',
  PURPOSE_CODE: 'purpose_code.dat',
  REMOTE_CONTROL: 'rem_contrl.dat',
  SECTION_214: 'sect_214.dat',
  SECTION_214_SERVICE_CODE: 'sect_214_code.dat',
  SECTION_214_STA: 'sect_214_sta.dat',
  SITE_CONDITION: 'site_cond.dat',
  SPACE_STATION: 'space_sta.dat',
  SPACE_STATION_STA: 'space_sta_sta.dat',
  STATUS_CODE: 'status_code.dat',
  STATUS_TRACKING: 'stat_track.dat',
  SUBSYSTEM_CODE: 'subsys_code.dat',
  SUBSYSTEM_REPORT: 'subsys_rpt.dat',
  TYPE_APPLICANT_CODE: 'type_appl_code.dat',
};

/** Table name overrides: DDL name → app-level name */
const APP_NAME_OVERRIDES: Record<string, string> = {
  MAIN: 'filing',
};

function deriveDatFile(ddlName: string): string {
  const override: string | undefined = DAT_FILE_OVERRIDES[ddlName];
  if (override != null) {
    return override;
  }
  return `${ddlName.toLowerCase()}.dat`;
}

function deriveAppName(ddlName: string): string {
  const override: string | undefined = APP_NAME_OVERRIDES[ddlName];
  if (override != null) {
    return override;
  }
  return ddlName.toLowerCase();
}

/**
 * Parses a Sybase DDL string and returns an array of TableDef objects.
 *
 * Handles `create table`, column definitions, and `create unique index ... _PK`
 * lines to extract primary keys.
 */
export function parseDdl(ddl: string): TableDef[] {
  const tables: TableDef[] = [];
  const pkMap: Map<string, string[]> = new Map();

  // Extract primary keys from index statements
  const pkRegex: RegExp =
    /create\s+unique\s+index\s+(\w+_PK)\s+on\s+(\w+)\s+\(([^)]+)\)/gi;
  let pkMatch: RegExpExecArray | null = pkRegex.exec(ddl);
  while (pkMatch != null) {
    const tableName: string = pkMatch[2]!;
    const cols: string[] = pkMatch[3]!.split(',').map((c) => c.trim());
    pkMap.set(tableName, cols);
    pkMatch = pkRegex.exec(ddl);
  }

  // Extract table definitions.
  // The closing ) must be on its own line (preceded by \n) to avoid
  // matching ) inside type definitions like char(5).
  const tableRegex: RegExp =
    /create\s+table\s+(\w+)\s*\(\s*([\s\S]*?)\n\)\s*\ngo/gi;
  let tableMatch: RegExpExecArray | null = tableRegex.exec(ddl);
  while (tableMatch != null) {
    const ddlName: string = tableMatch[1]!;
    const columnsBlock: string = tableMatch[2]!;
    const columns: ColumnDef[] = parseColumns(columnsBlock);
    const primaryKey: string[] = pkMap.get(ddlName) ?? [];

    tables.push({
      ddlName,
      appName: deriveAppName(ddlName),
      datFile: deriveDatFile(ddlName),
      columns,
      primaryKey,
    });

    tableMatch = tableRegex.exec(ddl);
  }

  return tables;
}

function parseColumns(block: string): ColumnDef[] {
  const columns: ColumnDef[] = [];
  const lines: string[] = block.split('\n');

  for (const line of lines) {
    const trimmed: string = line.trim().replace(/,\s*$/, '');
    if (trimmed === '' || trimmed.startsWith('/*')) {
      continue;
    }

    // Match: column_name    type(size)    [default ...] [not] null
    const colRegex: RegExp =
      /^(\w+)\s+((?:char|varchar|text|int|integer|tinyint|smallint|float|datetime|numeric)(?:\(\d+(?:,\s*\d+)?\))?)\s+(?:default\s+\S+\s+)?(not\s+null|null)/i;
    const match: RegExpExecArray | null = colRegex.exec(trimmed);
    if (match != null) {
      const name: string = match[1]!;
      const sybaseType: string = match[2]!.toLowerCase();
      const nullability: string = match[3]!.toLowerCase();

      columns.push({
        name,
        sybaseType,
        duckdbType: mapSybaseType(sybaseType),
        nullable: nullability === 'null',
      });
    }
  }

  return columns;
}
