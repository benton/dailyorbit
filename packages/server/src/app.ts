import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './lib/auth.ts';
import { CLIENT_DOMAIN } from './lib/env.ts';

const app = new Hono();

app.use(
  cors({
    origin: CLIENT_DOMAIN,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.get('/', (c) => c.json({ status: 'ok' }));

app.on(['GET', 'POST'], '/api/auth/**', (c) => auth.handler(c.req.raw));

export default app;
