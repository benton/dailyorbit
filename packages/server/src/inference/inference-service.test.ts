import { randomBytes } from 'node:crypto';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../lib/config-service.ts';
import { setConfigService } from '../lib/config.ts';
import { initializeDatabase } from '../lib/db-init.ts';
import { InferenceService } from './inference-service.ts';
import type { InferenceRequest, InferenceResponse } from './types.ts';

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

describe('InferenceService', () => {
  it('uses bedrockDefaultModel when modelId is omitted', async () => {
    const mockConverse = vi.fn().mockResolvedValue({
      output: { message: { role: 'assistant', content: [{ text: 'Hi' }] } },
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      stopReason: 'end_turn',
    });

    const svc = new InferenceService({ converse: mockConverse });

    const req: InferenceRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const resp: InferenceResponse = await svc.complete(req);

    expect(resp.content).toEqual('Hi');
    expect(resp.modelId).toEqual('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(resp.usage.totalTokens).toEqual(7);

    // Verify the model ID passed to Bedrock
    const calledInput = mockConverse.mock.calls[0][0];
    expect(calledInput.modelId).toEqual('us.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  it('uses explicit modelId when provided', async () => {
    const mockConverse = vi.fn().mockResolvedValue({
      output: { message: { role: 'assistant', content: [{ text: 'Ok' }] } },
      usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
      stopReason: 'end_turn',
    });

    const svc = new InferenceService({ converse: mockConverse });

    const req: InferenceRequest = {
      modelId: 'amazon.nova-micro-v1:0',
      messages: [{ role: 'user', content: 'Test' }],
    };

    const resp: InferenceResponse = await svc.complete(req);

    expect(resp.modelId).toEqual('amazon.nova-micro-v1:0');
    const calledInput = mockConverse.mock.calls[0][0];
    expect(calledInput.modelId).toEqual('amazon.nova-micro-v1:0');
  });

  it('measures latency in milliseconds', async () => {
    const mockConverse = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {
        output: { message: { role: 'assistant', content: [{ text: 'Done' }] } },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        stopReason: 'end_turn',
      };
    });

    const svc = new InferenceService({ converse: mockConverse });
    const resp = await svc.complete({
      messages: [{ role: 'user', content: 'Go' }],
    });

    expect(resp.latencyMs).toBeGreaterThanOrEqual(40);
  });
});
