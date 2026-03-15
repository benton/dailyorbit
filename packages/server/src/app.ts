import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { configRoutes } from './config/routes.ts';
import { earthStationRoutes } from './earth-stations/routes.ts';
import { filingRoutes } from './filings/routes.ts';
import { getAuth } from './lib/auth.ts';
import { getConfigService } from './lib/config.ts';
import { satelliteRoutes } from './satellites/routes.ts';
import { companyRoutes, companyAdminRoutes } from './companies/routes.ts';
import { autocompleteRoutes, searchRoutes } from './search/routes.ts';
import { statsRoutes } from './stats/routes.ts';

const app = new Hono();

app.use(
  cors({
    origin: () => getConfigService().get('clientDomain') as string,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.get('/api/health', (c) => c.json({ status: 'ok' }));

app.on(['GET', 'POST'], '/api/auth/**', (c) => getAuth().handler(c.req.raw));

app.route('/api/admin/config', configRoutes);
app.route('/api/admin/stats', statsRoutes);
app.route('/api/admin/companies', companyAdminRoutes);
app.route('/api/filings', filingRoutes);
app.route('/api/satellites', satelliteRoutes);
app.route('/api/earth-stations', earthStationRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/autocomplete', autocompleteRoutes);
app.route('/api/companies', companyRoutes);

// Serve the built frontend when SERVE_STATIC=true (e.g. in Docker).
// In development, Vite runs separately with hot-reload.
const webDistPath: string = resolve(
  import.meta.dirname ?? '.',
  '../../web/dist',
);
if (process.env.SERVE_STATIC === 'true' && existsSync(webDistPath)) {
  app.use(
    '*',
    serveStatic({ root: webDistPath, rewriteRequestPath: (p: string) => p }),
  );
  // SPA fallback: serve index.html for any non-API path that didn't match a static file
  app.get(
    '*',
    serveStatic({ root: webDistPath, rewriteRequestPath: () => '/index.html' }),
  );
}

export default app;
