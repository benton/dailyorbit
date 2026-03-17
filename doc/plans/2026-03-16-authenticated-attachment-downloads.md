# Authenticated ICFS Attachment Downloads

**Date:** 2026-03-16
**Status:** Implemented
**Depends on:** [servicenow-attachment-gap.md](2026-03-15-servicenow-attachment-gap.md)

---

## Executive Summary

43,752 attachment records have download URLs at `fccprod.servicenowservices.com`
that require FCC Okta SSO authentication. On 2026-03-16, we verified that:

1. A free ICFS account can be created at `fcc.gov/icfs`
2. After login (email + 2FA code), the browser receives session cookies
3. Those cookies can be extracted and used in raw HTTP requests (curl/fetch)
4. **Authenticated `curl` successfully downloads PDFs** that are otherwise blocked

This plan describes a semi-automated workflow for gradually clearing the 43k
attachment backlog using user-supplied session tokens.

---

## Why This Is So Complicated

### The authentication stack

ICFS runs on ServiceNow, hosted at `fccprod.servicenowservices.com`. Attachment
downloads hit the `sys_attachment.do` endpoint, which is behind the FCC's
enterprise SSO:

```
Browser → fccprod.servicenowservices.com/sys_attachment.do?sys_id=...
       → 302 redirect to fcc-ext.okta.com (Okta SSO)
       → Okta login (email + password)
       → Email-based 2FA (code sent to email)
       → 302 redirect back to ServiceNow with auth tokens
       → ServiceNow sets session cookies
       → Attachment downloads work
```

There is **no API key**, **no OAuth client credentials flow**, and **no
service account option**. The only authentication path is interactive browser
login with email-based 2FA. This means:

- No fully automated headless flow (2FA requires human interaction)
- Session cookies expire (see below), so downloads must happen in time-bounded
  chunks
- Each download session requires a human to log in and supply the token

### Session lifetime constraints

The ServiceNow session uses 8 cookies. The tightest constraint is
`glide_session_store`, which expires **~30 minutes** after issuance. It's
unknown whether the session refreshes on activity (it may — ServiceNow
typically does keep-alive on API calls). The other key cookies:

| Cookie | Expires | Role |
|--------|---------|------|
| `JSESSIONID` | session (browser close) | Main session token |
| `glide_user_route` | ~13 months | Server affinity routing |
| `glide_sso_id` | ~13 months | SSO identity |
| `glide_session_store` | **~30 minutes** | Session state (tightest constraint) |
| `BIGipServerpool_fccprod` | session | F5 load balancer affinity |
| `glide_user_activity` | session | Activity tracker |
| `glide_node_id_for_js` | session | Client-side node |
| `__CJ_g_startTime` | ~1 hour | Session timer |

### What unauthenticated requests see

Without cookies, `sys_attachment.do` returns HTTP 302 (redirect to login).
The current pipeline's `fetchWithRetry()` follows the redirect and saves the
HTML login page as the "attachment" — a few bytes of garbage marked as failed.

---

## Verified: End-to-End Proof of Concept

### Test performed on 2026-03-16

1. Created ICFS account at `fcc.gov/icfs` (free registration)
2. Logged in via browser (email + 2FA)
3. Navigated to filing `SAT-LOA-20200526-00055` (SpaceX Gen2 application)
4. Used Playwright to extract all 8 ServiceNow cookies from browser context
5. Issued authenticated curl:

```bash
curl -o test.pdf \
  -H "Cookie: JSESSIONID=...; glide_user_route=...; glide_sso_id=...; ..." \
  "https://fccprod.servicenowservices.com/sys_attachment.do?sys_id=dd8d02da1b5eb650379cec2de54bcbeb"
```

**Result:** HTTP 200, 3,398,207 bytes, valid 34-page PDF
(SpaceX Authorization and Order DA 26-36, January 9, 2026)

6. Verified unauthenticated curl returns HTTP 302 (redirect to login)

---

## Proposed Architecture

### Overview

The workflow is **semi-automated**: a human logs in once, a Playwright helper
extracts session cookies, and the existing download pipeline runs with those
cookies until the session expires. Repeat as needed to clear the backlog.

```
┌─────────────────────────────────────────────────────────┐
│  Human: logs into ICFS via browser, completes 2FA       │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Playwright script: extracts session cookies, writes    │
│  them to a temp file or passes to CLI                   │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  CLI: `./daily-orbit attachments download`              │
│    --auth-cookies <path-or-string>                      │
│    --retry-failed                                       │
│    --url-filter servicenow                              │
│                                                         │
│  Pipeline calls downloadFile() with Cookie header       │
│  Monitors for 302/401 → stops gracefully on session     │
│  expiry rather than poisoning the download queue         │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Progress: updates download_status in DB                │
│  On session expiry: logs count, exits cleanly           │
│  Next run: picks up where it left off (pending/failed)  │
└─────────────────────────────────────────────────────────┘
```

### Download rate estimate

At 500ms delay between requests (current pipeline default), one 30-minute
session can download ~3,600 attachments. If the session refreshes on activity,
a single login could clear much more. At 43,752 total:

| Scenario | Sessions needed | Calendar time |
|----------|-----------------|---------------|
| 30-min fixed sessions | ~13 | ~1 week (2/day) |
| Session refreshes on activity | ~2-3 | 1-2 days |
| Parallel downloads (concurrency=5) | ~3-4 fixed | 2 days |

---

## Implementation Plan

### Step 1: Cookie extraction script

**File:** `scripts/extract-icfs-cookies.ts`

A standalone Playwright script that:

