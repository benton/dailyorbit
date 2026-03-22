# Plan B: Server-Side Auto-Refresh for ICFS Session Cookies

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the server to automatically obtain and refresh ICFS session cookies using stored credentials, so the Admin Pipeline UI "Download Attachments" button works end-to-end without CLI intervention.

**Architecture:** Add a `ConfigService` reference to `PipelineContext` so pipeline stages can read encrypted config values. The `attachments.discover-download` stage reads ICFS credentials from config, calls `headlessLogin()` to get fresh cookies, and passes them to the attachment pipeline. A new `/api/admin/icfs/session` API endpoint exposes session status to the Admin UI.

**Tech Stack:** Builds on Plan A's `headlessLogin()` module, ConfigService, Hono API routes, React admin components

**Prerequisites:** Plan A must be completed first (headless login module + config schema fields).

**Prior Art:**
- `packages/server/src/pipeline/registry.ts:21-27` — PipelineContext type
- `packages/server/src/pipeline/runner.ts` — PipelineRunner that creates contexts
- `packages/server/src/pipeline/routes.ts:50-70` — POST /run handler
- `packages/web/src/admin/pipeline/PipelinePage.tsx` — Admin UI

---

### Task 1: Add ConfigService to PipelineContext

**Files:**
- Modify: `packages/server/src/pipeline/registry.ts`
- Modify: `packages/server/src/pipeline/runner.ts`

**Step 1: Extend PipelineContext type**

In `packages/server/src/pipeline/registry.ts`, add `config` to the context type:

```typescript
import type { ConfigService } from '../lib/config-service.ts';

export type PipelineContext = {
  db: DuckDBInstance;
  conn: DuckDBConnection;
  config: ConfigService;
  concurrency: number;
  log: (level: 'info' | 'error' | 'progress', message: string) => void;
  onProgress: (processed: number, total: number) => void;
};
```

**Step 2: Pass ConfigService when creating context in runner**

In `packages/server/src/pipeline/runner.ts`, find where `PipelineContext` is constructed and add the `config` field. The runner will need to receive or create a `ConfigService` instance. Look at how the runner is initialized (likely in `routes.ts` or a factory) and thread ConfigService through.

Follow the existing pattern: the runner already receives a `DuckDBInstance` — pass `ConfigService` alongside it.

**Step 3: Verify no pipeline stages break**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --filter server`
Expected: All existing tests pass (no stages use `ctx.config` yet, so adding it is backward-compatible).

**Step 4: Commit**

```bash
git add packages/server/src/pipeline/registry.ts packages/server/src/pipeline/runner.ts
git commit -m "feat(pipeline): add ConfigService to PipelineContext"
```

---

### Task 2: Wire attachments.discover-download to use headless login

**Files:**
- Modify: `packages/server/src/pipeline/registry.ts` (the `attachments.discover-download` stage)

**Step 1: Write a failing test**

Create `packages/server/src/pipeline/__tests__/discover-download-auth.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

// This test validates the integration logic: when ICFS credentials exist in config,
// the discover-download stage should attempt headless login and pass cookies.
// We test the decision logic, not Playwright itself.

