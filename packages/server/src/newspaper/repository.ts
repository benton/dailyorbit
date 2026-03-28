import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type {
  ArticleStatus,
  EditionStatus,
  EditionType,
  HouseAd,
  NewspaperArticle,
  NewspaperContentType,
  NewspaperEdition,
  NewspaperImage,
} from './types.ts';

// ── Row mappers ─────────────────────────────────────────────────────

function toISODate(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split('T')[0]!;
  const s: string = String(val);
  // If it looks like a full date string, parse and extract date part
  if (s.length > 10 && !s.includes('T')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]!;
  }
  return s;
}

function rowToEdition(r: Record<string, unknown>): NewspaperEdition {
  return {
    id: Number(r.id),
    editionDate: toISODate(r.edition_date),
    editionType: String(r.edition_type) as EditionType,
    status: String(r.status) as EditionStatus,
    pipelineRunId: r.pipeline_run_id != null ? Number(r.pipeline_run_id) : null,
    heroImagePath: r.hero_image_path != null ? String(r.hero_image_path) : null,
    publishedAt: r.published_at != null ? String(r.published_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToArticle(r: Record<string, unknown>): NewspaperArticle {
  return {
    id: Number(r.id),
    editionId: Number(r.edition_id),
    contentType: String(r.content_type) as NewspaperContentType,
    slug: String(r.slug),
    headline: r.headline != null ? String(r.headline) : null,
    body: String(r.body),
    sourceData: r.source_data != null ? String(r.source_data) : null,
    generatedBy: r.generated_by != null ? String(r.generated_by) : null,
    imagePath: r.image_path != null ? String(r.image_path) : null,
    imagePrompt: r.image_prompt != null ? String(r.image_prompt) : null,
    displayOrder: Number(r.display_order),
    status: String(r.status) as ArticleStatus,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

// ── Edition CRUD ────────────────────────────────────────────────────

/**
 * Upsert an edition for the given date. Creates if not exists, returns existing
 * if already present. Idempotent.
 */
export async function ensureEdition(
  conn: DuckDBConnection,
  date: string,
): Promise<NewspaperEdition> {
  // Try insert, ignore conflict on unique edition_date
  await conn.run(
    `INSERT INTO newspaper_edition (edition_date)
     VALUES (CAST(? AS DATE))
     ON CONFLICT (edition_date) DO NOTHING`,
    [date] as DuckDBValue[],
  );

  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_edition WHERE edition_date = CAST(? AS DATE)`,
    [date] as DuckDBValue[],
  );
  return rowToEdition(reader.getRowObjectsJS()[0]!);
}

export async function getEditionByDate(
  conn: DuckDBConnection,
  date: string,
): Promise<NewspaperEdition | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_edition WHERE edition_date = CAST(? AS DATE)`,
    [date] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToEdition(rows[0]!);
}

export async function getLatestEdition(
  conn: DuckDBConnection,
): Promise<NewspaperEdition | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_edition
     WHERE published_at IS NOT NULL
     ORDER BY edition_date DESC LIMIT 1`,
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToEdition(rows[0]!);
}

export async function listEditions(
  conn: DuckDBConnection,
  limit: number,
  offset: number,
): Promise<NewspaperEdition[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_edition
     ORDER BY edition_date DESC
     LIMIT ? OFFSET ?`,
    [limit, offset] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToEdition);
}

export async function updateEditionStatus(
  conn: DuckDBConnection,
  id: number,
  status: EditionStatus,
): Promise<void> {
  await conn.run(
    `UPDATE newspaper_edition
     SET status = ?, updated_at = current_timestamp
     WHERE id = ?`,
    [status, id] as DuckDBValue[],
  );
}

/**
 * Set published_at = NOW() on a complete edition.
 * Returns true if the edition was published, false if not found or not complete.
 */
export async function publishEdition(
  conn: DuckDBConnection,
  date: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `UPDATE newspaper_edition
     SET published_at = current_timestamp, updated_at = current_timestamp
     WHERE edition_date = CAST(? AS DATE) AND status = 'complete'
     RETURNING id`,
    [date] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().length > 0;
}

/**
 * Clear published_at on an edition (unpublish).
 * Returns true if the edition was found and unpublished.
 */
export async function unpublishEdition(
  conn: DuckDBConnection,
  date: string,
): Promise<boolean> {
  const reader = await conn.runAndReadAll(
    `UPDATE newspaper_edition
     SET published_at = NULL, updated_at = current_timestamp
     WHERE edition_date = CAST(? AS DATE)
     RETURNING id`,
    [date] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().length > 0;
}

/**
 * Delete an edition and its articles. Returns image paths for cleanup.
 */
export async function deleteEdition(
  conn: DuckDBConnection,
  date: string,
): Promise<{ deleted: boolean; imagePaths: string[] }> {
  const edition = await getEditionByDate(conn, date);
  if (!edition) return { deleted: false, imagePaths: [] };

  // Collect image paths before deletion
  const imgReader = await conn.runAndReadAll(
    `SELECT image_path FROM newspaper_article
     WHERE edition_id = ? AND image_path IS NOT NULL`,
    [edition.id] as DuckDBValue[],
  );
  const imagePaths: string[] = imgReader
    .getRowObjectsJS()
    .map((r: Record<string, unknown>) => String(r.image_path));

  if (edition.heroImagePath) {
    imagePaths.push(edition.heroImagePath);
  }

  // Delete articles first, then edition
  await conn.run(`DELETE FROM newspaper_article WHERE edition_id = ?`, [
    edition.id,
  ] as DuckDBValue[]);
  await conn.run(`DELETE FROM newspaper_edition WHERE id = ?`, [
    edition.id,
  ] as DuckDBValue[]);

  return { deleted: true, imagePaths };
}

/**
 * Partial update of an article's headline and/or body.
 * Returns the updated article, or null if not found.
 */
export async function updateArticle(
  conn: DuckDBConnection,
  editionId: number,
  slug: string,
  patch: { headline?: string; body?: string },
): Promise<NewspaperArticle | null> {
  const existing = await getArticle(conn, editionId, slug);
  if (!existing) return null;

  const sets: string[] = ['updated_at = current_timestamp'];
  const params: DuckDBValue[] = [];

  if (patch.headline !== undefined) {
    sets.push('headline = ?');
    params.push(patch.headline as DuckDBValue);
  }
  if (patch.body !== undefined) {
    sets.push('body = ?');
    params.push(patch.body as DuckDBValue);
  }

  if (params.length === 0) return existing;

  params.push(editionId as DuckDBValue, slug as DuckDBValue);

  await conn.run(
    `UPDATE newspaper_article SET ${sets.join(', ')}
     WHERE edition_id = ? AND slug = ?`,
    params,
  );

  return getArticle(conn, editionId, slug);
}

// ── Article CRUD ────────────────────────────────────────────────────

/**
 * Upsert an article by (edition_id, slug). Idempotent — updates on conflict.
 */
export async function upsertArticle(
  conn: DuckDBConnection,
  editionId: number,
  article: {
    contentType: NewspaperContentType;
    slug: string;
    headline?: string | null;
    body?: string;
    sourceData?: string | null;
    generatedBy?: string | null;
    imagePath?: string | null;
    imagePrompt?: string | null;
    displayOrder?: number;
    status?: ArticleStatus;
  },
): Promise<NewspaperArticle> {
  await conn.run(
    `INSERT INTO newspaper_article
       (edition_id, content_type, slug, headline, body, source_data,
        generated_by, image_path, image_prompt, display_order, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (edition_id, slug) DO UPDATE SET
       headline = COALESCE(EXCLUDED.headline, newspaper_article.headline),
       body = COALESCE(EXCLUDED.body, newspaper_article.body),
       source_data = COALESCE(EXCLUDED.source_data, newspaper_article.source_data),
       generated_by = COALESCE(EXCLUDED.generated_by, newspaper_article.generated_by),
       image_path = COALESCE(EXCLUDED.image_path, newspaper_article.image_path),
       image_prompt = COALESCE(EXCLUDED.image_prompt, newspaper_article.image_prompt),
       display_order = EXCLUDED.display_order,
       status = EXCLUDED.status,
       updated_at = now()`,
    [
      editionId,
      article.contentType,
      article.slug,
      article.headline ?? null,
      article.body ?? '',
      article.sourceData ?? null,
      article.generatedBy ?? null,
      article.imagePath ?? null,
      article.imagePrompt ?? null,
      article.displayOrder ?? 0,
      article.status ?? 'pending',
    ] as DuckDBValue[],
  );

  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_article WHERE edition_id = ? AND slug = ?`,
    [editionId, article.slug] as DuckDBValue[],
  );
  return rowToArticle(reader.getRowObjectsJS()[0]!);
}

export async function getArticlesByEdition(
  conn: DuckDBConnection,
  editionId: number,
): Promise<NewspaperArticle[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_article
     WHERE edition_id = ?
     ORDER BY display_order ASC`,
    [editionId] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToArticle);
}

export async function getArticle(
  conn: DuckDBConnection,
  editionId: number,
  slug: string,
): Promise<NewspaperArticle | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_article WHERE edition_id = ? AND slug = ?`,
    [editionId, slug] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToArticle(rows[0]!);
}

/**
 * Find the most recent generated article with the given slug across all editions.
 * Useful for cross-edition dependencies (e.g. editorial cartoon needs an editorial
 * that may have been generated on a different day).
 */
export async function getRecentArticleBySlug(
  conn: DuckDBConnection,
  slug: string,
): Promise<NewspaperArticle | null> {
  const reader = await conn.runAndReadAll(
    `SELECT a.* FROM newspaper_article a
     JOIN newspaper_edition e ON a.edition_id = e.id
     WHERE a.slug = ? AND a.status = 'generated'
     ORDER BY e.edition_date DESC
     LIMIT 1`,
    [slug] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToArticle(rows[0]!);
}

/**
 * Reset an article to pending status for regeneration.
 */
export async function resetArticle(
  conn: DuckDBConnection,
  editionId: number,
  slug: string,
): Promise<void> {
  await conn.run(
    `UPDATE newspaper_article
     SET status = 'pending', updated_at = current_timestamp
     WHERE edition_id = ? AND slug = ?`,
    [editionId, slug] as DuckDBValue[],
  );
}

// ── Image Library CRUD ─────────────────────────────────────────────

function rowToImage(r: Record<string, unknown>): NewspaperImage {
  return {
    id: Number(r.id),
    imageType: String(r.image_type) as NewspaperImage['imageType'],
    imagePath: String(r.image_path),
    prompt: r.prompt != null ? String(r.prompt) : null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]).map(String) : [],
    generatedBy: r.generated_by != null ? String(r.generated_by) : null,
    createdAt: String(r.created_at),
  };
}

export async function insertImage(
  conn: DuckDBConnection,
  image: Omit<NewspaperImage, 'id' | 'createdAt'>,
): Promise<NewspaperImage> {
  // DuckDB node API cannot bind array params directly; build tags literal in SQL.
  const tagsLiteral: string =
    image.tags.length > 0
      ? `[${image.tags.map((t: string) => `'${t.replace(/'/g, "''")}'`).join(', ')}]::VARCHAR[]`
      : `[]::VARCHAR[]`;

  await conn.run(
    `INSERT INTO newspaper_image (image_type, image_path, prompt, tags, generated_by)
     VALUES (?, ?, ?, ${tagsLiteral}, ?)`,
    [
      image.imageType,
      image.imagePath,
      image.prompt,
      image.generatedBy,
    ] as DuckDBValue[],
  );

  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_image WHERE image_path = ?`,
    [image.imagePath] as DuckDBValue[],
  );
  return rowToImage(reader.getRowObjectsJS()[0]!);
}

export async function getImageByPath(
  conn: DuckDBConnection,
  imagePath: string,
): Promise<NewspaperImage | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_image WHERE image_path = ?`,
    [imagePath] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToImage(rows[0]!);
}

export async function listImagesByType(
  conn: DuckDBConnection,
  imageType: string,
): Promise<NewspaperImage[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM newspaper_image WHERE image_type = ? ORDER BY id ASC`,
    [imageType] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToImage);
}

