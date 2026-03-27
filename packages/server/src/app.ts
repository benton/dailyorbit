import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { getLogger } from './lib/logger.ts';
import { requestLogger } from './lib/request-logger.ts';
import { APP_VERSION } from './version.ts';
import { configRoutes } from './config/routes.ts';
import { earthStationRoutes } from './earth-stations/routes.ts';
import { filingRoutes } from './filings/routes.ts';
import { getAuth } from './lib/auth.ts';
import { requireAuth, requireAdmin } from './lib/auth-middleware.ts';
import { getConfigService } from './lib/config.ts';
import { satelliteRoutes } from './satellites/routes.ts';
import { companyRoutes, companyAdminRoutes } from './companies/routes.ts';
import { newsRoutes, newsAdminRoutes } from './news/routes.ts';
import { newspaperRoutes, newspaperAdminRoutes } from './newspaper/routes.ts';
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
import { savedSearchRoutes } from './saved-search/routes.ts';
import { contentFlagRoutes } from './content-flag/routes.ts';
import { hiddenItemRoutes } from './hidden-item/routes.ts';
import { alertRoutes } from './alerts/routes.ts';
import { pipelineRoutes } from './pipeline/routes.ts';
import { backupRoutes } from './backup/routes.ts';
import { queryRoutes } from './query/routes.ts';
import {
  consultantRoutes,
  consultantAdminRoutes,
} from './consultant/routes.ts';
import { chatRoutes } from './chat/routes.ts';
import { testAdminRoutes } from './test-utils/routes.ts';
import { hiddenItemAdminRoutes } from './hidden-item/admin-routes.ts';
import { logsRoutes } from './logs/routes.ts';

const app = new Hono();

app.use(
  cors({
    origin: () => getConfigService().get('clientDomain') as string,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.get('/api/health', (c) => c.json({ status: 'ok', version: APP_VERSION }));

app.use('*', requestLogger(getLogger()));

app.all('/api/auth/*', (c) => getAuth().handler(c.req.raw));

// Protected API routes — require authentication for ALL endpoints.
// Newspaper images are public so <img> tags can load them without cookies.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/newspaper/images/')) {
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
app.route('/api/user/saved-searches', savedSearchRoutes);
app.route('/api/user/flags', contentFlagRoutes);
app.route('/api/user/hidden-items', hiddenItemRoutes);
app.route('/api/user/alerts', alertRoutes);
app.route('/api/admin/config', configRoutes);
app.route('/api/admin/stats', statsRoutes);
app.route('/api/admin/companies', companyAdminRoutes);
app.route('/api/admin/inference', buildInferenceRoutes());
app.route('/api/admin/news', newsAdminRoutes);
app.route('/api/admin/users', userAdminRoutes);
app.route('/api/admin/pipeline', pipelineRoutes);
app.route('/api/admin/backups', backupRoutes);
app.route('/api/admin/newspaper', newspaperAdminRoutes);
app.route('/api/admin/hidden-items', hiddenItemAdminRoutes);
app.route('/api/filings', filingRoutes);
app.route('/api/satellites', satelliteRoutes);
app.route('/api/earth-stations', earthStationRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/autocomplete', autocompleteRoutes);
app.route('/api/companies', companyRoutes);
app.route('/api/news', newsRoutes);
app.route('/api/newspaper', newspaperRoutes);
app.route('/api/query', queryRoutes);
app.route('/api/stats', publicStatsRoutes);
app.route('/api/consultants', consultantRoutes);
app.route('/api/conversations', chatRoutes);
app.route('/api/admin/consultants', consultantAdminRoutes);
app.route('/api/admin/logs', logsRoutes);
app.route('/api/admin/test', testAdminRoutes);

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
