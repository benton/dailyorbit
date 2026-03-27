import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getConfigService } from '../lib/config.ts';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import type { PaginatedRequest } from '../lib/pagination.ts';
import {
  InferenceService,
  type ConverseFunction,
} from './inference-service.ts';
import { listInferenceLog } from './log-repository.ts';
import { listAvailableModels } from './models.ts';
import { PROMPT_REGISTRY } from './prompt-registry.ts';
import type { InferenceRequest } from './types.ts';

/** Build inference admin routes. Accepts optional backend override for testing. */
export function buildInferenceRoutes(mockBackend?: ConverseFunction): Hono {
  const routes = new Hono();

  /** POST /test — Run a test inference call. */
  routes.post('/test', async (c) => {
    const body = await c.req.json<InferenceRequest>();

    if (!body.messages || body.messages.length === 0) {
      return c.json(
        { error: 'messages array must contain at least one message' },
        400,
      );
    }

    try {
      let backend: ConverseFunction;
      if (mockBackend != null) {
        backend = mockBackend;
      } else {
        // Lazy-import to avoid circular deps at module load
        const { getInferenceService } = await import('./index.ts');
        return c.json(await getInferenceService().complete(body));
      }
      const svc = new InferenceService(backend);
      return c.json(await svc.complete(body));
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 502);
    }
  });

  /** GET /models — List available Bedrock models. */
  routes.get('/models', async (c) => {
    try {
      const config = getConfigService();
      const region: string = config.get('bedrockRegion') as string;
      const models = await listAvailableModels(region);
      return c.json(models);
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 502);
    }
  });

  /** GET /prompt-templates — Return prompt registry for the admin UI. */
  routes.get('/prompt-templates', (c) => {
    return c.json(PROMPT_REGISTRY);
  });

  /** GET /costs — Paginated inference log with computed costs. */
  routes.get('/costs', async (c) => {
    const query: Record<string, string> = c.req.query();
    const request: PaginatedRequest = {};
    if (query.page != null) request.page = Number(query.page);
    if (query.pageSize != null) request.pageSize = Number(query.pageSize);
    if (query.sort != null) request.sort = query.sort;
    if (query.order === 'asc' || query.order === 'desc')
      request.order = query.order;

    const db = await getDb();
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);
    try {
      const result = await listInferenceLog(conn, request);
      return c.json(result);
    } finally {
      conn.closeSync();
    }
  });

  return routes;
}
