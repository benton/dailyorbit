import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import { ensureAlertTables } from './schema.ts';
import { ensureContentFlagTables } from '../content-flag/schema.ts';
import { ensureSavedSearchTables } from '../saved-search/schema.ts';
import { ensureViewingHistoryTables } from '../viewing-history/schema.ts';
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

// GET /api/user/alerts/unread-count — count of active, unviewed alert flags
alertRoutes.get('/unread-count', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    await ensureViewingHistoryTables(conn);

    // Count alert flags where the content has NOT been viewed by the user.
    // "Viewed" means EITHER an explicit row in user_filing_view/user_news_view
    // OR the item's date is at/below the user's watermark in user_view_watermark.
    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM user_content_flag f
       WHERE f.user_id = $1
         AND f.source = 'alert'
         AND f.dismissed_at IS NULL
         AND (
           (f.content_type = 'filing'
             AND NOT EXISTS (
               SELECT 1 FROM user_filing_view v
               WHERE v.user_id = f.user_id AND v.file_number = f.content_key
             )
             AND NOT EXISTS (
               SELECT 1 FROM filing fl
               JOIN user_view_watermark w ON w.user_id = f.user_id AND w.content_type = 'filing'
               WHERE fl.file_number = f.content_key AND fl.date_filed <= w.watermark_at
             )
           )
           OR
           (f.content_type = 'news'
             AND NOT EXISTS (
               SELECT 1 FROM user_news_view v
               WHERE v.user_id = f.user_id AND CAST(v.news_item_id AS VARCHAR) = f.content_key
             )
             AND NOT EXISTS (
               SELECT 1 FROM news_item ni
               JOIN user_view_watermark w ON w.user_id = f.user_id AND w.content_type = 'news'
               WHERE CAST(ni.id AS VARCHAR) = f.content_key
                 AND COALESCE(ni.published_at, ni.created_at) <= w.watermark_at
             )
           )
         )`,
      [user.id],
    );
    const count: number = Number(reader.getRowObjectsJS()[0]!.cnt);
    return c.json({ count });
  } finally {
    conn.closeSync();
  }
});

// GET /api/user/alerts/flagged — active alert flags grouped by saved search with content details
alertRoutes.get('/flagged', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    await ensureSavedSearchTables(conn);

    const reader = await conn.runAndReadAll(
      `SELECT f.id AS flag_id, f.content_type, f.content_key, f.reason,
              f.saved_search_id, f.created_at::VARCHAR AS flagged_at,
              ss.name AS search_name,
              CASE f.content_type
                WHEN 'filing' THEN (SELECT fl.address_attention FROM filing fl WHERE fl.file_number = f.content_key)
                WHEN 'news' THEN (SELECT ni.title FROM news_item ni WHERE ni.id = CAST(f.content_key AS INTEGER))
              END AS item_title,
              CASE f.content_type
                WHEN 'filing' THEN (SELECT fl.subsystem_code || '-' || fl.app_type_code FROM filing fl WHERE fl.file_number = f.content_key)
                WHEN 'news' THEN (SELECT ns.name FROM news_item ni JOIN news_source ns ON ns.id = ni.news_source_id WHERE ni.id = CAST(f.content_key AS INTEGER))
              END AS item_subtitle
       FROM user_content_flag f
       LEFT JOIN saved_search ss ON ss.id = f.saved_search_id
       WHERE f.user_id = $1 AND f.source = 'alert' AND f.dismissed_at IS NULL
       ORDER BY ss.name, f.created_at DESC`,
      [user.id],
    );
    return c.json(reader.getRowObjectsJS());
  } finally {
    conn.closeSync();
  }
});

export { alertRoutes };
