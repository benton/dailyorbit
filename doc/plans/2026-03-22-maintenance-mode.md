# Maintenance Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admins to put the app into a read-only "maintenance mode" that shows a friendly overlay to users during deployments, instead of broken API errors.

**Architecture:** A config-backed flag (`maintenanceMode`) controls a Hono middleware that returns 503 for write/authenticated endpoints while leaving public read-only routes and admin routes untouched. The frontend polls `/api/health` (which now includes the mode), and renders a full-screen overlay when maintenance is active. The CI deploy job optionally enables maintenance mode before triggering the ASG refresh.

**Tech Stack:** Hono middleware, DuckDB config table, React context + overlay component, GitLab CI `curl` calls

---

## Design Decisions

### What gets blocked?

During maintenance the app is **read-only for anonymous users, fully blocked for authenticated actions**:

| Route prefix | Blocked? | Reason |
|---|---|---|
| `GET /api/health` | No | Must stay up for ASG health checks and frontend polling |
| `GET /api/auth/*` | No | Login page needs to load (but session-gated actions will fail) |
| `GET /api/filings`, `/api/news`, etc. (public reads) | No | Read-only content, harmless |
| `POST/PUT/DELETE /api/user/*` | **Yes** | Write operations |
| `POST /api/conversations` | **Yes** | Chat is a write + inference operation |
| `/api/admin/*` | No | Admins need access to toggle maintenance off |
| All other authenticated routes | **Yes** | Anything requiring a session |

**Implementation shortcut:** Block all non-GET requests to non-admin, non-exempt paths. This is simpler than enumerating routes and matches the "most features are readonly" insight.

### Health endpoint contract

```json
{ "status": "ok", "maintenance": false }
{ "status": "maintenance", "maintenance": true, "message": "Deploying v0.9.1 — back in ~10 minutes" }
```

The `message` field comes from the `maintenanceMessage` config key (optional, has a sensible default).

### Frontend behavior

- A `MaintenanceProvider` context wraps the app, polling `/api/health` every 15 seconds
- When `maintenance: true`, a full-screen overlay appears with the message
- The overlay is **dismissible** (user can click "Continue anyway" to browse cached/public content)
- No changes to `apiFetch` — 503 errors surface naturally through existing error handling

### CI/CD integration

The deploy job in `.gitlab-ci.yml` calls the admin API to enable maintenance mode before triggering the ASG refresh. The new instance boots with `maintenanceMode: false` (the default), so maintenance mode auto-clears when the new instance is healthy. No explicit "disable" step needed.

**Caveat:** This requires the old instance to still be running when the deploy job sends the enable request. With `MinHealthyPercentage: 0`, the old instance is terminated ~immediately after refresh starts. So the sequence is: enable maintenance → wait for frontend to pick it up → trigger ASG refresh.

---

## Task 1: Add config keys to schema

**Files:**
- Modify: `packages/server/src/lib/config-schema.ts`
- Test: existing `packages/server/src/lib/config-service.test.ts` (verify seed picks up new keys)

**Step 1: Add `maintenanceMode` and `maintenanceMessage` to CONFIG_SCHEMA**

Add two new entries to the schema object (maintain alphabetical order relative to neighbors):

```typescript
  maintenanceMessage: {
    key: 'maintenanceMessage',
    defaultValue: 'We are updating Daily Orbit. Read-only browsing is still available.',
    encrypted: false,
    description: 'Message shown to users during maintenance mode',
  },
  maintenanceMode: {
    key: 'maintenanceMode',
    defaultValue: 'false',
    encrypted: false,
    description: 'When true, non-admin write requests return 503 and frontend shows maintenance overlay',
  },
```

**Step 2: Run tests to verify nothing breaks**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --reporter=verbose 2>&1 | head -80`
Expected: all config-service tests pass (seedDefaults iterates CONFIG_SCHEMA, new keys get default values)

**Step 3: Commit**

```
feat(config): add maintenanceMode and maintenanceMessage config keys
```

---

## Task 2: Maintenance mode middleware

**Files:**
- Create: `packages/server/src/lib/maintenance-middleware.ts`
- Create: `packages/server/src/lib/maintenance-middleware.test.ts`
- Modify: `packages/server/src/app.ts` (insert middleware)

**Step 1: Write the failing test**

```typescript
// packages/server/src/lib/maintenance-middleware.test.ts
import { Hono } from 'hono';
import { describe, it, expect, beforeEach } from 'vitest';
import { maintenanceMiddleware } from './maintenance-middleware.ts';

