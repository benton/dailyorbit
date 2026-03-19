import { describe, expect, it } from 'vitest';
import { parseChatSSEData } from './useChatStream.ts';
import type { ChatSSEEvent } from './types.ts';

describe('parseChatSSEData', () => {
  it('parses a status event', () => {
    const event: ChatSSEEvent | null = parseChatSSEData(
      'data: {"type":"status","stage":"rewriting","message":"Analyzing your question..."}',
    );
    expect(event).toEqual({
      message: 'Analyzing your question...',
      stage: 'rewriting',
      type: 'status',
    });
  });

  it('parses a delta event', () => {
    const event: ChatSSEEvent | null = parseChatSSEData(
      'data: {"type":"delta","text":"hello"}',
    );
    expect(event).toEqual({ text: 'hello', type: 'delta' });
  });

  it('parses a sources event with multiple sources', () => {
    const sources = [
      {
        id: 'SAT-LOA-20240701-00011',
        score: 0.85,
        snippet: 'Application for Ka-band...',
        title: 'Hughes Ka-band',
        type: 'filing' as const,
      },
      {
        id: '42',
        score: 0.72,
        snippet: 'Hughes files new...',
        title: 'SpaceNews article',
        type: 'news' as const,
        url: 'https://spacenews.com/hughes',
      },
    ];
    const line: string = `data: ${JSON.stringify({ sources, type: 'sources' })}`;
    const event: ChatSSEEvent | null = parseChatSSEData(line);
    expect(event).toEqual({ sources, type: 'sources' });
  });

  it('parses a usage event with costCents', () => {
    const usage = {
      costCents: 0.03,
      generateTokens: { input: 3201, output: 412 },
      retrievalMs: 300,
      rewriteTokens: { input: 142, output: 87 },
      totalMs: 2800,
    };
    const event: ChatSSEEvent | null = parseChatSSEData(
      `data: ${JSON.stringify({ type: 'usage', usage })}`,
    );
    expect(event).toEqual({ type: 'usage', usage });
  });

  it('parses a title event', () => {
    const event: ChatSSEEvent | null = parseChatSSEData(
      'data: {"type":"title","title":"My Chat"}',
    );
    expect(event).toEqual({ title: 'My Chat', type: 'title' });
  });

  it('parses a done event', () => {
    const event: ChatSSEEvent | null = parseChatSSEData('data: {"type":"done"}');
    expect(event).toEqual({ type: 'done' });
  });

  it('parses an error event', () => {
    const event: ChatSSEEvent | null = parseChatSSEData(
      'data: {"type":"error","message":"Rate limit exceeded"}',
    );
    expect(event).toEqual({ message: 'Rate limit exceeded', type: 'error' });
  });

  it('returns null for empty data line', () => {
    expect(parseChatSSEData('data: ')).toBeNull();
    expect(parseChatSSEData('data:')).toBeNull();
  });

  it('returns null for non-data lines', () => {
    expect(parseChatSSEData('id: 5')).toBeNull();
    expect(parseChatSSEData(':comment')).toBeNull();
    expect(parseChatSSEData('event: message')).toBeNull();
    expect(parseChatSSEData('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseChatSSEData('data: {not json}')).toBeNull();
    expect(parseChatSSEData('data: undefined')).toBeNull();
  });

  it('handles data with extra whitespace around the JSON', () => {
    const event: ChatSSEEvent | null = parseChatSSEData(
      'data:   {"type":"done"}  ',
    );
    expect(event).toEqual({ type: 'done' });
  });
});
