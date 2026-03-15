import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { configRoutes } from './config/routes.ts';
import { statsRoutes } from './stats/routes.ts';
import { getAuth } from './lib/auth.ts';
import { getConfigService } from './lib/config.ts';

const app = new Hono();

app.use(
  cors({
    origin: () => getConfigService().get('clientDomain') as string,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.get('/', (c) => c.json({ status: 'ok' }));

app.on(['GET', 'POST'], '/api/auth/**', (c) => getAuth().handler(c.req.raw));

app.route('/api/admin/config', configRoutes);
app.route('/api/admin/stats', statsRoutes);

export default app;
