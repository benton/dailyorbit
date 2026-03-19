# Chat with your Team — Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the three-panel chat interface for multi-turn conversations with switchable consultant personas.

**Architecture:** New `chat` feature directory (`packages/web/src/chat/`) with a page component, custom hook for SSE streaming, conversation sidebar, message thread, and consultant selector. Reuses existing UI components (Button, Input, Badge), auth guards (RequireAuth), and API patterns (apiFetch, SSE streaming). Admin consultant CRUD is added to the existing AI Settings page.

**Tech Stack:** React 19, React Router v7, Tailwind CSS v4, lucide-react icons, react-markdown, vitest

**Design doc:** `doc/plans/2026-03-19-chat-consultants-design.md`
**Prerequisite:** Backend plan (`doc/plans/2026-03-19-chat-backend-plan.md`) must be complete — all API endpoints available.

---

## Task 1: Chat Types & API Client

**Files:**
- Create: `packages/web/src/chat/types.ts`
- Create: `packages/web/src/chat/api.ts`

**Step 1: Create shared types**

```typescript
// packages/web/src/chat/types.ts
import type { RetrievedSource, QueryUsage } from '../query/types.ts';

export type Consultant = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  systemPrompt: string;
  modelId: string | null;
  temperature: number | null;
  maxResponseTokens: number | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  enabled: boolean;
  archivedAt: string | null;
};

export type Conversation = {
  id: string;
  userId: string;
  consultantId: number;
  consultantName: string | null;
  consultantIcon: string | null;
  consultantColor: string | null;
  title: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: RetrievedSource[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number;
  modelId: string | null;
  consultantId: number | null;
  sequence: number;
  createdAt: string;
};

export type ConversationWithMessages = Conversation & {
  messages: Message[];
};

export type ChatSSEEvent =
  | {
      type: 'status';
      stage: 'rewriting' | 'retrieving' | 'generating';
      message: string;
    }
  | { type: 'sources'; sources: RetrievedSource[] }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: QueryUsage & { costCents: number } }
  | { type: 'title'; title: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

**Step 2: Create API client functions**

```typescript
// packages/web/src/chat/api.ts
import { apiFetch } from '../lib/api.ts';
import type { Consultant, Conversation, ConversationWithMessages } from './types.ts';

export async function fetchConsultants(): Promise<Consultant[]> {
  return apiFetch<Consultant[]>('/api/consultants');
}

export async function fetchConversations(): Promise<Conversation[]> {
  return apiFetch<Conversation[]>('/api/conversations');
}

export async function fetchConversation(id: string): Promise<ConversationWithMessages> {
  return apiFetch<ConversationWithMessages>(`/api/conversations/${id}`);
}

export async function createConversation(consultantId: number): Promise<Conversation> {
  return apiFetch<Conversation>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ consultantId }),
  });
}

export async function renameConversation(id: string, title: string): Promise<Conversation> {
  return apiFetch<Conversation>(`/api/conversations/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/conversations/${id}`, {
    method: 'DELETE',
  });
}

// Admin
export async function fetchAllConsultants(): Promise<Consultant[]> {
  return apiFetch<Consultant[]>('/api/admin/consultants');
}

