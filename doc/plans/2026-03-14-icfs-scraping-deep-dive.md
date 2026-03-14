# Plan: ICFS Scraping Deep-Dive

## Context

The FCC replaced IBFS with ICFS (a ServiceNow Government Cloud portal) on 2025-06-24.
Our ingest pipeline's data sources are frozen. The **only** source of new filings is the ICFS portal at `https://fccprod.servicenowservices.com/icfs`. There are ~250K+ filings across all subsystems.

This plan covers a focused reverse-engineering session to fully document the ICFS request-response flow, then build a fast, deterministic scraping client in TypeScript.

---

## What We Already Know (from this session)

### Working: Search API (unauthenticated)

```
POST /api/now/sp/search
Content-Type: application/json

{
  "query": "SAT-LOA-2026",
  "portal": "6865628b1bd2625069c154e2604bcbf2",
  "source": "ibfs-search-applications",
  "include_facets": true,
  "count": 5
}
```

- Works without any auth headers or cookies
- Returns up to **1999 results** per query (server cap, `count` param is ignored)
- Search sources: `ibfs-search-applications`, `ibfs-search-pns`, `ibfs-search-pcs`, `ibfs-search-callsigns`, `ibfs-search-frns`
- Results include: `sys_id`, `label` (file number), `table`, `url`, `fields` (applicant name, subsystem)
- Wildcard `*` returns only 6 results; prefix queries like `SAT-LOA-202601` work for partitioning
- **Limitation**: search results are sparse — only file number, applicant name, subsystem. No dates, no attachments.

### Working: Filing Detail Page (browser session required)

Navigating to `?id=ibfs_application_summary&number=SAT-LOA-20260128-00047` in a browser loads rich data via Angular widgets. Extractable fields from the `IBFS Application Summary` widget scope:

**52 fields** including:
- `number`, `submission_date`, `status_date`, `state` (application status)
- `applicant_name`, `applicant_frn`, `applicant_city`, `applicant_state`
- `contact_name`, `contact_street`, `contact_city`, `contact_state`
- `call_sign`, `brief_application_description`, `nature_of_service`
- `da_number`, `grant_date`, `release_date`, `adopted_date`
- `afpn_date` (accepted for filing PN date), `action_pn_date`, `action_pn_da_number`
- `red_light_status`, `streamlined`, `environmental_impact`
- `begin_date`, `expiration_date`, `legacy_filing_key`

**Attachments** from `IBFS Custom Data Table` widget:
- Table: `x_fmc_ibfs_ibfs_attachment_metadata`
- Fields: `document_name`, `u_description`, `sys_created_on`, `attachment_type`, `sys_id`
- Download URL pattern: `/sys_attachment.do?sys_id={attachment_sys_id}`
- Note: attachment `sys_id` differs from metadata `sys_id`

**Related data** from `IBFS Public Data Table` widgets:
- Public Notices: table `x_fmc_ibfs_public_notices`, fields: `number`, `type_of_document`, `public_notice_release_date`
- Related Filings: table `x_fmc_ibfs_base_table`, linked by `call_sign`
- Pleadings & Comments: table `x_fmc_ibfs_pleadings_and_comments`

### CORRECTED (2026-03-14): SP Page API DOES return filing detail data

Previous testing concluded that the SP Page API returned `data: null` for widget data. **This was incorrect.** Retesting confirmed:

- **SP Page API** (`GET /api/now/sp/page?id=ibfs_application_summary&portal_id={portal_id}&number={file_number}`): **Works without auth.** Returns full widget data including 41 summary fields, filing documents, and pleadings/comments.
- **Critical detail**: The `portal_id` parameter must be included in the request. Previous tests may have omitted it.
- Data location: `result.containers[2].rows[0].columns[0].widgets[0].widget.data`
- This means **Hypothesis A (SSR-embedded data)** is confirmed — no browser or session tokens needed for filing detail.

### Still NOT working

- **Table API** (`GET /api/now/table/x_fmc_ibfs_base_table`): Returns 401 — requires authenticated user
- **Attachment downloads** (`/sys_attachment.do?sys_id=...`): Redirects to login without session

### ServiceNow Session Flow

