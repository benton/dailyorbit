import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb, getDbPath } from '../lib/db.ts';
import { APP_VERSION } from '../version.ts';
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
  getWeeklyFilingVolume,
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

/** Returns today's date in YYYY-MM-DD format using US Eastern timezone. */
function todayEastern(): string {
  const now: Date = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** Returns true if the current Eastern time hour is >= 8 (8:00 AM through 11:59 PM). */
function isEasternBusinessHours(): boolean {
  const now: Date = new Date();
  const hourStr: string = now.toLocaleString('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'America/New_York',
  });
  const hour: number = parseInt(hourStr, 10);
  return hour >= 8;
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

publicStatsRoutes.get('/todays-filings', async (c) => {
  if (!isEasternBusinessHours()) {
    return c.json({ visible: false, date: null, filings: [] });
  }
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const todayDate: string = todayEastern();
    const filings = await getRecentFilings(conn, todayDate);
    return c.json({ visible: true, date: todayDate, filings });
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

publicStatsRoutes.get('/weekly-filing-volume', async (c) => {
  const before: string = c.req.query('before') ?? todayEastern();
  const ref: Date = new Date(before + 'T12:00:00Z');
  const dow: number = ref.getUTCDay();
  const daysToMonday: number = dow === 0 ? 6 : dow - 1;
  const prevMonday: Date = new Date(
    ref.getTime() - (daysToMonday + 7) * 86_400_000,
  );
  const prevFriday: Date = new Date(prevMonday.getTime() + 4 * 86_400_000);
  const mondayStr: string = prevMonday.toISOString().slice(0, 10);
  const fridayStr: string = prevFriday.toISOString().slice(0, 10);

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const volume = await getWeeklyFilingVolume(conn, mondayStr, fridayStr);
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
    return c.json({ ...stats, version: APP_VERSION });
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
