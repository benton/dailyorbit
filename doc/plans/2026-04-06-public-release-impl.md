# Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open all non-admin pages for unauthenticated public viewing, with premium features gated behind auth and friendly "subscribe" dialogs linking to a new `/about` page.

**Architecture:** Add `optionalAuth()` server middleware so public API routes work without a session. Keep `requireAuth()` on cost-incurring and state-mutating route groups. On the frontend, remove `<RequireAuth>` from public routes and add auth-conditional UI gating with a shared `<SubscribeDialog>` component. Chat fakes replies client-side for unauthenticated users.

**Tech Stack:** Hono (server middleware), React + React Router + Radix Dialog (frontend), existing `useAuth()` context.

---

### Task 1: Add `optionalAuth()` Server Middleware

**Files:**
- Modify: `packages/server/src/lib/auth-middleware.ts`

- [ ] **Step 1: Add `optionalAuth()` function**

Add after the existing `requireAuth()` function (after line 38):

```typescript
/**
 * Middleware that populates `c.get('user')` from the session cookie if present,
 * but does NOT return 401 if no valid session is found.
 * Use on routes that are publicly accessible but behave differently when authenticated.
 */
export function optionalAuth(): MiddlewareHandler {
  return async (c: Context, next) => {
    try {
      const auth = getAuth();
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      if (session != null) {
        const user: SessionUser = {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role:
            ((session.user as Record<string, unknown>).role as string) ?? 'user',
        };
        c.set('user', user);
      }
    } catch {
      // No valid session — continue without user context
    }
    await next();
  };
}
```

- [ ] **Step 2: Verify the server compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/lib/auth-middleware.ts
git commit -m "feat(auth): add optionalAuth() middleware for public route support"
```

---

### Task 2: Switch Global Middleware and Protect User/Chat Routes

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Update the import to include `optionalAuth`**

In `packages/server/src/app.ts` line 13, change:

```typescript
import { requireAuth, requireAdmin } from './lib/auth-middleware.ts';
```

to:

```typescript
import { optionalAuth, requireAuth, requireAdmin } from './lib/auth-middleware.ts';
```

- [ ] **Step 2: Replace global `requireAuth()` with `optionalAuth()`**

Replace lines 62-69 (the global API middleware block):

```typescript
// Protected API routes — require authentication for ALL endpoints.
// Newspaper images are public so <img> tags can load them without cookies.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/newspaper/images/')) {
    return next();
  }
  return requireAuth()(c, next);
});
```

with:

```typescript
// Public API routes — populate user context if a session exists, but don't require it.
// Cost-incurring and state-mutating routes are explicitly protected below.
app.use('/api/*', optionalAuth());
```

- [ ] **Step 3: Add explicit `requireAuth()` to user and conversation route groups**

Add these two lines immediately after the `app.use('/api/admin/*', requireAdmin());` line (after line 72):

```typescript
app.use('/api/user/*', requireAuth());
app.use('/api/conversations/*', requireAuth());
```

Note: `/api/me` intentionally stays unprotected by route-group middleware — it already returns 401 naturally when there's no session, and the frontend uses it to detect auth state.

- [ ] **Step 4: Verify the server compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Manual smoke test**

Start the dev server and verify:
- `curl http://localhost:3000/api/search?q=spacex` returns results (no auth)
- `curl http://localhost:3000/api/user/saved-searches` returns 401
- `curl http://localhost:3000/api/conversations` returns 401
- `curl http://localhost:3000/api/consultants` returns results (no auth)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat(auth): switch to optional auth globally, protect user and chat routes"
```

---

### Task 3: Create `<SubscribeDialog>` Component

**Files:**
- Create: `packages/web/src/ui/SubscribeDialog.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/ui/SubscribeDialog.tsx`:

```tsx
import { Link } from 'react-router';
import { Button } from './button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.tsx';

type SubscribeDialogProps = {
  message: string;
  onClose: () => void;
  open: boolean;
};

