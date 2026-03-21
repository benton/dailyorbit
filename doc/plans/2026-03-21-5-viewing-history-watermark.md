# Plan: Viewing History Watermark

## Context

The current viewing history model writes one row per viewed item per user. With ~143k filings and growing, a "mark all as read" operation would INSERT ~143k rows — expensive and unnecessary. The daily trickle of new filings is only ~5-10/day.

**Solution:** Add a per-user, per-content-type "watermark" timestamp. Everything dated at or before the watermark is implicitly viewed. Only items *newer* than the watermark need per-item tracking.

## Design Decisions

1. **Watermark table:** `user_view_watermark(user_id, content_type, watermark_at, updated_at)` — PK `(user_id, content_type)`, content_type is `'filing'` or `'news'`
2. **"Viewed" definition:** item is viewed if `item_date <= watermark_at` OR a row exists in the per-item view table
3. **markUnread below watermark:** silently no-ops — items below the watermark stay "viewed"
4. **Per-item tables kept:** `user_filing_view` and `user_news_view` remain for tracking individual views above the watermark (preserves first/last viewed timestamps)
5. **News date:** use `COALESCE(published_at, created_at)` since `published_at` can be NULL
6. **`getRecentlyViewed` unchanged** — it returns explicitly-opened items only, which is correct
7. **New user onboarding:** Auto-set watermark to account creation timestamp — back catalog is implicitly "read" from day one. This is done at user creation time (or lazily on first query if no watermark row exists).

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/viewing-history/schema.ts` | Add `user_view_watermark` table creation |
| `packages/server/src/viewing-history/repository.ts` | Add watermark functions; modify 3 query functions |
| `packages/server/src/viewing-history/repository.test.ts` | Add watermark tests; expand test setup with filing/news_item tables |
| `packages/server/src/viewing-history/routes.ts` | Add `POST /mark-all-read` and `GET /watermarks` |
| `packages/web/src/lib/viewing-history.ts` | Add `markAllRead()` and `getWatermarks()` client functions |
| `packages/server/src/user/user-service.ts` | Initialize watermarks in `createUser()` |
| `packages/web/src/home/UserHomePage.tsx` | Add "Mark all as read" button |

## Implementation Steps

### Step 1: Schema
Add to `ensureViewingHistoryTables()`:
```sql
CREATE TABLE IF NOT EXISTS user_view_watermark (
  user_id      VARCHAR NOT NULL,
  content_type VARCHAR NOT NULL,
  watermark_at TIMESTAMP NOT NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (user_id, content_type)
)
```

### Step 2: Repository — new watermark functions
- `getWatermark(conn, userId, contentType)` → `Date | null`
- `setWatermark(conn, userId, contentType, watermarkAt?)` → `void` (upsert, defaults to NOW)
- `getWatermarks(conn, userId)` → `Map<ContentType, Date>`

### Step 3: Repository — modify existing query functions

**`getUnreadFilingsSince`** — add LEFT JOIN on watermark, filter `f.date_filed > w.watermark_at`:
```sql
LEFT JOIN user_view_watermark w
  ON w.user_id = ? AND w.content_type = 'filing'
WHERE ...
  AND (w.watermark_at IS NULL OR f.date_filed > w.watermark_at)
```

**`getViewedFileNumbers`** — UNION explicit views with watermark-based views:
```sql
SELECT file_number FROM user_filing_view WHERE user_id = ? AND file_number IN (...)
UNION
SELECT f.file_number FROM filing f, user_view_watermark w
  WHERE w.user_id = ? AND w.content_type = 'filing'
    AND f.file_number IN (...) AND f.date_filed <= w.watermark_at
```

**`getViewedNewsIds`** — same UNION pattern, using `COALESCE(n.published_at, n.created_at)`

### Step 4: Tests (TDD)
Expand test setup to create minimal `filing` and `news_item` tables with seed data at known dates. New test scenarios:

- Watermark CRUD: get/set/idempotent update, content type isolation
- `getUnreadFilingsSince`: excludes filings below watermark; works with no watermark
- `getViewedFileNumbers`: includes watermarked filings in bulk-check results
- `getViewedNewsIds`: respects news watermark, handles NULL `published_at`
- `markUnread` on watermarked item: still appears viewed

### Step 5: User creation — auto-set watermark
In `UserService.createUser()` (`packages/server/src/user/user-service.ts`), after inserting the user and account rows, call `setWatermark(conn, id, 'filing', now)` and `setWatermark(conn, id, 'news', now)` so new users start with the back catalog implicitly read.

### Step 6: Routes
- `POST /mark-all-read` — body: `{ contentType }` → `{ ok, watermarkAt }`
- `GET /watermarks` → `{ filing: string|null, news: string|null }`

### Step 7: Frontend client
Add `markAllRead(contentType)` and `getWatermarks()` to `packages/web/src/lib/viewing-history.ts`.

### Step 8: Frontend UI
Add "Mark all as read" button to UserHomePage unread filings section.

## Verification
1. `make test` — all existing + new tests pass
2. Manual: start API server, call `POST /mark-all-read` with `contentType: 'filing'`, verify `GET /unread?since=30` returns empty (or only very recent items)
3. Manual: verify `POST /bulk-check` with old filing numbers returns them as viewed after watermark is set
4. Manual: verify new filings (after watermark) still appear as unread
