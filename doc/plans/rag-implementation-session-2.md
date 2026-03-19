# RAG Implementation — Session 2: Frontend Query Interface

**Depends on:** [Session 1](rag-implementation-session-1.md) (backend query pipeline must be working)
**Produces:** A `/query` page with a chat-style interface that streams answers with source citations.

---

## Scope

This session builds the frontend:

1. SSE client hook for consuming the query stream
2. Query page with input, streaming answer, sources panel, and transparency UI
3. Frontend routing and auth gating
4. Clickable source citations that link to existing detail views

---

## Design Principles

### Transparency over polish

The UI should show the user what's happening at each stage. This means visible status transitions ("Analyzing your question...", "Searching 2 queries across filings and news...", "Found 7 relevant sources", "Generating answer...") rather than a generic spinner. The user should feel that the system is working methodically, not mysteriously.

### Cost visibility

Every query response shows token usage — input and output tokens for both the rewrite and generation steps, plus wall-clock times. This is displayed in a collapsible footer, not hidden. Users should understand that this feature has a per-query cost, even before per-user attribution is built.

### Single-question, not chat (for now)

The v1.4 interface is a single question → answer flow, not a multi-turn chat. Each query is independent. This is simpler to build, simpler to reason about costs, and matches the "research assistant" mental model better than chat. Multi-turn can be added later by maintaining a conversation context.

---

## Implementation Steps

### Step 1 — SSE client hook

**File:** `packages/web/src/query/useQueryStream.ts` (new)

```typescript
type QueryStreamState = {
  status: 'idle' | 'rewriting' | 'retrieving' | 'generating' | 'done' | 'error';
  statusMessage: string;
  sources: RetrievedSource[];
  answer: string;          // accumulated answer text
  usage: QueryUsage | null;
  error: string | null;
};

export function useQueryStream(): {
  state: QueryStreamState;
  submit: (question: string) => void;
  cancel: () => void;
}
```

Internally:
- `submit()` calls `fetch('/api/query', { method: 'POST', body: JSON.stringify({ question }) })` with streaming response
- Reads the response body as a `ReadableStream`, parsing SSE events line-by-line
- Updates React state progressively as events arrive
- `cancel()` aborts the fetch via `AbortController`
- Uses `fetch()` + manual SSE parsing (not `EventSource`, which only supports GET)

**Test:** `packages/web/src/query/useQueryStream.test.ts` — unit test with a mock fetch that returns a ReadableStream of SSE events. Verify state transitions.

### Step 2 — Shared types

**File:** `packages/web/src/query/types.ts` (new)

Mirror the server-side `QuerySSEEvent`, `RetrievedSource`, and `QueryUsage` types. These are duplicated rather than shared (monorepo boundary — the web package doesn't import from server). Keep them minimal and in sync.

### Step 3 — Query page component

**File:** `packages/web/src/query/QueryPage.tsx` (new)

Layout (top to bottom):

```
┌──────────────────────────────────────────────────┐
│  Page header: "Ask a Question"                    │
│  Breadcrumb: Home > Query                         │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────┐  [Ask]      │
│  │  Question input (textarea)       │             │
│  └──────────────────────────────────┘             │
│                                                    │
│  ┌─ Status bar ─────────────────────────────────┐ │
│  │  ● Searching 2 queries across filings...      │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌─ Answer ─────────────────────────────────────┐ │
│  │  The Hughes Ka-band application [SAT-LOA-... │ │
│  │  ...was filed on...                           │ │
│  │  (streaming text, rendered as markdown)        │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌─ Sources ────────────────────────────────────┐ │
│  │  📄 SAT-LOA-20240701-00011 — Hughes Ka-band  │ │
│  │  📎 Technical Exhibit A — page 3-7            │ │
│  │  📰 SpaceNews — "Hughes files new..."         │ │
│  │  (each row is a link to the detail view)      │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌─ Usage (collapsible) ────────────────────────┐ │
│  │  Rewrite: 142 in / 87 out tokens  (0.4s)     │ │
│  │  Generate: 3,201 in / 412 out tokens  (2.1s) │ │
│  │  Retrieval: 0.3s   Total: 2.8s               │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

Components:
- **QuestionInput** — textarea with submit button, disabled while streaming. Shows a character counter against the configurable max length (fetched from `/api/admin/config/queryMaxQuestionLength` or hardcoded to 1024 as fallback). Submits on Ctrl+Enter.
- **StatusBar** — animated dots/pulse while active, shows current stage message
- **AnswerDisplay** — renders accumulated markdown text (use existing markdown renderer if available, otherwise a lightweight one). Citation brackets like `[SAT-LOA-20240701-00011]` are parsed into clickable links.
- **SourcesList** — renders `RetrievedSource[]` as a card list with icons by type, each linking to the relevant detail page
- **UsageFooter** — collapsible section showing token counts and timing

### Step 4 — Citation link resolution

**File:** `packages/web/src/query/citation-links.ts` (new)

Parse `[CITATION_ID]` patterns in the answer text and resolve them to app routes:

```typescript
function resolveSourceUrl(source: RetrievedSource): string {
  switch (source.type) {
    case 'filing':    return `/filings/${source.id}`;
    case 'attachment': return `/filings/${source.id}`; // links to parent filing
    case 'pleading':  return `/filings/${source.id}`;
    case 'news':      return source.url ?? '#';
  }
}
```

The AnswerDisplay component scans the streamed text for `[ID]` patterns, matches them against the sources list, and renders them as `<Link>` elements.

### Step 5 — Frontend route + auth gating

**File:** `packages/web/src/App.tsx` (edit)

Add within the `<PublicLayout>` children, wrapped in `<RequireAuth>`:

```tsx
<Route
  element={
    <RequireAuth>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
        <QueryPage />
      </Suspense>
    </RequireAuth>
  }
  path="/query"
/>
```

This follows the exact pattern used by `/filings/unread` and `/profile` — auth-required but not admin-required.

### Step 6 — Navigation link

**File:** `packages/web/src/ui/PublicLayout.tsx` (edit)

Add a "Query" or "Ask" link in the site header navigation, **visible to all users** (including anonymous). Anonymous users who click it will hit the `<RequireAuth>` gate and be redirected to login. This ensures the feature is discoverable — users know it exists before they sign in.

---

## File Summary

| File | Action |
|---|---|
| `packages/web/src/query/types.ts` | Create |
| `packages/web/src/query/useQueryStream.ts` | Create |
| `packages/web/src/query/useQueryStream.test.ts` | Create |
| `packages/web/src/query/QueryPage.tsx` | Create |
| `packages/web/src/query/citation-links.ts` | Create |
| `packages/web/src/App.tsx` | Edit — add `/query` route |
| `packages/web/src/ui/PublicLayout.tsx` | Edit — add nav link |

---

## Markdown Rendering

Check whether the app already has a markdown rendering dependency. If not, add a lightweight one (`react-markdown` or `marked` + `DOMPurify`). The answer text will contain markdown formatting (bold, lists, etc.) from the LLM output.

---

## Open Questions for This Session

1. **Markdown library:** Does the app already render markdown anywhere? Reuse if so.
2. **Dark mode:** The app appears to support dark mode — the query page must respect it.
3. **Mobile responsiveness:** The sources panel should stack below the answer on narrow screens.
4. **Keyboard shortcut:** Should Ctrl+Enter submit the question? (Common pattern.)
