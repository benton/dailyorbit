import { Hono } from 'hono';
import { CONFIG_SCHEMA, type ConfigKey } from '../lib/config-schema.ts';
import { getConfigService } from '../lib/config.ts';
import { SecretValue } from '../lib/encryption.ts';

type ConfigEntry = {
  key: string;
  description: string;
  value: string;
  encrypted: boolean;
};

const MASKED_VALUE: string = '********';

export function buildConfigEntries(): ConfigEntry[] {
  const service = getConfigService();
  return Object.entries(CONFIG_SCHEMA).map(([key, def]) => {
    const raw = service.get(key as ConfigKey);
    const value: string =
      raw instanceof SecretValue ? MASKED_VALUE : (raw as string);
    return {
      key,
      description: def.description,
      value,
      encrypted: def.encrypted,
    };
  });
}

const configRoutes = new Hono();

configRoutes.get('/', (c) => {
  const entries: ConfigEntry[] = buildConfigEntries();
  return c.json(entries);
});

configRoutes.put('/:key', async (c) => {
  const key: string = c.req.param('key');
  if (!(key in CONFIG_SCHEMA)) {
    return c.json({ error: `Unknown config key: ${key}` }, 400);
  }
  const body = await c.req.json<{ value: string }>();
  if (typeof body.value !== 'string') {
    return c.json(
      { error: 'Request body must include a string "value" field' },
      400,
    );
  }
  const service = getConfigService();
  await service.set(key as ConfigKey, body.value);
  return c.json({ ok: true });
});

export { configRoutes };