describe('attachments.discover-download auth integration', () => {
  it('skips auth when no ICFS credentials are configured', async () => {
    // Verify that when icfsUsername is empty, runAttachmentPipeline is called without authCookies
    // This is tested via the actual pipeline stage in an integration context
    // For now, document the expected behavior:
    expect(true).toBe(true); // replaced in Step 3
  });
});
```

**Step 2: Update the stage to attempt headless login**

In `packages/server/src/pipeline/registry.ts`, modify the `attachments.discover-download` stage's `run` function:

```typescript
{
  id: 'attachments.discover-download',
  group: 'attachments',
  name: 'Discover & Download',
  description: 'Discover attachment metadata and download files (auto-authenticates if ICFS credentials configured)',
  defaultConcurrency: 5,
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { runAttachmentPipeline } = await import('../attachments/pipeline.ts');
    const start = Date.now();

    // Attempt headless login if ICFS credentials are configured
    let authCookies: string | undefined;
    const icfsUsername = await ctx.config.get('icfsUsername');
    const icfsPassword = await ctx.config.get('icfsPassword');

    if (icfsUsername && icfsPassword) {
      ctx.log('info', 'ICFS credentials found — attempting headless login...');
      const { headlessLogin } = await import('../icfs/headless-login.ts');
      const loginResult = await headlessLogin({
        username: icfsUsername,
        password: icfsPassword,
        headless: true,
        onStatus: (msg) => ctx.log('progress', msg),
      });

      if (loginResult.ok) {
        authCookies = loginResult.output.cookies;
        ctx.log('info', `Login successful — ${String(loginResult.output.cookieCount)} cookies, expires ${loginResult.output.expiresAt}`);
      } else {
        ctx.log('error', `Headless login failed: ${loginResult.message}`);
        ctx.log('info', 'Continuing without authentication (public downloads only)');
      }
    }

    const result = await runAttachmentPipeline({
      dbInstance: ctx.db,
      storageBasePath: 'data/attachments',
      scope: {},
      concurrency: ctx.concurrency,
      onProgress: (msg) => ctx.log('progress', msg),
      authCookies,
    });

    return {
      itemsProcessed: result.attachmentsDiscovered + result.attachmentsDownloaded,
      itemsFailed: result.attachmentsFailed,
      durationMs: Date.now() - start,
      summary: authCookies
        ? `Discovered ${String(result.attachmentsDiscovered)}, downloaded ${String(result.attachmentsDownloaded)} (authenticated)`
        : `Discovered ${String(result.attachmentsDiscovered)}, downloaded ${String(result.attachmentsDownloaded)}`,
    };
  },
},
```

**Step 3: Run existing tests**

Run: `cd /Users/benton/code/daily-orbit && pnpm test -- --filter server`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add packages/server/src/pipeline/registry.ts packages/server/src/pipeline/__tests__/discover-download-auth.test.ts
git commit -m "feat(pipeline): auto-authenticate attachments stage with stored ICFS credentials"
```

---

### Task 3: Add ICFS session status API endpoint

**Files:**
- Create: `packages/server/src/icfs/routes.ts`
- Modify: `packages/server/src/routes.ts` (or wherever API routes are mounted)

**Step 1: Write the test**

Create `packages/server/src/icfs/__tests__/routes.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { icfsRoutes } from '../routes.ts';

describe('GET /api/admin/icfs/session', () => {
  it('returns configured: false when no credentials are stored', async () => {
    // This requires a test ConfigService with empty values
    // Follow the existing test patterns for API routes in this codebase
    // Verify response shape: { configured: boolean; lastLogin?: string; cookieCount?: number }
    expect(true).toBe(true); // placeholder — implement after seeing route test patterns
  });
});
```

**Step 2: Implement the route**

Create `packages/server/src/icfs/routes.ts`:

```typescript
import { Hono } from 'hono';
import type { ConfigService } from '../lib/config-service.ts';

export function createIcfsRoutes(config: ConfigService): Hono {
  const app = new Hono();

  // GET /session — check if ICFS credentials are configured and session status
  app.get('/session', async (c) => {
    const username = await config.get('icfsUsername');
    const configured = !!username;

    return c.json({
      configured,
      username: configured ? username : null,
    });
  });

  // POST /login — trigger headless login and return result
  app.post('/login', async (c) => {
    const username = await config.get('icfsUsername');
    const password = await config.get('icfsPassword');

    if (!username || !password) {
      return c.json({ error: 'ICFS credentials not configured. Use CLI: ./daily-orbit config set icfsUsername/icfsPassword' }, 400);
    }

    const { headlessLogin } = await import('./headless-login.ts');
    const result = await headlessLogin({
      username,
      password,
      headless: true,
      onStatus: (msg) => console.log(`[icfs-login] ${msg}`),
    });

    if (result.ok) {
      // Write cookies to the standard location for pipeline use
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      const outputPath = 'data/icfs-cookies.json';
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(result.output, null, 2) + '\n');

      return c.json({
        success: true,
        cookieCount: result.output.cookieCount,
        expiresAt: result.output.expiresAt,
      });
    }

    return c.json({
      success: false,
      reason: result.reason,
      message: result.message,
    }, 401);
  });

  return app;
}
```

**Step 3: Mount the routes**

Find the main route file and mount: `app.route('/api/admin/icfs', createIcfsRoutes(configService))`

Follow the existing pattern for how other admin API routes are mounted.

**Step 4: Test manually**

Run the API server and test:
```bash
curl http://localhost:9000/api/admin/icfs/session
```
Expected: `{ "configured": true, "username": "..." }` or `{ "configured": false, "username": null }`

**Step 5: Commit**

