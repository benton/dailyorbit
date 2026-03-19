import { describe, expect, it } from 'vitest';
import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import {
  buildConverseInput,
  parseConverseOutput,
  BedrockClient,
} from './bedrock-client.ts';

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
      $metadata: { httpStatusCode: 200 },
      metrics: { latencyMs: 100 },
      output: {
        message: {
          role: 'assistant' as const,
          content: [{ text: 'Hello! How can I help?' }],
        },
      },
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      stopReason: 'end_turn' as const,
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
      $metadata: { httpStatusCode: 200 },
      metrics: { latencyMs: 0 },
      output: { message: { role: 'assistant' as const, content: [] } },
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      stopReason: 'max_tokens' as const,
    };

    const result = parseConverseOutput(raw, 'test-model', 0);
    expect(result.content).toEqual('');
  });
});

describe('BedrockClient.converseStream', () => {
  /** Build a mock BedrockClient whose underlying SDK client returns a fake stream. */
  function buildMockStreamClient(
    events: ConverseStreamOutput[],
  ): BedrockClient {
    const client = new BedrockClient('us-east-2');
    // Replace the private SDK client with a mock that returns our events
    async function* fakeStream(): AsyncGenerator<ConverseStreamOutput> {
      for (const event of events) {
        yield event;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).client = {
      send: async () => ({ stream: fakeStream(), $metadata: {} }),
    };
    return client;
  }

  it('yields contentBlockDelta and metadata events from the stream', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } } as ConverseStreamOutput,
      {
        contentBlockDelta: {
          delta: { text: 'Hello' },
          contentBlockIndex: 0,
        },
      } as ConverseStreamOutput,
      {
        contentBlockDelta: {
          delta: { text: ' world' },
          contentBlockIndex: 0,
        },
      } as ConverseStreamOutput,
      { contentBlockStop: { contentBlockIndex: 0 } } as ConverseStreamOutput,
      { messageStop: { stopReason: 'end_turn' } } as ConverseStreamOutput,
      {
        metadata: {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          metrics: { latencyMs: 200 },
        },
      } as ConverseStreamOutput,
    ];

    const client: BedrockClient = buildMockStreamClient(events);
    const collected: ConverseStreamOutput[] = [];

    for await (const event of client.converseStream({
      modelId: 'test-model',
      messages: [{ role: 'user', content: [{ text: 'Hi' }] }],
    })) {
      collected.push(event);
    }

    expect(collected).toHaveLength(events.length);

    // Verify text deltas are present
    const deltas: ConverseStreamOutput[] = collected.filter(
      (e) => e.contentBlockDelta != null,
    );
    expect(deltas).toHaveLength(2);
    expect(deltas[0]!.contentBlockDelta!.delta!).toEqual({ text: 'Hello' });
    expect(deltas[1]!.contentBlockDelta!.delta!).toEqual({ text: ' world' });

    // Verify metadata event with usage
    const meta: ConverseStreamOutput | undefined = collected.find(
      (e) => e.metadata != null,
    );
    expect(meta!.metadata!.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it('yields nothing when stream is null', async () => {
    const client = new BedrockClient('us-east-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).client = {
      send: async () => ({ stream: null, $metadata: {} }),
    };

    const collected: ConverseStreamOutput[] = [];
    for await (const event of client.converseStream({
      modelId: 'test-model',
      messages: [{ role: 'user', content: [{ text: 'Hi' }] }],
    })) {
      collected.push(event);
    }

    expect(collected).toHaveLength(0);
  });
});
