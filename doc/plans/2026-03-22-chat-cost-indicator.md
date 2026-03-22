# Plan: Chat Cost Indicator

## Goal

Add a subtle, live-updating cost indicator to the Chat interface. As the user
exchanges messages, the displayed cost ticks upward in real time.

## Current State

- Backend already computes and persists costs:
  - `conversation.total_cost_cents` — cumulative per conversation
  - `message.cost_cents` — per assistant turn
  - SSE `usage` event includes `costCents` for the current turn
- Frontend types already include `totalCostCents` on `Conversation` and
  `costCents` on `Message`
- `useChatStream` hook captures `streamState.usage` (including `costCents`)
  but never displays it
- No UI currently surfaces cost information anywhere

## Design

A small, muted cost badge appears in the chat header area (next to the
conversation title or consultant name). It shows the running total for the
current conversation, formatted as a dollar amount (e.g., "$0.003"). During
streaming, it updates live using the SSE `usage` event before the conversation
refresh confirms the final value.

The indicator should be:
- **Subtle** — small font, muted color, does not compete with message content
- **Always visible** while a conversation is active
- **Live-updating** — ticks up when a new SSE `usage` event arrives
- **Formatted smartly** — shows enough decimal places to be meaningful for
  small amounts (e.g., "$0.003"), switches to fewer decimals for larger
  amounts (e.g., "$1.24")

No new database columns or API changes are needed. All data is already
available.

## Tasks

### Task 1: Create `ChatCostBadge` component

**File**: `packages/web/src/chat/ChatCostBadge.tsx` (new)

A small presentational component:
- Props: `{ costCents: number }`
- Renders a formatted dollar string from cents
- Styling: small font size (~0.75rem), muted/secondary text color, no border,
  inline display
- Format logic:
  - < $0.01 → show 3+ decimal places (e.g., "$0.003")
  - $0.01–$9.99 → 2 decimal places (e.g., "$0.24")
  - >= $10 → 2 decimal places (e.g., "$12.50")

Steps:
1. Create `ChatCostBadge.tsx` with the formatting logic and CSS
2. Export from the chat module

### Task 2: Wire cost state into ChatPage

**File**: `packages/web/src/chat/ChatPage.tsx` (modify)

Track a `displayCostCents` state that combines:
1. The loaded conversation's `totalCostCents` (from API fetch)
2. Incremental updates from SSE `usage` events during streaming

Steps:
1. Add `displayCostCents` state, initialized from the active conversation's
   `totalCostCents` when a conversation is selected or refreshed
2. When `streamState.usage?.costCents` updates during streaming, add it to
   the display total
3. After streaming completes and conversation refreshes, reset to the
   authoritative `totalCostCents` from the API
4. Pass `displayCostCents` to the header area where `ChatCostBadge` renders

### Task 3: Place the badge in the chat header

**File**: `packages/web/src/chat/ChatPage.tsx` (modify)

Steps:
1. Render `<ChatCostBadge costCents={displayCostCents} />` in the chat
   header, adjacent to the conversation title or consultant name
2. Only show when a conversation is active and `displayCostCents > 0`
3. Ensure it doesn't shift layout when it appears/disappears (use a
   fixed-width slot or fade-in transition)

### Task 4: Add formatting tests

**File**: `packages/web/src/chat/ChatCostBadge.test.tsx` (new)

Steps:
1. Test the dollar formatting function across ranges:
   - 0 cents → hidden or "$0.00"
   - 0.3 cents → "$0.003"
   - 24 cents → "$0.24"
   - 1250 cents → "$12.50"
2. Test that the component renders/hides correctly based on props

## Verification

- `pnpm --filter web test` passes
- `pnpm --filter web build` succeeds
- Visual check: open the Chat page, send a message, confirm the cost badge
  appears and increments after the response streams in
