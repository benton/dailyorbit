import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import { ensureNewspaperTables } from './schema.ts';
import {
  getArticlesByEdition,
  getEditionByDate,
  getLatestEdition,
  listEditions,
} from './repository.ts';

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

export { newspaperRoutes };
