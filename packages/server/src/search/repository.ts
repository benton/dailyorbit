import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import {
  buildPaginatedQuery,
  buildPaginatedResponse,
  type PaginatedRequest,
  type PaginatedResponse,
} from '../lib/pagination.ts';
import type {
  EarthStationSearchFilters,
  EarthStationSearchResult,
  FilingSearchFilters,
  FilingSearchResult,
  SatelliteSearchFilters,
  SatelliteSearchResult,
} from './types.ts';
import { AUTOCOMPLETE_ENTITY_CONFIG, AUTOCOMPLETE_WHITELIST } from './types.ts';

// ---------------------------------------------------------------------------
// Filing search
// ---------------------------------------------------------------------------

const FILING_SORTABLE_COLUMNS: ReadonlySet<string> = new Set([
  'file_number',
  'callsign',
  'address_attention',
  'subsystem_code',
  'app_type_code',
  'status_code',
  'date_filed',
]);

/**
 * Search filings with ILIKE text filters, IN-list filters, and date range.
 */
export async function searchFilings(
  conn: DuckDBConnection,
  filters: FilingSearchFilters,
  pagination: PaginatedRequest,
): Promise<PaginatedResponse<FilingSearchResult>> {
  const conditions: string[] = [];
  const params: DuckDBValue[] = [];
  let paramIndex: number = 1;

  if (filters.file_number != null && filters.file_number.trim() !== '') {
    conditions.push(`file_number ILIKE $${paramIndex}`);
    params.push(`%${filters.file_number.trim()}%`);
    paramIndex++;
  }

  if (filters.callsign != null && filters.callsign.trim() !== '') {
    conditions.push(`callsign ILIKE $${paramIndex}`);
    params.push(`%${filters.callsign.trim()}%`);
    paramIndex++;
  }

  if (filters.applicant != null && filters.applicant.trim() !== '') {
    conditions.push(`address_attention ILIKE $${paramIndex}`);
    params.push(`%${filters.applicant.trim()}%`);
    paramIndex++;
  }

  if (filters.company != null && filters.company.trim() !== '') {
    conditions.push(
      `company_id IN (
        SELECT c.id FROM company c
        WHERE c.name ILIKE $${paramIndex}
        UNION
        SELECT c.id FROM company c
        WHERE c.parent_company_id IN (SELECT c2.id FROM company c2 WHERE c2.name ILIKE $${paramIndex})
      )`,
    );
    params.push(`%${filters.company.trim()}%`);
    paramIndex++;
  }

  if (filters.subsystem_code != null && filters.subsystem_code.length > 0) {
    const placeholders: string = filters.subsystem_code
      .map(() => `$${paramIndex++}`)
      .join(', ');
    conditions.push(`subsystem_code IN (${placeholders})`);
    params.push(...(filters.subsystem_code as DuckDBValue[]));
  }

  if (filters.app_type_code != null && filters.app_type_code.length > 0) {
    const placeholders: string = filters.app_type_code
      .map(() => `$${paramIndex++}`)
      .join(', ');
    conditions.push(`app_type_code IN (${placeholders})`);
    params.push(...(filters.app_type_code as DuckDBValue[]));
  }

  if (filters.status_code != null && filters.status_code.length > 0) {
    const placeholders: string = filters.status_code
      .map(() => `$${paramIndex++}`)
      .join(', ');
    conditions.push(`status_code IN (${placeholders})`);
    params.push(...(filters.status_code as DuckDBValue[]));
  }

  if (
    filters.date_filed_from != null &&
    filters.date_filed_from.trim() !== ''
  ) {
    conditions.push(`date_filed >= $${paramIndex}`);
    params.push(filters.date_filed_from.trim());
    paramIndex++;
  }

  if (filters.date_filed_to != null && filters.date_filed_to.trim() !== '') {
    conditions.push(`date_filed <= $${paramIndex}`);
    params.push(filters.date_filed_to.trim());
    paramIndex++;
  }

  const whereClause: string =
    conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const baseSql: string = `SELECT file_number, callsign, address_attention, subsystem_code, app_type_code, status_code, date_filed FROM filing${whereClause}`;

  const {
    sql,
    params: queryParams,
    countSql,
    countParams,
  } = buildPaginatedQuery(
    baseSql,
    params,
    pagination,
    FILING_SORTABLE_COLUMNS,
    'date_filed',
  );

  const dataReader = await conn.runAndReadAll(sql, queryParams);
  const countReader = await conn.runAndReadAll(countSql, countParams);

  const data: FilingSearchResult[] = dataReader
    .getRowObjectsJS()
    .map(rowToFilingResult);
  const totalRows: number = Number(
    countReader.getRowObjectsJS()[0]?.total ?? 0,
  );

  return buildPaginatedResponse(data, totalRows, pagination);
}

