import { useCallback, useRef, useState } from 'react';
import type { QuerySSEEvent, QueryUsage, RetrievedSource } from './types.ts';
import env from '../lib/env.tsx';

export type QueryStreamState = {
  answer: string;
  error: string | null;
  sources: RetrievedSource[];
  status: 'idle' | 'rewriting' | 'retrieving' | 'generating' | 'done' | 'error';
  statusMessage: string;
  usage: QueryUsage | null;
};

const INITIAL_STATE: QueryStreamState = {
  answer: '',
  error: null,
  sources: [],
  status: 'idle',
  statusMessage: '',
  usage: null,
};

/** Parse a single SSE `data:` line into a QuerySSEEvent, or null on failure. */
function parseSSEData(line: string): QuerySSEEvent | null {
  const trimmed: string = line.startsWith('data:') ? line.slice(5).trim() : '';
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed) as QuerySSEEvent;
  } catch {
    return null;
  }
}

export function useQueryStream(): {
  cancel: () => void;
  state: QueryStreamState;
  submit: (question: string) => void;
} {
  const [state, setState] = useState<QueryStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const submit = useCallback(
    (question: string) => {
      // Abort any in-flight request
      cancel();

      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        ...INITIAL_STATE,
        status: 'rewriting',
        statusMessage: 'Analyzing your question...',
      });

      const baseUrl: string = env('SERVER_URL');

      void (async () => {
        try {
          const response: Response = await fetch(`${baseUrl}/api/query`, {
            body: JSON.stringify({ question }),
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
          });

          if (!response.ok) {
            const body = await response.json().catch(() => ({ error: response.statusText }));
            const errorMsg: string = (body as Record<string, string>).error ?? response.statusText;
            setState((prev) => ({
              ...prev,
              error: errorMsg,
              status: 'error',
              statusMessage: '',
            }));
            return;
          }

          const reader: ReadableStreamDefaultReader<Uint8Array> = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer: string = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines: string[] = buffer.split('\n');
            // Keep the last potentially incomplete line in the buffer
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const event: QuerySSEEvent | null = parseSSEData(line);
              if (event == null) continue;

              switch (event.type) {
                case 'status':
                  setState((prev) => ({
                    ...prev,
                    status: event.stage,
                    statusMessage: event.message,
                  }));
                  break;
                case 'sources':
                  setState((prev) => ({
                    ...prev,
                    sources: event.sources,
                  }));
                  break;
                case 'delta':
                  setState((prev) => ({
                    ...prev,
                    answer: prev.answer + event.text,
                  }));
                  break;
                case 'usage':
                  setState((prev) => ({
                    ...prev,
                    usage: event.usage,
                  }));
                  break;
                case 'done':
                  setState((prev) => ({
                    ...prev,
                    status: 'done',
                    statusMessage: '',
                  }));
                  break;
                case 'error':
                  setState((prev) => ({
                    ...prev,
                    error: event.message,
                    status: 'error',
                    statusMessage: '',
                  }));
                  break;
              }
            }
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            // User cancelled — keep current state but mark idle
            setState((prev) => ({
              ...prev,
              status: prev.status === 'error' ? 'error' : 'idle',
              statusMessage: '',
            }));
            return;
          }
          const message: string =
            err instanceof Error ? err.message : 'An unexpected error occurred';
          setState((prev) => ({
            ...prev,
            error: message,
            status: 'error',
            statusMessage: '',
          }));
        }
      })();
    },
    [cancel],
  );

  return { cancel, state, submit };
}
