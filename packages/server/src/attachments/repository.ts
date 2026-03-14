import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { parseDuration } from './duration.ts';
import type {
  AttachmentMetadata,
  AttachmentRow,
  DiscoveryScope,
  FilingRow,
  UpsertResult,
} from './types.ts';

const CREATE_TABLE_SQL: string = `
  CREATE TABLE IF NOT EXISTS attachment (
    attachment_key INTEGER NOT NULL,
    filing_key INTEGER NOT NULL,
    file_number VARCHAR NOT NULL,
    source VARCHAR DEFAULT 'attachment',
    attachment_name VARCHAR NOT NULL,
    description VARCHAR NOT NULL DEFAULT '',
    download_url VARCHAR NOT NULL,
    download_status VARCHAR NOT NULL DEFAULT 'pending',
    file_size_bytes BIGINT,
    content_type VARCHAR,
    local_path VARCHAR,
    discovered_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
    downloaded_at TIMESTAMP,
    full_text TEXT,
    text_length INTEGER,
    summary TEXT
  )`;

const MIGRATE_COLUMNS_SQL: string[] = [
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS content_type VARCHAR`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS full_text TEXT`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS text_length INTEGER`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS summary TEXT`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'attachment'`,
];

async function migratePrimaryKeyConstraint(
  conn: DuckDBConnection,
): Promise<void> {
  const reader = await conn.runAndReadAll(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.table_constraints
    WHERE table_name = 'attachment' AND constraint_type = 'PRIMARY KEY'
  `);
  const hasPk: boolean = Number(reader.getRowObjectsJS()[0]!.cnt) > 0;
  if (!hasPk) {
    return;
  }

  // Use explicit column names because old and new schemas may differ in column order
  const colReader = await conn.runAndReadAll(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'attachment'
    ORDER BY ordinal_position
  `);
  const columns: string = colReader
    .getRowObjectsJS()
    .map((r) => String(r.column_name))
    .join(', ');

  await conn.run(`ALTER TABLE attachment RENAME TO attachment_old`);
  await conn.run(CREATE_TABLE_SQL);
  await conn.run(
    `INSERT INTO attachment (${columns}) SELECT ${columns} FROM attachment_old`,
  );
  await conn.run(`DROP TABLE attachment_old`);
}

export async function createAttachmentTable(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(CREATE_TABLE_SQL);
  for (const sql of MIGRATE_COLUMNS_SQL) {
    await conn.run(sql);
  }
  await migratePrimaryKeyConstraint(conn);
}

export async function countDuplicateKeys(
  conn: DuckDBConnection,
): Promise<number> {
  const reader = await conn.runAndReadAll(`
    SELECT COUNT(*) - COUNT(DISTINCT attachment_key) AS dupes FROM attachment
  `);
  return Number(reader.getRowObjectsJS()[0]!.dupes);
}

export async function upsertAttachments(
  conn: DuckDBConnection,
  attachments: AttachmentMetadata[],
): Promise<UpsertResult> {
  if (attachments.length === 0) {
    return { inserted: 0, existing: 0 };
  }

  let inserted: number = 0;
  let existing: number = 0;

  for (const att of attachments) {
    // Check if already exists
    const check = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM attachment WHERE attachment_key = $1`,
      [att.attachmentKey] as DuckDBValue[],
    );
    const exists: boolean = Number(check.getRowObjectsJS()[0]!.cnt) > 0;

    if (exists) {
      existing++;
    } else {
      await conn.run(
        `INSERT INTO attachment
          (attachment_key, filing_key, file_number, source, attachment_name, description, download_url)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          att.attachmentKey,
          att.filingKey,
          att.fileNumber,
          att.source,
          att.attachmentName,
          att.description,
          att.downloadUrl,
        ] as DuckDBValue[],
      );
      inserted++;
    }
  }

  return { inserted, existing };
}

export async function getFilingsForScope(
  conn: DuckDBConnection,
  scope: DiscoveryScope,
): Promise<FilingRow[]> {
  const conditions: string[] = [];
  const params: DuckDBValue[] = [];
  let paramIdx: number = 1;

  if (scope.fileNumbers != null && scope.fileNumbers.length > 0) {
    const placeholders: string = scope.fileNumbers
      .map(() => `$${String(paramIdx++)}`)
      .join(', ');
    conditions.push(`f.file_number IN (${placeholders})`);
    params.push(...(scope.fileNumbers as DuckDBValue[]));
  }

  if (scope.subsystems != null && scope.subsystems.length > 0) {
    const placeholders: string = scope.subsystems
      .map(() => `$${String(paramIdx++)}`)
      .join(', ');
    conditions.push(`f.subsystem_code IN (${placeholders})`);
    params.push(...(scope.subsystems as DuckDBValue[]));
  }

  if (scope.dateFrom != null) {
    conditions.push(`f.date_filed >= $${String(paramIdx++)}`);
    params.push(scope.dateFrom as DuckDBValue);
  }

  if (scope.dateTo != null) {
    conditions.push(`f.date_filed <= $${String(paramIdx++)}`);
    params.push(scope.dateTo as DuckDBValue);
  }

  if (scope.notScrapedSince != null) {
    conditions.push(
      `(f.last_scraped_at IS NULL OR f.last_scraped_at < $${String(paramIdx++)})`,
    );
    params.push(scope.notScrapedSince as DuckDBValue);
  }

  if (scope.staleAfter != null) {
    const ms: number = parseDuration(scope.staleAfter);
    const threshold: Date = new Date(Date.now() - ms);
    conditions.push(
      `(f.last_scraped_at IS NULL OR f.last_scraped_at < $${String(paramIdx++)})`,
    );
    params.push(threshold.toISOString() as DuckDBValue);
  }

  const whereClause: string =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const limitClause: string =
    scope.limit != null ? `LIMIT ${String(scope.limit)}` : '';

  const sql: string = `
    SELECT
      f.filing_key AS filing_key,
      f.file_number AS file_number,
      f.subsystem_code AS subsystem_code,
      f.app_type_code AS app_type_code,
      f.last_scraped_at AS last_scraped_at
    FROM filing f
    ${whereClause}
    ORDER BY f.filing_key
    ${limitClause}`;

  const reader = await conn.runAndReadAll(sql, params);
  const rows = reader.getRowObjectsJS();

  return rows.map((r) => ({
    filingKey: Number(r.filing_key),
    fileNumber: String(r.file_number),
    subsystemCode: String(r.subsystem_code),
    appTypeCode: String(r.app_type_code),
    lastScrapedAt: r.last_scraped_at != null ? String(r.last_scraped_at) : null,
  }));
}

export async function getPendingDownloads(
  conn: DuckDBConnection,
  filingKeys: number[],
  retryFailed: boolean = false,
): Promise<AttachmentRow[]> {
  if (filingKeys.length === 0) {
    return [];
  }

  const statusCondition: string = retryFailed
    ? `download_status IN ('pending', 'failed')`
    : `download_status = 'pending'`;

  const filingPlaceholders: string = filingKeys
    .map((_, i) => `$${String(i + 1)}`)
    .join(', ');

  const sql: string = `
    SELECT
      attachment_key, filing_key, file_number, source, attachment_name,
      description, download_url, download_status, file_size_bytes,
      content_type, local_path, discovered_at, downloaded_at,
      full_text, text_length, summary
    FROM attachment
    WHERE ${statusCondition} AND filing_key IN (${filingPlaceholders})
    ORDER BY attachment_key`;

  const reader = await conn.runAndReadAll(sql, filingKeys as DuckDBValue[]);
  const rows = reader.getRowObjectsJS();

  return rows.map((r) => ({
    attachmentKey: Number(r.attachment_key),
    filingKey: Number(r.filing_key),
    fileNumber: String(r.file_number),
    source: String(r.source),
    attachmentName: String(r.attachment_name),
    description: String(r.description),
    downloadUrl: String(r.download_url),
    downloadStatus: String(r.download_status),
    fileSizeBytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
    contentType: r.content_type != null ? String(r.content_type) : null,
    localPath: r.local_path != null ? String(r.local_path) : null,
    discoveredAt: String(r.discovered_at),
    downloadedAt: r.downloaded_at != null ? String(r.downloaded_at) : null,
    fullText: r.full_text != null ? String(r.full_text) : null,
    textLength: r.text_length != null ? Number(r.text_length) : null,
    summary: r.summary != null ? String(r.summary) : null,
  }));
}

export async function markDownloaded(
  conn: DuckDBConnection,
  attachmentKey: number,
  localPath: string,
  fileSizeBytes: number,
  contentType: string | null,
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET download_status = 'downloaded',
          local_path = $1,
          file_size_bytes = $2,
          content_type = $3,
          downloaded_at = current_timestamp
      WHERE attachment_key = $4`,
    [localPath, fileSizeBytes, contentType, attachmentKey] as DuckDBValue[],
  );
}

export async function markFailed(
  conn: DuckDBConnection,
  attachmentKey: number,
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET download_status = 'failed'
      WHERE attachment_key = $1`,
    [attachmentKey] as DuckDBValue[],
  );
}

export async function ensureLastScrapedColumn(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(
    `ALTER TABLE filing ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP`,
  );
}

export async function markFilingsScraped(
  conn: DuckDBConnection,
  filingKeys: number[],
): Promise<void> {
  if (filingKeys.length === 0) {
    return;
  }

  const placeholders: string = filingKeys
    .map((_, i) => `$${String(i + 1)}`)
    .join(', ');
  await conn.run(
    `UPDATE filing SET last_scraped_at = current_timestamp
     WHERE filing_key IN (${placeholders})`,
    filingKeys as DuckDBValue[],
  );
}
