import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { AttachmentMetadata } from '../attachments/types.ts';
import { attributeFiling } from '../companies/attribution.ts';
import type { FileNumber } from '../lib/file-number.ts';
import type {
  IcfsAttachment,
  IcfsFilingDetail,
  IcfsPleading,
  IcfsServiceType,
} from './types.ts';

export type PleadingRow = {
  pleadingKey: number;
  filingKey: number;
  fileNumber: FileNumber;
  icfsSysId: string;
  pleadingNumber: string;
  pleadingType: string;
  filerName: string;
  createdOn: string | null;
  exhibitAttachmentHtml: string | null;
};

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
        filingKey,
        fileNumber,
        subsystemCode,
        appTypeCode,
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
      ] as DuckDBValue[],
    );
  }

  // Attempt to attribute the filing to a company
  const companyId: number | null = await attributeFiling(
    conn,
    s.applicantName,
    s.applicantFrn,
  );
  if (companyId != null) {
    await conn.run(`UPDATE filing SET company_id = $1 WHERE file_number = $2`, [
      companyId,
      fileNumber,
    ] as DuckDBValue[]);
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

/** Deterministic hash of ICFS sysId + link index to a positive 32-bit int for attachment_key. */
export function sysIdToInt(sysId: string, suffix: number): number {
  let hash: number = 2166136261;
  const input: string = `${sysId}:${String(suffix)}`;
  for (let i: number = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const CREATE_PLEADING_TABLE_SQL: string = `
  CREATE TABLE IF NOT EXISTS pleading (
    pleading_key INTEGER NOT NULL,
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    icfs_sys_id VARCHAR NOT NULL,
    pleading_number VARCHAR NOT NULL,
    pleading_type VARCHAR NOT NULL,
    filer_name VARCHAR NOT NULL,
    created_on TIMESTAMP,
    exhibit_attachment_html VARCHAR,
    ingested_at TIMESTAMP NOT NULL DEFAULT current_timestamp
  )
`;

export async function createPleadingTable(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(CREATE_PLEADING_TABLE_SQL);
}

/** Map ICFS pleadings to DB rows using sysIdToInt for deterministic keys. */
export function icfsPleadingsToRows(
  pleadings: IcfsPleading[],
  filingKey: number,
  fileNumber: FileNumber,
): PleadingRow[] {
  return pleadings.map(
    (p: IcfsPleading): PleadingRow => ({
      pleadingKey: sysIdToInt(p.sysId, 0),
      filingKey,
      fileNumber,
      icfsSysId: p.sysId,
      pleadingNumber: p.number,
      pleadingType: p.pleadingType,
      filerName: p.filerName,
      createdOn: p.createdOn || null,
      exhibitAttachmentHtml: p.exhibitAttachmentHtml || null,
    }),
  );
}

/** Insert pleading rows if they don't already exist (keyed by pleading_key). */
export async function upsertPleadings(
  conn: DuckDBConnection,
  rows: PleadingRow[],
): Promise<{ inserted: number; existing: number }> {
  let inserted: number = 0;
  let existing: number = 0;

  for (const row of rows) {
    const check = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM pleading WHERE pleading_key = $1`,
      [row.pleadingKey] as DuckDBValue[],
    );
    const exists: boolean = Number(check.getRowObjectsJS()[0]!.cnt) > 0;

    if (exists) {
      existing++;
    } else {
      await conn.run(
        `INSERT INTO pleading
          (pleading_key, filing_key, file_number, icfs_sys_id,
           pleading_number, pleading_type, filer_name, created_on,
           exhibit_attachment_html)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          row.pleadingKey,
          row.filingKey,
          row.fileNumber,
          row.icfsSysId,
          row.pleadingNumber,
          row.pleadingType,
          row.filerName,
          row.createdOn,
          row.exhibitAttachmentHtml,
        ] as DuckDBValue[],
      );
      inserted++;
    }
  }

  return { inserted, existing };
}

/** Convert ICFS attachments to AttachmentMetadata rows (one per download link). */
export function icfsAttachmentsToMetadata(
  attachments: IcfsAttachment[],
  filingKey: number,
  fileNumber: FileNumber,
): AttachmentMetadata[] {
  const result: AttachmentMetadata[] = [];
  for (const att of attachments) {
    for (let i: number = 0; i < att.links.length; i++) {
      const link: { displayValue: string; url: string } = att.links[i]!;
      result.push({
        attachmentKey: sysIdToInt(att.sysId, i),
        filingKey,
        fileNumber,
        source: 'attachment',
        attachmentName: att.documentName,
        description: link.displayValue,
        downloadUrl: link.url,
      });
    }
  }
  return result;
}

/**
 * One-time migration: copy the 24 legacy `petition_to_deny` rows into the
 * `pleading` table with synthetic values. Idempotent — skips if rows
 * already migrated. After this runs, `petition_to_deny` is no longer queried.
 */
export async function migrateLegacyPetitions(
  conn: DuckDBConnection,
): Promise<number> {
  // Check if petition_to_deny table exists
  const tableCheck = await conn.runAndReadAll(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables
     WHERE table_name = 'petition_to_deny'`,
  );
  if (Number(tableCheck.getRowObjectsJS()[0]!.cnt) === 0) return 0;

  // Migrate rows not yet in pleading
  const rows = await conn.runAndReadAll(
    `SELECT filing_key, filed_by, CAST(date_filed AS VARCHAR) AS date_filed, description
     FROM petition_to_deny`,
  );
  const legacyRows = rows.getRowObjectsJS();

  let migrated: number = 0;
  for (const r of legacyRows) {
    const filingKey: number = Number(r.filing_key);
    const filedBy: string = r.filed_by != null ? String(r.filed_by) : '';
    const dateFiled: string | null =
      r.date_filed != null ? String(r.date_filed) : null;

    // Deterministic key from filing_key + filed_by + date_filed
    const keyInput: string = `${String(filingKey)}:${filedBy}:${dateFiled ?? ''}`;
    const pleadingKey: number = sysIdToInt(keyInput, 0);

    const check = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM pleading WHERE pleading_key = $1`,
      [pleadingKey] as DuckDBValue[],
    );
    if (Number(check.getRowObjectsJS()[0]!.cnt) > 0) continue;

    // Look up file_number from filing table
    const fnResult = await conn.runAndReadAll(
      `SELECT file_number FROM filing WHERE filing_key = $1`,
      [filingKey] as DuckDBValue[],
    );
    const fnRows = fnResult.getRowObjectsJS();
    const fileNumber: string =
      fnRows.length > 0 ? String(fnRows[0]!.file_number) : '';

    await conn.run(
      `INSERT INTO pleading
        (pleading_key, filing_key, file_number, icfs_sys_id,
         pleading_number, pleading_type, filer_name, created_on,
         exhibit_attachment_html)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        pleadingKey,
        filingKey,
        fileNumber,
        'ibfs-legacy',
        '',
        'PETITION',
        filedBy,
        dateFiled,
        null,
      ] as DuckDBValue[],
    );
    migrated++;
  }

  return migrated;
}