export function SubscribeDialog({ message, onClose, open }: SubscribeDialogProps) {
  return (
    <Dialog onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribers Only</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} size="sm" variant="outline">
            Close
          </Button>
          <Link to="/about">
            <Button size="sm">Learn More</Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify the frontend compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/ui/SubscribeDialog.tsx
git commit -m "feat(ui): add SubscribeDialog component for public release gating"
```

---

### Task 4: Unlock Frontend Routes

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Split the route tree into public and auth-required sections**

In `packages/web/src/App.tsx`, replace the single `<RequireAuth>` wrapped route block (lines 76-186) with two blocks: a public `<PublicLayout>` block and an auth-required block for profile/settings/unread.

Replace lines 76-186:

```tsx
            {/* All routes require authentication */}
            <Route
              element={
                <RequireAuth>
                  <PublicLayout />
                </RequireAuth>
              }
            >
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewspaperView latest />
                  </Suspense>
                }
                path="/"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <HomePage />
                  </Suspense>
                }
                path="/dashboard"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewspaperView />
                  </Suspense>
                }
                path="/newspaper/:date"
              />
              <Route element={<About />} path="/about" />
              <Route element={<SearchPage />} path="/search" />
              <Route element={<FilingDetail />} path="/filings/*" />
              <Route element={<SatelliteDetail />} path="/satellites/:id" />
              <Route element={<EarthStationDetail />} path="/earth-stations/:callsign" />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <CompaniesPage />
                  </Suspense>
                }
                path="/companies"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <CompanyDetail />
                  </Suspense>
                }
                path="/companies/:id"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <OwnershipEventsPage />
                  </Suspense>
                }
                path="/ownership-events"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewsPage />
                  </Suspense>
                }
                path="/news"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewsDetail />
                  </Suspense>
                }
                path="/news/:id"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <ChatPage />
                  </Suspense>
                }
                path="/chat"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <AlertsPage />
                  </Suspense>
                }
                path="/alerts"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <UserHomePage />
                  </Suspense>
                }
                path="/filings/unread"
              />
              <Route element={<ProfilePage />} path="/profile" />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <SettingsPage />
                  </Suspense>
                }
                path="/settings"
              />
            </Route>
```

with:

```tsx
            {/* Public routes — accessible without authentication */}
            <Route element={<PublicLayout />}>
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewspaperView latest />
                  </Suspense>
                }
                path="/"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <HomePage />
                  </Suspense>
                }
                path="/dashboard"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewspaperView />
                  </Suspense>
                }
                path="/newspaper/:date"
              />
              <Route element={<AboutPage />} path="/about" />
              <Route element={<SearchPage />} path="/search" />
              <Route element={<FilingDetail />} path="/filings/*" />
              <Route element={<SatelliteDetail />} path="/satellites/:id" />
              <Route element={<EarthStationDetail />} path="/earth-stations/:callsign" />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <CompaniesPage />
                  </Suspense>
                }
                path="/companies"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <CompanyDetail />
                  </Suspense>
                }
                path="/companies/:id"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <OwnershipEventsPage />
                  </Suspense>
                }
                path="/ownership-events"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewsPage />
                  </Suspense>
                }
                path="/news"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewsDetail />
                  </Suspense>
                }
                path="/news/:id"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <ChatPage />
                  </Suspense>
                }
                path="/chat"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <AlertsPage />
                  </Suspense>
                }
                path="/alerts"
              />
              {/* Auth-required routes within the public layout */}
              <Route
                element={
                  <RequireAuth>
                    <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                      <UserHomePage />
                    </Suspense>
                  </RequireAuth>
                }
                path="/filings/unread"
              />
              <Route
                element={
                  <RequireAuth>
                    <ProfilePage />
                  </RequireAuth>
                }
                path="/profile"
              />
              <Route
                element={
                  <RequireAuth>
                    <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                      <SettingsPage />
                    </Suspense>
                  </RequireAuth>
                }
                path="/settings"
              />
            </Route>
