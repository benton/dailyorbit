import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type {
  ApplicantFiling,
  ApplicantNode,
  AttachmentStats,
  CompanyFilingVolume,
  DailyFilingCount,
  DatasetStats,
  RecentFiling,
  TopLineStats,
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

export async function getCommentCount(conn: DuckDBConnection): Promise<number> {
  const result = await conn.runAndReadAll(
    'SELECT count(*)::INTEGER AS cnt FROM pleading',
  );
  const rows = result.getRowObjectsJS();
  return Number(rows[0]?.cnt ?? 0);
}

export async function getAttachmentCount(
  conn: DuckDBConnection,
): Promise<number> {
  const result = await conn.runAndReadAll(
    'SELECT count(*)::INTEGER AS cnt FROM attachment',
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
       AND date_filed >= '1970-01-01'
       AND date_filed <= CURRENT_DATE
     GROUP BY 1, 2
     ORDER BY 1, 2`,
  );
  return result.getRowObjectsJS().map((r) => ({
    year: String(r.year),
    subsystem_code: String(r.subsystem_code),
    count: Number(r.count),
  }));
}

export async function getRecentFilings(
  conn: DuckDBConnection,
  targetDate: string,
): Promise<RecentFiling[]> {
  const result = await conn.runAndReadAll(
    `SELECT f.file_number, f.callsign, f.address_attention,
            f.subsystem_code, f.app_type_code, f.status_code,
            f.date_filed::VARCHAR AS date_filed,
            c.name AS company_name,
            (SELECT a.summary FROM attachment a
             WHERE a.filing_key = f.filing_key
             ORDER BY CASE WHEN a.attachment_name = 'Attachment Application' THEN 0 ELSE 1 END,
                      a.attachment_key
             LIMIT 1) AS summary
     FROM filing f
     LEFT JOIN company c ON c.id = f.company_id
     WHERE f.date_filed::DATE = $1::DATE
     ORDER BY f.file_number ASC`,
    [targetDate] as DuckDBValue[],
  );
  return result.getRowObjectsJS().map((r) => ({
    file_number: String(r.file_number),
    callsign: r.callsign != null ? String(r.callsign) : null,
    address_attention:
      r.address_attention != null ? String(r.address_attention) : null,
    subsystem_code: String(r.subsystem_code),
    app_type_code: String(r.app_type_code),
    status_code: r.status_code != null ? String(r.status_code) : null,
    date_filed: r.date_filed != null ? String(r.date_filed) : null,
    company_name: r.company_name != null ? String(r.company_name) : null,
    summary: r.summary != null ? String(r.summary) : null,
  }));
}

export async function getRecentFilingVolumeByCompany(
  conn: DuckDBConnection,
): Promise<CompanyFilingVolume[]> {
  const result = await conn.runAndReadAll(
    `SELECT
       strftime(date_trunc('month', f.date_filed), '%Y-%m') AS month,
       coalesce(c.name, 'Other') AS company_name,
       count(*)::INTEGER AS count
     FROM filing f
     LEFT JOIN company c ON c.id = f.company_id
     WHERE f.date_filed IS NOT NULL
       AND f.date_filed >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
       AND f.date_filed <= CURRENT_DATE
     GROUP BY 1, 2
     ORDER BY 1, count DESC`,
  );
  return result.getRowObjectsJS().map((r) => ({
    month: String(r.month),
    company_name: String(r.company_name),
    count: Number(r.count),
  }));
}

export async function getTopLineStats(
  conn: DuckDBConnection,
): Promise<TopLineStats> {
  const [countResult, ownershipResult, activeResult] = await Promise.all([
    conn.runAndReadAll('SELECT count(*)::INTEGER AS cnt FROM filing'),
    conn.runAndReadAll(
      `SELECT count(*)::INTEGER AS cnt FROM ownership_event
       WHERE effective_date >= date_trunc('quarter', CURRENT_DATE) - INTERVAL '3 months'`,
    ),
    conn.runAndReadAll(
      `SELECT f.file_number, c.name AS company_name,
              count(*)::INTEGER AS activity_count
       FROM pleading p
       JOIN filing f ON f.filing_key = p.filing_key
       LEFT JOIN company c ON c.id = f.company_id
       WHERE p.created_on >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY f.file_number, c.name
       ORDER BY activity_count DESC
       LIMIT 5`,
    ),
  ]);

  const filing_count: number = Number(
    countResult.getRowObjectsJS()[0]?.cnt ?? 0,
  );
  const recent_ownership_events: number = Number(
    ownershipResult.getRowObjectsJS()[0]?.cnt ?? 0,
  );
  const most_active_filings = activeResult.getRowObjectsJS().map((r) => ({
    file_number: String(r.file_number),
    company_name: r.company_name != null ? String(r.company_name) : null,
    activity_count: Number(r.activity_count),
  }));

  return { filing_count, recent_ownership_events, most_active_filings };
}

export async function getWeeklyFilingVolume(
  conn: DuckDBConnection,
  mondayDate: string,
  fridayDate: string,
): Promise<DailyFilingCount[]> {
  const dayLabels: string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const result = await conn.runAndReadAll(
    `SELECT
       date_filed::DATE AS filing_date,
       count(*)::INTEGER AS filing_count
     FROM filing
     WHERE date_filed::DATE >= $1::DATE AND date_filed::DATE <= $2::DATE
     GROUP BY 1
     ORDER BY 1`,
    [mondayDate, fridayDate] as DuckDBValue[],
  );
  const countsByDate: Map<string, number> = new Map(
    result
      .getRowObjectsJS()
      .map((r) => [String(r.filing_date), Number(r.filing_count)]),
  );

  const days: DailyFilingCount[] = [];
  const start: Date = new Date(mondayDate + 'T12:00:00Z');
  for (let i: number = 0; i < 5; i++) {
    const d: Date = new Date(start.getTime() + i * 86_400_000);
    const dateStr: string = d.toISOString().slice(0, 10);
    days.push({
      day: dayLabels[i]!,
      date: dateStr,
      count: countsByDate.get(dateStr) ?? 0,
    });
  }
  return days;
}
