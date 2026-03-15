import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import {
  buildPaginatedQuery,
  buildPaginatedResponse,
  type PaginatedRequest,
  type PaginatedResponse,
} from '../lib/pagination.ts';
import type {
  AntennaFrequency,
  EarthStationAntenna,
  EarthStationFiling,
  EarthStationInfo,
  EarthStationStats,
} from './types.ts';

/**
 * Get summary info for an earth station by callsign.
 * Aggregates from the most recent SES filing with that callsign.
 * Returns null if no filings match.
 */
export async function getEarthStationByCallsign(
  conn: DuckDBConnection,
  callsign: string,
): Promise<EarthStationInfo | null> {
  const reader = await conn.runAndReadAll(
    `SELECT
       callsign,
       address_attention AS applicant_name,
       applicant_city,
       applicant_state,
       applicant_country,
       file_number,
       date_filed,
       status_code
     FROM filing
     WHERE callsign = $1 AND subsystem_code = 'SES'
     ORDER BY date_filed DESC NULLS LAST
     LIMIT 1`,
    [callsign] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;

  const r = rows[0]!;
  return {
    callsign: String(r.callsign),
    applicantName: r.applicant_name != null ? String(r.applicant_name) : null,
    applicantCity: r.applicant_city != null ? String(r.applicant_city) : null,
    applicantState:
      r.applicant_state != null ? String(r.applicant_state) : null,
    applicantCountry:
      r.applicant_country != null ? String(r.applicant_country) : null,
    mostRecentFileNumber: String(r.file_number),
    mostRecentDateFiled: r.date_filed != null ? String(r.date_filed) : null,
    mostRecentStatus: r.status_code != null ? String(r.status_code) : null,
  };
}

/** Columns allowed for sorting earth station filings */
const FILING_SORT_COLUMNS: ReadonlySet<string> = new Set([
  'file_number',
  'app_type_code',
  'status_code',
  'date_filed',
  'date_grant',
  'date_expire',
]);

/**
 * Get paginated filings for an earth station callsign (SES subsystem only).
 */
export async function getEarthStationFilings(
  conn: DuckDBConnection,
  callsign: string,
  request: PaginatedRequest,
): Promise<PaginatedResponse<EarthStationFiling>> {
  const baseSql: string = `
    SELECT
      filing_key,
      file_number,
      app_type_code,
      status_code,
      date_filed,
      date_grant,
      date_expire,
      description
    FROM filing
    WHERE callsign = $1 AND subsystem_code = 'SES'`;

  const baseParams: DuckDBValue[] = [callsign] as DuckDBValue[];

  const { sql, params, countSql, countParams } = buildPaginatedQuery(
    baseSql,
    baseParams,
    request,
    FILING_SORT_COLUMNS,
    'date_filed',
  );

  const [dataReader, countReader] = await Promise.all([
    conn.runAndReadAll(sql, params),
    conn.runAndReadAll(countSql, countParams),
  ]);

  const filings: EarthStationFiling[] = dataReader
    .getRowObjectsJS()
    .map((r) => ({
      filingKey: Number(r.filing_key),
      fileNumber: String(r.file_number),
      appTypeCode: String(r.app_type_code),
      statusCode: r.status_code != null ? String(r.status_code) : null,
      dateFiled: r.date_filed != null ? String(r.date_filed) : null,
      dateGrant: r.date_grant != null ? String(r.date_grant) : null,
      dateExpire: r.date_expire != null ? String(r.date_expire) : null,
      description: r.description != null ? String(r.description) : null,
    }));

  const totalRows: number = Number(countReader.getRowObjectsJS()[0]!.total);

  return buildPaginatedResponse(filings, totalRows, request);
}

/**
 * Get all antennas (with nested frequencies) for an earth station callsign.
 * Joins: filing -> site -> antenna -> frequency, filtered to SES subsystem.
 */
export async function getEarthStationAntennas(
  conn: DuckDBConnection,
  callsign: string,
): Promise<EarthStationAntenna[]> {
  // First get all antennas
  const antennaReader = await conn.runAndReadAll(
    `SELECT DISTINCT
       a.antenna_key,
       a.antenna_id,
       a.site_key,
       a.diameter,
       a.manufacturer,
       a.model,
       a.max_input_power,
       a.max_output_eirp
     FROM filing f
     JOIN site s ON s.filing_key = f.filing_key
     JOIN antenna a ON a.site_key = s.site_key
     WHERE f.callsign = $1 AND f.subsystem_code = 'SES'
     ORDER BY a.antenna_key`,
    [callsign] as DuckDBValue[],
  );

  const antennaRows = antennaReader.getRowObjectsJS();
  if (antennaRows.length === 0) return [];

  // Collect antenna keys for batch frequency lookup
  const antennaKeys: number[] = antennaRows.map((r) => Number(r.antenna_key));
  const placeholders: string = antennaKeys
    .map((_, i) => `$${String(i + 1)}`)
    .join(', ');

  const freqReader = await conn.runAndReadAll(
    `SELECT
       frequency_key,
       antenna_key,
       polarization_code,
       eirp,
       eirp_density,
       emission,
       frequency_lower,
       frequency_upper,
       trans_mode,
       modulation
     FROM frequency
     WHERE antenna_key IN (${placeholders})
     ORDER BY antenna_key, frequency_key`,
    antennaKeys as DuckDBValue[],
  );

  // Group frequencies by antenna_key
  const freqByAntenna: Map<number, AntennaFrequency[]> = new Map();
  for (const r of freqReader.getRowObjectsJS()) {
    const ak: number = Number(r.antenna_key);
    const freq: AntennaFrequency = {
      frequencyKey: Number(r.frequency_key),
      polarizationCode:
        r.polarization_code != null ? String(r.polarization_code) : null,
      eirp: r.eirp != null ? Number(r.eirp) : null,
      eirpDensity: r.eirp_density != null ? Number(r.eirp_density) : null,
      emission: r.emission != null ? String(r.emission) : null,
      frequencyLower:
        r.frequency_lower != null ? String(r.frequency_lower) : null,
      frequencyUpper:
        r.frequency_upper != null ? String(r.frequency_upper) : null,
      transMode: r.trans_mode != null ? String(r.trans_mode) : null,
      modulation: r.modulation != null ? String(r.modulation) : null,
    };
    const existing: AntennaFrequency[] = freqByAntenna.get(ak) ?? [];
    existing.push(freq);
    freqByAntenna.set(ak, existing);
  }

  return antennaRows.map((r) => ({
    antennaKey: Number(r.antenna_key),
    antennaId: String(r.antenna_id),
    siteKey: Number(r.site_key),
    diameter: r.diameter != null ? Number(r.diameter) : null,
    manufacturer: r.manufacturer != null ? String(r.manufacturer) : null,
    model: r.model != null ? String(r.model) : null,
    maxInputPower: r.max_input_power != null ? Number(r.max_input_power) : null,
    maxOutputEirp: r.max_output_eirp != null ? Number(r.max_output_eirp) : null,
    frequencies: freqByAntenna.get(Number(r.antenna_key)) ?? [],
  }));
}

/**
 * Get quick stats for an earth station callsign.
 */
export async function getEarthStationStats(
  conn: DuckDBConnection,
  callsign: string,
): Promise<EarthStationStats> {
  const statsReader = await conn.runAndReadAll(
    `SELECT
       COUNT(*) AS total_filing_count,
       MAX(date_filed) AS most_recent_filing_date
     FROM filing
     WHERE callsign = $1 AND subsystem_code = 'SES'`,
    [callsign] as DuckDBValue[],
  );
  const statsRow = statsReader.getRowObjectsJS()[0]!;

  const antennaReader = await conn.runAndReadAll(
    `SELECT COUNT(DISTINCT a.antenna_key) AS antenna_count
     FROM filing f
     JOIN site s ON s.filing_key = f.filing_key
     JOIN antenna a ON a.site_key = s.site_key
     WHERE f.callsign = $1 AND f.subsystem_code = 'SES'`,
    [callsign] as DuckDBValue[],
  );
  const antennaRow = antennaReader.getRowObjectsJS()[0]!;

  return {
    totalFilingCount: Number(statsRow.total_filing_count),
    mostRecentFilingDate:
      statsRow.most_recent_filing_date != null
        ? String(statsRow.most_recent_filing_date)
        : null,
    antennaCount: Number(antennaRow.antenna_count),
  };
}