```

- [ ] **Step 2: Remove the inline `About` component and add `AboutPage` import**

Remove lines 56-67 (the inline `About` component):

```tsx
const About = () => (
  <div className="m-6 mx-auto w-8/12 rounded-theme border border-border-theme bg-surface-card p-4 shadow-md">
    <h1 className="text-4xl">
      <fbt desc="About">About</fbt>
    </h1>
    <p className="my-4">
      <Link to="/">
        <fbt desc="Back to home link">Home</fbt>
      </Link>
    </p>
  </div>
);
```

Add this lazy import near the other lazy imports (after line 44):

```tsx
const AboutPage = lazy(() => import('./about/AboutPage.tsx'));
```

- [ ] **Step 3: Verify the frontend compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: May fail because `AboutPage` doesn't exist yet — that's fine, it will be created in Task 8. Verify no other errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(routes): unlock public pages, keep auth on profile/settings/unread"
```

---

### Task 5: Update `PublicLayout` Nav for Unauthenticated Users

**Files:**
- Modify: `packages/web/src/ui/PublicLayout.tsx`

- [ ] **Step 1: Show Chat and Alerts nav links for all users**

In `packages/web/src/ui/PublicLayout.tsx`, replace lines 116-117:

```tsx
          {isAuthenticated && <NavLink label="Chat" to="/chat" />}
          {isAuthenticated && <AlertBadge />}
```

with:

```tsx
          <NavLink label="Chat" to="/chat" />
          {isAuthenticated ? <AlertBadge /> : <NavLink label="Alerts" to="/alerts" />}
```

This shows the Chat link always, and shows the AlertBadge (with count) for authenticated users or a plain "Alerts" text link for unauthenticated users.

- [ ] **Step 2: Guard the AlertBadge fetch against 401s**

In the `AlertBadge` component (lines 25-60), the `fetchCount` function fetches `/api/user/alerts/unread-count` which will now 401 for unauthenticated users. The existing `catch { /* silent */ }` handles this gracefully — the count stays 0. No change needed here.

- [ ] **Step 3: Verify the frontend compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/ui/PublicLayout.tsx
git commit -m "feat(nav): show Chat and Alerts links for unauthenticated users"
```

---

### Task 6: Gate Search Page Premium Features

**Files:**
- Modify: `packages/web/src/search/SearchPage.tsx`

- [ ] **Step 1: Add SubscribeDialog import and state**

At the top of `packages/web/src/search/SearchPage.tsx`, add this import (after the existing imports around line 27):

```tsx
import { SubscribeDialog } from '../ui/SubscribeDialog.tsx';
```

Inside the `SearchPage` component, add state for the subscribe dialog (near the existing `showSaveModal` state around line 1178):

```tsx
const [subscribeDialog, setSubscribeDialog] = useState<string | null>(null);
```

- [ ] **Step 2: Change Save Search button to show dialog when not authenticated**

Replace lines 1748-1753 (the Save Search button block):

```tsx
        {isAuthenticated && activeTab === 'filings' && (
          <Button onClick={() => setShowSaveModal(true)} size="sm" variant="outline">
            <Bookmark className="mr-1.5 h-3.5 w-3.5" />
            Save Search
          </Button>
        )}
```

with:

```tsx
        {activeTab === 'filings' && (
          <Button
            onClick={() =>
              isAuthenticated
                ? setShowSaveModal(true)
                : setSubscribeDialog('Subscribe Today to Enable Saved Searches')
            }
            size="sm"
            variant="outline"
          >
            <Bookmark className="mr-1.5 h-3.5 w-3.5" />
            Save Search
          </Button>
        )}
```

- [ ] **Step 3: Change Saved Searches picker to show dialog when not authenticated**

Replace line 1754:

```tsx
        {isAuthenticated && <SavedSearchPicker onLoad={handleLoadSavedSearch} />}
```

with:

```tsx
        {isAuthenticated ? (
          <SavedSearchPicker onLoad={handleLoadSavedSearch} />
        ) : (
          <Button
            onClick={() => setSubscribeDialog('Subscribe Today to Enable Saved Searches')}
            size="sm"
            variant="outline"
          >
            <Bookmark className="mr-1.5 h-3.5 w-3.5" />
            Saved Searches
          </Button>
        )}
