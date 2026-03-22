import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type {
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamCommandInput,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { ensureInferenceLogTable } from './schema.ts';
import { InstrumentedBedrockClient } from './instrumented-client.ts';
import type { BedrockClientLike } from './bedrock-client.ts';
import type { EmbeddingRequest, EmbeddingResponse } from './types.ts';

// ---------------------------------------------------------------------------
// Mock inner client
// ---------------------------------------------------------------------------

function createMockClient(overrides?: {
  converseResult?: Partial<ConverseCommandOutput>;
  streamEvents?: ConverseStreamOutput[];
  embedResult?: Partial<EmbeddingResponse>;
}): BedrockClientLike {
  const converseResult = {
    $metadata: {},
    output: { message: { role: 'assistant', content: [{ text: 'hello' }] } },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    stopReason: 'end_turn',
    metrics: undefined,
    additionalModelResponseFields: undefined,
    trace: undefined,
    performanceConfig: undefined,
    ...overrides?.converseResult,
  } as ConverseCommandOutput;

  const embedResult: EmbeddingResponse = {
    embedding: [0.1, 0.2],
    inputTokenCount: 42,
    latencyMs: 80,
    ...overrides?.embedResult,
  };

  const defaultStreamEvents: ConverseStreamOutput[] = [
    {
      contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'hi' } },
    } as ConverseStreamOutput,
    {
      metadata: {
        usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
        metrics: { latencyMs: 500 },
      },
    } as ConverseStreamOutput,
  ];

  return {
    async converse(): Promise<ConverseCommandOutput> {
      return converseResult;
    },

    async *converseStream(): AsyncGenerator<ConverseStreamOutput> {
      const events: ConverseStreamOutput[] =
        overrides?.streamEvents ?? defaultStreamEvents;
      for (const event of events) {
        yield event;
      }
    },

    async embed(): Promise<EmbeddingResponse> {
      return embedResult;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: read all log rows
// ---------------------------------------------------------------------------

type LogRow = {
  modelId: string;
  operation: string;
  caller: string | null;
  inputTokens: number;
  outputTokens: number;
};

async function readLogRows(conn: DuckDBConnection): Promise<LogRow[]> {
  const reader = await conn.runAndReadAll(
    'SELECT model_id, operation, caller, input_tokens, output_tokens FROM inference_log ORDER BY id',
  );
  return reader.getRows().map((row) => ({
    modelId: String(row[0]),
    operation: String(row[1]),
    caller: row[2] != null ? String(row[2]) : null,
    inputTokens: Number(row[3]),
    outputTokens: Number(row[4]),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstrumentedBedrockClient', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureInferenceLogTable(conn);
  });

  afterEach(() => {
    conn.closeSync();
    db.closeSync();
  });

  describe('converse', () => {
    it('delegates to inner client and logs usage', async () => {
      const inner: BedrockClientLike = createMockClient();
      const client = new InstrumentedBedrockClient(inner, conn, 'test_caller');

      const input: ConverseCommandInput = {
        modelId: 'us.amazon.nova-pro-v1:0',
        messages: [{ role: 'user', content: [{ text: 'hi' }] }],
      };

      const result: ConverseCommandOutput = await client.converse(input);
      expect(result.usage?.inputTokens).toEqual(100);
      expect(result.usage?.outputTokens).toEqual(50);

      // Wait for async log write
      await new Promise((r) => setTimeout(r, 50));

      const rows: LogRow[] = await readLogRows(conn);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        modelId: 'us.amazon.nova-pro-v1:0',
        operation: 'converse',
        caller: 'test_caller',
        inputTokens: 100,
        outputTokens: 50,
      });
    });
  });

  describe('converseStream', () => {
    it('yields all events and logs usage from metadata', async () => {
      const inner: BedrockClientLike = createMockClient();
      const client = new InstrumentedBedrockClient(inner, conn, 'chat');

      const input: ConverseStreamCommandInput = {
        modelId: 'us.amazon.nova-pro-v1:0',
        messages: [{ role: 'user', content: [{ text: 'hi' }] }],
      };

      const events: ConverseStreamOutput[] = [];
      for await (const event of client.converseStream(input)) {
        events.push(event);
      }
      expect(events).toHaveLength(2);

      // Wait for async log write
      await new Promise((r) => setTimeout(r, 50));

      const rows: LogRow[] = await readLogRows(conn);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        modelId: 'us.amazon.nova-pro-v1:0',
        operation: 'converse_stream',
        caller: 'chat',
        inputTokens: 200,
        outputTokens: 80,
      });
    });
  });

  describe('embed', () => {
    it('delegates to inner client and logs embedding usage', async () => {
      const inner: BedrockClientLike = createMockClient();
      const client = new InstrumentedBedrockClient(inner, conn, 'embed_cli');

      const req: EmbeddingRequest = {
        modelId: 'amazon.titan-embed-text-v2:0',
        inputText: 'test text',
        dimensions: 512,
        normalize: true,
      };

      const result: EmbeddingResponse = await client.embed(req);
      expect(result.inputTokenCount).toEqual(42);
      expect(result.embedding).toEqual([0.1, 0.2]);

      // Wait for async log write
      await new Promise((r) => setTimeout(r, 50));

      const rows: LogRow[] = await readLogRows(conn);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        modelId: 'amazon.titan-embed-text-v2:0',
        operation: 'embed',
        caller: 'embed_cli',
        inputTokens: 42,
        outputTokens: 0,
      });
    });
  });

  describe('no connection', () => {
    it('works without a connection (logging skipped)', async () => {
      const inner: BedrockClientLike = createMockClient();
      const client = new InstrumentedBedrockClient(inner, null);

      const result: ConverseCommandOutput = await client.converse({
        modelId: 'us.amazon.nova-pro-v1:0',
        messages: [{ role: 'user', content: [{ text: 'hi' }] }],
      });
      expect(result.usage?.inputTokens).toEqual(100);

      // No rows should exist
      const rows: LogRow[] = await readLogRows(conn);
      expect(rows).toEqual([]);
    });
  });

  describe('setConnection', () => {
    it('enables logging after construction', async () => {
      const inner: BedrockClientLike = createMockClient();
      const client = new InstrumentedBedrockClient(inner, null, 'lazy');

      // First call — no connection, no logging
      await client.converse({
        modelId: 'us.amazon.nova-pro-v1:0',
        messages: [{ role: 'user', content: [{ text: 'hi' }] }],
      });

      // Set connection
      client.setConnection(conn);

      // Second call — should now log
      await client.converse({
        modelId: 'us.amazon.nova-pro-v1:0',
        messages: [{ role: 'user', content: [{ text: 'hello' }] }],
      });

      await new Promise((r) => setTimeout(r, 50));

      const rows: LogRow[] = await readLogRows(conn);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.caller).toEqual('lazy');
    });
  });
});
