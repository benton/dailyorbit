import { describe, expect, it } from 'vitest';
import type {
  ConverseCommandInput,
  ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { ConverseFunction } from '../inference/inference-service.ts';
import { rewriteQuery } from './rewrite.ts';

/** Build a mock backend that returns a canned text response. */
function mockBackend(responseText: string): ConverseFunction {
  return {
    async converse(
      _input: ConverseCommandInput,
    ): Promise<ConverseCommandOutput> {
      return {
        $metadata: {},
        metrics: { latencyMs: 100 },
        output: {
          message: {
            role: 'assistant',
            content: [{ text: responseText }],
          },
        },
        usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        stopReason: 'end_turn',
      };
    },
  };
}

const TEST_MODEL: string = 'us.amazon.nova-micro-v1:0';

describe('rewriteQuery', () => {
  it('parses a single rewritten query from valid JSON', async () => {
    const backend: ConverseFunction = mockBackend(
      '[{"text": "Hughes Network Systems satellite earth station applications"}]',
    );

    const result = await rewriteQuery('Hughes SES apps', backend, TEST_MODEL);

    expect(result.queries).toEqual([
      { text: 'Hughes Network Systems satellite earth station applications' },
    ]);
    expect(result.usage).toEqual({ input: 50, output: 30 });
  });

  it('parses multi-part decomposition into multiple queries', async () => {
    const backend: ConverseFunction = mockBackend(
      JSON.stringify([
        {
          text: 'SpaceX Starlink satellite launch authority',
          filters: { subsystems: ['SAT'], docTypes: ['filing'] },
        },
        {
          text: 'SpaceX earth station modifications 2024',
          filters: {
            subsystems: ['SES'],
            dateFrom: '2024-01-01',
            dateTo: '2024-12-31',
          },
        },
      ]),
    );

    const result = await rewriteQuery(
      'What SpaceX satellite and earth station filings were there in 2024?',
      backend,
      TEST_MODEL,
    );

    expect(result.queries).toHaveLength(2);
    expect(result.queries[0]!.filters?.subsystems).toEqual(['SAT']);
    expect(result.queries[1]!.filters?.dateFrom).toEqual('2024-01-01');
    expect(result.queries[1]!.filters?.dateTo).toEqual('2024-12-31');
  });

  it('extracts JSON from markdown code block wrapper', async () => {
    const backend: ConverseFunction = mockBackend(
      '```json\n[{"text": "SES-STA-20230101-00001 earth station special temporary authority"}]\n```',
    );

    const result = await rewriteQuery(
      'SES-STA-20230101-00001',
      backend,
      TEST_MODEL,
    );

    expect(result.queries).toEqual([
      {
        text: 'SES-STA-20230101-00001 earth station special temporary authority',
      },
    ]);
  });

  it('falls back to original question on malformed JSON', async () => {
    const backend: ConverseFunction = mockBackend(
      'This is not valid JSON at all.',
    );

    const result = await rewriteQuery(
      'my original question',
      backend,
      TEST_MODEL,
    );

    expect(result.queries).toEqual([{ text: 'my original question' }]);
  });

  it('falls back to original question on empty array', async () => {
    const backend: ConverseFunction = mockBackend('[]');

    const result = await rewriteQuery('what is going on', backend, TEST_MODEL);

    expect(result.queries).toEqual([{ text: 'what is going on' }]);
  });

  it('filters out invalid docTypes and keeps valid ones', async () => {
    const backend: ConverseFunction = mockBackend(
      JSON.stringify([
        {
          text: 'test query',
          filters: { docTypes: ['filing', 'invalid', 'news', 42] },
        },
      ]),
    );

    const result = await rewriteQuery('test', backend, TEST_MODEL);

    expect(result.queries[0]!.filters?.docTypes).toEqual(['filing', 'news']);
  });

  it('preserves file numbers verbatim in rewritten query', async () => {
    const fileNumber: string = 'SAT-LOA-20040701-00011';
    const backend: ConverseFunction = mockBackend(
      JSON.stringify([
        { text: `${fileNumber} satellite launch and operate authority` },
      ]),
    );

    const result = await rewriteQuery(fileNumber, backend, TEST_MODEL);

    expect(result.queries[0]!.text).toContain(fileNumber);
  });
});