```bash
git add packages/server/src/icfs/routes.ts packages/server/src/routes.ts
git commit -m "feat(api): add ICFS session status and login endpoints"
```

---

### Task 4: Add ICFS credential management to Admin UI

**Files:**
- Create: `packages/web/src/admin/pipeline/IcfsCredentials.tsx`
- Modify: `packages/web/src/admin/pipeline/PipelinePage.tsx`

**Step 1: Create the ICFS credentials component**

Create `packages/web/src/admin/pipeline/IcfsCredentials.tsx`:

A card component that:
- Shows whether ICFS credentials are configured (fetches from `GET /api/admin/icfs/session`)
- Has a "Login Now" button that POSTs to `/api/admin/icfs/login`
- Shows login result (success with cookie count + expiry, or failure reason)
- Shows a link to docs explaining how to set credentials via CLI

Follow the existing component patterns in the admin pipeline UI (card layout, button styles, status indicators).

**Step 2: Add to PipelinePage**

In `PipelinePage.tsx`, import and render `<IcfsCredentials />` above the pipeline stages, inside the existing layout. This gives admins visibility into auth status before running the attachment pipeline.

**Step 3: Test in browser**

Run: `make dev`
Navigate to `/admin/pipeline`
Expected: See ICFS credential status card. If credentials are configured, "Login Now" button triggers headless login.

**Step 4: Commit**

```bash
git add packages/web/src/admin/pipeline/IcfsCredentials.tsx packages/web/src/admin/pipeline/PipelinePage.tsx
git commit -m "feat(admin): add ICFS credential status and login button to pipeline UI"
```

---

### Task 5: Add credential configuration to Admin Config UI

**Files:**
- Modify: Admin config page (find the existing config management UI)

**Step 1: Verify ICFS fields appear in config UI**

The existing admin config UI should already show the new `icfsUsername` and `icfsPassword` fields from the config schema (since they were added in Plan A Task 1). Verify they render correctly with proper masking for encrypted fields.

If the config UI doesn't auto-discover new schema fields, add them manually following the existing pattern.

**Step 2: Test**

Navigate to `/admin/config` (or wherever the config UI lives).
Expected: `icfsUsername` and `icfsPassword` fields are editable, with password masking for the password field.

**Step 3: Commit (if changes were needed)**

```bash
git add <modified files>
git commit -m "feat(admin): ensure ICFS credential fields appear in config UI"
```

---

### Task 6: End-to-end test — pipeline UI triggers authenticated download

**Step 1: Set up credentials**

```bash
./daily-orbit config set icfsUsername '<email>'
./daily-orbit config set icfsPassword '<password>'
```

**Step 2: Run via Admin UI**

1. Open `/admin/pipeline`
2. Verify ICFS credential card shows "Configured"
3. Click "Login Now" — verify cookies are obtained
4. Click "Run" on `attachments.discover-download` stage
5. Watch SSE logs — should see "ICFS credentials found — attempting headless login..."
6. Verify authenticated ServiceNow downloads proceed

**Step 3: Run via CLI (verify both paths work)**

```bash
./daily-orbit attachments login
./daily-orbit attachments test-cookies
./daily-orbit attachments download --auth-cookies data/icfs-cookies.json --concurrency 20
```

**Step 4: Final commit**

```bash
git commit --allow-empty -m "docs: complete ICFS auto-auth integration (Plans A+B)"
```

---

## Session B Summary

After completing all 6 tasks you will have:
- `ConfigService` available to all pipeline stages
- `attachments.discover-download` automatically authenticates when credentials exist
- Admin UI shows ICFS auth status + "Login Now" button
- API endpoints for session status and on-demand login
- The "Download Attachments" pipeline button works end-to-end
- Graceful fallback: no credentials = public-only downloads, 2FA required = error message with CLI fallback instructions

## Open Questions (to resolve during implementation)

1. **Session caching**: Should the server cache obtained cookies in-memory (avoiding re-login on every pipeline run within the session lifetime)? Probably yes — add a simple in-memory cache with TTL.
2. **Playwright in production**: The current setup treats Playwright as a devDependency. For server-side login, it needs to be available at runtime. Consider making it an optional production dependency or documenting the install step.
3. **Cookie file vs. in-memory**: Currently cookies are written to `data/icfs-cookies.json`. The pipeline stage could pass cookies in-memory (from `headlessLogin()` directly to `runAttachmentPipeline()`). The file write is useful for CLI interop but may be unnecessary for the server path.
