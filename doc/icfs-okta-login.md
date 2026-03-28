# ICFS Okta Login: What Works

This document captures everything known about authenticating to the FCC's ICFS
(International Communications Filing System) hosted on ServiceNow at
`fccprod.servicenowservices.com`, which uses Okta SSO via `fcc-ext.okta.com`.

---

## Why Authentication Is Needed

The FCC migrated from IBFS to ICFS on 2025-06-24. Unlike IBFS (where
fcc.report mirrored ~209k attachments publicly), ICFS attachments are served
from `sys_attachment.do` behind FCC's Okta SSO. Approximately 60k attachments
are only reachable with a valid authenticated session.

---

## Account Setup

1. Create a free FCC ICFS account at https://fcc.gov/icfs
2. The account uses **email + password** — no special access tier is required
3. Okta is the IdP; the FCC external tenant is `fcc-ext.okta.com`
4. **2FA is NOT required** — Okta does not trigger MFA for this tenant
   (verified empirically; do not assert 2FA exists without proof)

---

## Authentication Flow

### SSO Entry Point

The public ICFS portal (`/icfs`) loads without auth, so navigating there does
**not** trigger login. Instead, use the ServiceNow SSO endpoint directly:

```
https://fccprod.servicenowservices.com/login_with_sso.do?glide_sso_id=10db4616dbb07200f2f2f6531f9619de
```

This `glide_sso_id` is the FCC external SSO connector ID. It redirects to Okta
immediately, bypassing any intermediate FCC portal pages.

### Okta Login Form

Okta may present either a **single-step** or **two-step** form:

- **Single-step**: Both username and password fields are visible simultaneously.
  Fill both, click submit once.
- **Two-step**: Username field only. Submit, wait for password field to appear,
  fill password, submit again.

The code detects which form is shown by checking if `input[type="password"]` is
already visible before interacting.

Selectors for the username field:
```css
input[name="identifier"], input#okta-signin-username
```

Submit button:
```css
input[type="submit"], button[type="submit"]
```

### Post-Login Redirect

After successful Okta auth, the browser is redirected back to ServiceNow via
SAML. The redirect lands on `navpage.do`, which runs JavaScript that sets
additional session cookies. **You must wait for these cookies** — the initial
redirect does not carry the full session.

### Cached SSO Sessions

If Okta has a cached SSO session, the `login_with_sso.do` URL may redirect
back to ServiceNow immediately without showing the login form. However, this
redirect may land on the unauthenticated nav page (not a real SSO completion).
Detection: check cookie count — fewer than 7 ServiceNow cookies means it's not
a real authenticated session. Clear cookies and retry.

---

## Session Cookies

A fully authenticated session produces **7-8 ServiceNow cookies** on the
domain `fccprod.servicenowservices.com`. Key cookies include:

- `BIGipServerpool_fccprod` — F5 load balancer affinity
- `glide_session_store` — the primary session identifier
- `glide_user_activity` — activity tracking
- `JSESSIONID` — Java servlet session

**All cookies are required.** Passing a subset may fail silently.

### Cookie Lifetime

Session cookies expire after approximately **30 minutes**. It is unknown
whether activity refreshes the timer. The pipeline should treat cookies as
single-use for a batch run.

### Cookie Format

Cookies are stored as a JSON file at `data/icfs-cookies.json`:

```json
{
  "cookies": "BIGipServerpool_fccprod=...; glide_session_store=...; ...",
  "extractedAt": "2026-03-28T02:00:00.000Z",
  "expiresAt": "2026-03-28T02:30:00.000Z",
  "cookieCount": 8
}
```

The `cookies` field is a `Cookie:` header string (semicolon-separated
name=value pairs), ready to pass directly to `fetch()` or `curl`.

---

## How Downloads Work

### Required Headers

Every authenticated download must include these three headers:

```
Cookie: <full cookie string>
User-Agent: Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
Referer: https://fccprod.servicenowservices.com/icfs
```

The User-Agent must look like a real browser. ServiceNow has anti-bot
detection that rejects generic or missing User-Agent strings.

### Redirect Behavior

Use `redirect: 'follow'` (or `curl -L`). ServiceNow may legitimately redirect
authenticated requests. Session expiry is detected from the **response body**,
not from redirect status codes.

### Detecting Session Expiry

An expired or invalid session returns `200 OK` with `Content-Type: text/html`
instead of the expected binary file. **Not all HTML responses mean session
expiry** — some attachments are legitimately HTML (e.g., FCC 312 filing forms
stored as `.htm`).

To distinguish, check for specific auth-failure markers in the first 2000
bytes of the response body:

