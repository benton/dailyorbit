import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import type { PaginatedRequest, SortOrder } from '../lib/pagination.ts';
import {
  getSatelliteById,
  getSatelliteFilings,
  getSatelliteStats,
} from './repository.ts';

const satelliteRoutes = new Hono();

/**
 * GET /:id
 *
 * Returns the space station record, paginated associated filings,
 * and quick stats (total filing count, most recent filing date,
 * distinct applicant count).
 */
satelliteRoutes.get('/:id', async (c) => {
  const idParam: string = c.req.param('id');
  const id: number = Number(idParam);
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    return c.json({ error: 'Invalid satellite id: must be an integer' }, 400);
  }

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);

  try {
    const satellite = await getSatelliteById(conn, id);
    if (satellite == null) {
      return c.json({ error: 'Satellite not found' }, 404);
    }

    const sortParam: string | undefined = c.req.query('sort');
    const paginationRequest: PaginatedRequest = {
      page: Number(c.req.query('page') ?? 1),
      pageSize: Number(c.req.query('pageSize') ?? 25),
      ...(sortParam != null ? { sort: sortParam } : {}),
      order: (c.req.query('order') ?? 'desc') as SortOrder,
    };

    const usName: string = satellite.us_name;
    const [filings, stats] = await Promise.all([
      getSatelliteFilings(conn, usName, paginationRequest),
      getSatelliteStats(conn, usName),
    ]);

    return c.json({ satellite, filings, stats });
  } finally {
    conn.closeSync();
  }
});

export { satelliteRoutes };
