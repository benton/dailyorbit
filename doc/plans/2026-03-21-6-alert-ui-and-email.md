# Alert UI & Email Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface alert-flagged content to users via a notification badge in the nav, a dedicated `/alerts` page listing unviewed flagged items grouped by saved search, and immediate email digests when new matches are found.

**Architecture:** Frontend gets an alert badge in the `PublicLayout` nav bar (polling `/api/alerts/unread-count`), a new `/alerts` page with grouped flagged content and dismiss actions, and a user setting for email alerts. Backend gets a new email service using Nodemailer with AWS SES transport, a digest renderer, and an email delivery step integrated into the `alerts.evaluate` pipeline stage. The existing `email_daily_orbit` user setting is repurposed as the email alert opt-in.

**Tech Stack:** Nodemailer + `@aws-sdk/client-sesv2` (new deps), DuckDB (existing), Hono (existing), React (existing)

**Depends on:** All four preceding plans (pipeline tracking, saved searches, viewing history & flagging, alert evaluation)

**Note on viewing history watermark:** The viewing history system now supports a per-user, per-content-type "watermark" timestamp stored in `user_view_watermark(user_id, content_type, watermark_at, updated_at)`. An item is considered "viewed" if it has a row in the per-item view table (`user_filing_view` / `user_news_view`) **OR** its date is at or before the user's watermark for that content type. For filings, the date is `filing.date_filed`; for news, it is `COALESCE(news_item.published_at, news_item.created_at)`. Any query that checks "has the user viewed this content?" must account for both mechanisms. The `ensureViewingHistoryTables()` function creates this table and must be called in any test setup that exercises viewing-history-aware code paths.

---

### Task 1: Install email dependencies

**Files:**
- Modify: `packages/server/package.json`

**Step 1: Add nodemailer and SES SDK**

```bash
cd /Users/benton/code/daily-orbit && pnpm --filter server add nodemailer @aws-sdk/client-sesv2
cd /Users/benton/code/daily-orbit && pnpm --filter server add -D @types/nodemailer
```

**Step 2: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml
git commit -m "build: add nodemailer and AWS SES SDK for email delivery"
```

---

### Task 2: Email service — SES transport via Nodemailer

**Files:**
- Create: `packages/server/src/email/email-service.ts`
- Create: `packages/server/src/email/email-service.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createEmailService, type EmailService } from './email-service.ts';

