import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import { ensureNewspaperTables } from './schema.ts';
import {
  deleteEdition,
  getAdjacentEditions,
  getArticlesByEdition,
  getEditionByDate,
  getHouseAdForDate,
  getImageByPath,
  getLatestEdition,
  listEditions,
  listHouseAds,
  listImagesByType,
  publishEdition,
  resetArticle,
  unpublishEdition,
  updateArticle,
} from './repository.ts';
import { getPortraitForPerson } from './portrait-assignment.ts';
import { slugify } from './ad-export-html.ts';
import type { HouseAd, NewspaperContentType } from './types.ts';

// ── Helpers ─────────────────────────────────────────────────────────

async function withConn<T>(
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    await ensureNewspaperTables(conn);
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}

// ── Routes (/api/newspaper) ─────────────────────────────────────────

const newspaperRoutes = new Hono();

/** GET /api/newspaper/edition/latest — most recent edition with all articles */
newspaperRoutes.get('/edition/latest', async (c) => {
  const result = await withConn(async (conn) => {
    const edition = await getLatestEdition(conn);
    if (!edition) return null;
    const articles = await getArticlesByEdition(conn, edition.id);
    return { ...edition, articles };
  });

  if (result == null) {
    return c.json({ error: 'No editions found' }, 404);
  }
  return c.json(result);
});

/** GET /api/newspaper/edition/:date — edition by date with all articles */
newspaperRoutes.get('/edition/:date', async (c) => {
  const date: string = c.req.param('date');
  // Basic date format validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const result = await withConn(async (conn) => {
    const edition = await getEditionByDate(conn, date);
    if (!edition) return null;
    const articles = await getArticlesByEdition(conn, edition.id);
    return { ...edition, articles };
  });

  if (result == null) {
    return c.json({ error: 'Edition not found' }, 404);
  }
  return c.json(result);
});

/** GET /api/newspaper/edition/:date/news — edition-scoped news items */
newspaperRoutes.get('/edition/:date/news', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const items = await withConn(async (conn) => {
    const reader = await conn.runAndReadAll(
      `SELECT ni.id, ni.title, ni.source_url, ns.name AS source_name,
              ni.summary, CAST(ni.published_at AS VARCHAR) AS published_at,
              c.name AS company_name
       FROM news_item ni
       JOIN news_source ns ON ns.id = ni.news_source_id
       LEFT JOIN company c ON c.id = ni.company_id
       WHERE ni.published_at < CAST(? AS DATE) + INTERVAL 1 DAY
         AND ni.summary IS NOT NULL AND LENGTH(ni.summary) > 0
       ORDER BY ni.published_at DESC
       LIMIT 5`,
      [date] as import('@duckdb/node-api').DuckDBValue[],
    );

    return reader.getRowObjectsJS().map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      title: String(r.title),
      sourceUrl: String(r.source_url),
      sourceName: r.source_name != null ? String(r.source_name) : null,
      summary: r.summary != null ? String(r.summary) : null,
      publishedAt: r.published_at != null ? String(r.published_at) : null,
      companyName: r.company_name != null ? String(r.company_name) : null,
    }));
  });

  return c.json({ data: items });
});

/** GET /api/newspaper/edition/:date/adjacent — prev and next edition dates */
newspaperRoutes.get('/edition/:date/adjacent', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }
  const result = await withConn((conn) => getAdjacentEditions(conn, date));
  return c.json(result);
});

/** GET /api/newspaper/editions — paginated edition list */
newspaperRoutes.get('/editions', async (c) => {
  const q = c.req.query();
  const limit: number = Math.min(Number(q.limit) || 20, 100);
  const offset: number = Math.max(Number(q.offset) || 0, 0);

  const editions = await withConn((conn) => listEditions(conn, limit, offset));
  return c.json(editions);
});

/** Content-type map for image extensions we serve. */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Base directory for generated newspaper images. */
const IMAGES_ROOT: string = resolve('data', 'newspaper', 'images');

