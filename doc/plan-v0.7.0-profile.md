# v0.7.0 Implementation Plan: Profile, Preferences, and Viewing History

## Context

With v0.6.0 complete, users can log in, have roles, and routes are protected. This plan adds personalization: user settings (persisted preferences), profile with Gravatar, filing viewing history (read/unread), and a personalized home page. These features make the app feel tailored to each user and surface new information efficiently.

---

## Key Design Decisions

### user_settings: one row per user, one column per setting
DB-level DEFAULT values on each column. A `getOrCreate` repository function ensures a row exists on first access. Simple, queryable, type-safe. New settings are added as new columns via schema migration in `ensureUserSettingsTables()`.

### Wide view implementation
`PublicLayout` reads `settings.wideView` and applies `max-w-6xl` (narrow) vs `max-w-[96rem]` (wide) on `<main>`. Toggle icon in the header. Optimistic: update React state immediately, fire-and-forget PATCH to server.

### Viewing history: optimistic UI
Toggle read/unread visually immediately, then fire-and-forget the API call. Auto-mark as read on filing detail page open. Stale-on-error is acceptable — resyncs on next page load.

### Personalized vs anonymous home page
Existing `HomePage.tsx` becomes the anonymous view. New `UserHomePage.tsx` for authenticated users. Route at `/` conditionally renders based on auth state. Shared stat components extracted for reuse.

### Gravatar
Server-side `gravatarUrl(email, size)` using `crypto.createHash('md5')`. Returns URL with `?d=identicon` fallback (works without Gravatar account). Frontend uses server-provided URL from profile/session — no client-side MD5 needed.

---

## Steps

### Step 1: Gravatar Utility

