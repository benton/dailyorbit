import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { PaginatedRequest, PaginatedResponse } from '../lib/pagination.ts';
import {
  buildPaginatedQuery,
  buildPaginatedResponse,
} from '../lib/pagination.ts';
import type {
  ExtractStatus,
  FetchStatus,
  NewsItem,
  NewsSource,
  NewsSourceCategory,
  NewsSourceSeedEntry,
} from './types.ts';

// ── Sortable column whitelists ──────────────────────────────────────

const NEWS_ITEM_SORTABLE_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'title',
  'published_at',
  'fetched_at',
  'extract_status',
  'news_source_id',
  'company_id',
]);

// ── Row mappers ─────────────────────────────────────────────────────

function rowToNewsSource(r: Record<string, unknown>): NewsSource {
  return {
    id: Number(r.id),
    name: String(r.name),
    feedUrl: String(r.feed_url),
    category: String(r.category) as NewsSourceCategory,
    enabled: Boolean(r.enabled),
    fetchIntervalMinutes: Number(r.fetch_interval_minutes),
    lastFetchedAt: r.last_fetched_at != null ? String(r.last_fetched_at) : null,
    lastFetchStatus:
      r.last_fetch_status != null
        ? (String(r.last_fetch_status) as FetchStatus)
        : null,
    lastFetchError:
      r.last_fetch_error != null ? String(r.last_fetch_error) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToNewsItem(r: Record<string, unknown>): NewsItem {
  const rawTags: unknown = r.tags;
  const tags: string[] = Array.isArray(rawTags)
    ? rawTags.map((t: unknown) => String(t))
    : [];

  return {
    id: Number(r.id),
    newsSourceId: Number(r.news_source_id),
    sourceName: r.source_name != null ? String(r.source_name) : null,
    sourceUrl: String(r.source_url),
    title: String(r.title),
    author: r.author != null ? String(r.author) : null,
    publishedAt: r.published_at != null ? String(r.published_at) : null,
    fetchedAt: String(r.fetched_at),
    fullText: r.full_text != null ? String(r.full_text) : null,
    textLength: r.text_length != null ? Number(r.text_length) : null,
    textChecksum: r.text_checksum != null ? String(r.text_checksum) : null,
    summary: r.summary != null ? String(r.summary) : null,
    summarizedBy: r.summarized_by != null ? String(r.summarized_by) : null,
    summarizedAt: r.summarized_at != null ? String(r.summarized_at) : null,
    extractStatus: String(r.extract_status) as ExtractStatus,
    companyId: r.company_id != null ? Number(r.company_id) : null,
    companyName: r.company_name != null ? String(r.company_name) : null,
    tags,
    createdAt: String(r.created_at),
  };
}

// ── News Source CRUD ────────────────────────────────────────────────

export async function createNewsSource(
  conn: DuckDBConnection,
  data: {
    name: string;
    feedUrl: string;
    category?: NewsSourceCategory;
    enabled?: boolean;
    fetchIntervalMinutes?: number;
  },
): Promise<NewsSource> {
  await conn.run(
    `INSERT INTO news_source (name, feed_url, category, enabled, fetch_interval_minutes)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      data.name,
      data.feedUrl,
      data.category ?? 'industry',
      data.enabled ?? true,
      data.fetchIntervalMinutes ?? 60,
    ] as DuckDBValue[],
  );

  const reader = await conn.runAndReadAll(
    `SELECT * FROM news_source WHERE id = (SELECT max(id) FROM news_source)`,
  );
  return rowToNewsSource(reader.getRowObjectsJS()[0]!);
}

export async function getNewsSourceById(
  conn: DuckDBConnection,
  id: number,
): Promise<NewsSource | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM news_source WHERE id = $1`,
    [id] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToNewsSource(rows[0]!);
}

export async function listNewsSources(
  conn: DuckDBConnection,
): Promise<NewsSource[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM news_source ORDER BY name`,
  );
  return reader.getRowObjectsJS().map(rowToNewsSource);
}

export async function updateNewsSource(
  conn: DuckDBConnection,
  id: number,
  data: {
    name?: string;
    enabled?: boolean;
    fetchIntervalMinutes?: number;
    category?: NewsSourceCategory;
  },
): Promise<NewsSource | null> {
  const sets: string[] = [];
  const params: DuckDBValue[] = [];
  let idx: number = 1;

  const fields: Array<[string, unknown]> = [
    ['name', data.name],
    ['enabled', data.enabled],
    ['fetch_interval_minutes', data.fetchIntervalMinutes],
    ['category', data.category],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) {
      sets.push(`"${col}" = $${String(idx)}`);
      params.push(val as DuckDBValue);
      idx++;
    }
  }

  if (sets.length === 0) return getNewsSourceById(conn, id);

  sets.push(`updated_at = current_timestamp`);
  params.push(id as DuckDBValue);

  await conn.run(
    `UPDATE news_source SET ${sets.join(', ')} WHERE id = $${String(idx)}`,
    params,
  );

  return getNewsSourceById(conn, id);
}

export async function deleteNewsSource(
  conn: DuckDBConnection,
  id: number,
): Promise<boolean> {
  const before = await conn.runAndReadAll(
    `SELECT count(*)::INTEGER AS cnt FROM news_source WHERE id = $1`,
    [id] as DuckDBValue[],
  );
  if (Number(before.getRowObjectsJS()[0]!.cnt) === 0) return false;

  await conn.run(`DELETE FROM news_item WHERE news_source_id = $1`, [
    id,
  ] as DuckDBValue[]);
  await conn.run(`DELETE FROM news_source WHERE id = $1`, [
    id,
  ] as DuckDBValue[]);
  return true;
}

export async function updateSourceFetchStatus(
  conn: DuckDBConnection,
  id: number,
  status: FetchStatus,
  error: string | null,
): Promise<void> {
  await conn.run(
    `UPDATE news_source
       SET last_fetched_at = current_timestamp,
           last_fetch_status = $1,
           last_fetch_error = $2,
           updated_at = current_timestamp
     WHERE id = $3`,
    [status, error, id] as DuckDBValue[],
  );
}

// ── News Source Seeding ─────────────────────────────────────────────

export async function seedNewsSources(
  conn: DuckDBConnection,
  seeds: ReadonlyArray<NewsSourceSeedEntry>,
): Promise<{ created: number; skipped: number }> {
  let created: number = 0;
  let skipped: number = 0;

  for (const seed of seeds) {
    const existing = await conn.runAndReadAll(
      `SELECT 1 FROM news_source WHERE feed_url = $1 LIMIT 1`,
      [seed.feedUrl] as DuckDBValue[],
    );
    if (existing.getRowObjectsJS().length > 0) {
      skipped++;
      continue;
    }

    await conn.run(
      `INSERT INTO news_source (name, feed_url, category, enabled)
       VALUES ($1, $2, $3, $4)`,
      [seed.name, seed.feedUrl, seed.category, seed.enabled] as DuckDBValue[],
    );
    created++;
  }

  return { created, skipped };
}

// ── Pipeline query helpers ──────────────────────────────────────────

export async function getSourcesDueForFetch(
  conn: DuckDBConnection,
): Promise<NewsSource[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM news_source
     WHERE enabled = TRUE
       AND (last_fetched_at IS NULL
            OR last_fetched_at + INTERVAL (fetch_interval_minutes) MINUTE < current_timestamp)
     ORDER BY last_fetched_at ASC NULLS FIRST`,
  );
  return reader.getRowObjectsJS().map(rowToNewsSource);
}

// ── News Item CRUD ──────────────────────────────────────────────────

export async function upsertNewsItem(
  conn: DuckDBConnection,
  data: {
    newsSourceId: number;
    sourceUrl: string;
    title: string;
    author: string | null;
    publishedAt: string | null;
    tags: string[];
  },
): Promise<boolean> {
  const existing = await conn.runAndReadAll(
    `SELECT 1 FROM news_item WHERE source_url = $1 LIMIT 1`,
    [data.sourceUrl] as DuckDBValue[],
  );
  if (existing.getRowObjectsJS().length > 0) return false;

  // DuckDB node API cannot infer the type of an empty array parameter,
  // so we build the tags list literal in SQL.
  const tagsLiteral: string =
    data.tags.length > 0
      ? `[${data.tags.map((t: string) => `'${t.replace(/'/g, "''")}'`).join(', ')}]::VARCHAR[]`
      : `[]::VARCHAR[]`;

  await conn.run(
    `INSERT INTO news_item (news_source_id, source_url, title, author, published_at, tags)
     VALUES ($1, $2, $3, $4, $5, ${tagsLiteral})`,
    [
      data.newsSourceId,
      data.sourceUrl,
      data.title,
      data.author,
      data.publishedAt,
    ] as DuckDBValue[],
  );
  return true;
}

