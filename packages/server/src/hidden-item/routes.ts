import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import { ensureHiddenItemTables } from './schema.ts';
import {
  getActiveHiddenKeys,
  getActiveHidesForUser,
  hideItem,
  unhideAllForUser,
  unhideItem,
} from './repository.ts';
import type { HideItemInput } from './types.ts';

const hiddenItemRoutes = new Hono();

// GET /api/user/hidden-items?content_type=filing — list active user-scope hides
hiddenItemRoutes.get('/', async (c) => {
  const user: SessionUser = c.get('user');
  const contentType: string = c.req.query('content_type') ?? 'filing';
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureHiddenItemTables(conn);
    const hides = await getActiveHidesForUser(conn, user.id, contentType);
    return c.json(hides);
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/hidden-items — hide a single item (scope='user')
hiddenItemRoutes.post('/', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<HideItemInput>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureHiddenItemTables(conn);
    const id: number = await hideItem(conn, user.id, body);
    return c.json({ id }, 201);
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/hidden-items/bulk-check — check which keys are hidden (user OR system)
hiddenItemRoutes.post('/bulk-check', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{
    content_type: string;
    content_keys: string[];
  }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureHiddenItemTables(conn);
    const hidden: Set<string> = await getActiveHiddenKeys(
      conn,
      user.id,
      body.content_type,
      body.content_keys,
    );
    return c.json({ hidden: [...hidden] });
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/hidden-items/:id/unhide — unhide a single item
hiddenItemRoutes.post('/:id/unhide', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureHiddenItemTables(conn);
    const ok: boolean = await unhideItem(conn, id, user.id);
    if (!ok) return c.json({ error: 'Not found or already unhidden' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/hidden-items/unhide-all — unhide all user-scope hides
hiddenItemRoutes.post('/unhide-all', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureHiddenItemTables(conn);
    const count: number = await unhideAllForUser(conn, user.id);
    return c.json({ count });
  } finally {
    conn.closeSync();
  }
});

export { hiddenItemRoutes };
