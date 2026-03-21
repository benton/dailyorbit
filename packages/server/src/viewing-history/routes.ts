import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import {
  type ContentType,
  getRecentlyViewed,
  getUnreadFilingsSince,
  getViewedFileNumbers,
  getViewedNewsIds,
  getWatermarks,
  markNewsUnread,
  markNewsViewed,
  markUnread,
  markViewed,
  setWatermark,
} from './repository.ts';

const viewingHistoryRoutes = new Hono();

viewingHistoryRoutes.post('/mark-read', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ fileNumber: string }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await markViewed(conn, user.id, body.fileNumber);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

viewingHistoryRoutes.post('/mark-unread', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ fileNumber: string }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await markUnread(conn, user.id, body.fileNumber);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

viewingHistoryRoutes.post('/bulk-check', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ fileNumbers: string[] }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const viewed: Set<string> = await getViewedFileNumbers(
      conn,
      user.id,
      body.fileNumbers,
    );
    return c.json({ viewed: [...viewed] });
  } finally {
    conn.closeSync();
  }
});

viewingHistoryRoutes.get('/unread', async (c) => {
  const user: SessionUser = c.get('user');
  const sinceParam: string = c.req.query('since') ?? '7';
  const days: number = parseInt(sinceParam, 10) || 7;
  const since: Date = new Date();
  since.setDate(since.getDate() - days);

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const filings = await getUnreadFilingsSince(conn, user.id, since);
    return c.json(filings);
  } finally {
    conn.closeSync();
  }
});

viewingHistoryRoutes.get('/recent', async (c) => {
  const user: SessionUser = c.get('user');
  const limit: number = parseInt(c.req.query('limit') ?? '10', 10) || 10;

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const recent = await getRecentlyViewed(conn, user.id, limit);
    return c.json(recent);
  } finally {
    conn.closeSync();
  }
});

// ── News viewing history ─────────────────────────────────────────────

viewingHistoryRoutes.post('/news/mark-read', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ newsItemId: number }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await markNewsViewed(conn, user.id, body.newsItemId);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

viewingHistoryRoutes.post('/news/mark-unread', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ newsItemId: number }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await markNewsUnread(conn, user.id, body.newsItemId);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

viewingHistoryRoutes.post('/news/bulk-check', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ newsItemIds: number[] }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const viewed: Set<number> = await getViewedNewsIds(
      conn,
      user.id,
      body.newsItemIds,
    );
    return c.json({ viewed: [...viewed] });
  } finally {
    conn.closeSync();
  }
});

// ── Watermark routes ────────────────────────────────────────────────

viewingHistoryRoutes.post('/mark-all-read', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<{ contentType: ContentType }>();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const watermarkAt: Date = await setWatermark(
      conn,
      user.id,
      body.contentType,
    );
    return c.json({ ok: true, watermarkAt: watermarkAt.toISOString() });
  } finally {
    conn.closeSync();
  }
});

viewingHistoryRoutes.get('/watermarks', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const wms: Map<ContentType, Date> = await getWatermarks(conn, user.id);
    return c.json({
      filing: wms.get('filing')?.toISOString() ?? null,
      news: wms.get('news')?.toISOString() ?? null,
    });
  } finally {
    conn.closeSync();
  }
});

export { viewingHistoryRoutes };