export async function getNewsItemById(
  conn: DuckDBConnection,
  id: number,
): Promise<NewsItem | null> {
  const reader = await conn.runAndReadAll(
    `SELECT ni.*, ns.name AS source_name, c.name AS company_name FROM news_item ni LEFT JOIN news_source ns ON ns.id = ni.news_source_id LEFT JOIN company c ON c.id = ni.company_id WHERE ni.id = $1`,
    [id] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToNewsItem(rows[0]!);
}

export async function listNewsItems(
  conn: DuckDBConnection,
  pagination: PaginatedRequest,
  filters?: {
    newsSourceId?: number;
    companyId?: number;
    extractStatus?: ExtractStatus;
    showHidden?: boolean;
    userId?: string;
  },
): Promise<PaginatedResponse<NewsItem>> {
  const conditions: string[] = [];
  const params: DuckDBValue[] = [];
  let idx: number = 1;

  if (filters?.newsSourceId != null) {
    conditions.push(`ni.news_source_id = $${String(idx)}`);
    params.push(filters.newsSourceId as DuckDBValue);
    idx++;
  }
  if (filters?.companyId != null) {
    conditions.push(`ni.company_id = $${String(idx)}`);
    params.push(filters.companyId as DuckDBValue);
    idx++;
  }
  if (filters?.extractStatus != null) {
    conditions.push(`ni.extract_status = $${String(idx)}`);
    params.push(filters.extractStatus as DuckDBValue);
    idx++;
  }

  if (!filters?.showHidden) {
    if (filters?.userId != null) {
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM hidden_item h
        WHERE h.content_type = 'news'
          AND h.content_key = CAST(ni.id AS VARCHAR)
          AND h.removed_at IS NULL
          AND (h.scope = 'system' OR (h.scope = 'user' AND h.user_id = $${String(idx)}))
      )`);
      params.push(filters.userId as DuckDBValue);
      idx++;
    } else {
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM hidden_item h
        WHERE h.content_type = 'news'
          AND h.content_key = CAST(ni.id AS VARCHAR)
          AND h.removed_at IS NULL
          AND h.scope = 'system'
      )`);
    }
  }

  const whereClause: string =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const baseSql: string = `SELECT ni.*, ns.name AS source_name, c.name AS company_name FROM news_item ni LEFT JOIN news_source ns ON ns.id = ni.news_source_id LEFT JOIN company c ON c.id = ni.company_id ${whereClause}`;

  const {
    sql,
    params: paginatedParams,
    countSql,
    countParams,
  } = buildPaginatedQuery(
    baseSql,
    params,
    pagination,
    NEWS_ITEM_SORTABLE_COLUMNS,
    'published_at',
  );

  const dataReader = await conn.runAndReadAll(sql, paginatedParams);
  const countReader = await conn.runAndReadAll(countSql, countParams);

  const data: NewsItem[] = dataReader.getRowObjectsJS().map(rowToNewsItem);
  const totalRows: number = Number(
    countReader.getRowObjectsJS()[0]?.total ?? 0,
  );

  return buildPaginatedResponse(data, totalRows, pagination);
}

