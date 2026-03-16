import { Hono } from 'hono';
import { getConfigService } from '../lib/config.ts';
import {
  InferenceService,
  type ConverseFunction,
} from './inference-service.ts';
import { listAvailableModels } from './models.ts';
import {
  DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
  DEFAULT_SUMMARIZATION_USER_PROMPT,
  SUMMARIZATION_VARIABLES,
} from './prompts.ts';
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

  /** GET /prompt-templates — Return prompt template metadata for the admin UI. */
  routes.get('/prompt-templates', (c) => {
    return c.json({
      summarization: {
        defaultSystemPrompt: DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
        defaultUserPrompt: DEFAULT_SUMMARIZATION_USER_PROMPT,
        variables: SUMMARIZATION_VARIABLES,
      },
    });
  });

  return routes;
}
