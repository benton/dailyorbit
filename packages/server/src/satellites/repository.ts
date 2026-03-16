import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import {
  buildPaginatedQuery,
  buildPaginatedResponse,
  type PaginatedRequest,
  type PaginatedResponse,
} from '../lib/pagination.ts';
import type { SatelliteFiling, SatelliteStats, SpaceStation } from './types.ts';

/** Columns allowed for sorting satellite filings */
const FILING_SORT_COLUMNS: ReadonlySet<string> = new Set([
  'file_number',
  'date_filed',
  'date_grant',
  'status_code',
  'address_attention',
  'subsystem_code',
  'app_type_code',
]);

/**
 * Fetch a single space station by its primary key.
 * Returns null if no matching record exists.
 */
export async function getSatelliteById(
  conn: DuckDBConnection,
  spaceStationKey: number,
): Promise<SpaceStation | null> {
  const result = await conn.runAndReadAll(
    `SELECT space_station_key, us_name, itu_name, orbit_location, "verbose", inactive_date
     FROM space_station
     WHERE space_station_key = $1`,
    [spaceStationKey] as DuckDBValue[],
  );
  const rows = result.getRowObjectsJS();
  if (rows.length === 0) return null;

  const row = rows[0]!;
  return {
    spaceStationKey: Number(row.space_station_key),
    usName: String(row.us_name),
    ituName: row.itu_name != null ? String(row.itu_name) : null,
    orbitLocation:
      row.orbit_location != null ? String(row.orbit_location) : null,
    verbose: row.verbose != null ? String(row.verbose) : null,
    inactiveDate: row.inactive_date != null ? String(row.inactive_date) : null,
  };
}

/**
 * Fetch paginated filings associated with a space station (via callsign → us_name).
 */
export async function getSatelliteFilings(
  conn: DuckDBConnection,
  usName: string,
  request: PaginatedRequest,
): Promise<PaginatedResponse<SatelliteFiling>> {
  const baseSql: string = `SELECT f.filing_key, f.file_number, f.subsystem_code, f.app_type_code,
       f.status_code, f.date_filed, f.date_grant, f.address_attention, f.callsign, f.description,
       (SELECT a.summary FROM attachment a WHERE a.file_number = f.file_number AND a.summary IS NOT NULL ORDER BY CASE WHEN a.attachment_name = 'Attachment Application' THEN 0 ELSE 1 END, a.attachment_key LIMIT 1) AS summary
     FROM filing f
     WHERE f.callsign = $1`;
  const baseParams: DuckDBValue[] = [usName] as DuckDBValue[];

  const pq = buildPaginatedQuery(
    baseSql,
    baseParams,
    request,
    FILING_SORT_COLUMNS,
    'date_filed',
  );

  const [dataResult, countResult] = await Promise.all([
    conn.runAndReadAll(pq.sql, pq.params),
    conn.runAndReadAll(pq.countSql, pq.countParams),
  ]);

  const data: SatelliteFiling[] = dataResult.getRowObjectsJS().map((row) => ({
    filingKey: Number(row.filing_key),
    fileNumber: String(row.file_number),
    subsystemCode: String(row.subsystem_code),
    appTypeCode: String(row.app_type_code ?? ''),
    statusCode: row.status_code != null ? String(row.status_code) : null,
    dateFiled: row.date_filed != null ? String(row.date_filed) : null,
    dateGrant: row.date_grant != null ? String(row.date_grant) : null,
    addressAttention:
      row.address_attention != null ? String(row.address_attention) : null,
    callsign: row.callsign != null ? String(row.callsign) : null,
    description: row.description != null ? String(row.description) : null,
    summary: row.summary != null ? String(row.summary) : null,
  }));

  const totalRows: number = Number(countResult.getRowObjectsJS()[0]!.total);
  return buildPaginatedResponse(data, totalRows, request);
}

/**
 * Compute quick stats for a satellite: total filing count,
 * most recent filing date, and distinct applicant count.
 */
export async function getSatelliteStats(
  conn: DuckDBConnection,
  usName: string,
): Promise<SatelliteStats> {
  const result = await conn.runAndReadAll(
    `SELECT
       COUNT(*) AS total_filings,
       MAX(date_filed) AS most_recent_filing_date,
       COUNT(DISTINCT address_attention) AS distinct_applicant_count
     FROM filing
     WHERE callsign = $1`,
    [usName] as DuckDBValue[],
  );

  const row = result.getRowObjectsJS()[0]!;
  return {
    totalFilings: Number(row.total_filings),
    mostRecentFilingDate:
      row.most_recent_filing_date != null
        ? String(row.most_recent_filing_date)
        : null,
    distinctApplicantCount: Number(row.distinct_applicant_count),
  };
}
