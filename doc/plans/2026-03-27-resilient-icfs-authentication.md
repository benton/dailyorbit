# Plan: Resilient ICFS Authentication for Attachment Downloads

**Date:** 2026-03-27
**Status:** Draft
**Priority:** Critical — 60k+ attachments behind authentication depend on this

## Problem Statement

The headless Playwright login to ServiceNow via Okta SSO works in **headed** mode
but fails in **headless** mode. Okta's risk-based authentication detects the headless
browser and escalates to email-based 2FA, which cannot be completed without human
interaction.

### Evidence

| Mode     | Result                                         |
|----------|-------------------------------------------------|
| Headed   | SSO completes, 8 cookies, all downloads succeed |
| Headless | SSO stalls on Okta, 2FA challenge triggered     |

Anti-detection measures (custom user-agent, `navigator.webdriver = false`,
`--disable-blink-features=AutomationControlled`) were insufficient.

### Root Cause

Okta's risk engine fingerprints the browser beyond what Playwright stealth tricks
can mask. Headed mode with a real GPU-backed compositor and window manager passes
the fingerprint check; headless does not.

## Design

A layered strategy with three mechanisms, used in priority order:

```
┌─────────────────────────────────────────┐
│ 1. Headed login via virtual framebuffer │  ← Production (Xvfb)
│    (looks like a real desktop browser)  │
├─────────────────────────────────────────┤
│ 2. Persisted cookie fallback            │  ← If login fails or is skipped
│    (DB-stored, auto-refreshed)          │
├─────────────────────────────────────────┤
│ 3. Manual cookie injection (admin CLI)  │  ← Emergency / initial bootstrap
│    (extract-cookies or direct paste)    │
└─────────────────────────────────────────┘
```

### Key Decisions

1. **Headed mode is the default for production.** The Docker container already
   installs Playwright + Chromium. Adding Xvfb (~5 MB) lets us run "headed" mode
   without a physical display. This sidesteps Okta's headless detection entirely.

2. **Cookie persistence in DB.** Currently cookies are stored only in
   `data/icfs-cookies.json` (a file). We add a `config` entry (`icfsCookies`)
   so cookies survive container restarts and are available to the pipeline without
   filesystem state. The pipeline writes fresh cookies back after each successful
   login.

3. **Graceful fallback.** If login fails (network issue, Okta outage, unexpected
   2FA), the pipeline falls back to the most recently persisted cookies. If those
   are expired, it skips authenticated downloads and logs a warning — it does NOT
   fail the entire pipeline run.

4. **Integration test uses headed mode.** The test is inherently environment-
   dependent (needs credentials, network access, a display or Xvfb). It is skipped
   in CI. Locally, it opens a brief browser window.

## Phases

### Phase 1: Xvfb in Docker + headed login default

**Files to modify:**
- `Dockerfile` — Install `xvfb` package
- `deploy/lib/user-data.sh` — No changes needed (Xvfb is inside the container)
- `packages/server/src/icfs/headless-login.ts` — Change: when running on Linux
  without a display (`!process.env.DISPLAY`), auto-launch Xvfb before Playwright.
  Alternatively, wrap the pipeline entrypoint with `xvfb-run`.
- `packages/server/src/pipeline/registry.ts` — Pass `headless: false` to
  `headlessLogin()` (Xvfb provides the virtual display).

**Implementation approach — choose one:**

- **Option A (simpler): `xvfb-run` wrapper.** The Docker `CMD` or systemd
  `ExecStart` wraps the node process with `xvfb-run --auto-servernum`. All
  Playwright launches automatically get a virtual display. No code changes to
  `headless-login.ts` beyond passing `headless: false`.

- **Option B: programmatic Xvfb.** Use the `xvfb` npm package to start/stop a
  virtual display from within `headlessLogin()`. More self-contained but adds a
  dependency.

**Recommendation:** Option A. Minimal code, proven pattern, no new npm deps.

### Phase 2: Cookie persistence in DB

**Files to modify:**
- `packages/server/src/lib/config-schema.ts` — Add `icfsCookies` config key
  (encrypted, stores the JSON cookie output string).
- `packages/server/src/pipeline/registry.ts` — After successful login, persist
  cookies via `config.set('icfsCookies', JSON.stringify(output))`. On login
  failure, attempt to load persisted cookies and check expiry.
- `packages/server/src/icfs/headless-login.ts` — No changes (cookie persistence
  is the caller's responsibility).

**Schema for `icfsCookies` config value:**
```typescript
{
  encrypted: true,
  defaultValue: '',
  description: 'Persisted ICFS session cookies (auto-refreshed by pipeline)',
}
```

### Phase 3: Pipeline fallback logic

**File:** `packages/server/src/pipeline/registry.ts` (attachment download stage)

**New flow:**
```
1. Try headlessLogin(headless: false)  // Xvfb provides display
   ├─ Success → use fresh cookies, persist to DB
   └─ Failure → log warning
2. If no fresh cookies, load persisted cookies from DB
   ├─ Not expired → use them
   └─ Expired or missing → log error, skip auth downloads
3. Run attachment pipeline with whatever cookies we have (or none)
```

### Phase 4: Integration test

**File:** `packages/server/src/icfs/headless-login.integration.test.ts`

**Changes:**
- Use `headless: false` (headed mode works reliably)
- Skip if no local DB/key file (CI)
- Assert: login OK, 7+ cookies, `JSESSIONID` + `glide_session_store` present
- Assert: download a known attachment, verify PDF content-type and magic bytes
- 90-second timeout (SSO + download)

### Phase 5: Cleanup

- Remove debug scripts from `packages/server/scripts/`:
  - `debug-servicenow-download.ts`
  - `debug-2fa-login.ts`
- Remove stale log files from `logs/`
- Update `doc/ingestion-pipeline.md` if it references the old headless-only flow
- Bump server version

## Testing Strategy

| Test | Type | Runs in CI? |
|------|------|-------------|
| `formatCookieOutput` unit tests | Unit | Yes |
| `headless-login.integration.test.ts` | Integration | No (needs creds + display) |
| `downloadFile` with mock cookies | Unit | Yes (mock fetch) |
| Full pipeline with Xvfb | Manual / staging | No |

## Risks

1. **Okta may start detecting Xvfb-backed headed mode.** Mitigation: cookie
   persistence means we only need login to succeed occasionally, not every time.
2. **Cookie lifetime uncertainty.** We assumed 30 minutes based on
   `SESSION_LIFETIME_MS`, but empirical evidence suggests cookies may last hours.
   Phase 2 should test actual expiry rather than estimated expiry.
3. **Xvfb adds ~5 MB to Docker image.** Negligible.
4. **EC2 instance has limited memory for browser.** Chromium in headed mode uses
   ~150-200 MB. Current instance type should handle this fine for a brief login.

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Xvfb + headed mode | ~30 min |
| Phase 2: Cookie persistence | ~30 min |
| Phase 3: Fallback logic | ~20 min |
| Phase 4: Integration test | ~15 min (already drafted) |
| Phase 5: Cleanup | ~10 min |
| **Total** | **~2 hours** |
