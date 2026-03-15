import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type {
  DataSource,
  FilingAttachment,
  FilingDetail,
  FilingPetition,
  RelatedSpaceStation,
} from './types.ts';
import { synthesizeTimeline } from './timeline.ts';

/**
 * Fetch a single filing by file number, enriched with lookup labels,
 * attachments, petitions, and related entity links.
 *
 * Returns null if no filing matches the given file number.
 */
export async function getFilingByFileNumber(
  conn: DuckDBConnection,
  fileNumber: string,
): Promise<FilingDetail | null> {
  const filingResult = await conn.runAndReadAll(
    `SELECT
       f.filing_key,
       f.file_number,
       f.subsystem_code,
       f.app_type_code,
       f.status_code,
       f.callsign,
       f.address_attention,
       f.applicant_frn,
       f.date_filed,
       f.date_signed,
       f.date_grant,
       f.date_begin,
       f.date_expire,
       f.last_action,
       f.last_action_date,
       f.brief_description,
       f.description,
       f.da_number,
       f.red_light_status,
       f.streamlined,
       f.environmental_impact,
       f.nature_of_service,
       f.transferor_name,
       f.transferee_name,
       f.icfs_last_fetched_at,
       f.company_id,
       co.name AS company_name,
       sc.status_text,
       sub.description AS subsystem_label,
       atc.application_type AS app_type_label
     FROM filing f
     LEFT JOIN status_code sc ON sc.status_code = f.status_code
     LEFT JOIN subsystem_code sub ON sub.subsystem_code = f.subsystem_code
     LEFT JOIN app_type_code atc ON atc.app_type_code = f.app_type_code
     LEFT JOIN company co ON co.id = f.company_id
     WHERE f.file_number = $1`,
    [fileNumber] as DuckDBValue[],
  );

  const filingRows = filingResult.getRowObjectsJS();
  if (filingRows.length === 0) return null;

  const row = filingRows[0]!;
  const filingKey: number = Number(row.filing_key);
  const subsystemCode: string = String(row.subsystem_code ?? '');

  const callsign: string | null =
    row.callsign != null ? String(row.callsign).trim() : null;

  const attachments: FilingAttachment[] = await fetchAttachments(
    conn,
    filingKey,
  );
  const petitions: FilingPetition[] = await fetchPetitions(conn, filingKey);

  let relatedSpaceStation: RelatedSpaceStation | null = null;
  if (subsystemCode === 'SAT' && callsign != null && callsign !== '') {
    relatedSpaceStation = await fetchSpaceStationByCallsign(conn, callsign);
  }

  const relatedEarthStationCallsign: string | null =
    subsystemCode === 'SES' && callsign != null && callsign !== ''
      ? callsign
      : null;

  const dataSource: DataSource =
    row.icfs_last_fetched_at != null ? 'icfs' : 'ibfs-legacy';

  const dateFiled: string | null =
    row.date_filed != null ? String(row.date_filed) : null;
  const dateSigned: string | null =
    row.date_signed != null ? String(row.date_signed) : null;
  const dateGrant: string | null =
    row.date_grant != null ? String(row.date_grant) : null;
  const dateBegin: string | null =
    row.date_begin != null ? String(row.date_begin) : null;
  const dateExpire: string | null =
    row.date_expire != null ? String(row.date_expire) : null;
  const lastActionDate: string | null =
    row.last_action_date != null ? String(row.last_action_date) : null;

  const timeline = synthesizeTimeline(
    { dateFiled, dateSigned, dateGrant, dateBegin, dateExpire, lastActionDate },
    petitions,
  );

  return {
    dataSource,
    filingKey,
    fileNumber: String(row.file_number),
    subsystemCode,
    subsystemLabel:
      row.subsystem_label != null ? String(row.subsystem_label) : null,
    appTypeCode: String(row.app_type_code ?? ''),
    appTypeLabel:
      row.app_type_label != null ? String(row.app_type_label) : null,
    statusCode: row.status_code != null ? String(row.status_code) : null,
    statusText: row.status_text != null ? String(row.status_text) : null,
    callsign,
    applicantName:
      row.address_attention != null ? String(row.address_attention) : null,
    applicantFrn: row.applicant_frn != null ? String(row.applicant_frn) : null,
    dateFiled,
    dateSigned,
    dateGrant,
    dateBegin,
    dateExpire,
    lastAction: row.last_action != null ? String(row.last_action) : null,
    lastActionDate,
    briefDescription:
      row.brief_description != null ? String(row.brief_description) : null,
    description: row.description != null ? String(row.description) : null,
    daNumber: row.da_number != null ? String(row.da_number) : null,
    redLightStatus:
      row.red_light_status != null ? String(row.red_light_status) : null,
    streamlined: row.streamlined != null ? String(row.streamlined) : null,
    environmentalImpact:
      row.environmental_impact != null
        ? String(row.environmental_impact)
        : null,
    natureOfService:
      row.nature_of_service != null ? String(row.nature_of_service) : null,
    transferorName:
      row.transferor_name != null ? String(row.transferor_name) : null,
    transfereeName:
      row.transferee_name != null ? String(row.transferee_name) : null,
    companyId: row.company_id != null ? Number(row.company_id) : null,
    companyName: row.company_name != null ? String(row.company_name) : null,
    attachments,
    petitions,
    timeline,
    relatedSpaceStation,
    relatedEarthStationCallsign,
  };
}