```

- [ ] **Step 4: Disable Show Hidden Items checkbox when not authenticated**

Replace lines 1755-1765 (the show hidden items checkbox block):

```tsx
        {isAuthenticated && activeTab === 'filings' && (
          <label className="ml-4 flex items-center gap-1.5 text-sm text-on-surface-muted">
            <input
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              type="checkbox"
            />
            <Eye className="h-3.5 w-3.5" />
            Show hidden items
          </label>
        )}
```

with:

```tsx
        {activeTab === 'filings' && (
          <label className="ml-4 flex items-center gap-1.5 text-sm text-on-surface-muted">
            <input
              checked={showHidden}
              disabled={!isAuthenticated}
              onChange={(e) => setShowHidden(e.target.checked)}
              type="checkbox"
            />
            <Eye className="h-3.5 w-3.5" />
            Show hidden items
          </label>
        )}
```

- [ ] **Step 5: Show Flag and Hide columns for all users, but gate clicks**

In the filing columns `useMemo` (around line 1473), the flag and hide columns are currently only included when `isAuthenticated` (line 1530-1533). We need to always include them but gate the toggle behavior.

Replace the `flagCol` definition (lines 1473-1495) with a version that gates on auth:

```tsx
    const flagCol: ColumnDef<FilingSearchResult, unknown> = {
      cell: ({ row }) =>
        isAuthenticated ? (
          <FlagToggle
            contentKey={row.original.file_number}
            contentType="filing"
            initialFlagged={flaggedKeys.has(row.original.file_number)}
            onToggle={(nowFlagged: boolean) => {
              setFlaggedKeys((prev: Set<string>) => {
                const next: Set<string> = new Set(prev);
                if (nowFlagged) {
                  next.add(row.original.file_number);
                } else {
                  next.delete(row.original.file_number);
                }
                return next;
              });
            }}
          />
        ) : (
          <button
            className="p-1 text-on-surface-muted/50 hover:text-on-surface-muted"
            onClick={() =>
              setSubscribeDialog('Become a Subscriber to Hide and Flag Filings')
            }
            type="button"
          >
            <Flag className="h-4 w-4" />
          </button>
        ),
      header: () => <Flag className="h-4 w-4 text-on-surface-muted/70" />,
      id: 'flag',
      size: 40,
    };
```

Replace the `hideCol` definition (lines 1496-1528) similarly:

```tsx
    const hideCol: ColumnDef<FilingSearchResult, unknown> = {
      cell: ({ row }) => {
        const isHidden: boolean = hiddenKeys.has(row.original.file_number);
        return isAuthenticated ? (
          <div className="flex items-center gap-1">
            <HideToggle
              contentKey={row.original.file_number}
              contentType="filing"
              initialHidden={isHidden}
              onToggle={(nowHidden: boolean) => {
                setHiddenKeys((prev: Set<string>) => {
                  const next: Set<string> = new Set(prev);
                  if (nowHidden) {
                    next.add(row.original.file_number);
                  } else {
                    next.delete(row.original.file_number);
                  }
                  return next;
                });
              }}
            />
            {showHidden && isHidden && (
              <span className="rounded bg-surface px-1 py-0.5 text-[10px] text-on-surface-muted">
                Hidden
              </span>
            )}
          </div>
        ) : (
          <button
            className="p-1 text-on-surface-muted/50 hover:text-on-surface-muted"
            onClick={() =>
              setSubscribeDialog('Become a Subscriber to Hide and Flag Filings')
            }
            type="button"
          >
            <EyeOff className="h-4 w-4" />
          </button>
        );
      },
      header: () => <EyeOff className="h-4 w-4 text-on-surface-muted/70" />,
      id: 'hide',
      size: 80,
    };
