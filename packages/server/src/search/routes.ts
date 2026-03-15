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
  const req: PaginatedRequest = {};
  if (query.page != null) req.page = Number(query.page);
  if (query.pageSize != null) req.pageSize = Number(query.pageSize);
  if (query.sort != null) req.sort = query.sort;
  if (query.order === 'asc' || query.order === 'desc') req.order = query.order;
  return req;
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
  const filters: FilingSearchFilters = {};
  if (q.file_number != null) filters.file_number = q.file_number;
  if (q.callsign != null) filters.callsign = q.callsign;
  if (q.applicant != null) filters.applicant = q.applicant;
  const subsystems = parseList(q.subsystem_code);
  if (subsystems != null) filters.subsystem_code = subsystems;
  const appTypes = parseList(q.app_type_code);
  if (appTypes != null) filters.app_type_code = appTypes;
  const statuses = parseList(q.status_code);
  if (statuses != null) filters.status_code = statuses;
  if (q.date_filed_from != null) filters.date_filed_from = q.date_filed_from;
  if (q.date_filed_to != null) filters.date_filed_to = q.date_filed_to;
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
  const filters: SatelliteSearchFilters = {};
  if (q.us_name != null) filters.us_name = q.us_name;
  if (q.itu_name != null) filters.itu_name = q.itu_name;
  if (q.orbit_location != null) filters.orbit_location = q.orbit_location;
  if (q.active != null) filters.active = q.active === 'true';
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
  const filters: EarthStationSearchFilters = {};
  if (q.callsign != null) filters.callsign = q.callsign;
  if (q.applicant != null) filters.applicant = q.applicant;
  if (q.state != null) filters.state = q.state;
  if (q.city != null) filters.city = q.city;
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