/** Fetch all attachments for a given filing key */
async function fetchAttachments(
  conn: DuckDBConnection,
  filingKey: number,
): Promise<FilingAttachment[]> {
  const result = await conn.runAndReadAll(
    `SELECT attachment_key, attachment_name, description, source,
            download_url, download_status, content_type, file_size_bytes
     FROM attachment
     WHERE filing_key = $1
     ORDER BY attachment_key`,
    [filingKey] as DuckDBValue[],
  );

  return result.getRowObjectsJS().map((r) => ({
    attachmentKey: Number(r.attachment_key),
    attachmentName: String(r.attachment_name),
    description: String(r.description ?? ''),
    source: String(r.source ?? 'attachment'),
    downloadUrl: String(r.download_url),
    downloadStatus: String(r.download_status),
    contentType: r.content_type != null ? String(r.content_type) : null,
    fileSizeBytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
  }));
}

/** Fetch all petitions/comments for a given filing key from the pleading table */
async function fetchPetitions(
  conn: DuckDBConnection,
  filingKey: number,
): Promise<FilingPetition[]> {
  const result = await conn.runAndReadAll(
    `SELECT filing_key, filer_name, created_on, pleading_type, pleading_number
     FROM pleading
     WHERE filing_key = $1
     ORDER BY created_on`,
    [filingKey] as DuckDBValue[],
  );

  return result.getRowObjectsJS().map((r) => ({
    filingKey: Number(r.filing_key),
    partyName: r.filer_name != null ? String(r.filer_name) : null,
    dateFiled: r.created_on != null ? String(r.created_on) : null,
    description: null,
    pleadingType: r.pleading_type != null ? String(r.pleading_type) : null,
    pleadingNumber:
      r.pleading_number != null ? String(r.pleading_number) : null,
  }));
}

/** Fetch a space station by callsign (matches us_name) */
async function fetchSpaceStationByCallsign(
  conn: DuckDBConnection,
  callsign: string,
): Promise<RelatedSpaceStation | null> {
  const result = await conn.runAndReadAll(
    `SELECT space_station_key, us_name, itu_name, orbit_location
     FROM space_station
     WHERE us_name = $1
     LIMIT 1`,
    [callsign] as DuckDBValue[],
  );

  const rows = result.getRowObjectsJS();
  if (rows.length === 0) return null;

  const r = rows[0]!;
  return {
    spaceStationKey: Number(r.space_station_key),
    usName: String(r.us_name),
    ituName: r.itu_name != null ? String(r.itu_name) : null,
    orbitLocation: r.orbit_location != null ? String(r.orbit_location) : null,
  };
}
