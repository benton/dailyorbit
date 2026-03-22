import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import {
  planRewind,
  executeRewind,
  type RewindOptions,
  type RewindResult,
} from './rewind.ts';

const testAdminRoutes = new Hono();

async function withConn<T>(
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const conn = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}

/**
 * POST /plan — dry-run: returns deletion counts without executing.
 * Body: { since?: string, last?: number, full?: boolean }
 */
testAdminRoutes.post('/rewind/plan', async (c) => {
  const body = await c.req.json<RewindOptions>();
  const opts: RewindOptions = {
    since: body.since,
    last: body.last,
    full: body.full,
    dryRun: true,
  };
  const result: RewindResult = await withConn((conn) => planRewind(conn, opts));
  return c.json(result);
});

/**
 * POST /execute — execute the rewind deletion.
 * Body: { since?: string, last?: number, full?: boolean }
 */
testAdminRoutes.post('/rewind/execute', async (c) => {
  const body = await c.req.json<RewindOptions>();
  const opts: RewindOptions = {
    since: body.since,
    last: body.last,
    full: body.full,
    dryRun: false,
  };
  const result: RewindResult = await withConn((conn) =>
    executeRewind(conn, opts),
  );
  return c.json(result);
});

export { testAdminRoutes };