function rowToFilingResult(row: Record<string, unknown>): FilingSearchResult {
  return {
    file_number: String(row.file_number ?? ''),
    callsign: row.callsign != null ? String(row.callsign) : null,
    address_attention:
      row.address_attention != null ? String(row.address_attention) : null,
    subsystem_code: String(row.subsystem_code ?? ''),
    app_type_code: String(row.app_type_code ?? ''),
    status_code: row.status_code != null ? String(row.status_code) : null,
    date_filed: row.date_filed != null ? String(row.date_filed) : null,
  };
}

// ---------------------------------------------------------------------------
// Satellite search
// ---------------------------------------------------------------------------

const SATELLITE_SORTABLE_COLUMNS: ReadonlySet<string> = new Set([
  'space_station_key',
  'us_name',
  'itu_name',
  'orbit_location',
  'inactive_date',
]);

/**
 * Search satellites with ILIKE text filters and active/inactive filter.
 */
export async function searchSatellites(
  conn: DuckDBConnection,
  filters: SatelliteSearchFilters,
  pagination: PaginatedRequest,
): Promise<PaginatedResponse<SatelliteSearchResult>> {
  const conditions: string[] = [];
  const params: DuckDBValue[] = [];
  let paramIndex: number = 1;

  if (filters.us_name != null && filters.us_name.trim() !== '') {
    conditions.push(`us_name ILIKE $${paramIndex}`);
    params.push(`%${filters.us_name.trim()}%`);
    paramIndex++;
  }

  if (filters.itu_name != null && filters.itu_name.trim() !== '') {
    conditions.push(`itu_name ILIKE $${paramIndex}`);
    params.push(`%${filters.itu_name.trim()}%`);
    paramIndex++;
  }

  if (filters.orbit_location != null && filters.orbit_location.trim() !== '') {
    conditions.push(`CAST(orbit_location AS VARCHAR) ILIKE $${paramIndex}`);
    params.push(`%${filters.orbit_location.trim()}%`);
    paramIndex++;
  }

  if (filters.active != null) {
    if (filters.active) {
      conditions.push(`inactive_date IS NULL`);
    } else {
      conditions.push(`inactive_date IS NOT NULL`);
    }
  }

  const whereClause: string =
    conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const baseSql: string = `SELECT space_station_key, us_name, itu_name, orbit_location, inactive_date FROM space_station${whereClause}`;

  const {
    sql,
    params: queryParams,
    countSql,
    countParams,
  } = buildPaginatedQuery(
    baseSql,
    params,
    pagination,
    SATELLITE_SORTABLE_COLUMNS,
    'us_name',
  );

  const dataReader = await conn.runAndReadAll(sql, queryParams);
  const countReader = await conn.runAndReadAll(countSql, countParams);

  const data: SatelliteSearchResult[] = dataReader
    .getRowObjectsJS()
    .map(rowToSatelliteResult);
  const totalRows: number = Number(
    countReader.getRowObjectsJS()[0]?.total ?? 0,
  );

  return buildPaginatedResponse(data, totalRows, pagination);
}

function rowToSatelliteResult(
  row: Record<string, unknown>,
): SatelliteSearchResult {
  return {
    space_station_key: Number(row.space_station_key),
    us_name: String(row.us_name ?? ''),
    itu_name: row.itu_name != null ? String(row.itu_name) : null,
    orbit_location:
      row.orbit_location != null ? String(row.orbit_location) : null,
    inactive_date: row.inactive_date != null ? String(row.inactive_date) : null,
  };
}

// ---------------------------------------------------------------------------
// Earth station search
// ---------------------------------------------------------------------------

const EARTH_STATION_SORTABLE_COLUMNS: ReadonlySet<string> = new Set([
  'callsign',
  'address_attention',
  'filing_count',
  'most_recent_filing',
]);

/**
 * Search earth stations by grouping SES-subsystem filings by callsign.
 * Joins with earth_station_sta for city/state filtering.
 */
