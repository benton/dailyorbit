# AI Foundations (v0.8) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an internal inference API backed by AWS Bedrock so the app has a reliable, model-agnostic LLM layer ready for summarization work in v1.

**Architecture:** A new `inference` module in `packages/server/src/` exposes an `InferenceService` that wraps the AWS Bedrock Converse API. The service accepts model ID, messages, and generation parameters, delegates to Bedrock, and returns a normalized response. Two new config keys (`bedrockRegion`, `bedrockDefaultModel`) are managed via the existing ConfigService/admin UI. An admin API endpoint allows testing inference from the UI. The AWS SDK credential resolver handles auth automatically (SSO profile, env vars, instance role — no API keys stored in the app).

**Tech Stack:** `@aws-sdk/client-bedrock-runtime` for inference, `@aws-sdk/client-bedrock` for model listing, Hono routes, vitest, existing ConfigService.

---

## Task 1: Install AWS SDK Dependencies

**Files:**
- Modify: `packages/server/package.json`

**Step 1: Add dependencies**

```bash
cd packages/server && pnpm add @aws-sdk/client-bedrock-runtime @aws-sdk/client-bedrock
```

**Step 2: Verify installation**

```bash
pnpm ls @aws-sdk/client-bedrock-runtime @aws-sdk/client-bedrock
```

Expected: Both packages listed with resolved versions.

**Step 3: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml
git commit -m "feat(inference): add AWS Bedrock SDK dependencies"
```

---

## Task 2: Add Bedrock Config Keys

**Files:**
- Modify: `packages/server/src/lib/config-schema.ts`
- Modify: `packages/server/src/config/routes.test.ts`

**Step 1: Update the config routes test to expect the two new keys**

In `packages/server/src/config/routes.test.ts`, add a test case:

```typescript
it('includes bedrock config keys', () => {
  const entries = buildConfigEntries();
  const keys: string[] = entries.map((e) => e.key);
  expect(keys).toContain('bedrockRegion');
  expect(keys).toContain('bedrockDefaultModel');
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/server && npx vitest run src/config/routes.test.ts
```

Expected: FAIL — keys not found.

**Step 3: Add config keys to schema**

In `packages/server/src/lib/config-schema.ts`, add two entries to `CONFIG_SCHEMA`:

```typescript
bedrockRegion: {
  key: 'bedrockRegion',
  defaultValue: 'us-east-2',
  encrypted: false,
  description: 'AWS region for Bedrock inference',
},
bedrockDefaultModel: {
  key: 'bedrockDefaultModel',
  defaultValue: 'anthropic.claude-haiku-4-5-20251001-v1:0',
  encrypted: false,
  description: 'Default Bedrock model ID for inference',
},
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run src/config/routes.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/lib/config-schema.ts packages/server/src/config/routes.test.ts
git commit -m "feat(inference): add bedrockRegion and bedrockDefaultModel config keys"
```

---

## Task 3: Define Inference Types

**Files:**
- Create: `packages/server/src/inference/types.ts`

**Step 1: Create the types file**

```typescript
/** Role for a message in a conversation. */
export type MessageRole = 'user' | 'assistant';

/** A single message in a conversation. */
export type InferenceMessage = {
  readonly role: MessageRole;
  readonly content: string;
};

/** Parameters controlling generation behavior. */
export type InferenceParams = {
  /** Maximum tokens to generate. */
  readonly maxTokens?: number;
  /** Sampling temperature (0–1). */
  readonly temperature?: number;
  /** Top-p nucleus sampling (0–1). */
  readonly topP?: number;
  /** Optional system prompt prepended to the conversation. */
  readonly systemPrompt?: string;
};

/** A request to the internal inference API. */
export type InferenceRequest = {
  /** Bedrock model ID. If omitted, uses bedrockDefaultModel config. */
  readonly modelId?: string;
  /** Conversation messages. Must contain at least one user message. */
  readonly messages: readonly InferenceMessage[];
  /** Generation parameters. */
  readonly params?: InferenceParams;
};

/** Token usage from a single inference call. */
export type TokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
};

/** The normalized response from an inference call. */
export type InferenceResponse = {
  /** The model's generated text. */
  readonly content: string;
  /** The model ID that actually served the request. */
  readonly modelId: string;
  /** Token usage statistics. */
  readonly usage: TokenUsage;
  /** Bedrock stop reason (end_turn, max_tokens, etc.). */
  readonly stopReason: string;
  /** Wall-clock latency in milliseconds. */
  readonly latencyMs: number;
};

/** Describes a model available for inference. */
export type ModelInfo = {
  readonly modelId: string;
  readonly modelName: string;
  readonly provider: string;
};
```

**Step 2: Commit**

```bash
git add packages/server/src/inference/types.ts
git commit -m "feat(inference): define internal inference API types"
```

---

## Task 4: Implement BedrockClient

**Files:**
- Create: `packages/server/src/inference/bedrock-client.ts`
- Create: `packages/server/src/inference/bedrock-client.test.ts`

**Step 1: Write the failing test**

Create `packages/server/src/inference/bedrock-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildConverseInput, parseConverseOutput } from './bedrock-client.ts';

