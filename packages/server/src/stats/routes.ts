import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb, getDbPath } from '../lib/db.ts';
import {
  getApplicantFilings,
  getDatasetStats,
  getMonthlyFilingVolume,
  getTopApplicants,
} from './repository.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';

const statsRoutes = new Hono();

statsRoutes.get('/', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const stats = await getDatasetStats(conn, getDbPath());
    return c.json(stats);
  } finally {
    conn.closeSync();
  }
});

statsRoutes.get('/applicant-graph', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const limit: number = Number(c.req.query('limit') ?? '20');
    const applicants = await getTopApplicants(conn, limit);
    const names: string[] = applicants.map((a) => a.name);
    const filings = await getApplicantFilings(conn, names);
    return c.json({ applicants, filings });
  } finally {
    conn.closeSync();
  }
});

statsRoutes.get('/filing-volume', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const volume = await getMonthlyFilingVolume(conn);
    return c.json(volume);
  } finally {
    conn.closeSync();
  }
});

export { statsRoutes };
