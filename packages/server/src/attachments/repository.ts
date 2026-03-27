import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { FileNumber } from '../lib/file-number.ts';
import { computeTextChecksum } from '../lib/text-utils.ts';

// Re-export so existing consumers (tests, other modules) can still import from here
export { computeTextChecksum } from '../lib/text-utils.ts';
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
    storage_key VARCHAR,
    discovered_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
    downloaded_at TIMESTAMP,
    full_text TEXT,
    text_length INTEGER,
    summary TEXT,
    extract_status VARCHAR NOT NULL DEFAULT 'pending',
    content_type_source VARCHAR DEFAULT 'http_header',
    text_checksum VARCHAR
  )`;

const MIGRATE_COLUMNS_SQL: string[] = [
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS content_type VARCHAR`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS full_text TEXT`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS text_length INTEGER`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS summary TEXT`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'attachment'`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS extract_status VARCHAR DEFAULT 'pending'`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS content_type_source VARCHAR DEFAULT 'http_header'`,
  `ALTER TABLE attachment ADD COLUMN IF NOT EXISTS text_checksum VARCHAR`,
  // storage_key is NOT added here — it's in CREATE_TABLE_SQL for new tables,
  // and migrateLocalPathToStorageKey handles the rename for existing tables.
];

const MIGRATE_INDEXES_SQL: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_attachment_text_checksum ON attachment(text_checksum)`,
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

/**
 * Migrate storage_key → storage_key:
 * 1. Rename the column if the old name still exists
 * 2. Strip the base path prefix from existing values so they become relative keys
 */
async function migrateLocalPathToStorageKey(
  conn: DuckDBConnection,
): Promise<void> {
  const colReader = await conn.runAndReadAll(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'attachment' AND column_name IN ('local_path', 'storage_key')
  `);
  const cols: Set<string> = new Set(
    colReader.getRowObjectsJS().map((r) => String(r.column_name)),
  );
  if (!cols.has('local_path')) return;

  // FTS indexes create dependencies that block ALTER TABLE — drop if present
  await dropAttachmentFtsIndex(conn);
  // Regular indexes also block column renames
  await conn.run(`DROP INDEX IF EXISTS idx_attachment_text_checksum`);

  if (cols.has('storage_key')) {
    // Both columns exist (e.g. partial migration) — copy data then drop old column
    await conn.run(`
      UPDATE attachment
      SET storage_key = local_path
      WHERE storage_key IS NULL AND local_path IS NOT NULL
    `);
    await conn.run(`ALTER TABLE attachment DROP COLUMN local_path`);
  } else {
    await conn.run(
      `ALTER TABLE attachment RENAME COLUMN local_path TO storage_key`,
    );
  }
  // Strip any absolute or relative data/attachments/ prefix to make values relative keys
  await conn.run(`
    UPDATE attachment
    SET storage_key = regexp_replace(storage_key, '^(.*?/)?data/attachments/', '')
    WHERE storage_key IS NOT NULL AND storage_key LIKE '%data/attachments/%'
  `);

  // Recreate the index we dropped (FTS is rebuilt separately by the pipeline)
  await conn.run(
    `CREATE INDEX IF NOT EXISTS idx_attachment_text_checksum ON attachment(text_checksum)`,
  );
}

async function dropAttachmentFtsIndex(conn: DuckDBConnection): Promise<void> {
  const ftsReader = await conn.runAndReadAll(`
    SELECT schema_name FROM information_schema.schemata
    WHERE schema_name = 'fts_main_attachment'
  `);
  if (ftsReader.getRowObjectsJS().length === 0) return;
  await conn.run(`INSTALL fts; LOAD fts;`);
  await conn.run(`PRAGMA drop_fts_index('attachment')`);
}

export async function createAttachmentTable(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(CREATE_TABLE_SQL);
  for (const sql of MIGRATE_COLUMNS_SQL) {
    await conn.run(sql);
  }
  // Must run before PK migration: PK migration recreates the table from
  // CREATE_TABLE_SQL (which has storage_key), so renaming local_path after
  // that would conflict with the already-existing storage_key column.
  await migrateLocalPathToStorageKey(conn);
  await migratePrimaryKeyConstraint(conn);
  await migrateFileNumberNormalization(conn);
  for (const sql of MIGRATE_INDEXES_SQL) {
    await conn.run(sql);
  }
}