The browser obtains a session automatically on first visit:
1. `GET /icfs` → server returns `JSESSIONID`, `glide_user_route`, `glide_node_id_for_js`, `BIGipServerpool_fccprod` cookies
2. The HTML response embeds `window.g_ck = '{csrf_token}'`
3. Subsequent API calls include `Cookie: JSESSIONID=...` and `X-UserToken: {g_ck}` headers
4. Widget data loads via Angular's client-side bootstrap (not a single extractable API call)

---

## Phase 1: Reverse-Engineer the Exact Request Flow

**Goal**: Use Playwright + Chrome DevTools to capture every HTTP request/response involved in loading a filing detail page, with full headers, cookies, and payloads.

### Step 1.1: Record HAR files for key page types

Use Playwright's built-in HAR recording:

```typescript
const context = await browser.newContext({
  recordHar: {
    path: 'icfs-filing-detail.har',
    urlFilter: /servicenowservices\.com/
  }
});
```

Record HARs for:
- [ ] Initial portal visit (`/icfs`) — capture session bootstrap
- [ ] Search results page (`?id=ibfs_search&q=SAT-LOA-2026`)
- [ ] Filing detail page (`?id=ibfs_application_summary&number=...`)
- [ ] Pleadings/comments tab click
- [ ] Attachment download (`/sys_attachment.do?sys_id=...`)

### Step 1.2: Analyze the Angular widget hydration flow

The filing detail data appears ONLY in the Angular scope, not in any single API response.
We need to determine exactly how it gets there:

- [ ] Intercept all XHR/fetch calls during page load with `page.route('**/*', ...)`
- [ ] Check if the SP page API response actually *does* contain widget data when loaded as a full page navigation (vs. API call)
- [ ] Check if there's a `$sp.getParameter()` call that reads URL params server-side during the page render
- [ ] Look for the `spPageData` Angular factory — it may be populated inline in the HTML `<script>` tag during SSR
- [ ] Test: does the page HTML `<script>` block contain serialized widget data that differs from the API response?

### Step 1.3: Test the g_ck token acquisition flow programmatically

```typescript
// Step 1: GET /icfs to obtain session cookies
const response = await fetch('https://fccprod.servicenowservices.com/icfs');
const cookies = response.headers.getSetCookie(); // JSESSIONID, etc.
const html = await response.text();
const g_ck = html.match(/window\.g_ck\s*=\s*'([^']+)'/)?.[1];

// Step 2: Try using these to call the widget API
// ... test various combinations
```

### Step 1.4: Test the "Publish Info" endpoint for g_ck

ServiceNow instances ship a legacy processor that returns the CSRF token:
```
GET /sn_devstudio_/v1/get_publish_info
```
Test if this exists on the FCC instance and returns a `ck` token.

---

## Phase 2: Identify the Minimal Reproducible Flow

**Goal**: Determine the simplest possible HTTP request sequence that yields filing detail data.

### Hypothesis A: SSR-embedded data (most likely)
The ServiceNow SP framework may embed widget data directly in the page HTML during server-side rendering. The Angular `spPageData` factory is populated from a `<script>` tag, not a separate API call. If true, we just need:
1. `GET /icfs` → get session cookies
2. `GET /icfs?id=ibfs_application_summary&number={filing}` with cookies → parse embedded JSON from HTML

### Hypothesis B: Widget hydration via separate call
The page makes a POST to `/api/now/sp/widget/{id}?id=ibfs_application_summary&number={filing}` that we haven't replicated correctly. The network log showed `[201] Created` responses. Need to capture the exact request body and headers.

### Hypothesis C: Full browser required
The Angular client-side code assembles the data from multiple sources during page load. If this is the case, we need a headless browser.

**Action**: Phase 1 will determine which hypothesis is correct.

---

## Phase 3: Build the Scraping Client

### If Hypothesis A or B (HTTP-only):

Use **`undici`** (Node.js built-in HTTP client) or **`got`** with a cookie jar:

```typescript
// Pseudocode for the ingest flow
class ICFSClient {
  private cookieJar: CookieJar;
  private g_ck: string;

  async initSession(): Promise<void> {
    // GET /icfs → extract cookies + g_ck from HTML
  }

  async searchFilings(query: string): Promise<SearchResult[]> {
    // POST /api/now/sp/search (works without auth)
  }

  async getFilingDetail(fileNumber: string): Promise<FilingDetail> {
    // GET or POST detail page with session → parse response
  }

  async downloadAttachment(sysId: string): Promise<Buffer> {
    // GET /sys_attachment.do?sys_id={sysId} with session cookies
  }
}
```

