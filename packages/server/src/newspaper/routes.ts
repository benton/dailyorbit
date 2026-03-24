import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import { ensureNewspaperTables } from './schema.ts';
import {
  getArticlesByEdition,
  getEditionByDate,
  getImageByPath,
  getLatestEdition,
  listEditions,
  listImagesByType,
  resetArticle,
} from './repository.ts';
import { getPortraitForPerson } from './portrait-assignment.ts';

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

/** GET /api/newspaper/images/library/:subpath+ — serve library images */
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

/** POST /api/newspaper/edition/:date/regenerate/:slug — reset article to pending for regeneration */
newspaperRoutes.post('/edition/:date/regenerate/:slug', async (c) => {
  const date: string = c.req.param('date');
  const slug: string = c.req.param('slug');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const result = await withConn(async (conn) => {
    const edition = await getEditionByDate(conn, date);
    if (!edition) return null;
    await resetArticle(conn, edition.id, slug);
    const articles = await getArticlesByEdition(conn, edition.id);
    const article = articles.find((a) => a.slug === slug);
    return article ?? null;
  });

  if (result == null) {
    return c.json({ error: 'Edition or article not found' }, 404);
  }
  return c.json({ success: true, article: result });
});

export { newspaperRoutes };