1. Opens `https://fccprod.servicenowservices.com/icfs` in a visible browser
2. Waits for the user to log in (polls for the `JSESSIONID` cookie)
3. Extracts all ServiceNow cookies
4. Writes them to stdout (or a file) as a JSON object:

```json
{
  "cookies": "JSESSIONID=...; glide_user_route=...; ...",
  "extracted_at": "2026-03-16T20:15:00Z",
  "expires_at": "2026-03-16T20:45:00Z"
}
```

This script is **not** part of the CLI — it's a standalone helper that the
operator runs manually before starting the download.

### Step 2: CLI changes — `attachments download`

**File:** `packages/server/src/cli/attachments/download.ts`

Add new CLI argument:

```
--auth-cookies <path>    Path to JSON file with session cookies (for ServiceNow downloads)
```

When provided, the pipeline:

- Filters to only `download_url LIKE '%servicenowservices.com%'` attachments
- Passes the cookie string to `downloadFile()` as an Authorization header
- Detects session expiry (HTTP 302 or HTML login page) and stops gracefully
- Reports progress: downloaded / failed / remaining / session-expired

### Step 3: Modify `downloadFile()` in storage.ts

**File:** `packages/server/src/attachments/storage.ts`

Add an optional `cookies` parameter:

```typescript
export async function downloadFile(
  url: string,
  destPath: string,
  options?: { cookies?: string },
): Promise<{ fileSizeBytes: number; contentType: string | null }>
```

When `options.cookies` is provided:

- Pass `Cookie` header in the fetch request
- **Do not** follow redirects (`redirect: 'manual'`) — a 302 means session expired
- On 302: throw a typed `SessionExpiredError` so the pipeline can stop gracefully
- Skip the `normalizeDownloadUrl()` `.pdf` suffix logic for ServiceNow URLs

### Step 4: Pipeline session-expiry handling

**File:** `packages/server/src/attachments/pipeline.ts`

When a `SessionExpiredError` is caught:

- Log the count of successful downloads in this session
- Log the count of remaining pending ServiceNow attachments
- Exit with code 0 (not an error — expected behavior)
- Do **not** mark the current attachment as `failed` (leave it `pending`)

### Step 5: Makefile target

```makefile
attachments-download-auth: ## Download ServiceNow attachments with auth cookies
	$(CLI) attachments download --auth-cookies data/icfs-cookies.json --retry-failed $(ARGS)
```

### Step 6: `fetchWithRetry` changes

**File:** `packages/server/src/attachments/fetch-retry.ts`

Add optional `headers` parameter that gets passed through to `fetch()`.
For authenticated requests, disable redirect following.

---

## Operational Procedure

### For the operator (documented in doc/ingestion-pipeline.md)

#### One-time setup

1. Create an ICFS account at https://www.fcc.gov/icfs (click "Log in")
2. Install Playwright: `npx playwright install chromium`

#### Each download session

```bash
# 1. Extract cookies (opens browser, you log in manually)
./scripts/extract-icfs-cookies.ts > data/icfs-cookies.json

# 2. Run authenticated downloads (stops on session expiry)
make attachments-download-auth

# 3. Run text extraction on newly downloaded files
make attachments-extract
```

#### Monitoring progress

```sql
-- Check ServiceNow attachment backlog
SELECT download_status, count(*)
FROM attachment
WHERE download_url LIKE '%servicenowservices.com%'
GROUP BY download_status;
```

---

## Files to Create / Modify

| Action | File | Description |
|--------|------|-------------|
| Create | `scripts/extract-icfs-cookies.ts` | Playwright cookie extraction helper |
| Modify | `packages/server/src/attachments/storage.ts` | Add cookies param to `downloadFile()` |
| Modify | `packages/server/src/attachments/fetch-retry.ts` | Add headers param to `fetchWithRetry()` |
| Modify | `packages/server/src/attachments/pipeline.ts` | Session-expiry handling, URL filtering |
| Modify | `packages/server/src/cli/attachments/download.ts` | `--auth-cookies` CLI arg |
| Modify | `Makefile` | `attachments-download-auth` target |
| Modify | `doc/ingestion-pipeline.md` | Operational procedure for auth downloads |
| Update | `doc/plans/2026-03-15-servicenow-attachment-gap.md` | Mark Strategy 4 as verified/in-progress |

---

## Open Questions

1. **Does the session refresh on activity?** If ServiceNow extends
   `glide_session_store` on each API call, the 30-minute window is a
   non-issue and a single login could clear the entire backlog. We should
   test this during the first real download run.

2. **Rate limiting?** ServiceNow may rate-limit or block rapid sequential
   downloads from a single session. Start conservative (500ms delay,
   concurrency=1) and increase if no issues.

3. **Minimum cookie set?** We're passing all 8 cookies. It's likely that
   only `JSESSIONID` + `glide_user_route` + `BIGipServerpool_fccprod` are
   required. Can optimize later but no reason to risk it now.

4. **Account risk?** Bulk downloading 43k files through a personal ICFS
   account could trigger abuse detection. Consider adding a longer delay
   (1-2s) and downloading over multiple days rather than aggressive bursts.

---

## Success Criteria

- [ ] Cookie extraction script works end-to-end
- [ ] `--auth-cookies` flag accepted by download CLI
- [ ] Authenticated downloads succeed for ServiceNow URLs
- [ ] Pipeline stops gracefully on session expiry (no poisoned records)
- [ ] Progress is resumable across sessions
- [ ] All 43,752 ServiceNow attachments downloaded
- [ ] Text extraction run on newly downloaded PDFs
- [ ] `doc/ingestion-pipeline.md` updated with auth download procedure
