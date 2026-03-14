import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { IcfsFilingDetail, IcfsServiceType } from './types.ts';

/** Parse subsystem code from a file number like "SAT-LOA-20250221-00050" */
export function parseSubsystem(fileNumber: string): string {
  return fileNumber.split('-')[0] ?? '';
}

/** Parse app type code from a file number like "SAT-LOA-20250221-00050" or "SAT-T/C-20250917-00287" */
export function parseAppType(fileNumber: string): string {
  const parts: string[] = fileNumber.split('-');
  if (parts.length < 2) return '';
  // Handle "T/C" — the app type is parts[1], but for file numbers like
  // SAT-T/C-20250917-00287 it's straightforward
  return parts[1] ?? '';
}

/**
 * Parse the legacy filing key from the ICFS display value.
 * ICFS formats it with commas like "-520,666" or "-1,499,997,387".
 * Returns null if empty or non-numeric after stripping commas.
 */
export function parseLegacyFilingKey(raw: string): number | null {
  const stripped: string = raw.replace(/,/g, '').trim();
  if (stripped === '') return null;
  const num: number = Number(stripped);
  return Number.isFinite(num) ? num : null;
}

/** Serialize active service types as a JSON string */
function serializeServiceTypes(types: IcfsServiceType[]): string {
  const active: Array<{ fieldName: string; label: string }> = types
    .filter((t) => t.value !== '')
    .map((t) => ({ fieldName: t.fieldName, label: t.label }));
  return JSON.stringify(active);
}

/**
 * Upsert a parsed ICFS filing into the DuckDB filing table.
 *
 * If the file_number already exists, updates ICFS-sourced columns
 * while preserving existing IBFS-sourced data. If not, inserts a
 * new row with a filing_key derived from the legacy_filing_key or
 * a synthetic negative key based on a hash of the file number.
 */
