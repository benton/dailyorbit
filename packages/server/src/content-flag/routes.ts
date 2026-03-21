import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import { ensureContentFlagTables } from './schema.ts';
import {
  createBulkFlags,
  createFlag,
  dismissFlag,
  getActiveFlagKeys,
  getActiveFlagsForUser,
  undismissFlag,
} from './repository.ts';
import type { BulkFlagInput, CreateFlagInput } from './types.ts';

const contentFlagRoutes = new Hono();

// GET /api/user/flags?content_type=filing — list active flags for current user
contentFlagRoutes.get('/', async (c) => {
  const user: SessionUser = c.get('user');
  const contentType: string = c.req.query('content_type') ?? 'filing';
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const flags = await getActiveFlagsForUser(conn, user.id, contentType);
    return c.json(flags);
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/flags — create a single flag
contentFlagRoutes.post('/', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<CreateFlagInput>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const id: number = await createFlag(conn, user.id, body);
    return c.json({ id }, 201);
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/flags/bulk — create flags for multiple content keys
contentFlagRoutes.post('/bulk', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<BulkFlagInput>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const ids: number[] = await createBulkFlags(conn, user.id, body);
    return c.json({ ids }, 201);
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/flags/bulk-check — check which keys are flagged (for list UI)
contentFlagRoutes.post('/bulk-check', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{
    content_type: string;
    content_keys: string[];
  }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const flagged: Set<string> = await getActiveFlagKeys(
      conn,
      user.id,
      body.content_type,
      body.content_keys,
    );
    return c.json({ flagged: [...flagged] });
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/flags/:id/dismiss — soft-delete a flag
contentFlagRoutes.post('/:id/dismiss', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const ok: boolean = await dismissFlag(conn, id, user.id);
    if (!ok) return c.json({ error: 'Not found or already dismissed' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

// POST /api/user/flags/:id/undismiss — restore a dismissed flag
contentFlagRoutes.post('/:id/undismiss', async (c) => {
  const user: SessionUser = c.get('user');
  const id: number = Number(c.req.param('id'));
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    const ok: boolean = await undismissFlag(conn, id, user.id);
    if (!ok) return c.json({ error: 'Not found or not dismissed' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

export { contentFlagRoutes };
