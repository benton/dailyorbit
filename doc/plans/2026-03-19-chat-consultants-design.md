# v1.7.0 Design: Chat with your Team — LLM-Powered Consultant Chatbot

## Overview

Evolve the existing single-turn RAG query interface into a multi-turn conversational chatbot with switchable "consultant" personas. Each consultant is a named configuration bundle (system prompt, model, generation parameters) that shares the same RAG retrieval pipeline. Users can switch consultants mid-conversation, and each consultant is aware of the team and can see prior messages from colleagues.

The feature is gated behind authentication and branded as **"Chat with your Team"**.

---

## Data Model

### `consultant`

A named configuration bundle that shapes how the LLM responds.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `INTEGER` (auto-increment PK) | |
| `name` | `VARCHAR NOT NULL` | Display name, e.g. "Regulatory Analyst" |
| `slug` | `VARCHAR NOT NULL UNIQUE` | URL-safe identifier |
| `description` | `VARCHAR` | Short blurb shown in selector UI |
| `system_prompt` | `TEXT NOT NULL` | The persona-specific prompt |
| `model_id` | `VARCHAR` | Override model, NULL = use default |
| `temperature` | `FLOAT` | NULL = use model default |
| `max_response_tokens` | `INTEGER` | NULL = no limit |
| `icon` | `VARCHAR` | Emoji or icon name for UI |
| `color` | `VARCHAR` | Hex color for UI accent |
| `sort_order` | `INTEGER DEFAULT 0` | Controls display ordering |
| `enabled` | `BOOLEAN DEFAULT true` | Admin can disable without deleting |
| `archived_at` | `TIMESTAMP` | Soft-delete; NULL = active |
| `created_at` | `TIMESTAMP DEFAULT now()` | |
| `updated_at` | `TIMESTAMP DEFAULT now()` | |

### `conversation`

A reified multi-turn chat session owned by a user.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` (PK) | |
| `user_id` | `VARCHAR NOT NULL` | FK to `user` |
| `consultant_id` | `INTEGER NOT NULL` | FK to `consultant` |
| `title` | `VARCHAR` | NULL until auto-generated after first exchange |
| `total_input_tokens` | `INTEGER DEFAULT 0` | Running total |
| `total_output_tokens` | `INTEGER DEFAULT 0` | Running total |
| `total_cost_cents` | `FLOAT DEFAULT 0` | Running total |
| `created_at` | `TIMESTAMP DEFAULT now()` | |
| `updated_at` | `TIMESTAMP DEFAULT now()` | |

### `message`

Individual turns within a conversation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` (PK) | |
| `conversation_id` | `UUID NOT NULL` | FK to `conversation` |
| `role` | `VARCHAR NOT NULL` | `'user'` or `'assistant'` |
| `content` | `TEXT NOT NULL` | The message text |
| `sources` | `JSON` | Retrieved sources array (assistant messages only) |
| `input_tokens` | `INTEGER` | Tokens consumed by this turn's request |
| `output_tokens` | `INTEGER` | Tokens generated in this turn's response |
| `cost_cents` | `FLOAT DEFAULT 0` | Cost for this turn |
| `model_id` | `VARCHAR` | Which model served this response |
| `consultant_id` | `INTEGER` | Which consultant generated this message |
| `sequence` | `INTEGER NOT NULL` | Ordering within conversation |
| `created_at` | `TIMESTAMP DEFAULT now()` | |

**Index:** `(conversation_id, sequence)` for ordered retrieval.

**Note:** `consultant_id` on `message` tracks which consultant produced each assistant response, since the user can switch consultants mid-conversation. The `consultant_id` on `conversation` reflects the most recently used consultant.

---

## Consultant Team Identity

Each consultant's system prompt is dynamically assembled at request time:

```
{team_preamble}

{consultant_specific_prompt}
```

The **team preamble** is generated from the `consultant` table at request time:

> You are **{name}**, a member of the Daily Orbit analyst team. Your team includes:
> - **General Analyst** — Balanced FCC filing Q&A, good starting point for any question
> - **Regulatory Strategist** — Procedural status, approval timelines, legal precedent
> - **Competitive Intelligence** — Market positioning, company activity, M&A implications
>
> When another team member's expertise would better serve the user's question, suggest they switch. You can see and build upon your colleagues' prior responses in the conversation.

This is built dynamically from enabled consultants — adding a new consultant automatically updates everyone's team awareness.

### Seed Consultants

Three built-in consultants, loaded via `./daily-orbit config seed-consultants` (idempotent):

1. **General Analyst** (`general-analyst`) — Balanced FCC filing Q&A
2. **Regulatory Strategist** (`regulatory-strategist`) — Procedural status, timelines, legal precedent, recommended actions
3. **Competitive Intelligence** (`competitive-intelligence`) — Market positioning, company patterns, spectrum competition, M&A

Each consultant can override the default model. Expensive deep-analysis consultants can use a more capable model; quick-lookup consultants can use a cheaper one.