export async function createConsultantAdmin(data: Partial<Consultant>): Promise<Consultant> {
  return apiFetch<Consultant>('/api/admin/consultants', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateConsultantAdmin(id: number, data: Partial<Consultant>): Promise<Consultant> {
  return apiFetch<Consultant>(`/api/admin/consultants/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function archiveConsultantAdmin(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/admin/consultants/${id}`, {
    method: 'DELETE',
  });
}
```

**Step 3: Commit**

```bash
git add packages/web/src/chat/types.ts packages/web/src/chat/api.ts
git commit -m "feat(chat): add frontend chat types and API client"
```

---

## Task 2: Chat Stream Hook

Evolve the existing `useQueryStream` pattern into a multi-turn `useChatStream` hook.

**Files:**
- Create: `packages/web/src/chat/useChatStream.ts`
- Create: `packages/web/src/chat/useChatStream.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/chat/useChatStream.test.ts
import { describe, expect, it } from 'vitest';
import { parseChatSSEData } from './useChatStream.ts';

describe('parseChatSSEData', () => {
  it('parses a valid data line', () => {
    const event = parseChatSSEData('data: {"type":"delta","text":"hello"}');
    expect(event).toEqual({ type: 'delta', text: 'hello' });
  });

  it('returns null for empty data', () => {
    expect(parseChatSSEData('data: ')).toBeNull();
    expect(parseChatSSEData('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseChatSSEData('data: {invalid')).toBeNull();
  });

  it('parses title events', () => {
    const event = parseChatSSEData('data: {"type":"title","title":"My Chat"}');
    expect(event).toEqual({ type: 'title', title: 'My Chat' });
  });
});
```

**Step 2: Implement the hook**

```typescript
// packages/web/src/chat/useChatStream.ts
import { useCallback, useRef, useState } from 'react';
import type { ChatSSEEvent, Message } from './types.ts';
import type { RetrievedSource, QueryUsage } from '../query/types.ts';
import env from '../lib/env.tsx';

export type ChatStreamState = {
  answer: string;
  error: string | null;
  sources: Array<RetrievedSource>;
  status: 'idle' | 'rewriting' | 'retrieving' | 'generating' | 'done' | 'error';
  statusMessage: string;
  usage: (QueryUsage & { costCents: number }) | null;
  generatedTitle: string | null;
};

const INITIAL_STATE: ChatStreamState = {
  answer: '',
  error: null,
  sources: [],
  status: 'idle',
  statusMessage: '',
  usage: null,
  generatedTitle: null,
};

export function parseChatSSEData(line: string): ChatSSEEvent | null {
  const trimmed: string = line.startsWith('data:') ? line.slice(5).trim() : '';
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed) as ChatSSEEvent;
  } catch {
    return null;
  }
}

export function useChatStream(): {
  cancel: () => void;
  reset: () => void;
  state: ChatStreamState;
  sendMessage: (conversationId: string, content: string) => void;
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
            setState((prev) => ({ ...prev, error: errorMsg, status: 'error', statusMessage: '' }));
            return;
          }

          const reader: ReadableStreamDefaultReader<Uint8Array> = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer: string = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines: Array<string> = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const event: ChatSSEEvent | null = parseChatSSEData(line);
              if (event == null) continue;

              switch (event.type) {
                case 'status':
                  setState((prev) => ({ ...prev, status: event.stage, statusMessage: event.message }));
                  break;
                case 'sources':
                  setState((prev) => ({ ...prev, sources: event.sources }));
                  break;
                case 'delta':
                  setState((prev) => ({ ...prev, answer: prev.answer + event.text }));
                  break;
                case 'usage':
                  setState((prev) => ({ ...prev, usage: event.usage }));
                  break;
                case 'title':
                  setState((prev) => ({ ...prev, generatedTitle: event.title }));
                  break;
                case 'done':
                  setState((prev) => ({ ...prev, status: 'done', statusMessage: '' }));
                  break;
                case 'error':
                  setState((prev) => ({ ...prev, error: event.message, status: 'error', statusMessage: '' }));
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
          const message: string = error instanceof Error ? error.message : 'An unexpected error occurred';
          setState((prev) => ({ ...prev, error: message, status: 'error', statusMessage: '' }));
        }
      })();
    },
    [cancel],
  );

  return { cancel, reset, state, sendMessage };
}
```

**Step 3: Run tests**

Run: `cd /Users/benton/code/daily-orbit && pnpm vitest run packages/web/src/chat/useChatStream.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/web/src/chat/useChatStream.ts packages/web/src/chat/useChatStream.test.ts
git commit -m "feat(chat): add useChatStream SSE hook with title event support"
```

---

## Task 3: Conversation Sidebar Component

**Files:**
- Create: `packages/web/src/chat/ConversationSidebar.tsx`

**Step 1: Implement the sidebar**

The sidebar lists the user's conversations, sorted by most recent. Features:
- "New conversation" button at top
- Each entry shows: title (or "Untitled"), consultant icon + color dot, relative time
- Active conversation highlighted with a background color
- Hover reveals rename (pencil icon) and delete (trash icon) action buttons
- Rename shows an inline text input, confirm with Enter, cancel with Escape
- Delete shows a confirm dialog (or uses window.confirm for simplicity)

```typescript
// packages/web/src/chat/ConversationSidebar.tsx
import { useCallback, useState } from 'react';
import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import type { Conversation } from './types.ts';

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

