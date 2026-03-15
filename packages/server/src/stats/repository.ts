import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type {
  ApplicantFiling,
  ApplicantNode,
  AttachmentStats,
  DatasetStats,
  YearlyFilingVolume,
  SubsystemCount,
} from './types.ts';

export async function getFilingCount(conn: DuckDBConnection): Promise<number> {
  const result = await conn.runAndReadAll(
    'SELECT count(*)::INTEGER AS cnt FROM filing',
  );
  const rows = result.getRowObjectsJS();
  return Number(rows[0]?.cnt ?? 0);
}

export async function getFilingsBySubsystem(
  conn: DuckDBConnection,
): Promise<SubsystemCount[]> {
  const result = await conn.runAndReadAll(
    `SELECT subsystem_code, count(*)::INTEGER AS count
     FROM filing
     GROUP BY subsystem_code
     ORDER BY count DESC, subsystem_code ASC`,
  );
  return result.getRowObjectsJS().map((r) => ({
    subsystem_code: String(r.subsystem_code),
    count: Number(r.count),
  }));
}

export async function getAttachmentStats(
  conn: DuckDBConnection,
): Promise<AttachmentStats> {
  const result = await conn.runAndReadAll(
    `SELECT
       count(*)::INTEGER AS total,
       count(*) FILTER (WHERE download_status = 'downloaded')::INTEGER AS downloaded,
       count(*) FILTER (WHERE download_status = 'pending')::INTEGER AS pending,
       count(*) FILTER (WHERE download_status = 'failed')::INTEGER AS failed,
       coalesce(sum(file_size_bytes) FILTER (WHERE download_status = 'downloaded'), 0)::BIGINT AS total_bytes
     FROM attachment`,
  );
  const row = result.getRowObjectsJS()[0]!;
  return {
    total: Number(row.total),
    downloaded: Number(row.downloaded),
    pending: Number(row.pending),
    failed: Number(row.failed),
    total_bytes: Number(row.total_bytes),
  };
}

export async function getDbSizeBytes(dbPath: string): Promise<number> {
  try {
    const { statSync } = await import('node:fs');
    return statSync(dbPath).size;
  } catch {
    return 0;
  }
}

export async function getDatasetStats(
  conn: DuckDBConnection,
  dbPath: string,
): Promise<DatasetStats> {
  const [filing_count, filings_by_subsystem, attachment_stats, db_size_bytes] =
    await Promise.all([
      getFilingCount(conn),
      getFilingsBySubsystem(conn),
      getAttachmentStats(conn),
      getDbSizeBytes(dbPath),
    ]);
  return {
    filing_count,
    filings_by_subsystem,
    attachment_stats,
    db_size_bytes,
  };
}

export async function getTopApplicants(
  conn: DuckDBConnection,
  limit: number = 20,
): Promise<ApplicantNode[]> {
  const result = await conn.runAndReadAll(
    `SELECT
       address_attention AS name,
       count(*)::INTEGER AS filing_count
     FROM filing
     WHERE address_attention IS NOT NULL AND address_attention != ''
     GROUP BY address_attention
     ORDER BY filing_count DESC, name ASC
     LIMIT $1`,
    [limit] as DuckDBValue[],
  );
  return result.getRowObjectsJS().map((r, i: number) => ({
    id: `applicant-${String(i)}`,
    name: String(r.name),
    filing_count: Number(r.filing_count),
  }));
}

export async function getApplicantFilings(
  conn: DuckDBConnection,
  applicantNames: string[],
): Promise<ApplicantFiling[]> {
  if (applicantNames.length === 0) return [];
  const placeholders: string = applicantNames
    .map((_: string, i: number) => `$${String(i + 1)}`)
    .join(', ');
  const result = await conn.runAndReadAll(
    `SELECT
       address_attention AS applicant_name,
       file_number,
       subsystem_code,
       app_type_code,
       date_filed::VARCHAR AS date_filed,
       status_code
     FROM filing
     WHERE address_attention IN (${placeholders})
     ORDER BY date_filed DESC`,
    applicantNames as DuckDBValue[],
  );
  return result.getRowObjectsJS().map((r) => ({
    applicant_name: String(r.applicant_name),
    file_number: String(r.file_number),
    subsystem_code: String(r.subsystem_code),
    app_type_code: String(r.app_type_code),
    date_filed: r.date_filed != null ? String(r.date_filed) : null,
    status_code: r.status_code != null ? String(r.status_code) : null,
  }));
}

export async function getYearlyFilingVolume(
  conn: DuckDBConnection,
): Promise<YearlyFilingVolume[]> {
  const result = await conn.runAndReadAll(
    `SELECT
       strftime(date_trunc('year', date_filed), '%Y') AS year,
       subsystem_code,
       count(*)::INTEGER AS count
     FROM filing
     WHERE date_filed IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 1, 2`,
  );
  return result.getRowObjectsJS().map((r) => ({
    year: String(r.year),
    subsystem_code: String(r.subsystem_code),
    count: Number(r.count),
  }));
}