---

## Message Flow

`POST /api/conversations/:id/messages` with `{ content: "user's question" }`

Returns an SSE stream (extending the existing query SSE protocol).

### Steps

1. **Persist user message** — insert with role `'user'`, increment sequence
2. **Load context** — fetch all prior messages + current consultant config
3. **Rewrite** — existing query rewriter transforms the question into search queries
4. **Retrieve** — existing hybrid BM25 + vector search
5. **Build LLM request:**
   ```
   [
     { role: "system", content: team_preamble + consultant.system_prompt },
     { role: "user", content: turn_1_user },
     { role: "assistant", content: turn_1_assistant },
     ...
     { role: "user", content: current_question_with_RAG_context },
   ]
   ```
   Only the final user message gets RAG context injected. Prior turns are sent verbatim.
6. **Stream** — Bedrock `converseStream` with consultant's model/temperature/max_tokens, emit SSE deltas
7. **Persist assistant message** — insert with full response, sources, tokens, cost_cents, model_id, consultant_id
8. **Update conversation** — bump `updated_at`, increment token/cost rollups, update `consultant_id`
9. **Auto-title** — if first exchange and title is NULL, background LLM call (cheap model) to generate a short title

### SSE Event Types

Extends the existing protocol:

- `status` — stage updates (rewriting, retrieving, generating)
- `sources` — retrieved sources array
- `delta` — streaming answer chunks
- `usage` — token counts + cost_cents
- `title` — `{ type: "title", title: "..." }` (new, after first exchange)
- `done` — stream complete
- `error` — error

---

## Token Management Strategy

See [conversation-token-management-strategy.md](conversation-token-management-strategy.md) for full analysis.

**Decision:** Full-history window (all messages sent every turn) with a configurable safety valve. When conversations exceed `maxConversationTurns` (default 50) or 80% of the model's context window, fall back to hybrid mode (summarize old messages, keep recent ones verbatim). The hybrid fallback is documented but not implemented in v1.7 — conversations are expected to be short enough that full history suffices.

---

## API Endpoints

### User-Facing

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/consultants` | List enabled consultants |
| `GET` | `/api/conversations` | List user's conversations (paginated, newest first) |
| `POST` | `/api/conversations` | Create conversation `{ consultantId }` |
| `GET` | `/api/conversations/:id` | Get conversation + all messages |
| `PUT` | `/api/conversations/:id` | Rename title |
| `DELETE` | `/api/conversations/:id` | Delete conversation + cascade messages |
| `POST` | `/api/conversations/:id/messages` | Send message, SSE stream response |

### Admin

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/consultants` | List all consultants (including disabled/archived) |
| `POST` | `/api/admin/consultants` | Create consultant |
| `PUT` | `/api/admin/consultants/:id` | Update consultant |
| `DELETE` | `/api/admin/consultants/:id` | Archive consultant (soft-delete) |

---

## Frontend

### Layout — Three-Panel Chat Interface

- **Left sidebar** — conversation list + "New conversation" button
  - Each entry: title (or "Untitled"), consultant icon/color, relative timestamp
  - Active conversation highlighted
  - Hover for rename/delete actions
  - Mobile: collapses to hamburger menu

- **Center panel** — chat thread
  - Scrollable message list, user/assistant bubbles
  - Assistant messages: markdown rendering with citation links, collapsible sources
  - Consultant switch dividers ("Switched to Regulatory Strategist")
  - Streaming indicator during generation

- **Bottom bar** — input area
  - Textarea with Cmd/Enter to send
  - Consultant selector chip (name + icon, click for dropdown)
  - Stop button during streaming

### Consultant Selector

Prominent when starting a new conversation. During conversation, shown as a compact chip above the input. Switching mid-conversation:
- Updates `conversation.consultant_id`
- Inserts a visual divider in the thread
- Subsequent messages use the new consultant's config

### Authentication Gating

- `/chat` route requires authentication
- Unauthenticated users redirect to login
- Navigation header shows "Chat with your Team" for logged-in users only

---

## Soft-Delete Behavior

Archiving a consultant (setting `archived_at`) does the following:
- Removes it from user-facing consultant list
- Removes it from admin "enabled" list (shown in "archived" section)
- Existing conversations display "Deleted consultant" fallback with a muted visual treatment
- The consultant's data is preserved for conversation history integrity

---

## Scope Summary

### In scope (v1.7)
- Consultant table + CRUD API + admin UI
- Conversation + message tables + user API
- Multi-turn SSE streaming with full-history context
- Dynamic team preamble generation
- Auto-title generation
- Seed consultants CLI
- Three-panel chat frontend
- Consultant switching mid-conversation
- Conversation rename + delete
- Token + cost tracking per message and conversation
- Auth gating

### Out of scope (future)
- Conversation search / export / branching
- Suggested follow-up questions
- Per-response feedback/ratings
- Hybrid summarization fallback implementation
- Conversation sharing between users
