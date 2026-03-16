import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin, requireAuth } from './auth-middleware.ts';

// Mock the auth module
vi.mock('./auth.ts', () => ({
  getAuth: vi.fn(),
}));

import { getAuth } from './auth.ts';

const mockGetAuth = vi.mocked(getAuth);

function buildApp(): Hono {
  const app = new Hono();
  app.use('/protected/*', requireAuth());
  app.use('/admin/*', requireAuth());
  app.use('/admin/*', requireAdmin());
  app.get('/protected/resource', (c) => c.json({ data: 'ok' }));
  app.get('/admin/resource', (c) => c.json({ data: 'admin-ok' }));
  return app;
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 when no session exists', async () => {
    mockGetAuth.mockReturnValue({
      api: { getSession: vi.fn().mockResolvedValue(null) },
    } as never);

    const app = buildApp();
    const res = await app.request('/protected/resource');
    expect(res.status).toEqual(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('passes through with valid session', async () => {
    mockGetAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'u1', email: 'a@b.com', name: 'Test', role: 'user' },
          session: { id: 's1' },
        }),
      },
    } as never);

    const app = buildApp();
    const res = await app.request('/protected/resource');
    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body).toEqual({ data: 'ok' });
  });
});

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 403 when user is not admin', async () => {
    mockGetAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'u1', email: 'a@b.com', name: 'Test', role: 'user' },
          session: { id: 's1' },
        }),
      },
    } as never);

    const app = buildApp();
    const res = await app.request('/admin/resource');
    expect(res.status).toEqual(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('passes through when user is admin', async () => {
    mockGetAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'u1', email: 'a@b.com', name: 'Admin', role: 'admin' },
          session: { id: 's1' },
        }),
      },
    } as never);

    const app = buildApp();
    const res = await app.request('/admin/resource');
    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body).toEqual({ data: 'admin-ok' });
  });
});