function relativeTime(dateStr: string): string {
  const now: number = Date.now();
  const then: number = new Date(dateStr).getTime();
  const diffMs: number = now - then;
  const diffMin: number = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr: number = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)}h ago`;
  const diffDay: number = Math.floor(diffHr / 24);
  return `${String(diffDay)}d ago`;
}

export default function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  const startRename = useCallback((conv: Conversation) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title ?? '');
  }, []);

  const submitRename = useCallback(() => {
    if (renamingId != null && renameValue.trim() !== '') {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRename]);

  return (
    <div className="flex h-full w-64 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="p-3">
        <Button
          className="w-full"
          onClick={onNew}
          size="sm"
          variant="outline"
        >
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          New conversation
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv: Conversation) => (
          <div
            className={`group relative cursor-pointer border-b border-neutral-100 px-3 py-2 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800 ${
              conv.id === activeId
                ? 'bg-blue-50 dark:bg-blue-950'
                : ''
            }`}
            key={conv.id}
            onClick={() => onSelect(conv.id)}
          >
            {renamingId === conv.id ? (
              <Input
                autoFocus
                className="h-7 text-sm"
                onBlur={submitRename}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                value={renameValue}
              />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {conv.consultantIcon != null && (
                    <span className="text-sm">{conv.consultantIcon}</span>
                  )}
                  <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    {conv.title ?? 'Untitled'}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {relativeTime(conv.updatedAt)}
                </div>

                {/* Hover actions */}
                <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                  <button
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(conv);
                    }}
                    title="Rename"
                    type="button"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded p-1 text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    title="Delete"
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {conversations.length === 0 && (
          <p className="p-4 text-center text-sm text-neutral-400">
            No conversations yet
          </p>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/chat/ConversationSidebar.tsx
git commit -m "feat(chat): add conversation sidebar component"
```

---

## Task 4: Consultant Selector Component

**Files:**
- Create: `packages/web/src/chat/ConsultantSelector.tsx`

**Step 1: Implement**

Two modes:
1. **Full selector** — shown when starting a new conversation. Grid of consultant cards.
2. **Compact chip** — shown during conversation. Click to open a dropdown.

