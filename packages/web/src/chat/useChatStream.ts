import { useCallback, useRef, useState } from 'react';
import type { QueryUsage, RetrievedSource } from '../query/types.ts';
import type { ChatSSEEvent } from './types.ts';
import env from '../lib/env.tsx';

export type ChatStreamState = {
  answer: string;
  error: string | null;
  generatedTitle: string | null;
  sources: Array<RetrievedSource>;
  status: 'done' | 'error' | 'generating' | 'idle' | 'retrieving' | 'rewriting';
  statusMessage: string;
  usage: (QueryUsage & { costCents: number }) | null;
};

const INITIAL_STATE: ChatStreamState = {
  answer: '',
  error: null,
  generatedTitle: null,
  sources: [],
  status: 'idle',
  statusMessage: '',
  usage: null,
};

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

export function useChatStream(): {
  cancel: () => void;
  reset: () => void;
  sendMessage: (conversationId: string, content: string) => void;
  state: ChatStreamState;
} {
  const [state, setState] = useState<ChatStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState(INITIAL_STATE);
  }, [cancel]);

  const sendMessage = useCallback(
    (conversationId: string, content: string) => {
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
          const response: Response = await fetch(
            `${baseUrl}/api/conversations/${conversationId}/messages`,
            {
              body: JSON.stringify({ content }),
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              method: 'POST',
              signal: controller.signal,
            },
          );

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
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines: Array<string> = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const event: ChatSSEEvent | null = parseChatSSEData(line);
              if (event == null) {
                continue;
              }

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
                case 'title':
                  setState((prev) => ({
                    ...prev,
                    generatedTitle: event.title,
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
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setState((prev) => ({
              ...prev,
              status: prev.status === 'error' ? 'error' : 'idle',
              statusMessage: '',
            }));
            return;
          }
          const message: string =
            error instanceof Error ? error.message : 'An unexpected error occurred';
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

  return { cancel, reset, sendMessage, state };
}
