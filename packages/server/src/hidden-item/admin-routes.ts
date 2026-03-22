import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import { ensureHiddenItemTables } from './schema.ts';
import { hideItem, getSystemHides, unhideSystemItem } from './repository.ts';
import type { HideItemInput } from './types.ts';

const hiddenItemAdminRoutes = new Hono();

// GET /api/admin/hidden-items?content_type=filing — list system-scope hides
hiddenItemAdminRoutes.get('/', async (c) => {
  const contentType: string = c.req.query('content_type') ?? 'filing';
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureHiddenItemTables(conn);
    const hides = await getSystemHides(conn, contentType);
    return c.json(hides);
  } finally {
    conn.closeSync();
  }
});

// POST /api/admin/hidden-items — hide item system-wide
hiddenItemAdminRoutes.post('/', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<HideItemInput>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureHiddenItemTables(conn);
    const id: number = await hideItem(conn, user.id, body, 'system');
    return c.json({ id }, 201);
  } finally {
    conn.closeSync();
  }
});

// POST /api/admin/hidden-items/:id/unhide — remove system-wide hide
hiddenItemAdminRoutes.post('/:id/unhide', async (c) => {
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureHiddenItemTables(conn);
    const ok: boolean = await unhideSystemItem(conn, id);
    if (!ok) return c.json({ error: 'Not found or already unhidden' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

export { hiddenItemAdminRoutes };