describe('email service', () => {
  it('should create a service instance without throwing', () => {
    // In test mode, we use a no-op transport
    const service: EmailService = createEmailService({ transport: 'test' });
    expect(service).toBeDefined();
    expect(service.sendMail).toBeDefined();
  });

  it('should format a plain text email', async () => {
    const service: EmailService = createEmailService({ transport: 'test' });
    const result = await service.sendMail({
      to: 'user@example.com',
      subject: 'Test Alert',
      text: 'You have 3 new matches.',
      html: '<p>You have <b>3</b> new matches.</p>',
    });
    // Test transport returns the message info
    expect(result.accepted).toContain('user@example.com');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=email/email-service`
Expected: FAIL — module not found.

**Step 3: Write the email service**

```typescript
import nodemailer from 'nodemailer';
import type { Transporter, SentMessageInfo } from 'nodemailer';

export type EmailServiceConfig = {
  transport: 'ses' | 'smtp' | 'test';
  region?: string;           // For SES (default: us-east-2)
  senderAddress?: string;    // e.g., "alerts@daily-orbit.example.com"
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
};

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailService = {
  sendMail: (input: SendMailInput) => Promise<SentMessageInfo>;
};

export function createEmailService(config: EmailServiceConfig): EmailService {
  let transporter: Transporter;

  if (config.transport === 'ses') {
    // Dynamic import to avoid requiring AWS SDK when not using SES
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    const aws = require('@aws-sdk/client-sesv2');
    const ses = new SESv2Client({ region: config.region ?? 'us-east-2' });
    transporter = nodemailer.createTransport({
      SES: { ses, aws },
    });
  } else if (config.transport === 'smtp') {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort ?? 587,
      secure: false,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });
  } else {
    // Test transport — captures messages in memory
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  const senderAddress: string = config.senderAddress ?? 'alerts@daily-orbit.example.com';

  return {
    async sendMail(input: SendMailInput): Promise<SentMessageInfo> {
      return transporter.sendMail({
        from: senderAddress,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    },
  };
}
```

Note: The SES transport initialization uses dynamic imports. The implementer should check the exact Nodemailer SES transport API — it may require `aws-sdk` v3 integration via `nodemailer-ses-transport` or the built-in SES support. Test against the actual AWS SES endpoint in the sandbox environment. Adjust the transport setup as needed per the Nodemailer SES documentation.

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=email/email-service`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/email/email-service.ts packages/server/src/email/email-service.test.ts
git commit -m "feat(email): add email service with SES, SMTP, and test transports"
```

---

### Task 3: Alert digest renderer

**Files:**
- Create: `packages/server/src/email/alert-digest.ts`
- Create: `packages/server/src/email/alert-digest.test.ts`

This module takes a set of alert matches grouped by saved search and renders them into plain text and HTML email content.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderAlertDigest, type DigestInput } from './alert-digest.ts';

describe('alert digest renderer', () => {
  const input: DigestInput = {
    userName: 'Alice',
    matches: [
      {
        searchName: 'SAT filings',
        contentType: 'filing',
        items: [
          { key: 'SAT-LOA-20260321-00001', title: 'SpaceX Inc — SAT LOA', url: '/filings/SAT-LOA-20260321-00001' },
          { key: 'SAT-MOD-20260321-00002', title: 'ViaSat — SAT MOD', url: '/filings/SAT-MOD-20260321-00002' },
        ],
      },
      {
        searchName: 'Spectrum news',
        contentType: 'news',
        items: [
          { key: '42', title: 'FCC Approves New Spectrum Sharing Rules', url: '/news/42' },
        ],
      },
    ],
  };

  it('should render text with all matches grouped by search', () => {
    const { text } = renderAlertDigest(input);
    expect(text).toContain('SAT filings');
    expect(text).toContain('SAT-LOA-20260321-00001');
    expect(text).toContain('Spectrum news');
    expect(text).toContain('FCC Approves New Spectrum Sharing Rules');
  });

  it('should render HTML with all matches grouped by search', () => {
    const { html } = renderAlertDigest(input);
    expect(html).toContain('<h2');
    expect(html).toContain('SAT filings');
    expect(html).toContain('href=');
  });

  it('should include the user name in the greeting', () => {
    const { text, html } = renderAlertDigest(input);
    expect(text).toContain('Alice');
    expect(html).toContain('Alice');
  });

  it('should generate a subject line with total count', () => {
    const { subject } = renderAlertDigest(input);
    expect(subject).toContain('3');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=alert-digest`
Expected: FAIL — module not found.

**Step 3: Write the digest renderer**

```typescript
export type DigestItem = {
  key: string;
  title: string;
  url: string;
};

export type DigestSearchGroup = {
  searchName: string;
  contentType: string;
  items: DigestItem[];
};

export type DigestInput = {
  userName: string;
  matches: DigestSearchGroup[];
};

export type DigestOutput = {
  subject: string;
  text: string;
  html: string;
};

export function renderAlertDigest(input: DigestInput): DigestOutput {
  const totalItems: number = input.matches.reduce(
    (sum, g) => sum + g.items.length, 0,
  );

  const subject: string = `Daily Orbit: ${String(totalItems)} new item${totalItems !== 1 ? 's' : ''} matching your alerts`;

  // Plain text
  const textSections: string[] = input.matches.map((group) => {
    const items: string = group.items
      .map((item) => `  - ${item.title} (${item.url})`)
      .join('\n');
    return `${group.searchName} (${String(group.items.length)} new):\n${items}`;
  });
  const text: string = [
    `Hi ${input.userName},`,
    '',
    `You have ${String(totalItems)} new item${totalItems !== 1 ? 's' : ''} matching your saved searches:`,
    '',
    ...textSections,
    '',
    '— The Daily Orbit',
  ].join('\n');

  // HTML
  const htmlSections: string = input.matches.map((group) => {
    const items: string = group.items
      .map(
        (item) =>
          `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></li>`,
      )
      .join('\n');
    return `<h2 style="margin: 16px 0 8px; font-size: 16px;">${escapeHtml(group.searchName)} (${String(group.items.length)} new)</h2>\n<ul>${items}</ul>`;
  }).join('\n');

  const html: string = [
    '<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">',
    `<p>Hi ${escapeHtml(input.userName)},</p>`,
    `<p>You have <strong>${String(totalItems)}</strong> new item${totalItems !== 1 ? 's' : ''} matching your saved searches:</p>`,
    htmlSections,
    '<hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;" />',
    '<p style="color: #888; font-size: 12px;">The Daily Orbit — FCC IBFS Explorer</p>',
    '</div>',
  ].join('\n');

  return { subject, text, html };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=alert-digest`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/email/alert-digest.ts packages/server/src/email/alert-digest.test.ts
git commit -m "feat(email): add alert digest renderer with plain text and HTML output"
```

---

### Task 4: Email delivery integration into alert evaluator

**Files:**
- Modify: `packages/server/src/alerts/evaluator.ts`

The evaluator currently writes flags and records `alert_run` with `email_sent: false`. This task adds email delivery after all searches for a given user are evaluated.

**Step 1: Add email delivery to `evaluateAlerts`**

The key change: after processing all saved searches, group the results by user. For each user who has `emailDailyOrbit = true` in their settings and has at least one match, render a digest and send it.

Add a new function `evaluateAlertsWithEmail` that wraps `evaluateAlerts`:

```typescript
import { createEmailService, type EmailService } from '../email/email-service.ts';
import { renderAlertDigest, type DigestSearchGroup, type DigestItem } from '../email/alert-digest.ts';
import { getSettingsByUserId } from '../user-settings/repository.ts';

export type EvaluationWithEmailResult = EvaluationResult & {
  emailsSent: number;
};

/**
 * Run alert evaluation and send email digests for users with matches.
 * This is the function called by the pipeline stage.
 */
export async function evaluateAlertsWithEmail(
  conn: DuckDBConnection,
  pipelineRunId: number,
  emailService: EmailService | null,
  baseUrl: string,
): Promise<EvaluationWithEmailResult> {
  // ... (the full implementation should):
  // 1. Call the existing evaluateAlerts logic but capture per-user/per-search results
  // 2. Group matches by user_id
  // 3. For each user with matches:
  //    a. Check user_settings.email_daily_orbit — skip if false
  //    b. Look up user email from the user table
  //    c. Build DigestSearchGroup[] from the matches
  //    d. Render digest via renderAlertDigest
  //    e. Send via emailService.sendMail
  //    f. Update alert_run records to set email_sent = true
  // 4. Return combined result with emailsSent count
}
```

The exact refactoring of `evaluateAlerts` to capture per-search results is left to the implementer. The key structural change is:
- The inner loop already has `search.user_id`, `search.name`, `contentKeys[]`
- Accumulate these into a `Map<string, DigestSearchGroup[]>` keyed by user_id
- After the loop, iterate the map for email delivery

**Step 2: Update the pipeline stage to pass email service**

In `packages/server/src/pipeline/registry.ts`, update the `alerts.evaluate` stage to create an email service and call `evaluateAlertsWithEmail`:

```typescript
const { createEmailService } = await import('../email/email-service.ts');
const { evaluateAlertsWithEmail } = await import('../alerts/evaluator.ts');

// Create email service — use SES in production, test transport otherwise
const emailTransport: string = process.env.NODE_ENV === 'production' ? 'ses' : 'test';
const emailService = createEmailService({
  transport: emailTransport as 'ses' | 'test',
  region: process.env.AWS_REGION ?? 'us-east-2',
  senderAddress: process.env.ALERT_SENDER_ADDRESS ?? 'alerts@daily-orbit.example.com',
});
const baseUrl: string = process.env.APP_BASE_URL ?? 'http://localhost:5173';

const result = await evaluateAlertsWithEmail(conn, pipelineRunId, emailService, baseUrl);
```

**Step 3: Commit**

```bash
git add packages/server/src/alerts/evaluator.ts packages/server/src/pipeline/registry.ts
git commit -m "feat(alerts): integrate email digest delivery into alert evaluation pipeline stage"
```

---

### Task 5: Email configuration in DB config

**Files:**
- Modify: `packages/server/src/user-settings/schema.ts` (if `email_daily_orbit` needs renaming — but it already exists and serves the purpose)

The existing `user_settings.email_daily_orbit` boolean already represents "send me email alerts." The column name is slightly misleading (it sounds like a daily digest rather than immediate alerts), but renaming it would break the existing frontend settings page.

**Decision:** keep `email_daily_orbit` as-is for now. Document that it controls alert email delivery. If the naming becomes confusing later, it can be renamed with a migration.

No code changes needed for this task — just a documentation note.

**Step 1: Commit documentation update**

Add a comment to the `user_settings` schema or update `doc/datamodel.md` noting that `email_daily_orbit` controls alert email opt-in.

```bash
git add doc/datamodel.md
git commit -m "docs: clarify email_daily_orbit setting controls alert email delivery"
```

---

### Task 6: API — unread alert count endpoint

**Files:**
- Modify: `packages/server/src/alerts/routes.ts`

The nav badge needs a lightweight endpoint to poll for the count of unviewed, active alert flags.

**Step 1: Add the endpoint**

```typescript
// GET /api/alerts/unread-count — count of active alert flags for current user
alertRoutes.get('/unread-count', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    await ensureViewingHistoryTables(conn);

    // Count alert flags where the content has NOT been viewed by the user.
    // "Viewed" means EITHER an explicit row in user_filing_view/user_news_view
    // OR the item's date is at/below the user's watermark in user_view_watermark.
    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM user_content_flag f
       WHERE f.user_id = $1
         AND f.source = 'alert'
         AND f.dismissed_at IS NULL
         AND (
           (f.content_type = 'filing'
             AND NOT EXISTS (
               SELECT 1 FROM user_filing_view v
               WHERE v.user_id = f.user_id AND v.file_number = f.content_key
             )
             AND NOT EXISTS (
               SELECT 1 FROM filing fl
               JOIN user_view_watermark w ON w.user_id = f.user_id AND w.content_type = 'filing'
               WHERE fl.file_number = f.content_key AND fl.date_filed <= w.watermark_at
             )
           )
           OR
           (f.content_type = 'news'
             AND NOT EXISTS (
               SELECT 1 FROM user_news_view v
               WHERE v.user_id = f.user_id AND CAST(v.news_item_id AS VARCHAR) = f.content_key
             )
             AND NOT EXISTS (
               SELECT 1 FROM news_item ni
               JOIN user_view_watermark w ON w.user_id = f.user_id AND w.content_type = 'news'
               WHERE CAST(ni.id AS VARCHAR) = f.content_key
                 AND COALESCE(ni.published_at, ni.created_at) <= w.watermark_at
             )
           )
         )`,
      [user.id],
    );
    const count: number = Number(reader.getRowObjectsJS()[0]!.cnt);
    return c.json({ count });
  } finally {
    conn.closeSync();
  }
});
```

Note: The implementer should verify this query against DuckDB. An alternative approach is to reuse the repository functions `getViewedFileNumbers` / `getViewedNewsIds` (which already account for watermarks) rather than inlining the SQL.

**Step 2: Commit**

```bash
git add packages/server/src/alerts/routes.ts
git commit -m "feat(alerts): add /unread-count endpoint for nav badge polling"
```

---

### Task 7: API — grouped alert items endpoint

**Files:**
- Modify: `packages/server/src/alerts/routes.ts`

The `/alerts` page needs the full list of flagged items grouped by saved search, with content metadata.

**Step 1: Add the endpoint**

```typescript
// GET /api/alerts/flagged — active alert flags grouped by saved search, with content details
alertRoutes.get('/flagged', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await ensureContentFlagTables(conn);
    await ensureSavedSearchTables(conn);

    const reader = await conn.runAndReadAll(
      `SELECT f.id AS flag_id, f.content_type, f.content_key, f.reason,
              f.saved_search_id, f.created_at::VARCHAR AS flagged_at,
              ss.name AS search_name,
              CASE f.content_type
                WHEN 'filing' THEN (SELECT fl.address_attention FROM filing fl WHERE fl.file_number = f.content_key)
                WHEN 'news' THEN (SELECT ni.title FROM news_item ni WHERE ni.id = CAST(f.content_key AS INTEGER))
              END AS item_title,
              CASE f.content_type
                WHEN 'filing' THEN (SELECT fl.subsystem_code || '-' || fl.app_type_code FROM filing fl WHERE fl.file_number = f.content_key)
                WHEN 'news' THEN (SELECT ns.name FROM news_item ni JOIN news_source ns ON ns.id = ni.news_source_id WHERE ni.id = CAST(f.content_key AS INTEGER))
              END AS item_subtitle
       FROM user_content_flag f
       LEFT JOIN saved_search ss ON ss.id = f.saved_search_id
       WHERE f.user_id = $1 AND f.source = 'alert' AND f.dismissed_at IS NULL
       ORDER BY ss.name, f.created_at DESC`,
      [user.id],
    );
    return c.json(reader.getRowObjectsJS());
  } finally {
    conn.closeSync();
  }
});
```

**Step 2: Commit**

```bash
git add packages/server/src/alerts/routes.ts
git commit -m "feat(alerts): add /flagged endpoint returning grouped alert items with content metadata"
```

---

### Task 8: Frontend — alert badge in nav bar

**Files:**
- Modify: `packages/web/src/ui/PublicLayout.tsx`

**Step 1: Add alert badge component and polling**

In `PublicLayout.tsx`, add a component that polls `/api/alerts/unread-count` every 60 seconds (only when authenticated) and renders a badge next to a "Alerts" nav link.

```typescript
function AlertBadge() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/alerts/unread-count');
        if (res.ok) {
          const data = await res.json();
          setCount(data.count);
        }
      } catch { /* silent */ }
    };
    void fetchCount();
    const interval = setInterval(() => void fetchCount(), 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Link to="/alerts" className="relative text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
      Alerts
      {count > 0 && (
        <span className="absolute -top-1 -right-3 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
```

Add `<AlertBadge />` to the nav bar inside the `{isAuthenticated && ...}` section, alongside the existing "Chat" link.

**Step 2: Verify manually**

Run: `cd /Users/benton/code/daily-orbit && make dev`
- When no alert flags exist, "Alerts" link appears without a badge
- Manually insert a flag in DuckDB, refresh — badge should appear with count

**Step 3: Commit**

```bash
git add packages/web/src/ui/PublicLayout.tsx
git commit -m "feat(alerts): add alert count badge to nav bar with 60-second polling"
```

---

### Task 9: Frontend — `/alerts` page

**Files:**
- Create: `packages/web/src/alerts/AlertsPage.tsx`
- Modify: `packages/web/src/App.tsx`

**Step 1: Create the alerts page component**

The page fetches `/api/alerts/flagged`, groups items by saved search, and renders them as expandable sections. Each item shows its title, subtitle, when it was flagged, and actions (View, Dismiss).

Key UI elements:
- **Search group headers** — saved search name + count of items
- **Item rows** — content title, subtitle (subsystem-apptype for filings, source name for news), flagged timestamp
- **Actions per item** — "View" link (navigates to `/filings/{fileNumber}` or `/news/{id}`), "Dismiss" button (calls `POST /api/flags/:id/dismiss`)
- **Bulk dismiss** — "Dismiss All" button per search group
- **Empty state** — "No new alert matches" message when no flags exist

Follow the same component patterns as the existing `SearchPage.tsx` and `NewsPage.tsx`.

```typescript
// Skeleton structure:
export default function AlertsPage() {
  const [flags, setFlags] = useState<FlaggedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/alerts/flagged')
      .then((r) => r.json())
      .then(setFlags)
      .finally(() => setLoading(false));
  }, []);

  // Group by search_name
  const grouped: Map<string, FlaggedItem[]> = useMemo(() => {
    const map = new Map<string, FlaggedItem[]>();
    for (const flag of flags) {
      const key = flag.search_name ?? 'Manual flags';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(flag);
    }
    return map;
  }, [flags]);

  const handleDismiss = async (flagId: number) => {
    await fetch(`/api/flags/${flagId}/dismiss`, { method: 'POST' });
    setFlags((prev) => prev.filter((f) => f.flag_id !== flagId));
  };

  // ... render grouped sections
}
```

**Step 2: Register the route in App.tsx**

Add the lazy import and route:

```typescript
const AlertsPage = lazy(() => import('./alerts/AlertsPage.tsx'));

// Inside the public layout routes, after the /chat route:
<Route
  element={
    <Suspense fallback={<div>Loading...</div>}>
      <AlertsPage />
    </Suspense>
  }
  path="/alerts"
/>
```

**Step 3: Verify manually**

Run: `cd /Users/benton/code/daily-orbit && make dev`
1. Navigate to `/alerts` — should show empty state
2. Manually flag some content via the API or DB
3. Refresh — should show grouped flagged items
4. Click "Dismiss" — item should disappear
5. Click "View" — should navigate to the content detail page

**Step 4: Commit**

```bash
git add packages/web/src/alerts/AlertsPage.tsx packages/web/src/App.tsx
git commit -m "feat(alerts): add /alerts page with grouped flagged content and dismiss actions"
```

---

### Task 10: Frontend — email alert toggle in user settings

**Files:**
- Modify: user settings page (find the existing profile/settings page component)

The existing `emailDailyOrbit` setting already has a toggle in the user profile page. Verify that:
1. The toggle label clearly communicates "Receive email alerts when new content matches your saved searches"
2. The toggle actually reads/writes the `emailDailyOrbit` setting

If the label is unclear (e.g., currently says "Daily Orbit email" or similar), update it to something like "Email me when new content matches my alert searches."

**Step 1: Update the label if needed**

Check the existing settings UI component, update the label text.

**Step 2: Commit**

```bash
git add packages/web/src/user/ProfilePage.tsx  # or wherever the settings toggle lives
git commit -m "feat(alerts): clarify email alert toggle label in user settings"
```

---

### Task 11: Integration test — full alert-to-email flow

**Files:**
- Create: `packages/server/src/alerts/email-integration.test.ts`

**Step 1: Write the integration test**

This test verifies the complete flow: saved search → new content → alert evaluation → email rendered and "sent" (via test transport).

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureAlertTables } from './schema.ts';
import { ensureSavedSearchTables } from '../saved-search/schema.ts';
import { ensureContentFlagTables } from '../content-flag/schema.ts';
import { ensurePipelineTrackingTables } from '../pipeline/schema.ts';
import { ensureViewingHistoryTables } from '../viewing-history/schema.ts';
import { createSavedSearch, updateSavedSearch } from '../saved-search/repository.ts';
import { insertPipelineRun, finishPipelineRun } from '../pipeline/tracking-repository.ts';
import { createEmailService } from '../email/email-service.ts';
import { evaluateAlertsWithEmail } from './evaluator.ts';

describe('alert email integration', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const userId: string = 'email-test-user';

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    // Create all required tables
    await conn.run(`
      CREATE TABLE IF NOT EXISTS "user" (
        id VARCHAR NOT NULL PRIMARY KEY, name VARCHAR NOT NULL,
        email VARCHAR NOT NULL UNIQUE, "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image VARCHAR, "createdAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        role VARCHAR NOT NULL DEFAULT 'user', banned BOOLEAN NOT NULL DEFAULT false,
        "banReason" VARCHAR, "banExpires" TIMESTAMP
      );
      INSERT INTO "user" (id, name, email) VALUES ('email-test-user', 'Alice', 'alice@example.com');
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id VARCHAR NOT NULL PRIMARY KEY,
        email_daily_orbit BOOLEAN NOT NULL DEFAULT false,
        wide_view BOOLEAN NOT NULL DEFAULT false
      );
      INSERT INTO user_settings (user_id, email_daily_orbit) VALUES ('email-test-user', true);
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER NOT NULL, file_number VARCHAR NOT NULL,
        callsign VARCHAR, address_attention VARCHAR,
        subsystem_code VARCHAR NOT NULL, app_type_code VARCHAR NOT NULL,
        status_code VARCHAR, date_filed TIMESTAMP,
        company_id INTEGER, _first_seen_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, parent_company_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER NOT NULL, file_number VARCHAR NOT NULL,
        summary VARCHAR, attachment_name VARCHAR
      );
      INSERT INTO filing VALUES
        (1, 'SAT-LOA-20260321-00001', 'E100', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2026-03-21', NULL, current_timestamp);
    `);
    await ensurePipelineTrackingTables(conn);
    await ensureSavedSearchTables(conn);
    await ensureContentFlagTables(conn);
    await ensureViewingHistoryTables(conn);
    await ensureAlertTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should evaluate alerts and send email digest via test transport', async () => {
    // Create and enable saved search
    const searchId: number = await createSavedSearch(conn, userId, {
      name: 'All SAT filings',
      content_type: 'filing',
      filters: { subsystem_code: ['SAT'] },
    });
    await updateSavedSearch(conn, searchId, userId, { alert_enabled: true });

    // Create pipeline run
    const runId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, runId, 'completed');

    // Create test email service
    const emailService = createEmailService({ transport: 'test' });

    // Evaluate with email
    const result = await evaluateAlertsWithEmail(
      conn, runId, emailService, 'http://localhost:5173',
    );

    expect(result.searchesEvaluated).toEqual(1);
    expect(result.totalMatched).toBeGreaterThanOrEqual(1);
    expect(result.emailsSent).toEqual(1);
  });
});
```

**Step 2: Run test**

Run: `cd /Users/benton/code/daily-orbit && pnpm --filter server test -- --testPathPattern=email-integration`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/server/src/alerts/email-integration.test.ts
git commit -m "test(alerts): add integration test for alert evaluation with email delivery"
```

---

## Summary of Deliverables

| What | Where |
|------|-------|
| Nodemailer + SES deps | `packages/server/package.json` |
| Email service | `packages/server/src/email/email-service.ts` + `.test.ts` |
| Digest renderer | `packages/server/src/email/alert-digest.ts` + `.test.ts` |
| Evaluator email integration | `packages/server/src/alerts/evaluator.ts` (modified) |
| Pipeline stage update | `packages/server/src/pipeline/registry.ts` (modified) |
| Unread count endpoint | `packages/server/src/alerts/routes.ts` (modified) |
| Flagged items endpoint | `packages/server/src/alerts/routes.ts` (modified) |
| Nav badge | `packages/web/src/ui/PublicLayout.tsx` (modified) |
| Alerts page | `packages/web/src/alerts/AlertsPage.tsx` |
| Route registration | `packages/web/src/App.tsx` (modified) |
| Settings label update | User settings page (modified) |
| Email integration test | `packages/server/src/alerts/email-integration.test.ts` |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ALERT_SENDER_ADDRESS` | `alerts@daily-orbit.example.com` | From address for alert emails |
| `APP_BASE_URL` | `http://localhost:5173` | Base URL for links in email digests |
| `AWS_REGION` | `us-east-2` | AWS region for SES transport |
| `NODE_ENV` | — | When `production`, uses SES; otherwise test transport |

## Epic Complete

This plan completes the Monitoring & Alerting epic:

1. **Pipeline Run Tracking** — merged
2. **Saved Searches** — planned
3. **Viewing History & Flagging** — planned
4. **Alert Evaluation** — planned
5. **Alert UI & Email** — this plan

The full flow: user saves a search → enables alerting → pipeline ingests new content → `alerts.evaluate` stage runs saved searches against new items → matches are flagged → email digest sent → user sees badge in nav → clicks through to `/alerts` page → views or dismisses flagged items.
