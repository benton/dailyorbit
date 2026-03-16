import { randomBytes } from 'node:crypto';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../lib/config-service.ts';
import { setConfigService } from '../lib/config.ts';
import { initializeDatabase } from '../lib/db-init.ts';
import { BedrockClient } from './bedrock-client.ts';
import { InferenceService } from './inference-service.ts';
import { listAvailableModels } from './models.ts';

const REGION = 'us-east-2';
const HAS_AWS_CREDS: boolean =
  process.env.AWS_PROFILE != null || process.env.AWS_ACCESS_KEY_ID != null;

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

describe.skipIf(!HAS_AWS_CREDS)('Bedrock integration', () => {
  it('completes a simple prompt via Haiku', async () => {
    const client = new BedrockClient(REGION);
    const svc = new InferenceService(client);

    const resp = await svc.complete({
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      messages: [
        { role: 'user', content: 'Reply with exactly: INTEGRATION_TEST_OK' },
      ],
      params: { maxTokens: 32, temperature: 0 },
    });

    expect(resp.content).toContain('INTEGRATION_TEST_OK');
    expect(resp.usage.inputTokens).toBeGreaterThan(0);
    expect(resp.usage.outputTokens).toBeGreaterThan(0);
    expect(resp.stopReason).toEqual('end_turn');
    expect(resp.latencyMs).toBeGreaterThan(0);
  }, 30_000);

  it('lists available models', async () => {
    const models = await listAvailableModels(REGION);
    expect(models.length).toBeGreaterThan(0);
    // Verify at least one model has a non-empty modelId
    expect(models[0].modelId.length).toBeGreaterThan(0);
  }, 15_000);
});
