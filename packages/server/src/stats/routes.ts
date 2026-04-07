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
  getRandomOrbitLocation,
} from './repository.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import { lastBusinessDayBefore, weekdayLabel } from './business-day.ts';

/**
 * Compute the most recent business day's date as YYYY-MM-DD, relative to
 * today in US Eastern time. Delegates the weekend-skipping logic to
 * `lastBusinessDayBefore` so the newspaper's "yesterday" matches the
 * dashboard's.
 */
function lastBusinessDate(): string {
  const todayEasternIso: string = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });
  return lastBusinessDayBefore(todayEasternIso);
}

/** Returns the day name for the last business date (e.g., "Friday" on weekends). */
function lastBusinessDayLabel(): string {
  return weekdayLabel(lastBusinessDate());
}

/** Returns today's date in YYYY-MM-DD format using US Eastern timezone. */
function todayEastern(): string {
  const now: Date = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Returns true when "Today's Filings" should be shown on the dashboard.
 * Hidden on Saturday and Sunday (ET), and hidden before 8 AM ET on Monday
 * (since no new filings arrive over the weekend).
 */
function isTodaysFilingsVisible(): boolean {
  const now: Date = new Date();
  const eastern: string = now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  if (eastern === 'Sat' || eastern === 'Sun') {
    return false;
  }
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
  if (!isTodaysFilingsVisible()) {
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

// ── Weather cache (1-hour TTL) ──────────────────────────────────────

type WeatherCache = {
  data: { temp: number; condition: string };
  fetchedAt: number;
};

const WEATHER_CACHE_TTL_MS: number = 60 * 60 * 1000;
let weatherCache: WeatherCache | null = null;

const WMO_CONDITIONS: Record<number, { label: string; symbol: string }> = {
  0: { label: 'Clear sky', symbol: '☀' },
  1: { label: 'Mainly clear', symbol: '☀' },
  2: { label: 'Partly cloudy', symbol: '☁' },
  3: { label: 'Overcast', symbol: '☁' },
  45: { label: 'Fog', symbol: '〰' },
  48: { label: 'Depositing rime fog', symbol: '〰' },
  51: { label: 'Light drizzle', symbol: '☂' },
  53: { label: 'Moderate drizzle', symbol: '☂' },
  55: { label: 'Dense drizzle', symbol: '☂' },
  56: { label: 'Freezing drizzle', symbol: '☂' },
  57: { label: 'Dense freezing drizzle', symbol: '☂' },
  61: { label: 'Slight rain', symbol: '☂' },
  63: { label: 'Moderate rain', symbol: '☂' },
  65: { label: 'Heavy rain', symbol: '☂' },
  66: { label: 'Freezing rain', symbol: '☂' },
  67: { label: 'Heavy freezing rain', symbol: '☂' },
  71: { label: 'Slight snow', symbol: '❄' },
  73: { label: 'Moderate snow', symbol: '❄' },
  75: { label: 'Heavy snow', symbol: '❄' },
  77: { label: 'Snow grains', symbol: '❄' },
  80: { label: 'Slight rain showers', symbol: '☂' },
  81: { label: 'Moderate rain showers', symbol: '☂' },
  82: { label: 'Violent rain showers', symbol: '☂' },
  95: { label: 'Thunderstorm', symbol: '⚡' },
  96: { label: 'Thunderstorm with hail', symbol: '⚡' },
  99: { label: 'Thunderstorm with heavy hail', symbol: '⚡' },
};

async function fetchOpenMeteoWeather(): Promise<{
  temp: number;
  condition: string;
  symbol: string;
}> {
  const now: number = Date.now();
  if (weatherCache && now - weatherCache.fetchedAt < WEATHER_CACHE_TTL_MS) {
    const cachedCondition: string = weatherCache.data.condition;
    const cachedSymbol: string =
      Object.values(WMO_CONDITIONS).find((v) => v.label === cachedCondition)
        ?.symbol ?? '☁';
    return {
      temp: weatherCache.data.temp,
      condition: cachedCondition,
      symbol: cachedSymbol,
    };
  }

  const url: string =
    'https://api.open-meteo.com/v1/forecast?latitude=38.9072&longitude=-77.0369&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America/New_York';
  const resp: Response = await fetch(url);
  const json = (await resp.json()) as {
    current: { temperature_2m: number; weather_code: number };
  };
  const temp: number = Math.round(json.current.temperature_2m);
  const code: number = json.current.weather_code;
  const info = WMO_CONDITIONS[code] ?? { label: 'Partly cloudy', symbol: '☁' };

  weatherCache = { data: { temp, condition: info.label }, fetchedAt: now };
  return { temp, condition: info.label, symbol: info.symbol };
}

publicStatsRoutes.get('/masthead-weather', async (c) => {
  const dateParam: string = c.req.query('date') ?? todayEastern();
  const date: Date = new Date(dateParam + 'T12:00:00Z');
  const dayOfWeek: number = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 3=Wed

  if (dayOfWeek === 1 || dayOfWeek === 3) {
    // Monday or Wednesday → real weather
    try {
      const weather = await fetchOpenMeteoWeather();
      return c.json({
        type: 'real',
        temp: weather.temp,
        condition: weather.condition,
        symbol: weather.symbol,
        unit: '°F',
      });
    } catch {
      // Fallback to orbital joke on fetch failure
      return c.json({
        type: 'orbital',
        name: 'GEO',
        location: '0°',
      });
    }
  }

  // Other days → orbital joke
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    const orbit = await getRandomOrbitLocation(conn);
    if (orbit) {
      return c.json({
        type: 'orbital',
        name: orbit.name,
        location: orbit.location,
      });
    }
    return c.json({
      type: 'orbital',
      name: 'GEO',
      location: '0°',
    });
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