describe('buildConverseInput', () => {
  it('maps InferenceRequest to Bedrock ConverseCommandInput', () => {
    const input = buildConverseInput({
      modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      messages: [{ role: 'user', content: 'Hello' }],
      params: {
        maxTokens: 256,
        temperature: 0.7,
        systemPrompt: 'You are a helpful assistant.',
      },
    });

    expect(input).toEqual({
      modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      messages: [{ role: 'user', content: [{ text: 'Hello' }] }],
      inferenceConfig: { maxTokens: 256, temperature: 0.7 },
      system: [{ text: 'You are a helpful assistant.' }],
    });
  });

  it('omits system when no systemPrompt provided', () => {
    const input = buildConverseInput({
      modelId: 'amazon.nova-micro-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(input).not.toHaveProperty('system');
  });

  it('maps multi-turn conversation', () => {
    const input = buildConverseInput({
      modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      messages: [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
        { role: 'user', content: 'And 3+3?' },
      ],
    });

    expect(input.messages).toHaveLength(3);
    expect(input.messages![2]).toEqual({
      role: 'user',
      content: [{ text: 'And 3+3?' }],
    });
  });
});

describe('parseConverseOutput', () => {
  it('extracts text content, usage, and stop reason from Bedrock response', () => {
    const raw = {
      output: {
        message: {
          role: 'assistant',
          content: [{ text: 'Hello! How can I help?' }],
        },
      },
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      stopReason: 'end_turn',
    };

    const result = parseConverseOutput(raw, 'test-model', 123);

    expect(result).toEqual({
      content: 'Hello! How can I help?',
      modelId: 'test-model',
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      stopReason: 'end_turn',
      latencyMs: 123,
    });
  });

  it('returns empty content when response has no text blocks', () => {
    const raw = {
      output: { message: { role: 'assistant', content: [] } },
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      stopReason: 'max_tokens',
    };

    const result = parseConverseOutput(raw, 'test-model', 0);
    expect(result.content).toEqual('');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/server && npx vitest run src/inference/bedrock-client.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement bedrock-client.ts**

Create `packages/server/src/inference/bedrock-client.ts`:

```typescript
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  InferenceRequest,
  InferenceResponse,
} from './types.ts';

/** Build a Bedrock ConverseCommandInput from our internal request type. */
export function buildConverseInput(req: InferenceRequest): ConverseCommandInput {
  const messages = req.messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: [{ text: m.content }],
  }));

  const input: ConverseCommandInput = {
    modelId: req.modelId,
    messages,
  };

  const params = req.params;
  if (params != null) {
    const inferenceConfig: Record<string, number> = {};
    if (params.maxTokens != null) inferenceConfig.maxTokens = params.maxTokens;
    if (params.temperature != null) inferenceConfig.temperature = params.temperature;
    if (params.topP != null) inferenceConfig.topP = params.topP;
    if (Object.keys(inferenceConfig).length > 0) {
      input.inferenceConfig = inferenceConfig;
    }
    if (params.systemPrompt != null) {
      input.system = [{ text: params.systemPrompt }];
    }
  }

  return input;
}

/** Parse a Bedrock ConverseCommandOutput into our internal response type. */
export function parseConverseOutput(
  raw: ConverseCommandOutput,
  modelId: string,
  latencyMs: number,
): InferenceResponse {
  const textBlocks = raw.output?.message?.content ?? [];
  const content: string = textBlocks
    .filter((block) => block.text != null)
    .map((block) => block.text!)
    .join('');

  return {
    content,
    modelId,
    usage: {
      inputTokens: raw.usage?.inputTokens ?? 0,
      outputTokens: raw.usage?.outputTokens ?? 0,
      totalTokens: raw.usage?.totalTokens ?? 0,
    },
    stopReason: raw.stopReason ?? 'unknown',
    latencyMs,
  };
}

/** Thin wrapper around BedrockRuntimeClient that calls Converse. */
export class BedrockClient {
  private readonly client: BedrockRuntimeClient;

  constructor(region: string) {
    this.client = new BedrockRuntimeClient({ region });
  }

  async converse(input: ConverseCommandInput): Promise<ConverseCommandOutput> {
    return this.client.send(new ConverseCommand(input));
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run src/inference/bedrock-client.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/inference/bedrock-client.ts packages/server/src/inference/bedrock-client.test.ts
git commit -m "feat(inference): implement Bedrock Converse client with input/output mapping"
```

---

## Task 5: Implement InferenceService

**Files:**
- Create: `packages/server/src/inference/inference-service.ts`
- Create: `packages/server/src/inference/inference-service.test.ts`

**Step 1: Write the failing test**

Create `packages/server/src/inference/inference-service.test.ts`:

```typescript
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
    expect(resp.modelId).toEqual('anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(resp.usage.totalTokens).toEqual(7);

    // Verify the model ID passed to Bedrock
    const calledInput = mockConverse.mock.calls[0][0];
    expect(calledInput.modelId).toEqual('anthropic.claude-haiku-4-5-20251001-v1:0');
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
```

**Step 2: Run test to verify it fails**

```bash
cd packages/server && npx vitest run src/inference/inference-service.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement InferenceService**

Create `packages/server/src/inference/inference-service.ts`:

```typescript
import type { ConverseCommandInput, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { getConfigService } from '../lib/config.ts';
import type { ConfigKey } from '../lib/config-schema.ts';
import { buildConverseInput, parseConverseOutput } from './bedrock-client.ts';
import type { InferenceRequest, InferenceResponse } from './types.ts';

/** Interface for the Bedrock converse call — real client or mock. */
export type ConverseFunction = {
  converse(input: ConverseCommandInput): Promise<ConverseCommandOutput>;
};

export class InferenceService {
  private readonly backend: ConverseFunction;

  constructor(backend: ConverseFunction) {
    this.backend = backend;
  }

  /** Run a completion request through Bedrock Converse. */
  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const config = getConfigService();
    const modelId: string =
      req.modelId ?? (config.get('bedrockDefaultModel' as ConfigKey) as string);

    const input: ConverseCommandInput = buildConverseInput({ ...req, modelId });

    const start: number = performance.now();
    const raw: ConverseCommandOutput = await this.backend.converse(input);
    const latencyMs: number = Math.round(performance.now() - start);

    return parseConverseOutput(raw, modelId, latencyMs);
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run src/inference/inference-service.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/inference/inference-service.ts packages/server/src/inference/inference-service.test.ts
git commit -m "feat(inference): implement InferenceService with model resolution and latency tracking"
```

---

## Task 6: Create Inference Singleton and Model Listing

**Files:**
- Create: `packages/server/src/inference/index.ts`
- Create: `packages/server/src/inference/models.ts`
- Create: `packages/server/src/inference/models.test.ts`

**Step 1: Write the failing test for model listing**

Create `packages/server/src/inference/models.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseModelList } from './models.ts';

describe('parseModelList', () => {
  it('maps Bedrock ListFoundationModels output to ModelInfo array', () => {
    const raw = {
      modelSummaries: [
        { modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0', modelName: 'Claude Haiku 4.5', providerName: 'Anthropic' },
        { modelId: 'amazon.nova-micro-v1:0', modelName: 'Nova Micro', providerName: 'Amazon' },
      ],
    };

    const models = parseModelList(raw);
    expect(models).toEqual([
      { modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0', modelName: 'Claude Haiku 4.5', provider: 'Anthropic' },
      { modelId: 'amazon.nova-micro-v1:0', modelName: 'Nova Micro', provider: 'Amazon' },
    ]);
  });

  it('returns empty array when no model summaries', () => {
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList({ modelSummaries: [] })).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/server && npx vitest run src/inference/models.test.ts
```

Expected: FAIL

**Step 3: Implement models.ts**

Create `packages/server/src/inference/models.ts`:

```typescript
import {
  BedrockClient as BedrockMgmtClient,
  ListFoundationModelsCommand,
  type ListFoundationModelsCommandOutput,
} from '@aws-sdk/client-bedrock';
import type { ModelInfo } from './types.ts';

/** Parse Bedrock ListFoundationModels output into our ModelInfo type. */
export function parseModelList(
  raw: Partial<ListFoundationModelsCommandOutput>,
): ModelInfo[] {
  const summaries = raw.modelSummaries ?? [];
  return summaries.map((s) => ({
    modelId: s.modelId ?? '',
    modelName: s.modelName ?? '',
    provider: s.providerName ?? '',
  }));
}

/** List text-generation models available in the configured region. */
export async function listAvailableModels(region: string): Promise<ModelInfo[]> {
  const client = new BedrockMgmtClient({ region });
  const resp = await client.send(
    new ListFoundationModelsCommand({
      byOutputModality: 'TEXT',
      byInferenceType: 'ON_DEMAND',
    }),
  );
  return parseModelList(resp);
}
```

**Step 4: Create the inference module singleton**

Create `packages/server/src/inference/index.ts`:

```typescript
import type { ConfigKey } from '../lib/config-schema.ts';
import { getConfigService } from '../lib/config.ts';
import { BedrockClient } from './bedrock-client.ts';
import { InferenceService } from './inference-service.ts';

let _service: InferenceService | null = null;

/** Get or create the singleton InferenceService backed by Bedrock. */
export function getInferenceService(): InferenceService {
  if (_service == null) {
    const config = getConfigService();
    const region: string = config.get('bedrockRegion' as ConfigKey) as string;
    const client = new BedrockClient(region);
    _service = new InferenceService(client);
  }
  return _service;
}

/** Reset the singleton (used when config changes). */
export function resetInferenceService(): void {
  _service = null;
}

export { InferenceService } from './inference-service.ts';
export type {
  InferenceMessage,
  InferenceParams,
  InferenceRequest,
  InferenceResponse,
  ModelInfo,
  TokenUsage,
} from './types.ts';
```

**Step 5: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run src/inference/models.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/inference/index.ts packages/server/src/inference/models.ts packages/server/src/inference/models.test.ts
git commit -m "feat(inference): add model listing, singleton factory, and module exports"
```

---

## Task 7: Implement Inference Admin Routes

**Files:**
- Create: `packages/server/src/inference/routes.ts`
- Create: `packages/server/src/inference/routes.test.ts`
- Modify: `packages/server/src/app.ts` — mount the new routes

**Step 1: Write the failing test**

Create `packages/server/src/inference/routes.test.ts`:

```typescript
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
      const mockConverse = vi.fn().mockResolvedValue({
        output: { message: { role: 'assistant', content: [{ text: 'Test response' }] } },
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        stopReason: 'end_turn',
      });

      const app = new Hono();
      app.route('/inference', buildInferenceRoutes(mockConverse));

      const resp = await app.request('/inference/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          params: { maxTokens: 128 },
        }),
      });

      expect(resp.status).toEqual(200);
      const body = await resp.json();
      expect(body.content).toEqual('Test response');
      expect(body.usage.totalTokens).toEqual(8);
    });

    it('rejects request with no messages', async () => {
      const mockConverse = vi.fn();
      const app = new Hono();
      app.route('/inference', buildInferenceRoutes(mockConverse));

      const resp = await app.request('/inference/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      });

      expect(resp.status).toEqual(400);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/server && npx vitest run src/inference/routes.test.ts
```

Expected: FAIL

**Step 3: Implement routes.ts**

Create `packages/server/src/inference/routes.ts`:

```typescript
import { Hono } from 'hono';
import type { ConfigKey } from '../lib/config-schema.ts';
import { getConfigService } from '../lib/config.ts';
import { InferenceService, type ConverseFunction } from './inference-service.ts';
import { listAvailableModels } from './models.ts';
import type { InferenceRequest } from './types.ts';

/** Build inference admin routes. Accepts optional backend override for testing. */
export function buildInferenceRoutes(mockBackend?: ConverseFunction): Hono {
  const routes = new Hono();

  /** POST /test — Run a test inference call. */
  routes.post('/test', async (c) => {
    const body = await c.req.json<InferenceRequest>();

    if (!body.messages || body.messages.length === 0) {
      return c.json({ error: 'messages array must contain at least one message' }, 400);
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
      const region: string = config.get('bedrockRegion' as ConfigKey) as string;
      const models = await listAvailableModels(region);
      return c.json(models);
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 502);
    }
  });

  return routes;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run src/inference/routes.test.ts
```

Expected: PASS

**Step 5: Mount routes in app.ts**

In `packages/server/src/app.ts`, add to the admin routes section:

```typescript
import { buildInferenceRoutes } from './inference/routes.ts';

// Inside the admin routes block:
app.route('/api/admin/inference', buildInferenceRoutes());
```

This route is mounted alongside the other `/api/admin/*` routes and requires admin auth.

**Step 6: Run all tests**

```bash
cd packages/server && npx vitest run
```

Expected: All tests PASS.

**Step 7: Commit**

```bash
git add packages/server/src/inference/routes.ts packages/server/src/inference/routes.test.ts packages/server/src/app.ts
git commit -m "feat(inference): add admin API routes for test inference and model listing"
```

---

## Task 8: Integration Test — Live Bedrock Call

**Files:**
- Create: `packages/server/src/inference/bedrock-integration.test.ts`

This test hits real Bedrock. It should be skipped in CI (no AWS creds) but runnable locally.

**Step 1: Write the integration test**

Create `packages/server/src/inference/bedrock-integration.test.ts`:

```typescript
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
const HAS_AWS_CREDS: boolean = process.env.AWS_PROFILE != null || process.env.AWS_ACCESS_KEY_ID != null;

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
      modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      messages: [{ role: 'user', content: 'Reply with exactly: INTEGRATION_TEST_OK' }],
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
    const haiku = models.find((m) => m.modelId.includes('claude'));
    expect(haiku).toBeDefined();
  }, 15_000);
});
```

**Step 2: Run the integration test locally**

```bash
cd packages/server && npx vitest run src/inference/bedrock-integration.test.ts
```

Expected: PASS (with AWS SSO session active).

**Step 3: Commit**

```bash
git add packages/server/src/inference/bedrock-integration.test.ts
git commit -m "test(inference): add Bedrock integration test (skipped without AWS creds)"
```

---

## Task 9: Admin UI — AI Settings Page

**Files:**
- Create: `packages/web/src/admin/AiSettings.tsx`
- Modify: `packages/web/src/App.tsx` — add route
- Modify: `packages/web/src/admin/AdminLayout.tsx` — add nav link

**Step 1: Create the AI Settings admin page**

Create `packages/web/src/admin/AiSettings.tsx`:

```tsx
import { Bot, Loader2, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.tsx';
import { ToastProvider, useToast } from '../ui/toast.tsx';

type ModelInfo = {
  modelId: string;
  modelName: string;
  provider: string;
};

type InferenceResponse = {
  content: string;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  stopReason: string;
  latencyMs: number;
};

type ConfigEntry = {
  key: string;
  value: string;
  description: string;
  encrypted: boolean;
};

function AiSettingsInner() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(true);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [testPrompt, setTestPrompt] = useState<string>('Say hello in one sentence.');
  const [testResult, setTestResult] = useState<InferenceResponse | null>(null);
  const [testing, setTesting] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const { toast } = useToast();

  const fetchConfig = useCallback(async () => {
    try {
      const entries: ConfigEntry[] = await apiFetch('/api/admin/config');
      const regionEntry = entries.find((e) => e.key === 'bedrockRegion');
      const modelEntry = entries.find((e) => e.key === 'bedrockDefaultModel');
      if (regionEntry) setRegion(regionEntry.value);
      if (modelEntry) setDefaultModel(modelEntry.value);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load config', 'error');
    }
  }, [toast]);

  const fetchModels = useCallback(async () => {
    try {
      const data: ModelInfo[] = await apiFetch('/api/admin/inference/models');
      setModels(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to list models', 'error');
    } finally {
      setLoadingModels(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchConfig();
    void fetchModels();
  }, [fetchConfig, fetchModels]);

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      await Promise.all([
        apiFetch('/api/admin/config/bedrockRegion', {
          method: 'PUT',
          body: JSON.stringify({ value: region }),
        }),
        apiFetch('/api/admin/config/bedrockDefaultModel', {
          method: 'PUT',
          body: JSON.stringify({ value: defaultModel }),
        }),
      ]);
      toast('AI settings saved', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingConfig(false);
    }
  }, [region, defaultModel, toast]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const resp: InferenceResponse = await apiFetch('/api/admin/inference/test', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: testPrompt }],
          params: { maxTokens: 256, temperature: 0.7 },
        }),
      });
      setTestResult(resp);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Inference failed', 'error');
    } finally {
      setTesting(false);
    }
  }, [testPrompt, toast]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          AI Settings
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Configure language model inference via AWS Bedrock.
        </p>
      </div>

      {/* Config Section */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-medium">Bedrock Configuration</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="bedrock-region">AWS Region</Label>
            <Input
              id="bedrock-region"
              onChange={(e) => setRegion(e.target.value)}
              value={region}
            />
          </div>
          <div>
            <Label htmlFor="bedrock-model">Default Model ID</Label>
            <Input
              id="bedrock-model"
              onChange={(e) => setDefaultModel(e.target.value)}
              value={defaultModel}
            />
          </div>
        </div>
        <Button className="mt-4" disabled={savingConfig} onClick={() => void handleSaveConfig()}>
          {savingConfig ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>

      {/* Test Section */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-medium">Test Inference</h2>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            onChange={(e) => setTestPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleTest(); }}
            placeholder="Enter a test prompt..."
            value={testPrompt}
          />
          <Button disabled={testing || !testPrompt} onClick={() => void handleTest()}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {testResult && (
          <div className="mt-4 space-y-2">
            <div className="rounded bg-neutral-50 p-4 text-sm dark:bg-neutral-800">
              {testResult.content}
            </div>
            <div className="flex gap-3 text-xs text-neutral-500">
              <Badge variant="secondary">{testResult.modelId}</Badge>
              <span>{testResult.usage.totalTokens} tokens</span>
              <span>{testResult.latencyMs}ms</span>
              <span>{testResult.stopReason}</span>
            </div>
          </div>
        )}
      </div>

      {/* Available Models */}
      <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="p-6 pb-2">
          <h2 className="text-lg font-medium">Available Models</h2>
          <p className="mt-1 text-sm text-neutral-500">
            On-demand text models in {region || 'configured region'}.
          </p>
        </div>
        {loadingModels ? (
          <p className="px-6 pb-6 text-sm text-neutral-500">Loading models...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Model ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m.modelId}>
                  <TableCell>{m.provider}</TableCell>
                  <TableCell>{m.modelName}</TableCell>
                  <TableCell className="font-mono text-sm">{m.modelId}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

export default function AiSettings() {
  return (
    <ToastProvider>
      <AiSettingsInner />
    </ToastProvider>
  );
}
```

**Step 2: Add route in App.tsx**

In the admin routes section of `packages/web/src/App.tsx`, add:

```tsx
import AiSettings from './admin/AiSettings.tsx';

// Inside the admin <Route> children:
<Route path="ai" element={<AiSettings />} />
```

**Step 3: Add nav link in AdminLayout.tsx**

Add to the admin navigation links array:

```tsx
{ to: '/admin/ai', label: 'AI Settings', icon: Bot }
```

Import `Bot` from `lucide-react`.

**Step 4: Run all tests**

```bash
make test
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add packages/web/src/admin/AiSettings.tsx packages/web/src/App.tsx packages/web/src/admin/AdminLayout.tsx
git commit -m "feat(inference): add AI Settings admin page with test inference and model browser"
```

---

## Task 10: Manual Smoke Test

**Step 1: Start dev servers**

```bash
make dev
```

**Step 2: Verify admin config page shows new keys**

Navigate to `http://localhost:5173/admin/config` — confirm `bedrockRegion` and `bedrockDefaultModel` appear.

**Step 3: Verify AI Settings page**

Navigate to `http://localhost:5173/admin/ai`:
- Confirm region and default model fields are populated
- Click to list available models — should show Bedrock catalog
- Enter a test prompt and submit — should get a response with token counts and latency

**Step 4: Verify API directly**

```bash
curl -s http://localhost:9000/api/admin/inference/models | head -5
curl -s -X POST http://localhost:9000/api/admin/inference/test \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hello"}],"params":{"maxTokens":64}}' | jq .
```

**Step 5: Commit any fixes, then tag**

```bash
git commit -m "chore: smoke test fixes" # (if needed)
```
