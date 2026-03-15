import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import { getFilingByFileNumber } from './repository.ts';

const filingRoutes = new Hono();

/**
 * GET /:fileNumber
 *
 * Returns the full filing detail including lookup labels,
 * attachments, petitions, and related entity links.
 */
filingRoutes.get('/:fileNumber', async (c) => {
  const fileNumber: string = c.req.param('fileNumber');

  if (fileNumber.trim() === '') {
    return c.json({ error: 'File number is required' }, 400);
  }

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);

  try {
    const filing = await getFilingByFileNumber(conn, fileNumber);
    if (filing == null) {
      return c.json({ error: 'Filing not found' }, 404);
    }
    return c.json(filing);
  } finally {
    conn.closeSync();
  }
});

export { filingRoutes };
