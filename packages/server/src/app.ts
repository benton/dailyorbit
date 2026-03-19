import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { configRoutes } from './config/routes.ts';
import { earthStationRoutes } from './earth-stations/routes.ts';
import { filingRoutes } from './filings/routes.ts';
import { getAuth } from './lib/auth.ts';
import { requireAuth, requireAdmin } from './lib/auth-middleware.ts';
import { getConfigService } from './lib/config.ts';
import { satelliteRoutes } from './satellites/routes.ts';
import { companyRoutes, companyAdminRoutes } from './companies/routes.ts';
import { newsRoutes, newsAdminRoutes } from './news/routes.ts';
import { buildInferenceRoutes } from './inference/routes.ts';
import { autocompleteRoutes, searchRoutes } from './search/routes.ts';
import { publicStatsRoutes, statsRoutes } from './stats/routes.ts';
import {
  userRoutes,
  userProfileRoutes,
  userAdminRoutes,
} from './user/routes.ts';
import { userSettingsRoutes } from './user-settings/routes.ts';
import { viewingHistoryRoutes } from './viewing-history/routes.ts';
import { pipelineRoutes } from './pipeline/routes.ts';
import { queryRoutes } from './query/routes.ts';
import { consultantRoutes, consultantAdminRoutes } from './consultant/routes.ts';
import { chatRoutes } from './chat/routes.ts';

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

app.all('/api/auth/*', (c) => getAuth().handler(c.req.raw));

// Protected API routes — require authentication
// Public endpoints are exempted: health, auth, stats, filings, satellites,
// earth-stations, search, autocomplete, companies (pregenerated content).
// User-specific and admin endpoints still require auth.
const publicPrefixes: string[] = [
  '/api/health',
  '/api/auth/',
  '/api/stats',
  '/api/filings',
  '/api/satellites',
  '/api/earth-stations',
  '/api/search',
  '/api/autocomplete',
  '/api/companies',
  '/api/news',
  '/api/consultants',
];
app.use('/api/*', async (c, next) => {
  const path: string = c.req.path;
  if (publicPrefixes.some((prefix: string) => path.startsWith(prefix))) {
    return next();
  }
  return requireAuth()(c, next);
});

// Admin routes — require admin role
app.use('/api/admin/*', requireAdmin());

app.route('/api/me', userRoutes);
app.route('/api/user', userProfileRoutes);
app.route('/api/user/settings', userSettingsRoutes);
app.route('/api/user/viewing-history', viewingHistoryRoutes);
app.route('/api/admin/config', configRoutes);
app.route('/api/admin/stats', statsRoutes);
app.route('/api/admin/companies', companyAdminRoutes);
app.route('/api/admin/inference', buildInferenceRoutes());
app.route('/api/admin/news', newsAdminRoutes);
app.route('/api/admin/users', userAdminRoutes);
app.route('/api/admin/pipeline', pipelineRoutes);
app.route('/api/filings', filingRoutes);
app.route('/api/satellites', satelliteRoutes);
app.route('/api/earth-stations', earthStationRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/autocomplete', autocompleteRoutes);
app.route('/api/companies', companyRoutes);
app.route('/api/news', newsRoutes);
app.route('/api/query', queryRoutes);
app.route('/api/stats', publicStatsRoutes);
app.route('/api/consultants', consultantRoutes);
app.route('/api/conversations', chatRoutes);
app.route('/api/admin/consultants', consultantAdminRoutes);

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
