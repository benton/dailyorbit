import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import {
  createConsultant,
  listConsultants,
  updateConsultant,
  archiveConsultant,
} from './repository.ts';

// ── Helpers ─────────────────────────────────────────────────────────

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

// ── Admin routes (mounted at /api/admin/consultants) ────────────────

export const consultantAdminRoutes = new Hono();

consultantAdminRoutes.get('/', async (c) => {
  const consultants = await withConn((conn) =>
    listConsultants(conn, { enabledOnly: false }),
  );
  return c.json(consultants);
});

consultantAdminRoutes.post('/', async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.slug || !body.systemPrompt) {
    return c.json({ error: 'name, slug, and systemPrompt are required' }, 400);
  }
  try {
    const consultant = await withConn((conn) => createConsultant(conn, body));
    return c.json(consultant, 201);
  } catch (err: unknown) {
    const message: string =
      err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE') || message.includes('Duplicate')) {
      return c.json({ error: `Slug "${body.slug}" already exists` }, 409);
    }
    return c.json({ error: message }, 500);
  }
});

consultantAdminRoutes.put('/:id', async (c) => {
  const id: number = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const body = await c.req.json();
  const updated = await withConn((conn) => updateConsultant(conn, id, body));
  if (updated == null) return c.json({ error: 'Consultant not found' }, 404);
  return c.json(updated);
});

consultantAdminRoutes.delete('/:id', async (c) => {
  const id: number = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const archived: boolean = await withConn((conn) =>
    archiveConsultant(conn, id),
  );
  if (!archived) return c.json({ error: 'Consultant not found' }, 404);
  return c.json({ ok: true });
});

// ── Public routes (mounted at /api/consultants) ─────────────────────

export const consultantRoutes = new Hono();

consultantRoutes.get('/', async (c) => {
  const consultants = await withConn((conn) =>
    listConsultants(conn, { enabledOnly: true }),
  );
  return c.json(consultants);
});
