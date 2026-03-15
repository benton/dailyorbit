import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import type { PaginatedRequest } from '../lib/pagination.ts';
import { getDb } from '../lib/db.ts';
import {
  autocomplete,
  searchEarthStations,
  searchFilings,
  searchSatellites,
} from './repository.ts';
import type {
  EarthStationSearchFilters,
  FilingSearchFilters,
  SatelliteSearchFilters,
} from './types.ts';

const searchRoutes = new Hono();

/** Parse pagination params from query string */
function parsePagination(query: Record<string, string>): PaginatedRequest {
  return {
    page: query.page != null ? Number(query.page) : undefined,
    pageSize: query.pageSize != null ? Number(query.pageSize) : undefined,
    sort: query.sort ?? undefined,
    order:
      query.order === 'desc'
        ? 'desc'
        : query.order === 'asc'
          ? 'asc'
          : undefined,
  };
}

/** Parse a comma-separated query param into a string array, or undefined */
function parseList(value: string | undefined): string[] | undefined {
  if (value == null || value.trim() === '') return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

// GET /api/search/filings
searchRoutes.get('/filings', async (c) => {
  const q = c.req.query();
  const filters: FilingSearchFilters = {
    file_number: q.file_number ?? undefined,
    callsign: q.callsign ?? undefined,
    applicant: q.applicant ?? undefined,
    subsystem_code: parseList(q.subsystem_code),
    app_type_code: parseList(q.app_type_code),
    status_code: parseList(q.status_code),
    date_filed_from: q.date_filed_from ?? undefined,
    date_filed_to: q.date_filed_to ?? undefined,
  };
  const pagination: PaginatedRequest = parsePagination(q);

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const result = await searchFilings(conn, filters, pagination);
    return c.json(result);
  } finally {
    conn.closeSync();
  }
});

// GET /api/search/satellites
searchRoutes.get('/satellites', async (c) => {
  const q = c.req.query();
  const filters: SatelliteSearchFilters = {
    us_name: q.us_name ?? undefined,
    itu_name: q.itu_name ?? undefined,
    orbit_location: q.orbit_location ?? undefined,
    active: q.active != null ? q.active === 'true' : undefined,
  };
  const pagination: PaginatedRequest = parsePagination(q);

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const result = await searchSatellites(conn, filters, pagination);
    return c.json(result);
  } finally {
    conn.closeSync();
  }
});

// GET /api/search/earth-stations
searchRoutes.get('/earth-stations', async (c) => {
  const q = c.req.query();
  const filters: EarthStationSearchFilters = {
    callsign: q.callsign ?? undefined,
    applicant: q.applicant ?? undefined,
    state: q.state ?? undefined,
    city: q.city ?? undefined,
  };
  const pagination: PaginatedRequest = parsePagination(q);

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const result = await searchEarthStations(conn, filters, pagination);
    return c.json(result);
  } finally {
    conn.closeSync();
  }
});

// GET /api/autocomplete/:entity/:field
const autocompleteRoutes = new Hono();

autocompleteRoutes.get('/:entity/:field', async (c) => {
  const entity: string = c.req.param('entity');
  const field: string = c.req.param('field');
  const q: string = c.req.query('q') ?? '';
  const limit: number = Math.min(Number(c.req.query('limit') ?? 10), 50);

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const results: string[] = await autocomplete(conn, entity, field, q, limit);
    return c.json(results);
  } finally {
    conn.closeSync();
  }
});

export { searchRoutes, autocompleteRoutes };
