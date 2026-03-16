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
