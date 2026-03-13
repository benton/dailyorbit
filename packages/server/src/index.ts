import { serve } from '@hono/node-server';
import app from './app.ts';

const PORT = 9000;

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