export async function searchEarthStations(
  conn: DuckDBConnection,
  filters: EarthStationSearchFilters,
  pagination: PaginatedRequest,
): Promise<PaginatedResponse<EarthStationSearchResult>> {
  const conditions: string[] = [`f.subsystem_code = 'SES'`];
  const params: DuckDBValue[] = [];
  let paramIndex: number = 1;

  if (filters.callsign != null && filters.callsign.trim() !== '') {
    conditions.push(`f.callsign ILIKE $${paramIndex}`);
    params.push(`%${filters.callsign.trim()}%`);
    paramIndex++;
  }

  if (filters.applicant != null && filters.applicant.trim() !== '') {
    conditions.push(`f.address_attention ILIKE $${paramIndex}`);
    params.push(`%${filters.applicant.trim()}%`);
    paramIndex++;
  }

  // city/state filtering requires a join to earth_station_sta
  const needsEarthJoin: boolean =
    (filters.state != null && filters.state.trim() !== '') ||
    (filters.city != null && filters.city.trim() !== '');

  const joinClause: string = needsEarthJoin
    ? ' INNER JOIN earth_station_sta e ON f.filing_key = e.filing_key'
    : '';

  if (filters.state != null && filters.state.trim() !== '') {
    conditions.push(`e.state_code ILIKE $${paramIndex}`);
    params.push(`%${filters.state.trim()}%`);
    paramIndex++;
  }

  if (filters.city != null && filters.city.trim() !== '') {
    conditions.push(`e.city ILIKE $${paramIndex}`);
    params.push(`%${filters.city.trim()}%`);
    paramIndex++;
  }

  const whereClause: string = ` WHERE ${conditions.join(' AND ')}`;

  const baseSql: string = `SELECT f.callsign, MAX(f.address_attention) AS address_attention, COUNT(*) AS filing_count, MAX(f.date_filed) AS most_recent_filing FROM filing f${joinClause}${whereClause} GROUP BY f.callsign`;

  const {
    sql,
    params: queryParams,
    countSql,
    countParams,
  } = buildPaginatedQuery(
    baseSql,
    params,
    pagination,
    EARTH_STATION_SORTABLE_COLUMNS,
    'callsign',
  );

  const dataReader = await conn.runAndReadAll(sql, queryParams);
  const countReader = await conn.runAndReadAll(countSql, countParams);

  const data: EarthStationSearchResult[] = dataReader
    .getRowObjectsJS()
    .map(rowToEarthStationResult);
  const totalRows: number = Number(
    countReader.getRowObjectsJS()[0]?.total ?? 0,
  );

  return buildPaginatedResponse(data, totalRows, pagination);
}

function rowToEarthStationResult(
  row: Record<string, unknown>,
): EarthStationSearchResult {
  return {
    callsign: String(row.callsign ?? ''),
    address_attention:
      row.address_attention != null ? String(row.address_attention) : null,
    filing_count: Number(row.filing_count),
    most_recent_filing:
      row.most_recent_filing != null ? String(row.most_recent_filing) : null,
  };
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

/**
 * Return distinct values for a given entity/field matching a prefix query.
 * Only whitelisted entity/field combinations are allowed.
 */
export async function autocomplete(
  conn: DuckDBConnection,
  entity: string,
  field: string,
  query: string,
  limit: number = 10,
): Promise<string[]> {
  const allowedFields: ReadonlySet<string> | undefined =
    AUTOCOMPLETE_WHITELIST[entity];
  if (allowedFields == null || !allowedFields.has(field)) {
    return [];
  }

  const config = AUTOCOMPLETE_ENTITY_CONFIG[entity];
  if (config == null) {
    return [];
  }

  const columnName: string = config.columnMap[field] ?? field;
  const { table } = config;

  // For earth-stations with state/city, we need a join
  const needsJoin: boolean =
    entity === 'earth-stations' && (field === 'state' || field === 'city');
  const fromClause: string = needsJoin
    ? `filing f INNER JOIN earth_station_sta e ON f.filing_key = e.filing_key`
    : table;

  const whereExtra: string =
    entity === 'earth-stations' && !needsJoin
      ? ` AND subsystem_code = 'SES'`
      : entity === 'earth-stations' && needsJoin
        ? ` AND f.subsystem_code = 'SES'`
        : '';

  const trimmedQuery: string = query.trim();
  const sql: string = `SELECT DISTINCT ${columnName} AS val FROM ${fromClause} WHERE ${columnName} ILIKE $1${whereExtra} ORDER BY val LIMIT ${Math.min(limit, 50)}`;

  const reader = await conn.runAndReadAll(sql, [
    `${trimmedQuery}%`,
  ] as DuckDBValue[]);
  const rows = reader.getRowObjectsJS();

  return rows
    .map((r) => (r.val != null ? String(r.val).trim() : ''))
    .filter((v) => v !== '');
}
