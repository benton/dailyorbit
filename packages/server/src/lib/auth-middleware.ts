import type { Context, MiddlewareHandler } from 'hono';
import { getAuth } from './auth.ts';
import type { SessionUser } from '../user/SessionUser.ts';

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUser;
  }
}

/**
 * Middleware that validates the session cookie or bearer token.
 * On success, sets `c.get('user')` to the session user.
 * Returns 401 if no valid session is found.
 */
export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next) => {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (session == null) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const user: SessionUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role:
        ((session.user as Record<string, unknown>).role as string) ?? 'user',
    };

    c.set('user', user);
    await next();
  };
}

/**
 * Middleware that checks the current user has the 'admin' role.
 * Must be used after `requireAuth()`.
 * Returns 403 if the user is not an admin.
 */
export function requireAdmin(): MiddlewareHandler {
  return async (c: Context, next) => {
    const user: SessionUser = c.get('user');
    if (user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
}