```typescript
// packages/web/src/chat/ConsultantSelector.tsx
import { useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Consultant } from './types.ts';

type Props = {
  consultants: Consultant[];
  selected: Consultant | null;
  onSelect: (consultant: Consultant) => void;
  compact?: boolean;
};

export default function ConsultantSelector({
  consultants,
  selected,
  onSelect,
  compact = false,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  const handleSelect = useCallback(
    (consultant: Consultant) => {
      onSelect(consultant);
      setDropdownOpen(false);
    },
    [onSelect],
  );

  // Full grid mode — for new conversation start
  if (!compact) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {consultants.map((c: Consultant) => (
          <button
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              selected?.id === c.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600'
            }`}
            key={c.id}
            onClick={() => handleSelect(c)}
            type="button"
          >
            <div className="mb-1 flex items-center gap-2">
              {c.icon != null && <span className="text-lg">{c.icon}</span>}
              <span className="font-medium text-neutral-800 dark:text-neutral-200">
                {c.name}
              </span>
            </div>
            {c.description != null && (
              <p className="text-sm text-neutral-500">{c.description}</p>
            )}
          </button>
        ))}
      </div>
    );
  }

  // Compact chip mode — during conversation
  return (
    <div className="relative">
      <button
        className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        type="button"
      >
        {selected?.icon != null && <span>{selected.icon}</span>}
        <span className="text-neutral-700 dark:text-neutral-300">
          {selected?.name ?? 'Select consultant'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
      </button>

      {dropdownOpen && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          {consultants.map((c: Consultant) => (
            <button
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                selected?.id === c.id ? 'bg-neutral-100 dark:bg-neutral-700' : ''
              }`}
              key={c.id}
              onClick={() => handleSelect(c)}
              type="button"
            >
              {c.icon != null && <span>{c.icon}</span>}
              <div>
                <div className="font-medium text-neutral-800 dark:text-neutral-200">{c.name}</div>
                {c.description != null && (
                  <div className="text-xs text-neutral-500">{c.description}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/chat/ConsultantSelector.tsx
git commit -m "feat(chat): add consultant selector with grid and chip modes"
```

---

## Task 5: Message Thread Component

**Files:**
- Create: `packages/web/src/chat/MessageThread.tsx`

**Step 1: Implement**

Renders the list of messages in a scrollable container. Features:
- User messages: right-aligned, blue background
- Assistant messages: left-aligned, neutral background, with consultant icon
- Assistant messages render content as markdown (reuse `react-markdown`)
- Sources shown as a collapsible section under assistant messages
- Streaming indicator (animated dots) shown for in-progress messages
- Consultant switch dividers when `consultantId` changes between consecutive assistant messages

This component also renders the "streaming" assistant message at the bottom when `streamingAnswer` is non-empty.

```typescript
// packages/web/src/chat/MessageThread.tsx
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Message, Consultant } from './types.ts';
import type { RetrievedSource } from '../query/types.ts';

type Props = {
  messages: Message[];
  streamingAnswer: string;
  streamingSources: RetrievedSource[];
  isStreaming: boolean;
  consultants: Map<number, Consultant>;
};

function SourcesList({ sources }: { sources: RetrievedSource[] }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  if (sources.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {String(sources.length)} source{sources.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <ul className="mt-1 space-y-1">
          {sources.map((s: RetrievedSource, i: number) => (
            <li className="text-xs text-neutral-500" key={`${s.id}-${String(i)}`}>
              <span className="font-medium">[{String(i + 1)}]</span>{' '}
              {s.url != null ? (
                <a className="underline hover:no-underline" href={s.url} rel="noreferrer" target="_blank">
                  {s.title}
                </a>
              ) : (
                s.title
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MessageThread({
  messages,
  streamingAnswer,
  streamingSources,
  isStreaming,
  consultants,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingAnswer]);

  // Detect consultant switches for dividers
  let lastConsultantId: number | null = null;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg: Message) => {
          let divider: React.ReactNode = null;

          // Show divider when consultant changes between assistant messages
          if (msg.role === 'assistant' && msg.consultantId != null) {
            if (lastConsultantId != null && msg.consultantId !== lastConsultantId) {
              const consultant = consultants.get(msg.consultantId);
              divider = (
                <div className="flex items-center gap-2 py-2 text-xs text-neutral-400">
                  <div className="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
                  <span>
                    Switched to {consultant?.icon ?? ''} {consultant?.name ?? 'another consultant'}
                  </span>
                  <div className="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
                </div>
              );
            }
            lastConsultantId = msg.consultantId;
          }

          return (
            <div key={msg.id}>
              {divider}
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm text-white">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="mt-1 flex-shrink-0 text-lg">
                    {msg.consultantId != null
                      ? (consultants.get(msg.consultantId)?.icon ?? '🤖')
                      : '🤖'}
                  </div>
                  <div className="min-w-0 max-w-[85%]">
                    <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2 text-sm dark:bg-neutral-800">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.sources != null && <SourcesList sources={msg.sources} />}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Streaming assistant message */}
        {isStreaming && streamingAnswer !== '' && (
          <div className="flex gap-3">
            <div className="mt-1 flex-shrink-0 text-lg">🤖</div>
            <div className="min-w-0 max-w-[85%]">
              <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2 text-sm dark:bg-neutral-800">
                <ReactMarkdown>{streamingAnswer}</ReactMarkdown>
                <span className="inline-block animate-pulse text-neutral-400">▊</span>
              </div>
              {streamingSources.length > 0 && <SourcesList sources={streamingSources} />}
            </div>
          </div>
        )}

        {/* Streaming indicator (before any text arrives) */}
        {isStreaming && streamingAnswer === '' && (
          <div className="flex gap-3">
            <div className="mt-1 flex-shrink-0 text-lg">🤖</div>
            <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2 dark:bg-neutral-800">
              <span className="animate-pulse text-sm text-neutral-400">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/chat/MessageThread.tsx
git commit -m "feat(chat): add message thread component with markdown and sources"
```

---

## Task 6: Chat Input Component

**Files:**
- Create: `packages/web/src/chat/ChatInput.tsx`

**Step 1: Implement**

Bottom bar with textarea, consultant chip, and stop button.

```typescript
// packages/web/src/chat/ChatInput.tsx
import { useCallback, useRef, useState } from 'react';
import { Send, StopCircle } from 'lucide-react';
import { Button } from '../ui/button.tsx';
import ConsultantSelector from './ConsultantSelector.tsx';
import type { Consultant } from './types.ts';

type Props = {
  consultants: Consultant[];
  selectedConsultant: Consultant | null;
  onSelectConsultant: (consultant: Consultant) => void;
  onSend: (content: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  disabled?: boolean;
};

export default function ChatInput({
  consultants,
  selectedConsultant,
  onSelectConsultant,
  onSend,
  onCancel,
  isStreaming,
  disabled = false,
}: Props) {
  const [value, setValue] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed: string = value.trim();
    if (trimmed === '' || isStreaming || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset textarea height
    if (textareaRef.current != null) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isStreaming, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Auto-resize textarea
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const ta: HTMLTextAreaElement = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${String(Math.min(ta.scrollHeight, 200))}px`;
  }, []);

  return (
    <div className="border-t border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2">
          <ConsultantSelector
            compact
            consultants={consultants}
            onSelect={onSelectConsultant}
            selected={selectedConsultant}
          />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            disabled={disabled}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question... (⌘+Enter to send)"
            ref={textareaRef}
            rows={1}
            value={value}
          />
          {isStreaming ? (
            <Button onClick={onCancel} size="icon" variant="outline">
              <StopCircle className="h-4 w-4 text-red-500" />
            </Button>
          ) : (
            <Button
              disabled={value.trim() === '' || disabled}
              onClick={handleSubmit}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/chat/ChatInput.tsx
git commit -m "feat(chat): add chat input component with auto-resize and consultant chip"
```

---

## Task 7: Main Chat Page

**Files:**
- Create: `packages/web/src/chat/ChatPage.tsx`

**Step 1: Implement the orchestrator**

This is the top-level page component that wires everything together:
- Fetches consultants and conversations on mount
- Manages active conversation state
- Handles new conversation creation, switching, renaming, deleting
- Passes streaming state from `useChatStream` to child components

```typescript
// packages/web/src/chat/ChatPage.tsx
import { useCallback, useEffect, useState } from 'react';
import ConversationSidebar from './ConversationSidebar.tsx';
import ConsultantSelector from './ConsultantSelector.tsx';
import MessageThread from './MessageThread.tsx';
import ChatInput from './ChatInput.tsx';
import { useChatStream } from './useChatStream.tsx';
import {
  fetchConsultants,
  fetchConversations,
  fetchConversation,
  createConversation,
  renameConversation,
  deleteConversation,
} from './api.ts';
import type { Consultant, Conversation, Message } from './types.ts';
import { useToast } from '../ui/toast.tsx';

export default function ChatPage() {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedConsultant, setSelectedConsultant] = useState<Consultant | null>(null);
  const [isNewConversation, setIsNewConversation] = useState<boolean>(true);
  const { toast } = useToast();
  const { state: streamState, sendMessage, cancel, reset } = useChatStream();

  // Build consultant lookup map
  const consultantMap: Map<number, Consultant> = new Map(
    consultants.map((c: Consultant) => [c.id, c]),
  );

  // Load consultants and conversations on mount
  useEffect(() => {
    void (async () => {
      try {
        const [c, convs] = await Promise.all([
          fetchConsultants(),
          fetchConversations(),
        ]);
        setConsultants(c);
        setConversations(convs);
        if (c.length > 0 && selectedConsultant == null) {
          setSelectedConsultant(c[0]!);
        }
      } catch (err: unknown) {
        const msg: string = err instanceof Error ? err.message : 'Failed to load';
        toast(msg, 'error');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load conversation messages when active changes
  useEffect(() => {
    if (activeConvId == null) return;
    void (async () => {
      try {
        const conv = await fetchConversation(activeConvId);
        setMessages(conv.messages);
        // Set consultant to match conversation's current consultant
        const consultant = consultantMap.get(conv.consultantId);
        if (consultant != null) setSelectedConsultant(consultant);
      } catch (err: unknown) {
        const msg: string = err instanceof Error ? err.message : 'Failed to load conversation';
        toast(msg, 'error');
      }
    })();
  }, [activeConvId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When streaming completes, refresh messages and conversation list
  useEffect(() => {
    if (streamState.status !== 'done') return;
    if (activeConvId == null) return;
    void (async () => {
      const conv = await fetchConversation(activeConvId);
      setMessages(conv.messages);
      // Refresh conversation list (title may have changed)
      const convs = await fetchConversations();
      setConversations(convs);
    })();
    reset();
  }, [streamState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle new conversation
  const handleNew = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    setIsNewConversation(true);
    reset();
  }, [reset]);

  // Handle selecting a conversation
  const handleSelect = useCallback((id: string) => {
    setActiveConvId(id);
    setIsNewConversation(false);
    reset();
  }, [reset]);

  // Handle sending a message
  const handleSend = useCallback(
    async (content: string) => {
      if (selectedConsultant == null) return;

      let convId: string = activeConvId ?? '';

      // Create conversation if new
      if (convId === '') {
        try {
          const conv = await createConversation(selectedConsultant.id);
          convId = conv.id;
          setActiveConvId(convId);
          setIsNewConversation(false);
          setConversations((prev) => [conv, ...prev]);
        } catch (err: unknown) {
          const msg: string = err instanceof Error ? err.message : 'Failed to create conversation';
          toast(msg, 'error');
          return;
        }
      }

      // Add optimistic user message to local state
      const optimisticMsg: Message = {
        id: `temp-${String(Date.now())}`,
        conversationId: convId,
        role: 'user',
        content,
        sources: null,
        inputTokens: null,
        outputTokens: null,
        costCents: 0,
        modelId: null,
        consultantId: null,
        sequence: messages.length + 1,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);

      sendMessage(convId, content);
    },
    [activeConvId, selectedConsultant, messages.length, sendMessage, toast],
  );

  // Handle rename
  const handleRename = useCallback(
    async (id: string, title: string) => {
      try {
        await renameConversation(id, title);
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title } : c)),
        );
      } catch (err: unknown) {
        const msg: string = err instanceof Error ? err.message : 'Rename failed';
        toast(msg, 'error');
      }
    },
    [toast],
  );

  // Handle delete
  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this conversation?')) return;
      try {
        await deleteConversation(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConvId === id) handleNew();
      } catch (err: unknown) {
        const msg: string = err instanceof Error ? err.message : 'Delete failed';
        toast(msg, 'error');
      }
    },
    [activeConvId, handleNew, toast],
  );

  // Handle consultant switch during conversation
  const handleConsultantSwitch = useCallback(
    (consultant: Consultant) => {
      setSelectedConsultant(consultant);
      // If there's an active conversation, the backend will be told on next message
      // via the consultant's config being loaded server-side based on conversation.consultant_id
      // We update locally for the UI immediately
    },
    [],
  );

  const isStreaming: boolean = ['rewriting', 'retrieving', 'generating'].includes(streamState.status);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <ConversationSidebar
        activeId={activeConvId}
        conversations={conversations}
        onDelete={handleDelete}
        onNew={handleNew}
        onRename={handleRename}
        onSelect={handleSelect}
      />

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {isNewConversation && messages.length === 0 ? (
          /* New conversation — show full consultant selector */
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <h1 className="mb-2 text-2xl font-semibold text-neutral-800 dark:text-neutral-200">
              Chat with your Team
            </h1>
            <p className="mb-6 text-neutral-500">Choose a consultant to start</p>
            <div className="w-full max-w-2xl">
              <ConsultantSelector
                consultants={consultants}
                onSelect={handleConsultantSwitch}
                selected={selectedConsultant}
              />
            </div>
          </div>
        ) : (
          /* Message thread */
          <MessageThread
            consultants={consultantMap}
            isStreaming={isStreaming}
            messages={messages}
            streamingAnswer={streamState.answer}
            streamingSources={streamState.sources}
          />
        )}

        {/* Status bar */}
        {isStreaming && streamState.statusMessage !== '' && (
          <div className="border-t border-neutral-100 px-4 py-1 text-center text-xs text-neutral-400 dark:border-neutral-800">
            {streamState.statusMessage}
          </div>
        )}

        {/* Error */}
        {streamState.error != null && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {streamState.error}
          </div>
        )}

        {/* Input */}
        <ChatInput
          consultants={consultants}
          disabled={selectedConsultant == null}
          isStreaming={isStreaming}
          onCancel={cancel}
          onSelectConsultant={handleConsultantSwitch}
          onSend={handleSend}
          selectedConsultant={selectedConsultant}
        />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/chat/ChatPage.tsx
git commit -m "feat(chat): add main ChatPage orchestrator component"
```

---

## Task 8: Route Registration & Nav Link

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/ui/PublicLayout.tsx`

**Step 1: Add route in App.tsx**

Add lazy import and route:

```typescript
const ChatPage = lazy(() => import('./chat/ChatPage.tsx'));
```

Add the route inside the `<Route element={<PublicLayout />}>` block, wrapped in `RequireAuth`:

```tsx
<Route
  element={
    <RequireAuth>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
        <ChatPage />
      </Suspense>
    </RequireAuth>
  }
  path="/chat"
/>
```

**Step 2: Add nav link in PublicLayout.tsx**

Add "Chat with your Team" link in the header navigation, visible only when authenticated. Use the existing `useAuth()` hook to check `isAuthenticated`. Place it alongside other nav links.

Look at how other nav links are structured in `PublicLayout.tsx` and follow the same pattern. The link text should be "Chat with your Team" and point to `/chat`.

**Step 3: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/ui/PublicLayout.tsx
git commit -m "feat(chat): add /chat route and navigation link"
```

---

## Task 9: Admin Consultant Management Page

**Files:**
- Create: `packages/web/src/admin/ConsultantAdmin.tsx`
- Modify: `packages/web/src/App.tsx` (add admin route)
- Modify: `packages/web/src/admin/AdminLayout.tsx` (add nav link)

**Step 1: Implement admin page**

A CRUD page for managing consultants, following the pattern of existing admin pages (e.g., `NewsSourcesAdmin.tsx` or `Companies.tsx`):

- Table listing all consultants (id, name, slug, icon, enabled, archived)
- "Add consultant" button opens a form
- Edit button on each row opens the same form pre-populated
- Delete button archives (soft-delete) with confirmation
- Form fields: name, slug (auto-generated from name), description, system prompt (use PromptEditor pattern), model_id (dropdown from Bedrock model list), temperature (slider), max_response_tokens (number), icon (text), color (color picker), sort_order (number), enabled (toggle)

Use `fetchAllConsultants`, `createConsultantAdmin`, `updateConsultantAdmin`, `archiveConsultantAdmin` from `chat/api.ts`.

**Step 2: Add admin route in App.tsx**

```typescript
const ConsultantAdmin = lazy(() => import('./admin/ConsultantAdmin.tsx'));
```

Add inside the `/admin` route block:
```tsx
<Route
  element={
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
      <ConsultantAdmin />
    </Suspense>
  }
  path="consultants"
/>
```

**Step 3: Add admin nav link in AdminLayout.tsx**

Add a "Consultants" link pointing to `/admin/consultants` in the admin navigation bar, alongside existing links (Config, Companies, Users, AI, Pipeline, News).

**Step 4: Commit**

```bash
git add packages/web/src/admin/ConsultantAdmin.tsx packages/web/src/App.tsx packages/web/src/admin/AdminLayout.tsx
git commit -m "feat(chat): add admin consultant management page"
```

---

## Task 10: Lint, Format, Full Test Suite

**Step 1: Run linter**

Run: `cd /Users/benton/code/daily-orbit && make lint`
Fix any issues.

**Step 2: Run formatter**

Run: `cd /Users/benton/code/daily-orbit && make format`

**Step 3: Run full test suite**

Run: `cd /Users/benton/code/daily-orbit && make test`
Expected: All tests pass.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "style: fix lint and format issues in chat frontend"
```

---

## Summary of Created Files

| File | Purpose |
|------|---------|
| `packages/web/src/chat/types.ts` | Shared TypeScript types |
| `packages/web/src/chat/api.ts` | API client functions |
| `packages/web/src/chat/useChatStream.ts` | SSE streaming hook |
| `packages/web/src/chat/useChatStream.test.ts` | Hook unit tests |
| `packages/web/src/chat/ConversationSidebar.tsx` | Conversation list sidebar |
| `packages/web/src/chat/ConsultantSelector.tsx` | Grid + chip consultant picker |
| `packages/web/src/chat/MessageThread.tsx` | Message display with markdown + sources |
| `packages/web/src/chat/ChatInput.tsx` | Input bar with consultant chip |
| `packages/web/src/chat/ChatPage.tsx` | Main page orchestrator |
| `packages/web/src/admin/ConsultantAdmin.tsx` | Admin CRUD page |

## Modified Files

| File | Change |
|------|--------|
| `packages/web/src/App.tsx` | Add `/chat` and `/admin/consultants` routes |
| `packages/web/src/ui/PublicLayout.tsx` | Add "Chat with your Team" nav link (auth-gated) |
| `packages/web/src/admin/AdminLayout.tsx` | Add "Consultants" admin nav link |
