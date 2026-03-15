import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import type { PaginatedRequest, SortOrder } from '../lib/pagination.ts';
import {
  getEarthStationAntennas,
  getEarthStationByCallsign,
  getEarthStationFilings,
  getEarthStationStats,
} from './repository.ts';
import type { EarthStationDetailResponse } from './types.ts';

const earthStationRoutes = new Hono();

earthStationRoutes.get('/:callsign', async (c) => {
  const callsign: string = c.req.param('callsign').toUpperCase();

  const db = await getDb();
  const conn = await db.connect();

  try {
    const info = await getEarthStationByCallsign(conn, callsign);
    if (info == null) {
      return c.json({ error: `Earth station not found: ${callsign}` }, 404);
    }

    const paginationRequest: PaginatedRequest = {
      page: Number(c.req.query('page') ?? '1'),
      pageSize: Number(c.req.query('pageSize') ?? '25'),
      sort: c.req.query('sort'),
      order: (c.req.query('order') ?? 'desc') as SortOrder,
    };

    const [filings, antennas, stats] = await Promise.all([
      getEarthStationFilings(conn, callsign, paginationRequest),
      getEarthStationAntennas(conn, callsign),
      getEarthStationStats(conn, callsign),
    ]);

    const response: EarthStationDetailResponse = {
      info,
      filings,
      antennas,
      stats,
    };

    return c.json(response);
  } finally {
    conn.closeSync();
  }
});

export { earthStationRoutes };