/** GET /api/newspaper/images/library/:subpath+ — serve library images (public, no auth) */
newspaperRoutes.get('/images/library/:subpath{.+}', async (c) => {
  const subpath: string = c.req.param('subpath');

  // Reject path traversal
  if (subpath.includes('..') || /[\\]/.test(subpath)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const filePath: string = join(IMAGES_ROOT, 'library', subpath);
  const resolved: string = resolve(filePath);

  if (!resolved.startsWith(IMAGES_ROOT)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const ext: string = resolved.substring(resolved.lastIndexOf('.'));
  const contentType: string | undefined = IMAGE_CONTENT_TYPES[ext];
  if (contentType == null) {
    return c.json({ error: 'Unsupported image type' }, 400);
  }

  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      return c.json({ error: 'Not found' }, 404);
    }
    const data: Buffer = await readFile(resolved);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        'Cache-Control': 'public, max-age=604800',
      },
    });
  } catch {
    return c.json({ error: 'Not found' }, 404);
  }
});

/**
 * GET /api/newspaper/images/:date/:filename — serve generated images.
 * Only allows date-directory/filename pattern; prevents directory traversal.
 */
newspaperRoutes.get('/images/:date/:filename', async (c) => {
  const date: string = c.req.param('date');
  const filename: string = c.req.param('filename');

  // Validate date format and filename (no path separators)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format' }, 400);
  }
  if (/[/\\]/.test(filename) || filename.includes('..')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const filePath: string = join(IMAGES_ROOT, date, filename);
  const resolved: string = resolve(filePath);

  // Directory traversal guard: resolved path must be under IMAGES_ROOT
  if (!resolved.startsWith(IMAGES_ROOT)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Determine content type from extension
  const ext: string = filename.substring(filename.lastIndexOf('.'));
  const contentType: string | undefined = IMAGE_CONTENT_TYPES[ext];
  if (contentType == null) {
    return c.json({ error: 'Unsupported image type' }, 400);
  }

  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      return c.json({ error: 'Not found' }, 404);
    }
    const data: Buffer = await readFile(resolved);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return c.json({ error: 'Not found' }, 404);
  }
});

// ── Library routes (/api/newspaper/library) ──────────────────────────

/** GET /api/newspaper/library/portraits — list all portraits */
newspaperRoutes.get('/library/portraits', async (c) => {
  const portraits = await withConn((conn) =>
    listImagesByType(conn, 'portrait'),
  );
  return c.json(portraits);
});

/** GET /api/newspaper/library/portraits/:name — get portrait for a person name */
newspaperRoutes.get('/library/portraits/:name', async (c) => {
  const personName: string = decodeURIComponent(c.req.param('name'));

  const portrait = await withConn((conn) =>
    getPortraitForPerson(conn, personName),
  );

  if (portrait == null) {
    return c.json({ error: 'Portrait library not generated' }, 404);
  }
  return c.json(portrait);
});

/** GET /api/newspaper/library/section-headers — list all section headers */
newspaperRoutes.get('/library/section-headers', async (c) => {
  const headers = await withConn((conn) =>
    listImagesByType(conn, 'section_header'),
  );
  return c.json(headers);
});

/** GET /api/newspaper/library/section-headers/:name — get specific header by name */
newspaperRoutes.get('/library/section-headers/:name', async (c) => {
  const name: string = c.req.param('name');
  const dataDir: string = resolve('data');
  const imagePath: string = join(
    dataDir,
    'newspaper',
    'images',
    'library',
    'headers',
    `${name}.webp`,
  );

  const header = await withConn((conn) => getImageByPath(conn, imagePath));

  if (header == null) {
    return c.json({ error: 'Section header not found' }, 404);
  }
  return c.json(header);
});

