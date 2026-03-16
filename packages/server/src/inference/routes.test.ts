import { randomBytes } from 'node:crypto';
import { DuckDBInstance } from '@duckdb/node-api';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../lib/config-service.ts';
import { setConfigService } from '../lib/config.ts';
import { initializeDatabase } from '../lib/db-init.ts';
import { buildInferenceRoutes } from './routes.ts';

const TEST_KEY: Buffer = randomBytes(32);
let db: DuckDBInstance;

beforeEach(async () => {
  db = await DuckDBInstance.create(':memory:');
  await initializeDatabase(db);
  const service = new ConfigService(db, TEST_KEY);
  await service.seedDefaults();
  setConfigService(service);
});

afterEach(() => {
  db.closeSync();
});

describe('inference routes', () => {
  describe('POST /test', () => {
    it('returns inference response from mock backend', async () => {
      const mockBackend = {
        converse: vi.fn().mockResolvedValue({
          output: {
            message: {
              role: 'assistant',
              content: [{ text: 'Test response' }],
            },
          },
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
          stopReason: 'end_turn',
        }),
      };

      const app = new Hono();
      app.route('/inference', buildInferenceRoutes(mockBackend));

      const resp = await app.request('/inference/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          params: { maxTokens: 128 },
        }),
      });

      expect(resp.status).toEqual(200);
      const body = (await resp.json()) as {
        content: string;
        usage: { totalTokens: number };
      };
      expect(body.content).toEqual('Test response');
      expect(body.usage.totalTokens).toEqual(8);
    });

    it('rejects request with no messages', async () => {
      const mockBackend = { converse: vi.fn() };
      const app = new Hono();
      app.route('/inference', buildInferenceRoutes(mockBackend));

      const resp = await app.request('/inference/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      });

      expect(resp.status).toEqual(400);
    });
  });
});
