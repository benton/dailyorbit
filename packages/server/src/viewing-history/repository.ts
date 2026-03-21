import type { DuckDBConnection } from '@duckdb/node-api';

export type ContentType = 'filing' | 'news';

// ── Watermark functions ─────────────────────────────────────────────

export async function getWatermark(
  conn: DuckDBConnection,
  userId: string,
  contentType: ContentType,
): Promise<Date | null> {
  const result = await conn.runAndReadAll(
    `SELECT watermark_at FROM user_view_watermark
     WHERE user_id = $1 AND content_type = $2`,
    [userId, contentType],
  );
  const rows = result.getRowObjectsJS();
  if (rows.length === 0) return null;
  return (rows[0] as { watermark_at: Date }).watermark_at;
}

export async function setWatermark(
  conn: DuckDBConnection,
  userId: string,
  contentType: ContentType,
  watermarkAt?: Date,
): Promise<Date> {
  const ts: string = (watermarkAt ?? new Date()).toISOString();
  await conn.run(
    `INSERT INTO user_view_watermark (user_id, content_type, watermark_at, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, content_type)
     DO UPDATE SET watermark_at = $3, updated_at = $4`,
    [userId, contentType, ts, new Date().toISOString()],
  );
  return new Date(ts);
}

export async function getWatermarks(
  conn: DuckDBConnection,
  userId: string,
): Promise<Map<ContentType, Date>> {
  const result = await conn.runAndReadAll(
    `SELECT content_type, watermark_at FROM user_view_watermark
     WHERE user_id = $1`,
    [userId],
  );
  const map = new Map<ContentType, Date>();
  for (const row of result.getRowObjectsJS()) {
    const r = row as { content_type: string; watermark_at: Date };
    map.set(r.content_type as ContentType, r.watermark_at);
  }
  return map;
}

// ── View record types ───────────────────────────────────────────────

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
     WHERE user_id = $1 AND file_number IN (${placeholders})
     UNION
     SELECT f.file_number FROM filing f, user_view_watermark w
     WHERE w.user_id = $1 AND w.content_type = 'filing'
       AND f.file_number IN (${placeholders})
       AND f.date_filed <= w.watermark_at`,
    [userId, ...fileNumbers],
  );

  return new Set(
    result
      .getRowObjectsJS()
      .map((row) => (row as { file_number: string }).file_number),
  );
}

/** Mark a news item as viewed by a user. Upserts last_viewed_at on repeat views. */
export async function markNewsViewed(
  conn: DuckDBConnection,
  userId: string,
  newsItemId: number,
): Promise<void> {
  const now: string = new Date().toISOString();
  await conn.run(
    `INSERT INTO user_news_view (user_id, news_item_id, first_viewed_at, last_viewed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, news_item_id)
     DO UPDATE SET last_viewed_at = $4`,
    [userId, newsItemId, now, now],
  );
}

/** Mark a news item as unread for a user. */
export async function markNewsUnread(
  conn: DuckDBConnection,
  userId: string,
  newsItemId: number,
): Promise<void> {
  await conn.run(
    'DELETE FROM user_news_view WHERE user_id = $1 AND news_item_id = $2',
    [userId, newsItemId],
  );
}

/** Check which news item IDs have been viewed by a user. */
export async function getViewedNewsIds(
  conn: DuckDBConnection,
  userId: string,
  newsItemIds: number[],
): Promise<Set<number>> {
  if (newsItemIds.length === 0) return new Set();
  const placeholders: string = newsItemIds
    .map((_: number, i: number) => `$${i + 2}`)
    .join(', ');
  const result = await conn.runAndReadAll(
    `SELECT news_item_id FROM user_news_view
     WHERE user_id = $1 AND news_item_id IN (${placeholders})
     UNION
     SELECT n.id AS news_item_id FROM news_item n, user_view_watermark w
     WHERE w.user_id = $1 AND w.content_type = 'news'
       AND n.id IN (${placeholders})
       AND COALESCE(n.published_at, n.created_at) <= w.watermark_at`,
    [userId, ...newsItemIds],
  );
  return new Set(
    result
      .getRowObjectsJS()
      .map((row) => Number((row as Record<string, unknown>).news_item_id)),
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
     LEFT JOIN user_view_watermark w ON w.user_id = $1 AND w.content_type = 'filing'
     WHERE v.file_number IS NULL
       AND f.date_filed >= $2
       AND (w.watermark_at IS NULL OR f.date_filed > w.watermark_at)
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