const HOUSE_AD_FEATURES: string[] = [
  'receive a daily, personalized edition by email',
  'search on concepts as well as keywords',
  'save custom searches',
  'receive email alerts based on saved searches',
  "NEW! Chat with *The Orbit's* Editors",
];

/** GET /api/newspaper/house-ad/:date — deterministic house ad for the given date */
newspaperRoutes.get('/house-ad/:date', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const ad = await withConn((conn) => getHouseAdForDate(conn, date));

  if (ad == null) {
    return c.json({
      tagline: 'All the Frequencies Fit to Print',
      imageSubpath: null,
      features: HOUSE_AD_FEATURES,
    });
  }

  return c.json({
    tagline: ad.tagline,
    imageSubpath: `house-ads/${ad.imagePath.split('/').pop()}`,
    features: HOUSE_AD_FEATURES,
  });
});

/** GET /api/newspaper/edition/:date/slots — expected content slots for the date */
newspaperRoutes.get('/edition/:date/slots', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const { getContentTypesForDay } = await import('./rotation.ts');
  const { SLUG_MAP, DISPLAY_ORDER_MAP } = await import('./slot-dispatcher.ts');

  const dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay() as
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6;
  const slots = getContentTypesForDay(dayOfWeek);

  const DAILY_TYPES: NewspaperContentType[] = [
    'daily_digest',
    'hero_image',
    'fake_ad',
    'editorial_cartoon',
    'classifieds',
  ];

  const rotationTypes: NewspaperContentType[] = [
    slots.slotA,
    slots.slotB,
    slots.slotC,
  ].filter((t): t is NewspaperContentType => t != null);

  const allTypes: NewspaperContentType[] = [...DAILY_TYPES, ...rotationTypes];

  const IMAGE_TYPES = new Set<string>(['hero_image', 'editorial_cartoon']);
  const manifest = allTypes.map((ct) => ({
    contentType: ct,
    slug: SLUG_MAP[ct],
    displayOrder: DISPLAY_ORDER_MAP[ct],
    promptSlug: IMAGE_TYPES.has(ct)
      ? null
      : `newspaper-${ct.replace(/_/g, '-')}`,
    slotGroup: DAILY_TYPES.includes(ct)
      ? 'daily'
      : ct === slots.slotA
        ? 'slotA'
        : ct === slots.slotB
          ? 'slotB'
          : 'slotC',
  }));

  return c.json(manifest);
});

// ── Admin routes (/api/admin/newspaper) ──────────────────────────────

const newspaperAdminRoutes = new Hono();

/** POST /api/admin/newspaper/edition/:date/publish — publish a complete edition */
newspaperAdminRoutes.post('/edition/:date/publish', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const published: boolean = await withConn((conn) =>
    publishEdition(conn, date),
  );
  if (!published) {
    return c.json({ error: 'Edition not found or not complete' }, 409);
  }
  return c.json({ success: true });
});

/** POST /api/admin/newspaper/edition/:date/unpublish — unpublish an edition */
newspaperAdminRoutes.post('/edition/:date/unpublish', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const unpublished: boolean = await withConn((conn) =>
    unpublishEdition(conn, date),
  );
  if (!unpublished) {
    return c.json({ error: 'Edition not found' }, 404);
  }
  return c.json({ success: true });
});

/** DELETE /api/admin/newspaper/edition/:date — delete edition and articles */
newspaperAdminRoutes.delete('/edition/:date', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const result = await withConn((conn) => deleteEdition(conn, date));
  if (!result.deleted) {
    return c.json({ error: 'Edition not found' }, 404);
  }
  return c.json({ success: true, imagePaths: result.imagePaths });
});

/** PUT /api/admin/newspaper/edition/:date/article/:slug — edit article headline/body */
newspaperAdminRoutes.put('/edition/:date/article/:slug', async (c) => {
  const date: string = c.req.param('date');
  const slug: string = c.req.param('slug');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const body = await c.req.json<{ headline?: string; body?: string }>();

  const article = await withConn(async (conn) => {
    const edition = await getEditionByDate(conn, date);
    if (!edition) return null;
    return updateArticle(conn, edition.id, slug, body);
  });

  if (article == null) {
    return c.json({ error: 'Edition or article not found' }, 404);
  }
  return c.json(article);
});