// ── Pipeline: extraction ────────────────────────────────────────────

export async function getNewsItemsNeedingExtraction(
  conn: DuckDBConnection,
  limit: number = 100,
): Promise<NewsItem[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM news_item
     WHERE extract_status = 'pending'
     ORDER BY published_at DESC NULLS LAST
     LIMIT $1`,
    [limit] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToNewsItem);
}

export async function updateNewsItemExtraction(
  conn: DuckDBConnection,
  id: number,
  data: {
    fullText: string;
    textLength: number;
    textChecksum: string;
    extractStatus: ExtractStatus;
  },
): Promise<void> {
  await conn.run(
    `UPDATE news_item
       SET full_text = $1,
           text_length = $2,
           text_checksum = $3,
           extract_status = $4
     WHERE id = $5`,
    [
      data.fullText,
      data.textLength,
      data.textChecksum,
      data.extractStatus,
      id,
    ] as DuckDBValue[],
  );
}

export async function markExtractionFailed(
  conn: DuckDBConnection,
  id: number,
): Promise<void> {
  await conn.run(
    `UPDATE news_item SET extract_status = 'failed' WHERE id = $1`,
    [id] as DuckDBValue[],
  );
}

// ── Pipeline: summarization ─────────────────────────────────────────

export async function getNewsItemsNeedingSummary(
  conn: DuckDBConnection,
  limit: number = 100,
): Promise<NewsItem[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM news_item
     WHERE full_text IS NOT NULL
       AND summary IS NULL
     ORDER BY published_at DESC NULLS LAST
     LIMIT $1`,
    [limit] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToNewsItem);
}

export async function saveNewsItemSummary(
  conn: DuckDBConnection,
  id: number,
  summary: string,
  modelId: string,
): Promise<void> {
  await conn.run(
    `UPDATE news_item
       SET summary = $1,
           summarized_by = $2,
           summarized_at = current_timestamp
     WHERE id = $3`,
    [summary, modelId, id] as DuckDBValue[],
  );
}

export async function findExistingNewsItemSummaryByChecksum(
  conn: DuckDBConnection,
  checksum: string,
): Promise<string | null> {
  const reader = await conn.runAndReadAll(
    `SELECT summary FROM news_item
     WHERE text_checksum = $1 AND summary IS NOT NULL
     LIMIT 1`,
    [checksum] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return String(rows[0]!.summary);
}

// ── Pipeline: company attribution ───────────────────────────────────

export async function getNewsItemsNeedingAttribution(
  conn: DuckDBConnection,
  limit: number = 500,
): Promise<NewsItem[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM news_item
     WHERE company_id IS NULL
       AND full_text IS NOT NULL
     ORDER BY published_at DESC NULLS LAST
     LIMIT $1`,
    [limit] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToNewsItem);
}

export async function setNewsItemCompany(
  conn: DuckDBConnection,
  id: number,
  companyId: number,
): Promise<void> {
  await conn.run(`UPDATE news_item SET company_id = $1 WHERE id = $2`, [
    companyId,
    id,
  ] as DuckDBValue[]);
}