/**
 * Normalize compact file_number values in the attachment table by copying the
 * canonical hyphenated file_number from the filing table (joined on filing_key).
 * Only updates rows where the attachment file_number doesn't contain a hyphen.
 * No-op if the filing table doesn't exist (e.g. in unit tests).
 */
async function migrateFileNumberNormalization(
  conn: DuckDBConnection,
): Promise<void> {
  const tableCheck = await conn.runAndReadAll(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_name = 'filing'
  `);
  const filingTableExists: boolean =
    Number(tableCheck.getRowObjectsJS()[0]!.cnt) > 0;
  if (!filingTableExists) return;

  await conn.run(`
    UPDATE attachment
    SET file_number = f.file_number
    FROM filing f
    WHERE attachment.filing_key = f.filing_key
      AND attachment.file_number NOT LIKE '%-%'
  `);
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
      `(ad.discovered_at IS NULL OR ad.discovered_at < $${String(paramIdx++)})`,
    );
    params.push(scope.notScrapedSince as DuckDBValue);
  }

  if (scope.staleAfter != null) {
    const ms: number = parseDuration(scope.staleAfter);
    const threshold: Date = new Date(Date.now() - ms);
    conditions.push(
      `(ad.discovered_at IS NULL OR ad.discovered_at < $${String(paramIdx++)})`,
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
      ad.discovered_at AS discovered_at
    FROM filing f
    LEFT JOIN attachment_discovery ad ON ad.filing_key = f.filing_key
    ${whereClause}
    ORDER BY f.filing_key
    ${limitClause}`;

  const reader = await conn.runAndReadAll(sql, params);
  const rows = reader.getRowObjectsJS();

  return rows.map((r) => ({
    filingKey: Number(r.filing_key),
    fileNumber: String(r.file_number) as FileNumber,
    subsystemCode: String(r.subsystem_code),
    appTypeCode: String(r.app_type_code),
    discoveredAt: r.discovered_at != null ? String(r.discovered_at) : null,
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
      content_type, storage_key, discovered_at, downloaded_at,
      full_text, text_length, summary
    FROM attachment
    WHERE ${statusCondition} AND filing_key IN (${filingPlaceholders})
    ORDER BY attachment_key`;

  const reader = await conn.runAndReadAll(sql, filingKeys as DuckDBValue[]);
  const rows = reader.getRowObjectsJS();

  return rows.map((r) => ({
    attachmentKey: Number(r.attachment_key),
    filingKey: Number(r.filing_key),
    fileNumber: String(r.file_number) as FileNumber,
    source: String(r.source),
    attachmentName: String(r.attachment_name),
    description: String(r.description),
    downloadUrl: String(r.download_url),
    downloadStatus: String(r.download_status),
    fileSizeBytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
    contentType: r.content_type != null ? String(r.content_type) : null,
    storageKey: r.storage_key != null ? String(r.storage_key) : null,
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
  storageKey: string,
  fileSizeBytes: number,
  contentType: string | null,
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET download_status = 'downloaded',
          storage_key = $1,
          file_size_bytes = $2,
          content_type = $3,
          downloaded_at = current_timestamp
      WHERE attachment_key = $4`,
    [storageKey, fileSizeBytes, contentType, attachmentKey] as DuckDBValue[],
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

/**
 * Returns true if the download URL is not an actual downloadable file.
 * Matches empty URLs, ICFS form editor pages (/ibfs?), and ICFS nav links (/nav_to).
 */
export function isUndownloadableUrl(downloadUrl: string): boolean {
  const trimmed: string = downloadUrl.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('/ibfs?') ||
    trimmed.startsWith('/nav_to')
  );
}

export async function markDownloadSkipped(
  conn: DuckDBConnection,
  attachmentKey: number,
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET download_status = 'skipped'
      WHERE attachment_key = $1`,
    [attachmentKey] as DuckDBValue[],
  );
}

const CREATE_DISCOVERY_LOG_SQL: string = `
  CREATE TABLE IF NOT EXISTS attachment_discovery (
    filing_key INTEGER NOT NULL,
    discovered_at TIMESTAMP NOT NULL DEFAULT current_timestamp
  )`;

export async function createDiscoveryLogTable(
  conn: DuckDBConnection,
): Promise<void> {
  await conn.run(CREATE_DISCOVERY_LOG_SQL);
}

/**
 * Mark filings as having had their attachments discovered.
 * Records in the attachment_discovery table so the pipeline knows
 * which filings have already been checked.
 */
export type PendingExtractionRow = {
  attachmentKey: number;
  storageKey: string;
  contentType: string;
};

export type ExtractionQueryOptions = {
  filingKeys?: number[] | undefined;
  retryFailed?: boolean | undefined;
  limit?: number | undefined;
};

export async function getPendingExtractions(
  conn: DuckDBConnection,
  options: ExtractionQueryOptions = {},
): Promise<PendingExtractionRow[]> {
  const statusCondition: string = options.retryFailed
    ? `extract_status IN ('pending', 'failed')`
    : `extract_status = 'pending'`;

  const limitClause: string =
    options.limit != null ? `LIMIT ${String(options.limit)}` : '';

  const filingKeys: number[] | undefined = options.filingKeys;
  const filingFilter: string =
    filingKeys != null && filingKeys.length > 0
      ? `AND filing_key IN (${filingKeys.map((_, i) => `$${String(i + 1)}`).join(', ')})`
      : '';

  const sql: string = `
    SELECT attachment_key, storage_key, content_type
    FROM attachment
    WHERE download_status = 'downloaded'
      AND content_type IN ('application/pdf', 'text/plain', 'text/csv', 'text/html')
      AND storage_key IS NOT NULL
      AND ${statusCondition}
      ${filingFilter}
    ORDER BY attachment_key
    ${limitClause}`;

  const params: number[] =
    filingKeys != null && filingKeys.length > 0 ? filingKeys : [];
  const stmt = await conn.prepare(sql);
  for (let i: number = 0; i < params.length; i++) {
    stmt.bindInteger(i + 1, params[i]!);
  }
  const reader = await stmt.runAndReadAll();
  return reader.getRowObjectsJS().map((r) => ({
    attachmentKey: Number(r.attachment_key),
    storageKey: String(r.storage_key),
    contentType: String(r.content_type),
  }));
}

export async function markExtracted(
  conn: DuckDBConnection,
  attachmentKey: number,
  fullText: string,
  textLength: number,
): Promise<void> {
  const checksum: string = computeTextChecksum(fullText);
  await conn.run(
    `UPDATE attachment
      SET full_text = $1,
          text_length = $2,
          text_checksum = $3,
          extract_status = 'extracted'
      WHERE attachment_key = $4`,
    [fullText, textLength, checksum, attachmentKey] as DuckDBValue[],
  );
}

export async function markExtractionSkipped(
  conn: DuckDBConnection,
  attachmentKey: number,
  reason: 'skipped_no_text' | 'skipped_not_pdf' | 'skipped_auth_error',
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET extract_status = $1
      WHERE attachment_key = $2`,
    [reason, attachmentKey] as DuckDBValue[],
  );
}

export async function markExtractionFailed(
  conn: DuckDBConnection,
  attachmentKey: number,
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET extract_status = 'failed'
      WHERE attachment_key = $1`,
    [attachmentKey] as DuckDBValue[],
  );
}

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

export type PendingSummarizationRow = {
  attachmentKey: number;
  fileNumber: string;
  applicantName: string;
  dateFiled: string;
  appTypeCode: string;
  subsystemCode: string;
  attachmentName: string;
  fullText: string;
  textChecksum: string | null;
};

export async function getPendingSummarizations(
  conn: DuckDBConnection,
  options: {
    filingKeys?: number[] | undefined;
    limit?: number | undefined;
  } = {},
): Promise<PendingSummarizationRow[]> {
  const limitClause: string =
    options.limit != null ? `LIMIT ${String(options.limit)}` : '';

  const filingKeys: number[] | undefined = options.filingKeys;
  const filingFilter: string =
    filingKeys != null && filingKeys.length > 0
      ? `AND a.filing_key IN (${filingKeys.map((_, i) => `$${String(i + 1)}`).join(', ')})`
      : '';

  const sql: string = `
    SELECT
      a.attachment_key,
      a.file_number,
      COALESCE(f.signer_name, '(unknown)') AS applicant_name,
      COALESCE(CAST(f.date_filed AS VARCHAR), '(unknown)') AS date_filed,
      COALESCE(f.app_type_code, '(unknown)') AS app_type_code,
      COALESCE(f.subsystem_code, '(unknown)') AS subsystem_code,
      COALESCE(a.attachment_name, '') AS attachment_name,
      a.full_text,
      a.text_checksum
    FROM attachment a
    JOIN filing f ON a.file_number = f.file_number
    WHERE a.full_text IS NOT NULL
      AND a.summary IS NULL
      ${filingFilter}
    ORDER BY f.date_filed DESC, a.text_length ASC
    ${limitClause}`;

  const params: number[] =
    filingKeys != null && filingKeys.length > 0 ? filingKeys : [];
  const stmt = await conn.prepare(sql);
  for (let i: number = 0; i < params.length; i++) {
    stmt.bindInteger(i + 1, params[i]!);
  }
  const reader = await stmt.runAndReadAll();
  return reader.getRowObjectsJS().map((r) => ({
    attachmentKey: Number(r.attachment_key),
    fileNumber: String(r.file_number),
    applicantName: String(r.applicant_name),
    dateFiled: String(r.date_filed),
    appTypeCode: String(r.app_type_code),
    subsystemCode: String(r.subsystem_code),
    attachmentName: String(r.attachment_name),
    fullText: String(r.full_text),
    textChecksum: r.text_checksum != null ? String(r.text_checksum) : null,
  }));
}

export async function findExistingSummaryByChecksum(
  conn: DuckDBConnection,
  textChecksum: string,
): Promise<string | null> {
  const reader = await conn.runAndReadAll(
    `SELECT summary FROM attachment
     WHERE text_checksum = $1 AND summary IS NOT NULL
     LIMIT 1`,
    [textChecksum] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  return rows.length > 0 ? String(rows[0]!.summary) : null;
}

export async function saveSummary(
  conn: DuckDBConnection,
  attachmentKey: number,
  summary: string,
  summarizedBy?: string | undefined,
): Promise<void> {
  if (summarizedBy != null) {
    await conn.run(
      `UPDATE attachment
        SET summary = $1,
            summarized_by = $2,
            summarized_at = current_timestamp
        WHERE attachment_key = $3`,
      [summary, summarizedBy, attachmentKey] as DuckDBValue[],
    );
  } else {
    await conn.run(
      `UPDATE attachment SET summary = $1 WHERE attachment_key = $2`,
      [summary, attachmentKey] as DuckDBValue[],
    );
  }
}

export async function markFilingsDiscovered(
  conn: DuckDBConnection,
  filingKeys: number[],
): Promise<void> {
  if (filingKeys.length === 0) {
    return;
  }

  for (const fk of filingKeys) {
    await conn.run(`DELETE FROM attachment_discovery WHERE filing_key = $1`, [
      fk,
    ] as DuckDBValue[]);
    await conn.run(
      `INSERT INTO attachment_discovery (filing_key) VALUES ($1)`,
      [fk] as DuckDBValue[],
    );
  }
}

// ---------------------------------------------------------------------------
// Content-type validation
// ---------------------------------------------------------------------------

export type PendingValidationRow = {
  attachmentKey: number;
  storageKey: string;
  contentType: string | null;
};

export type ValidationQueryOptions = {
  limit?: number | undefined;
};

export async function getPendingValidations(
  conn: DuckDBConnection,
  options: ValidationQueryOptions = {},
): Promise<PendingValidationRow[]> {
  const limitClause: string =
    options.limit != null ? `LIMIT ${String(options.limit)}` : '';

  const sql: string = `
    SELECT attachment_key, storage_key, content_type
    FROM attachment
    WHERE download_status = 'downloaded'
      AND storage_key IS NOT NULL
      AND (content_type_source IS NULL OR content_type_source = 'http_header')
    ORDER BY attachment_key
    ${limitClause}`;

  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJS().map((r) => ({
    attachmentKey: Number(r.attachment_key),
    storageKey: String(r.storage_key),
    contentType: r.content_type != null ? String(r.content_type) : null,
  }));
}

export async function markContentTypeValidated(
  conn: DuckDBConnection,
  attachmentKey: number,
  detectedMimeType: string,
): Promise<void> {
  await conn.run(
    `UPDATE attachment
      SET content_type = $1,
          content_type_source = 'file_magic'
      WHERE attachment_key = $2`,
    [detectedMimeType, attachmentKey] as DuckDBValue[],
  );
}
