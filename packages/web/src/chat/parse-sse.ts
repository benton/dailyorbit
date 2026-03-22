import type { ChatSSEEvent } from './types.ts';

/** Parse a single SSE `data:` line into a ChatSSEEvent, or null on failure. */
export function parseChatSSEData(line: string): ChatSSEEvent | null {
  const trimmed: string = line.startsWith('data:') ? line.slice(5).trim() : '';
  if (trimmed === '') {
    return null;
  }
  try {
    return JSON.parse(trimmed) as ChatSSEEvent;
  } catch {
    return null;
  }
}
