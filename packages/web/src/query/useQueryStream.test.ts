import { describe, expect, it } from 'vitest';
import type { QuerySSEEvent } from './types.ts';

// Re-implement parseSSEData here to unit-test SSE parsing logic without
// needing React rendering (the web package has no jsdom setup).
function parseSSEData(line: string): QuerySSEEvent | null {
  const trimmed: string = line.startsWith('data:') ? line.slice(5).trim() : '';
  if (trimmed === '') {
    return null;
  }
  try {
    return JSON.parse(trimmed) as QuerySSEEvent;
  } catch {
    return null;
  }
}

describe('parseSSEData', () => {
  it('parses a status event', () => {
    const event: QuerySSEEvent | null = parseSSEData(
      'data: {"type":"status","stage":"rewriting","message":"Analyzing your question..."}',
    );
    expect(event).toEqual({
      message: 'Analyzing your question...',
      stage: 'rewriting',
      type: 'status',
    });
  });

  it('parses a delta event', () => {
    const event: QuerySSEEvent | null = parseSSEData('data: {"type":"delta","text":"The Hughes"}');
    expect(event).toEqual({ text: 'The Hughes', type: 'delta' });
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
    const event: QuerySSEEvent | null = parseSSEData(line);
    expect(event).toEqual({ sources, type: 'sources' });
  });

  it('parses a usage event', () => {
    const usage = {
      generateTokens: { input: 3201, output: 412 },
      retrievalMs: 300,
      rewriteTokens: { input: 142, output: 87 },
      totalMs: 2800,
    };
    const event: QuerySSEEvent | null = parseSSEData(
      `data: ${JSON.stringify({ type: 'usage', usage })}`,
    );
    expect(event).toEqual({ type: 'usage', usage });
  });

  it('parses a done event', () => {
    const event: QuerySSEEvent | null = parseSSEData('data: {"type":"done"}');
    expect(event).toEqual({ type: 'done' });
  });

  it('parses an error event', () => {
    const event: QuerySSEEvent | null = parseSSEData(
      'data: {"type":"error","message":"Rate limit exceeded"}',
    );
    expect(event).toEqual({ message: 'Rate limit exceeded', type: 'error' });
  });

  it('returns null for empty data line', () => {
    expect(parseSSEData('data: ')).toBeNull();
    expect(parseSSEData('data:')).toBeNull();
  });

  it('returns null for non-data lines (id, event, comments)', () => {
    expect(parseSSEData('id: 5')).toBeNull();
    expect(parseSSEData(':comment')).toBeNull();
    expect(parseSSEData('event: message')).toBeNull();
    expect(parseSSEData('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSSEData('data: {not json}')).toBeNull();
    expect(parseSSEData('data: undefined')).toBeNull();
  });

  it('handles data with extra whitespace around the JSON', () => {
    const event: QuerySSEEvent | null = parseSSEData('data:   {"type":"done"}  ');
    expect(event).toEqual({ type: 'done' });
  });
});
