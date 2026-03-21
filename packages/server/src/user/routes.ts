import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getConfigService } from '../lib/config.ts';
import { getDb } from '../lib/db.ts';
import { SecretValue } from '../lib/encryption.ts';
import { gravatarUrl } from '../lib/gravatar.ts';
import {
  createEmailService,
  type EmailServiceConfig,
} from '../email/email-service.ts';
import { renderTestEmail } from '../email/test-email.ts';
import type { SessionUser } from './SessionUser.ts';
import { UserService } from './user-service.ts';

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  gravatarUrl: string;
};

// ── Public user route (requires auth, mounted at /api/me) ──────────

const userRoutes = new Hono();

userRoutes.get('/', (c) => {
  const user: SessionUser = c.get('user');
  return c.json(user);
});

// ── Profile routes (mounted at /api/user) ──────────────────────────

const userProfileRoutes = new Hono();

userProfileRoutes.get('/profile', async (c) => {
  const sessionUser: SessionUser = c.get('user');
  const service: UserService = await getService();
  const user = await service.getUser(sessionUser.id);
  if (user == null) {
    return c.json({ error: 'User not found' }, 404);
  }

  const profile: UserProfile = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    gravatarUrl: gravatarUrl(user.email, 128),
  };
  return c.json(profile);
});

userProfileRoutes.patch('/profile', async (c) => {
  const sessionUser: SessionUser = c.get('user');
  const body = await c.req.json<{ name?: string }>();

  if (body.name != null) {
    const db = await getDb();
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    try {
      await conn.run(
        'UPDATE "user" SET name = $1, "updatedAt" = current_timestamp WHERE id = $2',
        [body.name, sessionUser.id],
      );
    } finally {
      conn.closeSync();
    }
  }

  const service: UserService = await getService();
  const user = await service.getUser(sessionUser.id);
  if (user == null) {
    return c.json({ error: 'User not found' }, 404);
  }

  const profile: UserProfile = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    gravatarUrl: gravatarUrl(user.email, 128),
  };
  return c.json(profile);
});

// ── Admin user management routes (mounted at /api/admin/users) ─────

const userAdminRoutes = new Hono();

async function getService(): Promise<UserService> {
  const db = await getDb();
  return new UserService(db);
}

userAdminRoutes.get('/', async (c) => {
  const service: UserService = await getService();
  const users = await service.listUsers();
  return c.json(users);
});

userAdminRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    email: string;
    name: string;
    password: string;
    role?: string;
  }>();

  if (!body.email || !body.name || !body.password) {
    return c.json({ error: 'email, name, and password are required' }, 400);
  }

  const service: UserService = await getService();
  const user = await service.createUser(
    body.email,
    body.name,
    new SecretValue(body.password),
    body.role,
  );
  return c.json(user, 201);
});

userAdminRoutes.get('/:id', async (c) => {
  const id: string = c.req.param('id');
  const service: UserService = await getService();
  const user = await service.getUser(id);
  if (user == null) {
    return c.json({ error: 'User not found' }, 404);
  }
  return c.json(user);
});

userAdminRoutes.put('/:id/disable', async (c) => {
  const id: string = c.req.param('id');
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}));
  const service: UserService = await getService();
  await service.disableUser(id, (body as { reason?: string }).reason);
  return c.json({ ok: true });
});

userAdminRoutes.put('/:id/enable', async (c) => {
  const id: string = c.req.param('id');
  const service: UserService = await getService();
  await service.enableUser(id);
  return c.json({ ok: true });
});

userAdminRoutes.delete('/:id', async (c) => {
  const id: string = c.req.param('id');
  const service: UserService = await getService();
  await service.deleteUser(id);
  return c.json({ ok: true });
});

userAdminRoutes.post('/:id/reset-password', async (c) => {
  const id: string = c.req.param('id');
  const body = await c.req.json<{ password: string }>();
  if (!body.password) {
    return c.json({ error: 'password is required' }, 400);
  }
  const service: UserService = await getService();
  await service.resetPassword(id, new SecretValue(body.password));
  return c.json({ ok: true });
});

userAdminRoutes.put('/:id/role', async (c) => {
  const id: string = c.req.param('id');
  const body = await c.req.json<{ role: string }>();
  if (!body.role) {
    return c.json({ error: 'role is required' }, 400);
  }
  const service: UserService = await getService();
  await service.setRole(id, body.role);
  return c.json({ ok: true });
});

userAdminRoutes.post('/:id/send-test-email', async (c) => {
  const id: string = c.req.param('id');
  const service: UserService = await getService();
  const user = await service.getUser(id);
  if (user == null) {
    return c.json({ error: 'User not found' }, 404);
  }

  const config = getConfigService();
  const emailConfig: EmailServiceConfig = {
    transport: config.get('emailTransport') as 'ses' | 'smtp' | 'test',
    region: config.get('emailRegion') as string,
    senderAddress: config.get('emailSenderAddress') as string,
  };
  const emailService = createEmailService(emailConfig);
  const appBaseUrl: string = config.get('appBaseUrl') as string;

  const mail = renderTestEmail({
    recipientName: user.name,
    recipientEmail: user.email,
    appBaseUrl,
  });

  await emailService.sendMail(mail);
  return c.json({ ok: true, to: user.email });
});

export { userRoutes, userProfileRoutes, userAdminRoutes };