function buildApp(getEnabled: () => boolean): Hono {
  const app = new Hono();
  app.use('*', maintenanceMiddleware(getEnabled));
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.get('/api/filings', (c) => c.json({ filings: [] }));
  app.post('/api/user/flags', (c) => c.json({ ok: true }));
  app.get('/api/admin/config', (c) => c.json({ config: [] }));
  app.post('/api/admin/pipeline/scheduler/start', (c) => c.json({ ok: true }));
  return app;
}

describe('maintenanceMiddleware', () => {
  describe('when maintenance mode is OFF', () => {
    const app = buildApp(() => false);

    it('allows GET to public route', async () => {
      const res = await app.request('/api/filings');
      expect(res.status).toBe(200);
    });

    it('allows POST to user route', async () => {
      const res = await app.request('/api/user/flags', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  describe('when maintenance mode is ON', () => {
    const app = buildApp(() => true);

    it('allows GET /api/health', async () => {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
    });

    it('allows GET to public read-only routes', async () => {
      const res = await app.request('/api/filings');
      expect(res.status).toBe(200);
    });

    it('blocks POST to user route with 503', async () => {
      const res = await app.request('/api/user/flags', { method: 'POST' });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toHaveProperty('maintenance', true);
    });

    it('allows all requests to /api/admin/*', async () => {
      const res = await app.request('/api/admin/config');
      expect(res.status).toBe(200);
    });

    it('allows POST to /api/admin/*', async () => {
      const res = await app.request('/api/admin/pipeline/scheduler/start', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('allows GET /api/auth/* paths', async () => {
      // Auth routes need to remain accessible for login
      const authApp = buildApp(() => true);
      authApp.get('/api/auth/session', (c) => c.json({ user: null }));
      const res = await authApp.request('/api/auth/session');
      expect(res.status).toBe(200);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- packages/server/src/lib/maintenance-middleware.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the middleware**

```typescript
// packages/server/src/lib/maintenance-middleware.ts
import type { Context, MiddlewareHandler, Next } from 'hono';

/**
 * Exempt path prefixes — these are never blocked regardless of method.
 * Health must stay up for ASG checks; auth for login; admin for toggling mode off.
 */
const EXEMPT_PREFIXES: string[] = [
  '/api/health',
  '/api/auth/',
  '/api/admin/',
];

const SAFE_METHOD: Set<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function maintenanceMiddleware(
  isEnabled: () => boolean,
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    if (!isEnabled()) {
      return next();
    }

    const path: string = c.req.path;

    // Always allow exempt prefixes
    if (EXEMPT_PREFIXES.some((p: string) => path.startsWith(p))) {
      return next();
    }

    // Allow safe (read-only) methods — most app features are read-only
    if (SAFE_METHOD.has(c.req.method)) {
      return next();
    }

    // Block everything else with 503
    return c.json(
      { error: 'Service is undergoing maintenance', maintenance: true },
      503,
    );
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- packages/server/src/lib/maintenance-middleware.test.ts`
Expected: PASS

**Step 5: Wire the middleware into app.ts**

In `packages/server/src/app.ts`, add the import and insert the middleware after CORS, before the health endpoint:

```typescript
import { maintenanceMiddleware } from './lib/maintenance-middleware.ts';
import { getConfigService } from './lib/config.ts';

// ... after CORS middleware (line 48) ...

app.use(
  '/api/*',
  maintenanceMiddleware(() => getConfigService().get('maintenanceMode') === 'true'),
);

app.get('/api/health', (c) => {
  const maintenance: boolean = getConfigService().get('maintenanceMode') === 'true';
  const message: string = getConfigService().get('maintenanceMessage') as string;
  return c.json({
    status: maintenance ? 'maintenance' : 'ok',
    maintenance,
    ...(maintenance ? { message } : {}),
  });
});
```

Note: `getConfigService` is already imported in app.ts (line 11). Only `maintenanceMiddleware` needs a new import.

**Step 6: Run full test suite**

Run: `cd /Users/benton/code/daily-orbit && pnpm test`
Expected: PASS

**Step 7: Commit**

```
feat(server): add maintenance mode middleware with 503 for write endpoints
```

---

## Task 3: Admin UI toggle

**Files:**
- Create: `packages/web/src/admin/MaintenanceToggle.tsx`
- Modify: whichever admin layout component renders the top-level admin controls (likely the pipeline page or a shared admin header)

**Step 1: Identify where to place the toggle**

Check the admin layout — the toggle should be prominent, likely near the SchedulerPanel on the pipeline page or in a shared admin header/sidebar.

**Step 2: Create the MaintenanceToggle component**

```tsx
// packages/web/src/admin/MaintenanceToggle.tsx
import { Construction } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Button } from '../ui/button.tsx';

export default function MaintenanceToggle() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    void (async () => {
      try {
        const entries = await apiFetch<Array<{ key: string; value: string }>>('/api/admin/config');
        const modeEntry = entries.find((e) => e.key === 'maintenanceMode');
        const msgEntry = entries.find((e) => e.key === 'maintenanceMessage');
        if (modeEntry != null) {
          setEnabled(modeEntry.value === 'true');
        }
        if (msgEntry != null) {
          setMessage(msgEntry.value);
        }
      } catch {
        // best-effort
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = useCallback(async () => {
    const newValue: boolean = !enabled;
    setEnabled(newValue);
    try {
      await apiFetch('/api/admin/config/maintenanceMode', {
        body: JSON.stringify({ value: newValue ? 'true' : 'false' }),
        method: 'PUT',
      });
    } catch {
      setEnabled(!newValue); // revert on failure
    }
  }, [enabled]);

  if (loading) {
    return null;
  }

  return (
    <div className="mb-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Construction className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Maintenance Mode
          </h2>
          {enabled ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              Active
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              Off
            </span>
          )}
        </div>

        <Button
          onClick={() => void handleToggle()}
          size="sm"
          type="button"
          variant={enabled ? 'default' : 'outline'}
        >
          <Construction className="mr-1 h-3.5 w-3.5" />
          {enabled ? 'Disable' : 'Enable'}
        </Button>
      </div>

      {enabled && (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Write endpoints are returning 503. Users see a maintenance overlay.
        </div>
      )}

      <div className="mt-3">
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          Message:
          <input
            className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
            onBlur={(e) => {
              void apiFetch('/api/admin/config/maintenanceMessage', {
                body: JSON.stringify({ value: e.target.value }),
                method: 'PUT',
              });
            }}
            onChange={(e) => setMessage(e.target.value)}
            type="text"
            value={message}
          />
        </label>
      </div>
    </div>
  );
}
```

**Step 3: Add to the pipeline admin page (or admin layout)**

Import and render `<MaintenanceToggle />` above the `<SchedulerPanel />` in the pipeline page.

**Step 4: Verify in browser**

Run: `make dev` and navigate to `/admin/pipeline`
Expected: Maintenance toggle panel visible, toggles config, badge updates

**Step 5: Commit**

```
feat(admin): add maintenance mode toggle to pipeline admin page
```

---

## Task 4: Frontend maintenance overlay

**Files:**
- Create: `packages/web/src/MaintenanceOverlay.tsx`
- Modify: `packages/web/src/App.tsx` (or root layout) to include the overlay

**Step 1: Create the overlay component**

```tsx
// packages/web/src/MaintenanceOverlay.tsx
import { Construction, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const POLL_INTERVAL_MS: number = 15_000;
const HEALTH_URL: string = `${import.meta.env.VITE_SERVER_URL ?? ''}/api/health`;

type HealthResponse = {
  maintenance: boolean;
  message?: string;
  status: string;
};

export default function MaintenanceOverlay() {
  const [maintenance, setMaintenance] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [dismissed, setDismissed] = useState<boolean>(false);

  const checkHealth = useCallback(async () => {
    try {
      const res: Response = await fetch(HEALTH_URL);
      const data: HealthResponse = await res.json() as HealthResponse;
      setMaintenance(data.maintenance === true);
      if (data.message != null) {
        setMessage(data.message);
      }
      // Auto-undismiss when maintenance ends then starts again
      if (!data.maintenance) {
        setDismissed(false);
      }
    } catch {
      // Network error — API might be completely down during ASG refresh
      // Show maintenance overlay for connection failures too
      setMaintenance(true);
      setMessage('The server is temporarily unreachable. It may be restarting.');
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void checkHealth();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [checkHealth]);

  if (!maintenance || dismissed) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 max-w-md rounded-lg bg-white p-8 shadow-xl dark:bg-neutral-900">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Construction className="h-8 w-8 text-amber-500" />
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Updating Daily Orbit
            </h2>
          </div>
          <button
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            onClick={() => setDismissed(true)}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          {message}
        </p>
        <p className="mt-3 text-xs text-neutral-400">
          Read-only browsing is still available.
        </p>
        <button
          className="mt-4 text-xs text-neutral-500 underline hover:text-neutral-700 dark:hover:text-neutral-300"
          onClick={() => setDismissed(true)}
          type="button"
        >
          Continue browsing
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Add to root layout**

In the root App component or layout, render `<MaintenanceOverlay />` at the top level so it appears above all content.

**Step 3: Verify in browser**

1. Enable maintenance mode via admin toggle
2. Open a non-admin browser session
3. Expected: overlay appears with message, dismissible, reappears on next poll if still in maintenance

**Step 4: Commit**

```
feat(web): add maintenance overlay with health endpoint polling
```

---

## Task 5: CI/CD deploy integration

**Files:**
- Modify: `.gitlab-ci.yml` (deploy job)

**Step 1: Add maintenance mode enable/disable to deploy job**

Add these lines to the deploy job script, **before** the ASG refresh trigger:

```yaml
    # Enable maintenance mode on the running instance before refresh
    - |
      echo "Enabling maintenance mode..."
      curl -sf -X PUT "https://api.dailyorbit.org/api/admin/config/maintenanceMode" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $DEPLOY_API_TOKEN" \
        -d '{"value":"true"}' || echo "Warning: could not enable maintenance mode (instance may be down)"
    - |
      curl -sf -X PUT "https://api.dailyorbit.org/api/admin/config/maintenanceMessage" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $DEPLOY_API_TOKEN" \
        -d "{\"value\":\"Deploying $CI_COMMIT_TAG — back in ~10 minutes\"}" || true
    - sleep 5  # Let frontend poll pick up the change
```

**Important:** This requires a `DEPLOY_API_TOKEN` CI variable — a Better Auth API key or session token for an admin user. This is an **optional enhancement** and can be deferred. The manual admin toggle works standalone.

**Step 2: Note that maintenance auto-clears**

The new instance boots with `maintenanceMode: false` (config default). No explicit "disable" step is needed. When the new instance comes up, `/api/health` returns `maintenance: false` and the frontend overlay disappears on the next 15s poll.

**Step 3: Commit**

```
feat(ci): enable maintenance mode before ASG refresh during deploy
```

---

## Task 6: End-to-end verification

**Step 1: Local test**

1. `make dev`
2. Navigate to `/admin/pipeline`
3. Toggle maintenance mode ON
4. Open a non-admin tab — verify overlay appears
5. Verify public GET routes (filings, news) still work
6. Verify POST to `/api/user/flags` returns 503
7. Verify `/api/health` returns `{ status: "maintenance", maintenance: true, message: "..." }`
8. Toggle maintenance mode OFF
9. Verify overlay disappears within 15 seconds
10. Verify POST routes work again

**Step 2: Run full test suite**

Run: `cd /Users/benton/code/daily-orbit && pnpm test`
Expected: all tests pass

**Step 3: Commit any remaining fixes, then tag and deploy**

---

## Summary

| Task | What | Commit message |
|---|---|---|
| 1 | Config keys | `feat(config): add maintenanceMode and maintenanceMessage config keys` |
| 2 | Server middleware + health endpoint | `feat(server): add maintenance mode middleware with 503 for write endpoints` |
| 3 | Admin UI toggle | `feat(admin): add maintenance mode toggle to pipeline admin page` |
| 4 | Frontend overlay | `feat(web): add maintenance overlay with health endpoint polling` |
| 5 | CI/CD integration (optional) | `feat(ci): enable maintenance mode before ASG refresh during deploy` |
| 6 | E2E verification | — |