export async function upsertIcfsFiling(
  conn: DuckDBConnection,
  detail: IcfsFilingDetail,
): Promise<void> {
  if (!detail.found || detail.summary == null) return;

  const s = detail.summary;
  const fileNumber: string = s.fileNumber;

  // Check if filing already exists
  const existing = await conn.runAndReadAll(
    `SELECT filing_key FROM filing WHERE file_number = $1`,
    [fileNumber] as DuckDBValue[],
  );
  const existingRows = existing.getRowObjectsJS();

  let filingKey: number;
  if (existingRows.length > 0) {
    filingKey = Number(existingRows[0]!.filing_key);
  } else {
    const legacyKey: number | null = parseLegacyFilingKey(s.legacyFilingKey);
    filingKey = legacyKey ?? generateSyntheticKey(fileNumber);
  }

  const subsystemCode: string = parseSubsystem(fileNumber);
  const appTypeCode: string = parseAppType(fileNumber);
  const serviceTypesJson: string = serializeServiceTypes(detail.serviceTypes);

  const tp = detail.transferParties;

  if (existingRows.length > 0) {
    // Update existing row with ICFS data
    await conn.run(
      `UPDATE filing SET
        icfs_sys_id = $1,
        callsign = $2,
        status_code = $3,
        status_date = $4,
        last_action = $5,
        last_action_date = $6,
        date_filed = $7,
        date_grant = $8,
        date_begin = $9,
        date_expire = $10,
        aff_pub_notice_date = $11,
        act_pub_notice_date = $12,
        description = $13,
        address_attention = $14,
        contact_attention = $15,
        applicant_frn = $16,
        applicant_street = $17,
        applicant_city = $18,
        applicant_state = $19,
        applicant_zip_code = $20,
        applicant_country = $21,
        contact_street = $22,
        contact_city = $23,
        contact_state = $24,
        contact_zip_code = $25,
        contact_country = $26,
        da_number = $27,
        red_light_status = $28,
        streamlined = $29,
        environmental_impact = $30,
        nature_of_service = $31,
        brief_description = $32,
        transferor_name = $33,
        transferor_street = $34,
        transferor_city = $35,
        transferor_zip_code = $36,
        transferee_name = $37,
        transferee_street = $38,
        transferee_city = $39,
        transferee_zip_code = $40,
        icfs_service_types = $41,
        icfs_last_fetched_at = current_timestamp
      WHERE file_number = $42`,
      [
        s.sysId,
        s.callSign,
        s.status,
        s.statusDate || null,
        s.lastAction,
        s.lastActionDate || null,
        s.submissionDate || null,
        s.grantDate || null,
        s.beginDate || null,
        s.expirationDate || null,
        s.afpnDate || null,
        s.actionPnDate || null,
        s.briefDescription,
        s.applicantName,
        s.contactName,
        s.applicantFrn,
        s.applicantStreet,
        s.applicantCity,
        s.applicantState,
        s.applicantZipCode,
        s.applicantCountry,
        s.contactStreet,
        s.contactCity,
        s.contactState,
        s.contactZipCode,
        s.contactCountry,
        s.daNumber,
        s.redLightStatus,
        s.streamlined,
        s.environmentalImpact,
        s.natureOfService,
        s.briefDescription,
        tp?.transferorName ?? null,
        tp?.transferorStreet ?? null,
        tp?.transferorCity ?? null,
        tp?.transferorZipCode ?? null,
        tp?.transfereeName ?? null,
        tp?.transfereeStreet ?? null,
        tp?.transfereeCity ?? null,
        tp?.transfereeZipCode ?? null,
        serviceTypesJson,
        fileNumber,
      ] as DuckDBValue[],
    );
  } else {
    // Insert new row
    await conn.run(
      `INSERT INTO filing (
        filing_key, file_number, subsystem_code, app_type_code,
        icfs_sys_id, callsign, status_code, status_date,
        last_action, last_action_date, date_filed, date_grant,
        date_begin, date_expire, aff_pub_notice_date, act_pub_notice_date,
        description, address_attention, contact_attention,
        applicant_frn, applicant_street, applicant_city, applicant_state,
        applicant_zip_code, applicant_country,
        contact_street, contact_city, contact_state,
        contact_zip_code, contact_country,
        da_number, red_light_status, streamlined, environmental_impact,
        nature_of_service, brief_description,
        transferor_name, transferor_street, transferor_city, transferor_zip_code,
        transferee_name, transferee_street, transferee_city, transferee_zip_code,
        icfs_service_types, icfs_last_fetched_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19,
        $20, $21, $22, $23,
        $24, $25,
        $26, $27, $28,
        $29, $30,
        $31, $32, $33, $34,
        $35, $36,
        $37, $38, $39, $40,
        $41, $42, $43, $44,
        $45, current_timestamp
      )`,
      [
        filingKey, fileNumber, subsystemCode, appTypeCode,
        s.sysId, s.callSign, s.status, s.statusDate || null,
        s.lastAction, s.lastActionDate || null, s.submissionDate || null, s.grantDate || null,
        s.beginDate || null, s.expirationDate || null, s.afpnDate || null, s.actionPnDate || null,
        s.briefDescription, s.applicantName, s.contactName,
        s.applicantFrn, s.applicantStreet, s.applicantCity, s.applicantState,
        s.applicantZipCode, s.applicantCountry,
        s.contactStreet, s.contactCity, s.contactState,
        s.contactZipCode, s.contactCountry,
        s.daNumber, s.redLightStatus, s.streamlined, s.environmentalImpact,
        s.natureOfService, s.briefDescription,
        tp?.transferorName ?? null, tp?.transferorStreet ?? null, tp?.transferorCity ?? null, tp?.transferorZipCode ?? null,
        tp?.transfereeName ?? null, tp?.transfereeStreet ?? null, tp?.transfereeCity ?? null, tp?.transfereeZipCode ?? null,
        serviceTypesJson,
      ] as DuckDBValue[],
    );
  }
}

/**
 * Generate a deterministic synthetic filing key from a file number.
 * Uses a simple hash to produce a negative integer (to avoid collisions
 * with positive IBFS legacy keys).
 */
function generateSyntheticKey(fileNumber: string): number {
  let hash: number = 0;
  for (let i: number = 0; i < fileNumber.length; i++) {
    const char: number = fileNumber.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Ensure negative and non-zero
  return hash > 0 ? -hash : hash === 0 ? -1 : hash;
}
