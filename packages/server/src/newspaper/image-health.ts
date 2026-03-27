import type { DuckDBConnection } from '@duckdb/node-api';
import type { NewspaperArticle, NewspaperEdition } from './types.ts';

// ── Types ────────────────────────────────────────────────────────────

export type ImageCheckResult = {
  url: string;
  category: 'edition' | 'library';
  label: string;
  status: 'ok' | 'missing' | 'wrong_content_type' | 'error';
  httpStatus?: number;
  contentType?: string;
};

export type ImageHealthReport = {
  checkedAt: string;
  baseUrl: string;
  totalChecked: number;
  totalOk: number;
  totalMissing: number;
  results: ImageCheckResult[];
};

// ── Pure URL builders ────────────────────────────────────────────────

/**
 * Build CDN URLs for all articles in a single edition that have an imagePath.
 * The imagePath stored in the DB is a local filesystem path like
 * `data/newspaper/images/2026-03-25/hero-image-abc.webp`.
 * The CDN path is `{baseUrl}/images/{date}/{filename}`.
 */
export function buildEditionImageUrls(
  baseUrl: string,
  editionDate: string,
  articles: NewspaperArticle[],
): { url: string; label: string }[] {
  const results: { url: string; label: string }[] = [];
  for (const article of articles) {
    if (article.imagePath == null) continue;
    const filename: string = article.imagePath.split('/').pop()!;
    const url: string = `${baseUrl}/images/${editionDate}/${filename}`;
    results.push({ url, label: `${editionDate}/${article.slug}` });
  }
  return results;
}

/**
 * Build CDN URLs for known library image paths.
 * libraryPaths are relative to the images root, e.g. `library/portraits/alex-chen.webp`.
 */
export function buildLibraryImageUrls(
  baseUrl: string,
  libraryPaths: string[],
): { url: string; label: string }[] {
  return libraryPaths.map((p: string) => ({
    url: `${baseUrl}/images/${p}`,
    label: p,
  }));
}

// ── HTTP check ───────────────────────────────────────────────────────

export async function checkImageUrl(
  url: string,
  category: 'edition' | 'library',
  label: string,
): Promise<ImageCheckResult> {
  try {
    const resp: Response = await fetch(url, { method: 'HEAD' });
    const contentType: string = resp.headers.get('content-type') ?? '';

    if (resp.status === 404 || resp.status === 403) {
      return { url, category, label, status: 'missing', httpStatus: resp.status, contentType };
    }
    if (!resp.ok) {
      return { url, category, label, status: 'error', httpStatus: resp.status, contentType };
    }
    if (!contentType.startsWith('image/')) {
      return { url, category, label, status: 'wrong_content_type', httpStatus: resp.status, contentType };
    }
    return { url, category, label, status: 'ok', httpStatus: resp.status, contentType };
  } catch (err: unknown) {
    return {
      url,
      category,
      label,
      status: 'error',
      contentType: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────

/**
 * Run the full image health check: query recent editions, build URL lists,
 * HEAD-check each URL, and return a structured report.
 */
export async function runImageHealthCheck(
  conn: DuckDBConnection,
  baseUrl: string,
  daysBack: number = 7,
): Promise<ImageHealthReport> {
  const { ensureNewspaperTables } = await import('./schema.ts');
  const { listEditions, getArticlesByEdition, listImagesByType } =
    await import('./repository.ts');
  await ensureNewspaperTables(conn);

  // 1. Collect edition image URLs
  const editions: NewspaperEdition[] = await listEditions(conn, daysBack, 0);
  const editionChecks: { url: string; category: 'edition'; label: string }[] = [];
  for (const edition of editions) {
    const articles: NewspaperArticle[] = await getArticlesByEdition(conn, edition.id);
    const urls = buildEditionImageUrls(baseUrl, edition.editionDate, articles);
    for (const u of urls) {
      editionChecks.push({ ...u, category: 'edition' as const });
    }
  }

  // 2. Collect library image URLs (sample of each type)
  const libraryPaths: string[] = [];
  for (const imageType of ['portrait', 'section_header', 'house_ad'] as const) {
    const images = await listImagesByType(conn, imageType);
    // Take up to 5 of each type as a sample
    const sample = images.slice(0, 5);
    for (const img of sample) {
      // imagePath is like `data/newspaper/images/library/portraits/foo.webp`
      // Extract the part after `images/`
      const idx: number = img.imagePath.indexOf('images/');
      if (idx >= 0) {
        libraryPaths.push(img.imagePath.substring(idx + 'images/'.length));
      }
    }
  }
  const libraryChecks = buildLibraryImageUrls(baseUrl, libraryPaths);

  // 3. Check all URLs concurrently
  const allChecks = [
    ...editionChecks.map((c) => checkImageUrl(c.url, c.category, c.label)),
    ...libraryChecks.map((c) => checkImageUrl(c.url, 'library', c.label)),
  ];
  const results: ImageCheckResult[] = await Promise.all(allChecks);

  const totalOk: number = results.filter((r) => r.status === 'ok').length;
  const totalMissing: number = results.filter(
    (r) => r.status === 'missing' || r.status === 'wrong_content_type',
  ).length;

  return {
    checkedAt: new Date().toISOString(),
    baseUrl,
    totalChecked: results.length,
    totalOk,
    totalMissing,
    results,
  };
}