### If Hypothesis C (full browser required):

Use **Playwright in headless mode** — but optimized for speed:

```typescript
import { chromium } from 'playwright';

// Launch once, reuse context for many pages
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

// Navigate and extract via Angular scope
const page = await context.newPage();
await page.goto(`https://fccprod.servicenowservices.com/icfs?id=ibfs_application_summary&number=${fileNumber}`);
await page.waitForFunction(() => {
  const w = document.querySelector('[widget]');
  const scope = angular.element(w).scope();
  return scope?.data?.found === true;
});
const data = await page.evaluate(() => { /* extract from Angular scope */ });
```

**Speed considerations for headless Playwright**:
- Block unnecessary resources (images, fonts, CSS) via `page.route()`
- Reuse browser context across pages (session persists)
- Run multiple pages in parallel (ServiceNow may rate-limit)
- Consider `browserless.io` or similar for cloud-scale headless execution

### Candidate libraries to evaluate:

| Library | Approach | Speed | Session Handling | Notes |
|---|---|---|---|---|
| `undici` / native `fetch` | HTTP only | Fastest | Manual cookie jar | Best if Hypothesis A/B works |
| `got` + `tough-cookie` | HTTP only | Fast | Built-in cookie jar | More ergonomic than raw fetch |
| `playwright` | Full browser | Slow (~2-5s/page) | Automatic | Guaranteed to work, heaviest |
| `puppeteer` | Full browser | Slow (~2-5s/page) | Automatic | Alternative to Playwright |
| `cheerio` | HTML parsing | Fast | N/A (pair with HTTP client) | For extracting embedded JSON from SSR HTML |

**Recommendation**: Start with `undici` + `cheerio`. Fall back to Playwright only if the data truly requires client-side JS execution.

---

## Phase 4: Enumeration Strategy

The search API caps at 1999 results per query. To enumerate all filings:

### For incremental daily ingestion (primary use case):
- Query by `{subsystem}-{type}-{YYYYMMDD}` for recent dates
- Daily volume is low enough (~10-50 filings/day) to stay under the cap
- Store `last_scraped_date` per subsystem to track progress

### For historical backfill:
- Partition by subsystem + type + year-month: `SAT-LOA-202507`, `SAT-MOD-202508`, etc.
- Most month partitions will be well under 1999
- For high-volume months, partition by day

### Subsystems to cover:
- `SAT` (satellite space station) — primary interest
- `SES` (satellite earth station) — primary interest
- `ITC` (international telecom) — secondary
- `SCL` (submarine cable) — secondary

---

## Phase 5: Update Documentation

After the deep-dive, update:
- [ ] `doc/fcc-filing-history.md` — confirmed endpoint behavior, response schemas, rate limits
- [ ] `doc/datamodel.md` — new/changed fields from ICFS vs IBFS
- [ ] Create `packages/server/src/ingest/icfs-client.ts` with the working client

---

## Verification Checklist

- [ ] Can obtain session (cookies + g_ck) programmatically without a browser
- [ ] Can retrieve full filing detail for a known post-2025-06-24 filing
- [ ] Can enumerate all filings for a given date range
- [ ] Can download binary attachments via `/sys_attachment.do`
- [ ] Extracted fields cover our DuckDB schema requirements
- [ ] Session remains valid for bulk operations (or can be refreshed)
- [ ] No rate limiting observed at moderate throughput (~1 req/sec)

---

## Key References

- [ServiceNow Session Token Auth](https://jessems.com/posts/2023-08-25-authenticating-against-the-servicenow-api-with-session-tokens/) — g_ck + JSESSIONID flow
- [ServiceNow Unauthenticated Endpoints](https://gist.github.com/win3zz/e236c578c5ba8d8349f687deffabaa2d) — SP API exposure patterns
- [ServiceNow Cookie Docs](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0693221) — official cookie documentation
- [Playwright HAR Recording](https://playwright.dev/docs/mock) — HAR record/replay
- [HAR Replay with Dynamic Params](https://medium.com/@sdgroup/harmageddon-is-cancelled-how-we-taught-playwright-to-replay-har-with-dynamic-parameters-efc4cc24894e)
- [Playwright Web Scraping Guide](https://oxylabs.io/blog/playwright-web-scraping)