/** GET /api/admin/newspaper/image-health?days=7 — check CDN reachability */
newspaperAdminRoutes.get('/image-health', async (c) => {
  const days: number = Math.min(Number(c.req.query('days')) || 7, 30);

  const { getConfigService } = await import('../lib/config.ts');
  const { runImageHealthCheck } = await import('./image-health.ts');

  const config = getConfigService();
  const baseUrl: string = `${config.get('appBaseUrl') as string}/newspaper`;

  const report = await withConn((conn) =>
    runImageHealthCheck(conn, baseUrl, days),
  );
  return c.json(report);
});

/** POST /api/admin/newspaper/generate/:date — generate (or fill missing) an edition */
newspaperAdminRoutes.post('/generate/:date', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const result = await withConn(async (conn) => {
    const { generateEdition } = await import('./generate-service.ts');
    return generateEdition(conn, date);
  });

  return c.json(result);
});

/** POST /api/admin/newspaper/generate/:date/:slug — generate a single content slot */
newspaperAdminRoutes.post('/generate/:date/:slug', async (c) => {
  const date: string = c.req.param('date');
  const slug: string = c.req.param('slug');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  // Reverse-lookup: slug → contentType
  const { SLUG_MAP } = await import('./slot-dispatcher.ts');
  const contentType = (
    Object.entries(SLUG_MAP) as Array<[NewspaperContentType, string]>
  ).find(([, s]) => s === slug)?.[0];

  if (contentType == null) {
    return c.json({ error: `Unknown article slug: ${slug}` }, 400);
  }

  const result = await withConn(async (conn) => {
    // Reset article to pending first so generation isn't skipped
    const edition = await getEditionByDate(conn, date);
    if (edition) {
      await resetArticle(conn, edition.id, slug);
    }
    const { generateEdition } = await import('./generate-service.ts');
    return generateEdition(conn, date, [contentType]);
  });

  return c.json(result);
});

/** POST /api/admin/newspaper/regenerate/:date — delete and regenerate an entire edition */
newspaperAdminRoutes.post('/regenerate/:date', async (c) => {
  const date: string = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const result = await withConn(async (conn) => {
    await deleteEdition(conn, date);
    const { generateEdition } = await import('./generate-service.ts');
    return generateEdition(conn, date);
  });

  return c.json(result);
});

// ── House ad library admin ──────────────────────────────────────────

type HouseAdListItem = {
  id: number;
  tagline: string;
  slug: string;
  htmlPath: string;
  imagePath: string;
  imageSubpath: string;
};

export function mapHouseAdToListItem(ad: HouseAd): HouseAdListItem {
  const slug: string = slugify(ad.tagline);
  const filename: string = ad.imagePath.split('/').pop() ?? '';
  return {
    id: ad.id,
    tagline: ad.tagline,
    slug,
    htmlPath: `/ads/${String(ad.id)}-${slug}.html`,
    imagePath: `/ads/${String(ad.id)}-${slug}.webp`,
    // Library subpath only — the client builds the absolute URL via
    // libraryImageUrl() so the asset host can differ from the API host
    // (CDN in prod, API server in dev — Vite doesn't proxy image paths).
    imageSubpath: `house-ads/${filename}`,
  };
}

/** GET /api/admin/newspaper/house-ads — list every entry in the house ad library */
newspaperAdminRoutes.get('/house-ads', async (c) => {
  const ads = await withConn(async (conn) => {
    const rows = await listHouseAds(conn);
    return rows.map(mapHouseAdToListItem);
  });
  return c.json({ ads });
});

export { newspaperRoutes, newspaperAdminRoutes };
