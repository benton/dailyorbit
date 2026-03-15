import { Hono } from 'hono';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import type { PaginatedRequest } from '../lib/pagination.ts';
import {
  addAlias,
  createCompany,
  extractOwnershipEvents,
  getAttributionStats,
  getCompanyDetail,
  getCompanyFilings,
  listCompanies,
  removeAlias,
  searchCompanies,
  updateCompany,
} from './repository.ts';
import { runBatchAttribution, seedCompanies } from './attribution.ts';
import { COMPANY_SEED_DATA } from './seed-data.ts';
import type { AliasType } from './types.ts';

// ── Helpers ─────────────────────────────────────────────────────────

function parsePagination(query: Record<string, string>): PaginatedRequest {
  const req: PaginatedRequest = {};
  if (query.page != null) req.page = Number(query.page);
  if (query.pageSize != null) req.pageSize = Number(query.pageSize);
  if (query.sort != null) req.sort = query.sort;
  if (query.order === 'asc' || query.order === 'desc') req.order = query.order;
  return req;
}

async function withConn<T>(
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  trackConnection(conn);
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}

// ── Public routes (/api/companies) ──────────────────────────────────

const companyRoutes = new Hono();

companyRoutes.get('/', async (c) => {
  const q = c.req.query();
  const pagination: PaginatedRequest = parsePagination(q);
  const result = await withConn((conn) => listCompanies(conn, pagination));
  return c.json(result);
});

companyRoutes.get('/search', async (c) => {
  const query: string = c.req.query('q') ?? '';
  const limit: number = Number(c.req.query('limit') ?? '20');
  if (query.trim() === '') {
    return c.json([]);
  }
  const results = await withConn((conn) => searchCompanies(conn, query, limit));
  return c.json(results);
});

companyRoutes.get('/:id', async (c) => {
  const id: number = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid company ID' }, 400);
  }
  const detail = await withConn((conn) => getCompanyDetail(conn, id));
  if (detail == null) {
    return c.json({ error: 'Company not found' }, 404);
  }
  return c.json(detail);
});

companyRoutes.get('/:id/filings', async (c) => {
  const id: number = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid company ID' }, 400);
  }
  const q = c.req.query();
  const pagination: PaginatedRequest = parsePagination(q);
  const result = await withConn((conn) =>
    getCompanyFilings(conn, id, pagination),
  );
  return c.json(result);
});

// ── Admin routes (/api/admin/companies) ─────────────────────────────

const companyAdminRoutes = new Hono();

companyAdminRoutes.get('/attribution', async (c) => {
  const stats = await withConn((conn) => getAttributionStats(conn));
  return c.json(stats);
});

companyAdminRoutes.post('/attribute', async (c) => {
  const result = await withConn((conn) => runBatchAttribution(conn));
  return c.json(result);
});

companyAdminRoutes.post('/seed', async (c) => {
  const result = await withConn((conn) =>
    seedCompanies(conn, COMPANY_SEED_DATA),
  );
  return c.json(result);
});

companyAdminRoutes.post('/extract-ownership', async (c) => {
  const result = await withConn((conn) => extractOwnershipEvents(conn));
  return c.json(result);
});

companyAdminRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const name: string | undefined = body.name;
  if (name == null || name.trim() === '') {
    return c.json({ error: 'Company name is required' }, 400);
  }
  const company = await withConn((conn) =>
    createCompany(conn, {
      name,
      parentCompanyId: body.parentCompanyId ?? null,
      stockTicker: body.stockTicker ?? null,
      stockExchange: body.stockExchange ?? null,
      industry: body.industry ?? null,
      website: body.website ?? null,
      description: body.description ?? null,
    }),
  );
  return c.json(company, 201);
});

companyAdminRoutes.put('/:id', async (c) => {
  const id: number = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid company ID' }, 400);
  }
  const body = await c.req.json();
  const updated = await withConn((conn) => updateCompany(conn, id, body));
  if (updated == null) {
    return c.json({ error: 'Company not found' }, 404);
  }
  return c.json(updated);
});

companyAdminRoutes.post('/:id/aliases', async (c) => {
  const id: number = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid company ID' }, 400);
  }
  const body = await c.req.json();
  const aliasName: string | undefined = body.aliasName;
  if (aliasName == null || aliasName.trim() === '') {
    return c.json({ error: 'Alias name is required' }, 400);
  }
  const aliasType: AliasType = body.aliasType ?? 'legal_name';
  await withConn((conn) => addAlias(conn, id, aliasName, aliasType));
  return c.json({ ok: true }, 201);
});

companyAdminRoutes.delete('/:id/aliases/:name', async (c) => {
  const id: number = Number(c.req.param('id'));
  const name: string = decodeURIComponent(c.req.param('name'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid company ID' }, 400);
  }
  await withConn((conn) => removeAlias(conn, id, name));
  return c.json({ ok: true });
});

export { companyRoutes, companyAdminRoutes };
