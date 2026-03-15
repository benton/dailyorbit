import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { configRoutes } from './config/routes.ts';
import { earthStationRoutes } from './earth-stations/routes.ts';
import { filingRoutes } from './filings/routes.ts';
import { getAuth } from './lib/auth.ts';
import { getConfigService } from './lib/config.ts';
import { satelliteRoutes } from './satellites/routes.ts';
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

app.get('/', (c) => c.json({ status: 'ok' }));

app.on(['GET', 'POST'], '/api/auth/**', (c) => getAuth().handler(c.req.raw));

app.route('/api/admin/config', configRoutes);
app.route('/api/admin/stats', statsRoutes);
app.route('/api/filings', filingRoutes);
app.route('/api/satellites', satelliteRoutes);
app.route('/api/earth-stations', earthStationRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/autocomplete', autocompleteRoutes);

export default app;