export async function countImagesByType(
  conn: DuckDBConnection,
  imageType: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `SELECT count(*)::INTEGER AS cnt FROM newspaper_image WHERE image_type = ?`,
    [imageType] as DuckDBValue[],
  );
  return Number(reader.getRowObjectsJS()[0]!.cnt);
}

// ── House Ad repository ─────────────────────────────────────────────

function rowToHouseAd(row: Record<string, unknown>): HouseAd {
  return {
    id: Number(row.id),
    tagline: String(row.tagline),
    imagePath: String(row.image_path),
    imagePrompt: String(row.image_prompt),
    generatedBy: row.generated_by != null ? String(row.generated_by) : null,
    createdAt: String(row.created_at),
  };
}

export async function insertHouseAd(
  conn: DuckDBConnection,
  ad: {
    tagline: string;
    imagePath: string;
    imagePrompt: string;
    generatedBy: string | null;
  },
): Promise<HouseAd> {
  await conn.run(
    `INSERT INTO house_ad (tagline, image_path, image_prompt, generated_by)
     VALUES (?, ?, ?, ?)`,
    [ad.tagline, ad.imagePath, ad.imagePrompt, ad.generatedBy] as DuckDBValue[],
  );
  const reader = await conn.runAndReadAll(
    `SELECT * FROM house_ad WHERE tagline = ? ORDER BY id DESC LIMIT 1`,
    [ad.tagline] as DuckDBValue[],
  );
  return rowToHouseAd(reader.getRowObjectsJS()[0]!);
}

export async function getHouseAdForDate(
  conn: DuckDBConnection,
  editionDate: string,
): Promise<HouseAd | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM house_ad
     ORDER BY id
     LIMIT 1
     OFFSET (extract(doy FROM ?::DATE)::INTEGER % (SELECT count(*)::INTEGER FROM house_ad))`,
    [editionDate] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToHouseAd(rows[0]!);
}

export async function countHouseAds(conn: DuckDBConnection): Promise<number> {
  const reader = await conn.runAndReadAll(
    `SELECT count(*)::INTEGER AS cnt FROM house_ad`,
  );
  return Number(reader.getRowObjectsJS()[0]!.cnt);
}

export async function listHouseAds(conn: DuckDBConnection): Promise<HouseAd[]> {
  const reader = await conn.runAndReadAll(`SELECT * FROM house_ad ORDER BY id`);
  return reader.getRowObjectsJS().map(rowToHouseAd);
}