| Marker | Indicates |
|---|---|
| `nav_to.do` | ServiceNow nav frame (login redirect) |
| `sysparm_url` | ServiceNow login parameter |
| `/login.do` | ServiceNow login page |
| `okta` | Okta login/redirect page |
| `signin-widget` | Okta sign-in widget JS |
| `session_expired` | Explicit session expiry marker |
| `login_redirect` | Explicit login redirect marker |

If none of these markers are present and the response is HTML, it's a
**legitimate HTML attachment** and should be stored normally.

### Download URLs

Attachments are at:
```
https://fccprod.servicenowservices.com/sys_attachment.do?sys_id=<sys_id>
```

The `sys_id` comes from the ICFS filing metadata discovered during the
scraping phase.

---

## CLI Commands

### Manual Login

```bash
./daily-orbit attachments login --headed --output data/icfs-cookies.json
```

Options:
- `--headed` — show the browser (required on EC2 with Xvfb; optional locally)
- `--username <email>` / `--password <pass>` — override stored credentials
- `--save-credentials` — persist username/password to encrypted config
- `--output <path>` — where to write the cookie JSON (default: `data/icfs-cookies.json`)

Credentials fall back to encrypted config values `icfsUsername` and
`icfsPassword` if not provided on the command line.

### Store Credentials

```bash
./daily-orbit config set icfsUsername user@example.com
./daily-orbit config set icfsPassword 'the-password'
```

These are stored encrypted in DuckDB using the key file at
`data/daily-orbit.key`.

### Authenticated Download

```bash
./daily-orbit attachments download --auth-cookies data/icfs-cookies.json --concurrency 1 --verbose
```

The `--auth-cookies` flag loads the cookie JSON and filters the download queue
to only ServiceNow URLs. Concurrency is forced to 1 for authenticated
downloads (3-second delay between requests) to avoid triggering anti-bot
detection.

---

## Pipeline Integration

The nightly pipeline (`ingest` group) handles login automatically:

1. Reads `icfsUsername` and `icfsPassword` from encrypted config
2. Runs `headlessLogin()` in headed mode (Xvfb on EC2)
3. On success, persists cookies to `icfsCookies` config key as fallback
4. On login failure, falls back to persisted cookies if not expired
5. If no usable cookies, skips authenticated downloads (unauthenticated mode)

The pipeline runs a **canary download** before committing to the full queue:
raw `fetch()` against the first URL, then `downloadFile()` against the same
URL. If both succeed, the queue proceeds. If the canary gets HTML but
`downloadFile()` succeeds (legitimate HTML attachment), the queue still
proceeds. Only if `downloadFile()` throws `SessionExpiredError` does the
pipeline abort.

---

## EC2 / Docker Notes

### Xvfb (Virtual Framebuffer)

Playwright's Chromium requires a display server. On headless EC2 instances,
the Docker entrypoint starts **Xvfb** automatically. The `--headed` flag tells
Playwright to launch a visible browser window (rendered into Xvfb).

**Headed mode is required** — headless Chromium triggers Okta's bot detection
and fails to complete login. The `--disable-blink-features=AutomationControlled`
flag is also set to suppress the `navigator.webdriver` property.

### Anti-Bot Measures

The login code applies these countermeasures:

```javascript
// Remove webdriver indicator
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});

// Launch with anti-detection flag
chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });

// Realistic user agent and viewport
context = browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...',
  viewport: { width: 1280, height: 800 },
});
```

### Debug Scripts

- `debugscripts/test_icfs_auth_download.sh` — end-to-end test: login → curl
  → Node.js fetch → verify PDF. Run via `run_in_prod.sh`.
- `debugscripts/test_xvfb_login.sh` — quick login test with screenshot capture
  on failure.
- `debugscripts/debug_ec2_instance.sh` — run the download pipeline with canary
  and capture full output.

### Failure Screenshot

On login failure, a screenshot is saved to `/tmp/icfs-login-failure.png`
inside the container. The `test_xvfb_login.sh` script copies it to the host
for inspection.

---

## Known Issues and Gotchas

1. **HTML attachments are not session expiry** — Some `sys_attachment.do` URLs
   return `text/html` (FCC filing forms). The old code treated all HTML as
   expired sessions, killing the entire 60k download queue on the first HTML
   attachment. Fixed in v1.21.1.

2. **Cookie count validation** — Fewer than 7 cookies means the session is not
   fully initialized. The SSO redirect may appear to succeed but land on an
   unauthenticated page.

3. **30-minute window** — At 3 seconds per download (rate-limited), a single
   session can download ~600 attachments before expiry. The pipeline should
   re-login periodically for large batches (not yet implemented).

4. **Anti-bot detection** — Headless mode fails. Headed mode with Xvfb works.
   The User-Agent must be a real browser string.

5. **ServiceNow concurrency** — Keep to 1 concurrent download with 3-second
   delays. Higher concurrency or faster rates may trigger rate limiting or
   session revocation.
