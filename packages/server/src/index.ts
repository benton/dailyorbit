import { serve } from '@hono/node-server';
import app from './app.ts';
import { getLogger } from './lib/logger.ts';

const PORT = 9000;

serve({ fetch: app.fetch, port: PORT }, () => {
  getLogger().info(`Server running at http://localhost:${String(PORT)}`);
});
