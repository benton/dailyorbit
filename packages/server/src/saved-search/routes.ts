import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import {
  createSavedSearch,
  getSavedSearchById,
  getSavedSearchesForUser,
  updateSavedSearch,
  deleteSavedSearch,
} from './repository.ts';
import { executeSavedSearch } from './execute.ts';
import type { CreateSavedSearchInput } from './types.ts';

const savedSearchRoutes = new Hono();

// GET / — list current user's saved searches
savedSearchRoutes.get('/', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const searches = await getSavedSearchesForUser(conn, user.id);
    return c.json(searches);
  } finally {
    conn.closeSync();
  }
});

// GET /:id — get a single saved search
savedSearchRoutes.get('/:id', async (c) => {
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const saved = await getSavedSearchById(conn, id);
    if (saved == null) return c.json({ error: 'Not found' }, 404);
    return c.json(saved);
  } finally {
    conn.closeSync();
  }
});

// POST / — create a new saved search
savedSearchRoutes.post('/', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<CreateSavedSearchInput>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const id: number = await createSavedSearch(conn, user.id, body);
    const saved = await getSavedSearchById(conn, id);
    return c.json(saved, 201);
  } finally {
    conn.closeSync();
  }
});

// PATCH /:id — update name or alert_enabled
savedSearchRoutes.patch('/:id', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: string; alert_enabled?: boolean }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const updated: boolean = await updateSavedSearch(conn, id, user.id, body);
    if (!updated) return c.json({ error: 'Not found or not owned' }, 404);
    const saved = await getSavedSearchById(conn, id);
    return c.json(saved);
  } finally {
    conn.closeSync();
  }
});

// DELETE /:id
savedSearchRoutes.delete('/:id', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const deleted: boolean = await deleteSavedSearch(conn, id, user.id);
    if (!deleted) return c.json({ error: 'Not found or not owned' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

// GET /:id/execute — re-run a saved search
savedSearchRoutes.get('/:id/execute', async (c) => {
  const id: number = Number(c.req.param('id'));
  const page: number = Number(c.req.query('page') ?? '1');
  const pageSize: number = Math.min(
    Number(c.req.query('pageSize') ?? '25'),
    100,
  );
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const saved = await getSavedSearchById(conn, id);
    if (saved == null) return c.json({ error: 'Not found' }, 404);
    const result = await executeSavedSearch(
      conn,
      saved.content_type,
      saved.filters,
      { page, pageSize },
    );
    return c.json(result);
  } finally {
    conn.closeSync();
  }
});

export { savedSearchRoutes };
