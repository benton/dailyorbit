import type { DuckDBConnection } from '@duckdb/node-api';

export type ViewRecord = {
  fileNumber: string;
  firstViewedAt: Date;
  lastViewedAt: Date;
};

export async function markViewed(
  conn: DuckDBConnection,
  userId: string,
  fileNumber: string,
): Promise<void> {
  const now: string = new Date().toISOString();
  await conn.run(
    `INSERT INTO user_filing_view (user_id, file_number, first_viewed_at, last_viewed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, file_number)
     DO UPDATE SET last_viewed_at = $4`,
    [userId, fileNumber, now, now],
  );
}

export async function markUnread(
  conn: DuckDBConnection,
  userId: string,
  fileNumber: string,
): Promise<void> {
  await conn.run(
    'DELETE FROM user_filing_view WHERE user_id = $1 AND file_number = $2',
    [userId, fileNumber],
  );
}

export async function getViewedFileNumbers(
  conn: DuckDBConnection,
  userId: string,
  fileNumbers: string[],
): Promise<Set<string>> {
  if (fileNumbers.length === 0) return new Set();

  const placeholders: string = fileNumbers
    .map((_: string, i: number) => `$${i + 2}`)
    .join(', ');

  const result = await conn.runAndReadAll(
    `SELECT file_number FROM user_filing_view
     WHERE user_id = $1 AND file_number IN (${placeholders})`,
    [userId, ...fileNumbers],
  );

  return new Set(
    result
      .getRowObjectsJS()
      .map((row) => (row as { file_number: string }).file_number),
  );
}

type UnreadFiling = {
  fileNumber: string;
  dateFiled: string | null;
  subsystemCode: string | null;
  appTypeCode: string | null;
  applicantName: string | null;
};

export async function getUnreadFilingsSince(
  conn: DuckDBConnection,
  userId: string,
  since: Date,
): Promise<UnreadFiling[]> {
  const sinceIso: string = since.toISOString();
  const result = await conn.runAndReadAll(
    `SELECT f.file_number, f.date_filed, f.subsystem_code, f.app_type_code, f.address_attention AS applicant_name
     FROM filing f
     LEFT JOIN user_filing_view v ON v.user_id = $1 AND v.file_number = f.file_number
     WHERE v.file_number IS NULL
       AND f.date_filed >= $2
     ORDER BY f.date_filed DESC
     LIMIT 50`,
    [userId, sinceIso],
  );

  return result.getRowObjectsJS().map((row) => {
    const r = row as Record<string, unknown>;
    return {
      fileNumber: r.file_number as string,
      dateFiled: r.date_filed as string | null,
      subsystemCode: r.subsystem_code as string | null,
      appTypeCode: r.app_type_code as string | null,
      applicantName: r.applicant_name as string | null,
    };
  });
}

export async function getRecentlyViewed(
  conn: DuckDBConnection,
  userId: string,
  limit: number = 10,
): Promise<ViewRecord[]> {
  const result = await conn.runAndReadAll(
    `SELECT file_number, first_viewed_at, last_viewed_at
     FROM user_filing_view
     WHERE user_id = $1
     ORDER BY last_viewed_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return result.getRowObjectsJS().map((row) => {
    const r = row as Record<string, unknown>;
    return {
      fileNumber: r.file_number as string,
      firstViewedAt: r.first_viewed_at as Date,
      lastViewedAt: r.last_viewed_at as Date,
    };
  });
}
