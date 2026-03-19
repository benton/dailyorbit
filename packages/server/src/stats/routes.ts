import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb, getDbPath } from '../lib/db.ts';
import {
  getApplicantFilings,
  getDatasetStats,
  getAttachmentCount,
  getCommentCount,
  getFilingCount,
  getFilingsBySubsystem,
  getRecentFilingVolumeByCompany,
  getRecentFilings,
  getTopLineStats,
  getYearlyFilingVolume,
  getTopApplicants,
} from './repository.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';

/**
 * Compute the most recent business day's date as YYYY-MM-DD.
 * On Saturday → Friday, on Sunday → Friday, otherwise → yesterday.
 * Uses US Eastern time for day-of-week determination.
 */
function lastBusinessDate(): string {
  const now: Date = new Date();
  // Convert to US Eastern for day-of-week check
  const eastern: string = now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  const today: Date = new Date(
    now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
  );

  let daysBack: number = 1;
  if (eastern === 'Sat') {
    daysBack = 1;
  } else if (eastern === 'Sun') {
    daysBack = 2;
  } else if (eastern === 'Mon') {
    daysBack = 3;
  }

  today.setDate(today.getDate() - daysBack);
  return today.toISOString().slice(0, 10);
}

/** Returns the day name for the last business date (e.g., "Friday" on weekends). */
function lastBusinessDayLabel(): string {
  const dateStr: string = lastBusinessDate();
  const date: Date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

// ── Public stats routes (/api/stats) ────────────────────────────────

const publicStatsRoutes = new Hono();

publicStatsRoutes.get('/', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const [
      filing_count,
      filings_by_subsystem,
      comment_count,
      attachment_count,
    ] = await Promise.all([
      getFilingCount(conn),
      getFilingsBySubsystem(conn),
      getCommentCount(conn),
      getAttachmentCount(conn),
    ]);
    return c.json({
      filing_count,
      filings_by_subsystem,
      comment_count,
      attachment_count,
    });
  } finally {
    conn.closeSync();
  }
});

publicStatsRoutes.get('/filing-volume', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const volume = await getYearlyFilingVolume(conn);
    return c.json(volume);
  } finally {
    conn.closeSync();
  }
});

publicStatsRoutes.get('/recent-filings', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const targetDate: string = lastBusinessDate();
    const dayLabel: string = lastBusinessDayLabel();
    const filings = await getRecentFilings(conn, targetDate);
    return c.json({ date: targetDate, dayLabel, filings });
  } finally {
    conn.closeSync();
  }
});

publicStatsRoutes.get('/top-line-stats', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const stats = await getTopLineStats(conn);
    return c.json(stats);
  } finally {
    conn.closeSync();
  }
});

publicStatsRoutes.get('/recent-volume-by-company', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const volume = await getRecentFilingVolumeByCompany(conn);
    return c.json(volume);
  } finally {
    conn.closeSync();
  }
});

// ── Admin stats routes (/api/admin/stats) ───────────────────────────

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
    const volume = await getYearlyFilingVolume(conn);
    return c.json(volume);
  } finally {
    conn.closeSync();
  }
});

export { publicStatsRoutes, statsRoutes };