```

Then update the column array assembly (line 1529-1533) to always include flag and hide columns:

```tsx
    return [
      ...(isAuthenticated ? [selectCol] : []),
      ...filingColumns,
      flagCol,
      hideCol,
    ];
```

- [ ] **Step 6: Apply the same changes to the content search columns**

Repeat the same pattern for the content search flag/hide columns (lines 1571-1630). Replace the `flagCol` for content search:

```tsx
    const flagCol: ColumnDef<ContentSearchResult, unknown> = {
      cell: ({ row }) =>
        isAuthenticated ? (
          <FlagToggle
            contentKey={row.original.file_number}
            contentType="filing"
            initialFlagged={flaggedKeys.has(row.original.file_number)}
            onToggle={(nowFlagged: boolean) => {
              setFlaggedKeys((prev: Set<string>) => {
                const next: Set<string> = new Set(prev);
                if (nowFlagged) {
                  next.add(row.original.file_number);
                } else {
                  next.delete(row.original.file_number);
                }
                return next;
              });
            }}
          />
        ) : (
          <button
            className="p-1 text-on-surface-muted/50 hover:text-on-surface-muted"
            onClick={() =>
              setSubscribeDialog('Become a Subscriber to Hide and Flag Filings')
            }
            type="button"
          >
            <Flag className="h-4 w-4" />
          </button>
        ),
      header: () => <Flag className="h-4 w-4 text-on-surface-muted/70" />,
      id: 'flag',
      size: 40,
    };
```

Replace the content search `hideCol`:

```tsx
    const hideCol: ColumnDef<ContentSearchResult, unknown> = {
      cell: ({ row }) => {
        const isHidden: boolean = hiddenKeys.has(row.original.file_number);
        return isAuthenticated ? (
          <div className="flex items-center gap-1">
            <HideToggle
              contentKey={row.original.file_number}
              contentType="filing"
              initialHidden={isHidden}
              onToggle={(nowHidden: boolean) => {
                setHiddenKeys((prev: Set<string>) => {
                  const next: Set<string> = new Set(prev);
                  if (nowHidden) {
                    next.add(row.original.file_number);
                  } else {
                    next.delete(row.original.file_number);
                  }
                  return next;
                });
              }}
            />
            {showHidden && isHidden && (
              <span className="rounded bg-surface px-1 py-0.5 text-[10px] text-on-surface-muted">
                Hidden
              </span>
            )}
          </div>
        ) : (
          <button
            className="p-1 text-on-surface-muted/50 hover:text-on-surface-muted"
            onClick={() =>
              setSubscribeDialog('Become a Subscriber to Hide and Flag Filings')
            }
            type="button"
          >
            <EyeOff className="h-4 w-4" />
          </button>
        );
      },
      header: () => <EyeOff className="h-4 w-4 text-on-surface-muted/70" />,
      id: 'hide',
      size: 80,
    };
```

And update the content search column array assembly to always include flag and hide:

```tsx
    return [
      ...(isAuthenticated ? [selectCol] : []),
      ...contentColumns,
      flagCol,
      hideCol,
    ];
```

- [ ] **Step 7: Add the SubscribeDialog render**

At the end of the SearchPage JSX return, just before the closing fragment or div, add:

```tsx
      <SubscribeDialog
        message={subscribeDialog ?? ''}
        onClose={() => setSubscribeDialog(null)}
        open={subscribeDialog != null}
      />
```

- [ ] **Step 8: Verify the frontend compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/search/SearchPage.tsx
git commit -m "feat(search): gate save/flag/hide behind auth with subscribe dialogs"
```

---

### Task 7: Gate Chat Page for Unauthenticated Users

**Files:**
- Modify: `packages/web/src/chat/ChatPage.tsx`

- [ ] **Step 1: Add auth import and canned reply constants**

At the top of `packages/web/src/chat/ChatPage.tsx`, add the auth import (after existing imports):

```tsx
import { useAuth } from '../user/AuthContext.tsx';
```

Inside `ChatPageInner`, add the auth hook and canned replies after the existing state declarations (after line 37):

