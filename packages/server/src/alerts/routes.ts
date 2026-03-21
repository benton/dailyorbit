import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import { ensureAlertTables } from './schema.ts';
import { getAlertRunsForSearch } from './repository.ts';

const alertRoutes = new Hono();

// GET /api/user/alerts/history/:savedSearchId — alert run history for a saved search
alertRoutes.get('/history/:savedSearchId', async (c) => {
  const savedSearchId: number = Number(c.req.param('savedSearchId'));
  const limit: number = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureAlertTables(conn);
    const runs = await getAlertRunsForSearch(conn, savedSearchId, limit);
    return c.json(runs);
  } finally {
    conn.closeSync();
  }
});

// GET /api/user/alerts/summary — summary of recent alert activity for current user
alertRoutes.get('/summary', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureAlertTables(conn);
    const reader = await conn.runAndReadAll(
      `SELECT ar.id, ar.saved_search_id, ss.name AS search_name,
              ar.pipeline_run_id, ar.executed_at::VARCHAR AS executed_at,
              ar.items_matched, ar.items_flagged, ar.email_sent, ar.error
       FROM alert_run ar
       JOIN saved_search ss ON ss.id = ar.saved_search_id
       WHERE ss.user_id = $1
       ORDER BY ar.executed_at DESC
       LIMIT 50`,
      [user.id],
    );
    return c.json(reader.getRowObjectsJS());
  } finally {
    conn.closeSync();
  }
});

export { alertRoutes };
