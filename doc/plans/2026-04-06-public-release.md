# Public Release Design Spec

Open the site for unauthenticated public viewing. All non-admin pages are accessible without login. Premium features that incur cost or modify user state are gated behind authentication, with friendly "subscribe" messaging linking to a new `/about` page.

## 1. Backend Auth Changes

### 1.1 New `optionalAuth()` Middleware

**File:** `packages/server/src/lib/auth-middleware.ts`

Add an `optionalAuth()` middleware alongside the existing `requireAuth()`. It uses the same session-resolution logic but does not return 401 on failure — it simply leaves `c.get('user')` as `undefined` and calls `next()`.

### 1.2 Global Middleware Change

**File:** `packages/server/src/app.ts`

Replace the current global `requireAuth()` on `/api/*` with `optionalAuth()`. Remove the newspaper-images exception (no longer needed since the default is permissive).

### 1.3 Explicitly Protected Routes

These route groups retain `requireAuth()` at the group level:

| Route group | Reason |
|---|---|
| `/api/user/*` | Profile, settings, viewing history, saved searches, flags, hidden items, alerts |
| `/api/conversations/*` | Chat creation and RAG messaging — incurs inference costs |
| `/api/admin/*` | Already gated by `requireAdmin()` |

### 1.4 Public Read-Only Routes

These become accessible without authentication:

- `/api/search`, `/api/autocomplete`
- `/api/filings/*`, `/api/satellites/*`, `/api/earth-stations/*`
- `/api/companies/*`, `/api/news/*`
- `/api/newspaper/*`
- `/api/consultants`
- `/api/health`, `/api/auth/*` (already public)

`/api/me` stays as-is — returns user if authenticated, 401 otherwise. The frontend uses this to detect auth state.

## 2. Frontend Routing Changes

### 2.1 Remove Auth Guards

**File:** `packages/web/src/App.tsx`

Remove the `<RequireAuth>` wrapper from these routes:

- `/` , `/newspaper/:date`
- `/dashboard`
- `/search`
- `/news`, `/news/:id`
- `/chat`
- `/alerts`
- `/companies`, `/companies/:id`
- `/filings/*`
- `/satellites/:id`, `/earth-stations/:callsign`

### 2.2 Routes That Stay Behind `<RequireAuth>`

- `/profile`
- `/settings`
- `/filings/unread`

### 2.3 New Route

- `/about` — `AboutPage` component, no auth required

### 2.4 Nav Bar

Add a "Sign In" button/link visible when `!isAuthenticated`, in the area where the user menu normally appears.

## 3. Shared Component: `<SubscribeDialog>`

**New file:** `packages/web/src/ui/SubscribeDialog.tsx`

A modal dialog component:
- **Props:** `message: string`, `open: boolean`, `onClose: () => void`
- **Content:** Displays the message text, plus a link to `/about`
- **Styling:** Consistent with existing dialog/modal patterns in the app

## 4. Page-Level Gating

### 4.1 Search Page

**File:** `packages/web/src/search/SearchPage.tsx`

When `!isAuthenticated`:
- **Save Search button:** Opens `<SubscribeDialog message="Subscribe Today to Enable Saved Searches" />`
- **Saved Searches button (`SavedSearchPicker`):** Opens `<SubscribeDialog message="Subscribe Today to Enable Saved Searches" />`
- **Show hidden items checkbox:** Rendered as disabled
- **Flag column (`FlagToggle`):** Click opens `<SubscribeDialog message="Become a Subscriber to Hide and Flag Filings" />`
- **Hide column (`HideToggle`):** Click opens `<SubscribeDialog message="Become a Subscriber to Hide and Flag Filings" />`

The `isAuthenticated` state comes from the existing `useAuth()` hook.

### 4.2 Chat Page

**File:** `packages/web/src/chat/ChatPage.tsx`

When `!isAuthenticated`, the submit handler:
1. Does NOT call the API
2. Picks a random consultant from the loaded `/api/consultants` list
3. Picks from a rotation of canned messages:
   - "Sorry, Dear Reader. You'll have to become a subscriber to chat with our editorial staff."
   - "I'd love to help, but my editor says subscribers only. Head to our About page to learn more!"
   - "This conversation requires a subscription. Our editorial team is standing by for subscribers!"
   - "No freeloaders at the press desk! Subscribe to unlock full access to our consultants."
4. Renders the fake reply as a normal assistant message with a short delay for realism
5. The canned messages should include a link to `/about`

The server-side `/api/conversations/*` routes remain behind `requireAuth()` as a hard gate.

### 4.3 Alerts Page

**File:** `packages/web/src/alerts/AlertsPage.tsx`

When `!isAuthenticated`:
- Skip the API fetch entirely
- Show an empty list
- Replace the empty-state message with: "Subscribe Now to Enable Personalized Email Alerts" — linked to `/about`

### 4.4 Unchanged Pages

Home (Newspaper), Dashboard, and News require no changes beyond being unlocked by the routing change.

## 5. The `/about` Page

**New file:** `packages/web/src/about/AboutPage.tsx`

A static product-marketing page styled consistently with the rest of the app (same layout shell, typography, colors).

### Sections

1. **Hero** — "The Daily Orbit" tagline. One-liner: AI-powered satellite communications industry intelligence.

2. **Feature Highlights** — Brief showcase:
   - Full-text and vector search across every FCC IBFS filing
   - AI-powered document summaries and filing timelines
   - RAG-based chat consultants for interrogating the data
   - Automated daily newspaper generation with AI-written articles
   - Real-time alerts on saved searches

3. **How It's Built** — Tech stack and methodology:
   - Full-stack TypeScript monorepo
   - DuckDB for analytics, full-text search, and vector search
   - AWS Bedrock multi-model inference (summarization, embeddings, RAG)
   - SSE streaming for real-time chat
   - Automated nightly data pipeline
   - Emphasis: rapid development, modern AI integration throughout

4. **Call to Action** — "This product has lots of great features, but if you'd like to hire me to make it even more powerful, contact me at benton@bentonroberts.com" — plus a link to bentonroberts.com for the full resume.

5. **Sign In** — Link to `/login` for existing users who arrived via a subscribe dialog.

### Content Source

Hardcoded in the component. Reference bentonroberts.com for accurate resume details during implementation.

## 6. Files Changed Summary

| File | Change |
|---|---|
| `packages/server/src/lib/auth-middleware.ts` | Add `optionalAuth()` |
| `packages/server/src/app.ts` | Global middleware swap, add `requireAuth()` to user/conversation route groups |
| `packages/web/src/App.tsx` | Remove `<RequireAuth>` from public routes, add `/about` route |
| `packages/web/src/ui/SubscribeDialog.tsx` | New shared dialog component |
| `packages/web/src/search/SearchPage.tsx` | Auth-aware gating on save/flag/hide actions |
| `packages/web/src/search/SavedSearchPicker.tsx` | Auth-aware gating |
| `packages/web/src/chat/ChatPage.tsx` | Client-side fake replies when unauthenticated |
| `packages/web/src/alerts/AlertsPage.tsx` | Auth-aware empty state |
| `packages/web/src/about/AboutPage.tsx` | New about/marketing page |
| `packages/web/src/ui/UserMenu.tsx` | Show "Sign In" button when unauthenticated |
| `packages/web/src/ui/PublicLayout.tsx` | Ensure layout works for unauthenticated users (AlertBadge, etc.) |