```tsx
  const { isAuthenticated } = useAuth();

  const cannedReplies: Array<string> = [
    'Sorry, Dear Reader. You\'ll have to [become a subscriber](/about) to chat with our editorial staff.',
    'I\'d love to help, but my editor says [subscribers only](/about). Head to our About page to learn more!',
    'This conversation requires a [subscription](/about). Our editorial team is standing by for subscribers!',
    'No freeloaders at the press desk! [Subscribe](/about) to unlock full access to our consultants.',
  ];
  const cannedReplyIndex = useRef<number>(0);
```

- [ ] **Step 2: Add fake reply handler**

Add a new function after the `handleSend` callback (after line 178):

```tsx
  const handleFakeSend = useCallback(
    (content: string) => {
      if (selectedConsultant == null || consultants.length === 0) {
        return;
      }

      // Pick a random consultant for each reply
      const randomConsultant: Consultant =
        consultants[Math.floor(Math.random() * consultants.length)]!;

      // Add user message
      const userMsg: Message = {
        consultantId: null,
        content,
        conversationId: 'demo',
        costCents: 0,
        createdAt: new Date().toISOString(),
        id: `demo-user-${String(Date.now())}`,
        inputTokens: null,
        modelId: null,
        outputTokens: null,
        role: 'user',
        sequence: messages.length + 1,
        sources: null,
      };

      // Pick next canned reply in rotation
      const reply: string = cannedReplies[cannedReplyIndex.current % cannedReplies.length]!;
      cannedReplyIndex.current += 1;

      const assistantMsg: Message = {
        consultantId: randomConsultant.id,
        content: reply,
        conversationId: 'demo',
        costCents: 0,
        createdAt: new Date().toISOString(),
        id: `demo-asst-${String(Date.now())}`,
        inputTokens: null,
        modelId: null,
        outputTokens: null,
        role: 'assistant',
        sequence: messages.length + 2,
        sources: null,
      };

      setMessages((prev) => [...prev, userMsg]);
      // Add a small delay for realism
      setTimeout(() => {
        setMessages((prev) => [...prev, assistantMsg]);
      }, 500);
    },
    [selectedConsultant, consultants, messages.length],
  );
```

- [ ] **Step 3: Wire the fake handler into ChatInput**

Replace the `onSend` prop in the `<ChatInput>` component (line 288):

```tsx
          onSend={handleSend}
```

with:

```tsx
          onSend={isAuthenticated ? handleSend : handleFakeSend}
```

- [ ] **Step 4: Hide the conversation sidebar for unauthenticated users**

In the JSX, wrap the `<ConversationSidebar>` (lines 226-233) with an auth check:

```tsx
      {isAuthenticated && (
        <ConversationSidebar
          activeId={activeConvId}
          conversations={conversations}
          onDelete={handleDelete}
          onNew={handleNew}
          onRename={handleRename}
          onSelect={handleSelect}
        />
      )}
```

- [ ] **Step 5: Skip conversation/message fetching for unauthenticated users**

In the mount `useEffect` (lines 45-59), guard the `fetchConversations()` call:

```tsx
  useEffect(() => {
    void (async () => {
      try {
        const [c, convs] = await Promise.all([
          fetchConsultants(),
          isAuthenticated ? fetchConversations() : Promise.resolve([]),
        ]);
        setConsultants(c);
        setConversations(convs);
        if (c.length > 0) {
          setSelectedConsultant(c[0]!);
        }
      } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : 'Failed to load';
        toast(msg, 'error');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 6: Hide the cost badge for unauthenticated users**

Wrap the cost badge header (lines 253-255) with an auth check:

```tsx
            {isAuthenticated && (
              <div className="flex items-center justify-end border-b border-border-theme/50 px-4 py-1">
                <ChatCostBadge costCents={displayCostCents} />
              </div>
            )}
```

- [ ] **Step 7: Verify the frontend compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/chat/ChatPage.tsx
git commit -m "feat(chat): fake replies for unauthenticated users, hide sidebar and cost"
```

---

