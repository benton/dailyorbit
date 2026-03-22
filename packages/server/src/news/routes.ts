import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import type { PaginatedRequest } from '../lib/pagination.ts';
import {
  createNewsSource,
  deleteNewsSource,
  getNewsItemById,
  listNewsItems,
  listNewsSources,
  updateNewsSource,
} from './repository.ts';
import type { ExtractStatus, NewsSourceCategory } from './types.ts';
import { getAuth } from '../lib/auth.ts';

// ── Helpers ─────────────────────────────────────────────────────────

function parsePagination(query: Record<string, string>): PaginatedRequest {
  const req: PaginatedRequest = {};
  if (query.page != null) req.page = Number(query.page);
  if (query.pageSize != null) req.pageSize = Number(query.pageSize);
  if (query.sort != null) req.sort = query.sort;
  if (query.order === 'asc' || query.order === 'desc') req.order = query.order;
  return req;
}

async function withConn<T>(
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}

// ── Public routes (/api/news) ───────────────────────────────────────

const newsRoutes = new Hono();

newsRoutes.get('/', async (c) => {
  const q = c.req.query();
  const pagination: PaginatedRequest = parsePagination(q);
  const filters: {
    newsSourceId?: number;
    companyId?: number;
    extractStatus?: ExtractStatus;
    showHidden?: boolean;
    userId?: string;
  } = {};

  if (q.sourceId != null) filters.newsSourceId = Number(q.sourceId);
  if (q.companyId != null) filters.companyId = Number(q.companyId);
  if (q.extractStatus != null)
    filters.extractStatus = q.extractStatus as ExtractStatus;
  if (q.show_hidden === 'true') filters.showHidden = true;
  const newsSession = await getAuth().api.getSession({
    headers: c.req.raw.headers,
  });
  if (newsSession != null) filters.userId = newsSession.user.id;

  const result = await withConn((conn) =>
    listNewsItems(conn, pagination, filters),
  );
  return c.json(result);
});

newsRoutes.get('/sources', async (c) => {
  const sources = await withConn((conn) => listNewsSources(conn));
  return c.json(sources);
});

newsRoutes.get('/:id', async (c) => {
  const id: number = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid news item ID' }, 400);
  }
  const item = await withConn((conn) => getNewsItemById(conn, id));
  if (item == null) {
    return c.json({ error: 'News item not found' }, 404);
  }
  return c.json(item);
});

// ── Admin routes (/api/admin/news) ──────────────────────────────────

const newsAdminRoutes = new Hono();

newsAdminRoutes.get('/sources', async (c) => {
  const sources = await withConn((conn) => listNewsSources(conn));
  return c.json(sources);
});

newsAdminRoutes.post('/sources', async (c) => {
  const body = await c.req.json();
  const name: string | undefined = body.name;
  const feedUrl: string | undefined = body.feedUrl;
  if (name == null || name.trim() === '') {
    return c.json({ error: 'Source name is required' }, 400);
  }
  if (feedUrl == null || feedUrl.trim() === '') {
    return c.json({ error: 'Feed URL is required' }, 400);
  }
  const source = await withConn((conn) =>
    createNewsSource(conn, {
      name,
      feedUrl,
      category: (body.category as NewsSourceCategory) ?? 'industry',
      enabled: body.enabled ?? true,
      fetchIntervalMinutes: body.fetchIntervalMinutes ?? 60,
    }),
  );
  return c.json(source, 201);
});

newsAdminRoutes.put('/sources/:id', async (c) => {
  const id: number = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid source ID' }, 400);
  }
  const body = await c.req.json();
  const updated = await withConn((conn) =>
    updateNewsSource(conn, id, {
      name: body.name,
      enabled: body.enabled,
      fetchIntervalMinutes: body.fetchIntervalMinutes,
      category: body.category,
    }),
  );
  if (updated == null) {
    return c.json({ error: 'Source not found' }, 404);
  }
  return c.json(updated);
});

newsAdminRoutes.post('/sources/:id/fetch', async (c) => {
  const id: number = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid source ID' }, 400);
  }
  const { getNewsSourceById } = await import('./repository.ts');
  const { fetchSingleSource } = await import('./rss-fetcher.ts');
  const result = await withConn(async (conn) => {
    const source = await getNewsSourceById(conn, id);
    if (source == null) return null;
    return fetchSingleSource(conn, source);
  });
  if (result == null) {
    return c.json({ error: 'Source not found' }, 404);
  }
  return c.json(result);
});

newsAdminRoutes.delete('/sources/:id', async (c) => {
  const id: number = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid source ID' }, 400);
  }
  const deleted = await withConn((conn) => deleteNewsSource(conn, id));
  if (!deleted) {
    return c.json({ error: 'Source not found' }, 404);
  }
  return c.json({ ok: true });
});

export { newsRoutes, newsAdminRoutes };
