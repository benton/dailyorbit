import { describe, expect, it } from 'vitest';
import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import { BedrockClient } from '../inference/bedrock-client.ts';
import { generateAnswer } from './generate.ts';
import type { QuerySSEEvent, RetrievedSource } from './types.ts';

/** Build a mock BedrockClient with a fake converseStream. */
function mockStreamClient(events: ConverseStreamOutput[]): BedrockClient {
  const client = new BedrockClient('us-east-2');
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

const TEST_SOURCES: RetrievedSource[] = [
  {
    type: 'filing',
    id: 'SAT-LOA-20240101-00001',
    title: 'SAT-LOA-20240101-00001 — SpaceX Inc',
    snippet: 'Request for Ka-band frequency allocation',
    score: 0.5,
    url: '/filings/SAT-LOA-20240101-00001',
  },
  {
    type: 'attachment',
    id: '42',
    title: 'SAT-LOA-20240101-00001 — Technical Narrative',
    snippet: 'Detailed interference analysis for Ka-band operations',
    score: 0.3,
  },
];

describe('generateAnswer', () => {
  it('yields delta events for each text chunk from the stream', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } } as ConverseStreamOutput,
      {
        contentBlockDelta: {
          delta: { text: 'Based on ' },
          contentBlockIndex: 0,
        },
      } as ConverseStreamOutput,
      {
        contentBlockDelta: {
          delta: { text: 'the sources [Source 1], ' },
          contentBlockIndex: 0,
        },
      } as ConverseStreamOutput,
      {
        contentBlockDelta: {
          delta: { text: 'Ka-band was allocated.' },
          contentBlockIndex: 0,
        },
      } as ConverseStreamOutput,
      { contentBlockStop: { contentBlockIndex: 0 } } as ConverseStreamOutput,
      { messageStop: { stopReason: 'end_turn' } } as ConverseStreamOutput,
      {
        metadata: {
          usage: { inputTokens: 200, outputTokens: 50, totalTokens: 250 },
          metrics: { latencyMs: 1500 },
        },
      } as ConverseStreamOutput,
    ];

    const client: BedrockClient = mockStreamClient(events);
    const collected: QuerySSEEvent[] = [];

    const gen = generateAnswer(
      'What Ka-band allocations were made?',
      TEST_SOURCES,
      client,
      'us.amazon.nova-pro-v1:0',
    );

    let result = await gen.next();
    while (!result.done) {
      collected.push(result.value);
      result = await gen.next();
    }

    // Should have 3 delta events
    const deltas: QuerySSEEvent[] = collected.filter((e) => e.type === 'delta');
    expect(deltas).toHaveLength(3);
    expect(deltas[0]).toEqual({ type: 'delta', text: 'Based on ' });
    expect(deltas[1]).toEqual({
      type: 'delta',
      text: 'the sources [Source 1], ',
    });
    expect(deltas[2]).toEqual({
      type: 'delta',
      text: 'Ka-band was allocated.',
    });

    // Generator return value should have token usage
    expect(result.value).toEqual({ inputTokens: 200, outputTokens: 50 });
  });

  it('yields no deltas for an empty stream', async () => {
    const client: BedrockClient = mockStreamClient([]);
    const collected: QuerySSEEvent[] = [];

    const gen = generateAnswer('test', TEST_SOURCES, client, 'test-model');
    let result = await gen.next();
    while (!result.done) {
      collected.push(result.value);
      result = await gen.next();
    }

    expect(collected).toHaveLength(0);
    expect(result.value).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('handles stream events without text in delta', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } } as ConverseStreamOutput,
      // A contentBlockStart without text
      {
        contentBlockStart: { start: {}, contentBlockIndex: 0 },
      } as ConverseStreamOutput,
      {
        contentBlockDelta: {
          delta: { text: 'Answer text' },
          contentBlockIndex: 0,
        },
      } as ConverseStreamOutput,
      { messageStop: { stopReason: 'end_turn' } } as ConverseStreamOutput,
    ];

    const client: BedrockClient = mockStreamClient(events);
    const collected: QuerySSEEvent[] = [];

    const gen = generateAnswer('test', TEST_SOURCES, client, 'test-model');
    let result = await gen.next();
    while (!result.done) {
      collected.push(result.value);
      result = await gen.next();
    }

    const deltas: QuerySSEEvent[] = collected.filter((e) => e.type === 'delta');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual({ type: 'delta', text: 'Answer text' });
  });
});