### Task 8: Gate Alerts Page for Unauthenticated Users

**Files:**
- Modify: `packages/web/src/alerts/AlertsPage.tsx`

- [ ] **Step 1: Add auth import**

At the top of `packages/web/src/alerts/AlertsPage.tsx`, add (after existing imports):

```tsx
import { useAuth } from '../user/AuthContext.tsx';
```

- [ ] **Step 2: Add early return for unauthenticated users**

Inside the `AlertsPage` component, add this at the very beginning (after `const [loading, setLoading] = ...` on line 37):

```tsx
  const { isAuthenticated } = useAuth();

  // Show subscribe prompt for unauthenticated users
  if (!isAuthenticated) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-on-surface">Alerts</h1>
        <div className="rounded-theme border border-border-theme bg-surface-card p-8 text-center">
          <p className="text-on-surface-muted">
            <Link className="text-accent-theme underline hover:no-underline" to="/about">
              Subscribe Now
            </Link>{' '}
            to Enable Personalized Email Alerts
          </p>
        </div>
      </div>
    );
  }
```

Note: The `Link` import already exists at line 2.

- [ ] **Step 3: Verify the frontend compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/alerts/AlertsPage.tsx
git commit -m "feat(alerts): show subscribe prompt for unauthenticated users"
```

---

### Task 9: Create the `/about` Page

**Files:**
- Create: `packages/web/src/about/AboutPage.tsx`

- [ ] **Step 1: Create the about directory and component**

Create `packages/web/src/about/AboutPage.tsx`:

```tsx
import {
  Bot,
  Database,
  Mail,
  Newspaper,
  Search,
  MessageSquare,
  Bell,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router';

const features = [
  {
    icon: Search,
    title: 'Full-Text & Vector Search',
    desc: 'BM25 keyword and semantic vector search across every FCC IBFS filing ever submitted.',
  },
  {
    icon: Bot,
    title: 'AI-Powered Summaries',
    desc: 'LLM-generated summaries of every document and filing timeline, powered by multi-model inference.',
  },
  {
    icon: MessageSquare,
    title: 'RAG Chat Consultants',
    desc: 'Ask questions and get answers grounded in the actual filing data, with cited sources.',
  },
  {
    icon: Newspaper,
    title: 'Automated Daily Newspaper',
    desc: 'AI-written articles, editorials, and news summaries generated fresh each day.',
  },
  {
    icon: Bell,
    title: 'Real-Time Alerts',
    desc: 'Save searches, enable alerts, and receive email notifications when new filings match.',
  },
  {
    icon: Database,
    title: 'Complete FCC IBFS Archive',
    desc: 'Every international and satellite filing, comment, and attachment — fully indexed and searchable.',
  },
];

const techStack = [
  'Full-stack TypeScript monorepo',
  'DuckDB — analytics, full-text search, and vector search in a single engine',
  'AWS Bedrock — multi-model inference for summarization, embeddings, and RAG',
  'Server-Sent Events for real-time streaming chat',
  'Automated nightly data pipeline with incremental ingestion',
  'React + Hono + Radix UI',
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Hero */}
      <section className="text-center">
        <h1
          className="text-4xl font-bold"
          style={{ color: 'var(--do-text-heading)', fontFamily: 'var(--do-font-heading)' }}
        >
          The Daily Orbit
        </h1>
        <p className="mt-2 text-lg text-on-surface-muted">
          AI-Powered Satellite Communications Industry Intelligence
        </p>
      </section>

      {/* Features */}
      <section>
        <h2
          className="mb-4 text-xl font-semibold"
          style={{ color: 'var(--do-text-heading)', fontFamily: 'var(--do-font-heading)' }}
        >
          What It Does
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div
              className="rounded-theme border border-border-theme bg-surface-card p-4"
              key={f.title}
            >
              <div className="mb-2 flex items-center gap-2">
                <f.icon className="h-5 w-5 text-accent-theme" />
                <h3 className="font-medium text-on-surface">{f.title}</h3>
              </div>
              <p className="text-sm text-on-surface-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it's built */}
      <section>
        <h2
          className="mb-4 text-xl font-semibold"
          style={{ color: 'var(--do-text-heading)', fontFamily: 'var(--do-font-heading)' }}
        >
          How It's Built
        </h2>
        <div className="rounded-theme border border-border-theme bg-surface-card p-4">
          <p className="mb-3 text-sm text-on-surface-muted">
            Built from scratch in under four weeks through rapid, AI-accelerated full-stack
            development. Every layer — data ingestion, search indexing, LLM integration, and
            frontend — was designed and implemented as a cohesive system.
          </p>
          <ul className="space-y-1.5">
            {techStack.map((item) => (
              <li className="flex items-start gap-2 text-sm text-on-surface" key={item}>
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-theme" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="rounded-theme border border-border-theme bg-surface-card p-6 text-center">
        <p className="text-on-surface">
          This product has lots of great features, but if you'd like to hire me to make it even
          more powerful, contact me at{' '}
          <a
            className="text-accent-theme underline hover:no-underline"
            href="mailto:benton@bentonroberts.com"
          >
            benton@bentonroberts.com
          </a>
        </p>
        <div className="mt-4 flex items-center justify-center gap-4">
          <a
            className="inline-flex items-center gap-1.5 rounded-theme border border-border-theme px-4 py-2 text-sm text-on-surface hover:bg-on-surface/5"
            href="https://bentonroberts.com/"
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Full Resume
          </a>
          <a
            className="inline-flex items-center gap-1.5 rounded-theme border border-border-theme px-4 py-2 text-sm text-on-surface hover:bg-on-surface/5"
            href="mailto:benton@bentonroberts.com"
          >
            <Mail className="h-3.5 w-3.5" />
            Get in Touch
          </a>
        </div>
      </section>

      {/* Sign in */}
      <section className="text-center">
        <p className="text-sm text-on-surface-muted">
          Already have an account?{' '}
          <Link className="text-accent-theme underline hover:no-underline" to="/login">
            Sign In
          </Link>
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify the frontend compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/about/AboutPage.tsx
git commit -m "feat(about): add product marketing and hire-me page"
```

---

### Task 10: Final Smoke Test

- [ ] **Step 1: Start the dev server**

Run: `make dev` (or whatever the project uses to start both server and client)

- [ ] **Step 2: Test unauthenticated experience**

Open the app in an incognito/private browser window and verify:

1. **Home page** loads and shows the latest newspaper edition
2. **Dashboard** loads and shows data
3. **Search** works — results appear; Save Search button shows subscribe dialog; Flag/Hide icons show subscribe dialog; Show Hidden checkbox is disabled
4. **News** page loads and articles are browsable
5. **Chat** page loads — consultant selector works; submitting a message shows a canned reply from a random consultant; no API calls to `/api/conversations/*`
6. **Alerts** page shows the "Subscribe Now" message linking to `/about`
7. **About** page displays feature highlights, tech stack, CTA, and sign-in link
8. **Nav bar** shows "Login" button in the user menu area
9. Filing detail pages load when clicking search results
10. `/profile` and `/settings` redirect to login

- [ ] **Step 3: Test authenticated experience still works**

Log in and verify:
1. Search Save/Saved/Flag/Hide all work normally
2. Chat sends real messages to the RAG system
3. Alerts show actual flagged items
4. Profile and settings are accessible

- [ ] **Step 4: Test backend security**

```bash
# These should return 401:
curl -s http://localhost:3000/api/user/saved-searches | head -1
curl -s http://localhost:3000/api/conversations | head -1
curl -s -X POST http://localhost:3000/api/conversations -H 'Content-Type: application/json' -d '{"consultantId":1}' | head -1

# These should return data:
curl -s http://localhost:3000/api/consultants | head -c 100
curl -s 'http://localhost:3000/api/search?q=spacex' | head -c 100
```

- [ ] **Step 5: Commit any fixes discovered during testing**

If any issues are found, fix and commit individually with descriptive messages.