Create `packages/server/src/lib/gravatar.ts`:
```typescript
import { createHash } from 'node:crypto';
export function gravatarUrl(email: string, size: number = 80): string {
  const hash: string = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=${size}`;
}
```

Test `packages/server/src/lib/gravatar.test.ts` — known email/hash pairs, trimming, lowercasing.

### Step 2: user_settings Server Module

Create `packages/server/src/user-settings/schema.ts` — `ensureUserSettingsTables(conn)`:
```sql
CREATE TABLE IF NOT EXISTS user_settings (
  user_id VARCHAR PRIMARY KEY,
  email_daily_orbit BOOLEAN NOT NULL DEFAULT FALSE,
  wide_view BOOLEAN NOT NULL DEFAULT FALSE
)
```

Create `packages/server/src/user-settings/repository.ts`:
- `getSettingsByUserId(conn, userId)` — SELECT
- `getOrCreateSettings(conn, userId)` — INSERT ON CONFLICT DO NOTHING, then SELECT
- `updateSettings(conn, userId, patch)` — dynamic SET

Create `packages/server/src/user-settings/routes.ts`:
- `GET /` — returns current user's settings
- `PATCH /` — updates settings

Test `packages/server/src/user-settings/repository.test.ts` — in-memory DuckDB.

Modify `packages/server/src/lib/db-init.ts` — call `ensureUserSettingsTables()`.
Modify `packages/server/src/app.ts` — mount at `/api/user/settings`.

### Step 3: Viewing History Server Module

Create `packages/server/src/viewing-history/schema.ts` — `ensureViewingHistoryTables(conn)`:
```sql
CREATE TABLE IF NOT EXISTS user_filing_view (
  user_id VARCHAR NOT NULL,
  file_number VARCHAR NOT NULL,
  first_viewed_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  last_viewed_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (user_id, file_number)
)
```

Create `packages/server/src/viewing-history/repository.ts`:
- `markViewed(conn, userId, fileNumber)` — INSERT ON CONFLICT DO UPDATE last_viewed_at
- `markUnread(conn, userId, fileNumber)` — DELETE
- `getViewedFileNumbers(conn, userId, fileNumbers[])` — bulk lookup, returns Set
- `getUnreadFilingsSince(conn, userId, since)` — LEFT JOIN filing, WHERE view IS NULL
- `getRecentlyViewed(conn, userId, limit)` — ORDER BY last_viewed_at DESC

Create `packages/server/src/viewing-history/routes.ts`:
- `POST /mark-read` — body: `{ fileNumber }`
- `POST /mark-unread` — body: `{ fileNumber }`
- `POST /bulk-check` — body: `{ fileNumbers[] }` → `{ viewed[] }`
- `GET /unread` — query: `since` (ISO date)
- `GET /recent` — query: `limit`

Test `packages/server/src/viewing-history/repository.test.ts` — in-memory DuckDB.

Modify `packages/server/src/lib/db-init.ts` — call `ensureViewingHistoryTables()`.
Modify `packages/server/src/app.ts` — mount at `/api/user/viewing-history`.

### Step 4: User Profile Route

Create/extend `packages/server/src/user/routes.ts`:
- `GET /profile` — returns `{ id, name, email, role, createdAt, gravatarUrl }`
- `PATCH /profile` — updates name

Add `UserProfile` type to `packages/server/src/user/SessionUser.ts`.
Mount at `/api/user` in `packages/server/src/app.ts`.

### Step 5: Frontend Settings Context

Create `packages/web/src/lib/settings-context.tsx`:
- `SettingsProvider` — fetches settings on mount if authenticated
- Exposes `{ settings, updateSetting(key, value) }` via `useSettings()` hook
- Optimistic local state updates, fire-and-forget PATCH

Modify `packages/web/src/App.tsx` — wrap routes with `<SettingsProvider>`.

### Step 6: Wide View Toggle

Modify `packages/web/src/ui/PublicLayout.tsx`:
- Read `settings?.wideView` from context
- `<main>` class: `settings?.wideView ? 'max-w-[96rem]' : 'max-w-6xl'`
- Add toggle icon button in header (lucide `Maximize2`/`Minimize2`)

Modify `packages/web/src/admin/AdminLayout.tsx` — same wide-view logic.

### Step 7: Profile Page

Create `packages/web/src/user/ProfilePage.tsx`:
- Large Gravatar (128px), name, email, role, member since
- Editable name field
- Settings toggles: email_daily_orbit, wide_view (Radix Switch)

Modify `packages/web/src/App.tsx` — add `/profile` route.
Modify `packages/web/src/ui/PublicLayout.tsx` — header shows small Gravatar (24px) + name, links to `/profile`.

### Step 8: Read/Unread Indicators

Create `packages/web/src/lib/viewing-history.ts` — API helpers: `bulkCheckViewed()`, `markRead()`, `markUnread()`.

Create `packages/web/src/filings/ReadUnreadToggle.tsx`:
- Small icon: lucide `Eye` (read) / `EyeOff` (unread)
- Click toggles, fires API call

Modify `packages/web/src/home/HomePage.tsx` — add read/unread state to filing rows.
Modify `packages/web/src/filings/FilingDetail.tsx` — auto-mark read on mount.

### Step 9: Personalized Home Page

Create `packages/web/src/home/UserHomePage.tsx`:
- "Unread Filings" section — from `/api/user/viewing-history/unread?since=7d`
- "Recently Viewed" section — from `/api/user/viewing-history/recent?limit=10`
- Reused stats/charts from anonymous home page

Extract shared components from `HomePage.tsx`:
- `packages/web/src/home/StatsCards.tsx`
- `packages/web/src/home/FilingVolumeCharts.tsx`

Modify `packages/web/src/App.tsx` — `/` route conditionally renders `UserHomePage` or `HomePage` based on auth state.

---

## Dependency Graph

```
Step 1 (gravatar) ———————————————→ Step 4 (profile route) → Step 7 (profile page)
Step 2 (settings server) ————→ Step 5 (settings context) → Step 6 (wide view)
                                                           ↘ Step 7 (profile page)
Step 3 (viewing history server) → Step 8 (read/unread UI) → Step 9 (personalized home)
```

Steps 1, 2, 3 are independent and can be done in parallel.
Steps 5–9 depend on their respective server modules and auth context (from v0.6.0).

## Verification

1. `make test` — all tests pass
2. `make dev` — start servers
3. Sign in → navigate to `/profile` → see Gravatar, name, email, settings toggles
4. Toggle wide view → layout expands immediately, persists across page refresh
5. Open a filing detail page → returns to filing list → that filing now shows as "read"
6. Click read/unread toggle icon → icon flips, persists on refresh
7. Home page (authenticated) → shows "Unread Filings" and "Recently Viewed" sections
8. Home page (unauthenticated/incognito) → shows anonymous stats page
