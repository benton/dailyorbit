# House Ad Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose every entry in the `house_ad` library at a stable, content-addressed URL as a self-contained static HTML file plus its image, browseable from a new admin gallery page with copy-URL affordances.

**Architecture:** Three new server modules (`ad-export-html.ts`, `ad-export-routes.ts`, plus a small repository helper) and one new admin React page (`HouseAdLibrary.tsx`). Public routes mount at `/ads/*` (outside `/api/`) so URLs are short and shareable. The HTML template is a pure function with all newspaper styles inlined; the click-target URL is built from a new `houseAdDestinationUrl` config key with auto UTM params.

**Tech Stack:** TypeScript, Hono, DuckDB, vitest, React, react-router, Tailwind, existing project utilities (`apiFetch`, `Button`, `Badge`, `withConn`).

**Spec:** `docs/superpowers/specs/2026-04-07-house-ad-export-design.md`

---

## File Manifest

**Create:**
- `packages/server/src/newspaper/ad-export-html.ts` — pure functions: `slugify`, `escapeHtml`, `buildAdDestinationUrl`, `renderAdHtml`
- `packages/server/src/newspaper/ad-export-html.test.ts` — unit tests for the four pure functions
- `packages/server/src/newspaper/ad-export-routes.ts` — Hono router factory `createAdExportRoutes(deps)`
- `packages/server/src/newspaper/ad-export-routes.test.ts` — route handler tests using stub deps
- `packages/web/src/admin/newspaper/HouseAdLibrary.tsx` — admin gallery page

**Modify:**
- `packages/server/src/lib/config-schema.ts` — add `houseAdDestinationUrl` entry
- `packages/server/src/newspaper/repository.ts` — add `getHouseAdById`
- `packages/server/src/newspaper/routes.ts` — add `GET /api/admin/newspaper/house-ads`
- `packages/server/src/app.ts` — mount `/ads` route group
- `packages/web/src/App.tsx` — add lazy route for `HouseAdLibrary` at `maintain/newspaper/house-ads`
- `packages/web/src/admin/AdminSidebar.tsx` — add "House Ad Library" item under Maintenance group

---

## Task 1: Add `houseAdDestinationUrl` config key

**Files:**
- Modify: `packages/server/src/lib/config-schema.ts`

- [ ] **Step 1: Add config schema entry**

Open `packages/server/src/lib/config-schema.ts`. Find the existing `appBaseUrl` block (around line 154) and add a new entry immediately after it inside the `CONFIG_SCHEMA` object:

```ts
  houseAdDestinationUrl: {
    key: 'houseAdDestinationUrl',
    defaultValue: 'https://dailyorbit.org/',
    encrypted: false,
    description:
      'Base URL used as the click-target for exported house ads (UTM params are appended automatically).',
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm -C packages/server run typecheck`
Expected: no new errors. The `ConfigKey` union type is derived from `CONFIG_SCHEMA` keys, so this also makes `'houseAdDestinationUrl'` a valid argument to `config.get()`.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/lib/config-schema.ts
git commit -m "feat(config): add houseAdDestinationUrl key for ad export"
```

---

## Task 2: `slugify` pure function

**Files:**
- Create: `packages/server/src/newspaper/ad-export-html.ts`
- Create: `packages/server/src/newspaper/ad-export-html.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/newspaper/ad-export-html.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { slugify } from './ad-export-html.ts';

describe('slugify', () => {
  test('lowercases ASCII and replaces spaces with hyphens', () => {
    expect(slugify('Three Miles Up')).toBe('three-miles-up');
  });

  test('strips diacritics', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  test('removes punctuation and quotes', () => {
    expect(slugify(`"All the Frequencies, Fit to Print!"`)).toBe(
      'all-the-frequencies-fit-to-print',
    );
  });

  test('collapses runs of separators and trims', () => {
    expect(slugify('  hello---world  ')).toBe('hello-world');
  });

  test('truncates to 60 characters at a hyphen boundary', () => {
    const long: string =
      'this is a very long tagline that should be truncated at a hyphen boundary not mid word';
    const result: string = slugify(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toMatch(/-$/);
    expect(result).not.toMatch(/^-/);
    // Must end at a word boundary, not mid-word
    expect(result.split('-').every((p: string) => p.length > 0)).toBe(true);
  });

  test('is idempotent', () => {
    const once: string = slugify('Three Miles Up & Counting!');
    expect(slugify(once)).toBe(once);
  });

  test('handles all-symbol input by returning empty string', () => {
    expect(slugify('!!!')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-html.test.ts`
Expected: FAIL — module `./ad-export-html.ts` not found.

- [ ] **Step 3: Create the source file with `slugify`**

Create `packages/server/src/newspaper/ad-export-html.ts`:

```ts
/**
 * Pure utilities for rendering exportable house-ad HTML pages.
 *
 * No I/O, no DB access. The route layer composes these functions
 * with repository data.
 */

const SLUG_MAX_LENGTH: number = 60;

/**
 * Convert a tagline into a URL-safe kebab-case slug.
 *
 * Rules: NFKD-normalize, strip diacritics, lowercase, replace any run of
 * non-[a-z0-9] with a single hyphen, trim leading/trailing hyphens,
 * truncate to 60 chars at a hyphen boundary.
 */
export function slugify(input: string): string {
  const ascii: string = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .toLowerCase();

  const collapsed: string = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (collapsed.length <= SLUG_MAX_LENGTH) {
    return collapsed;
  }

  // Truncate at the last hyphen that fits within the limit
  const truncated: string = collapsed.slice(0, SLUG_MAX_LENGTH);
  const lastHyphen: number = truncated.lastIndexOf('-');
  if (lastHyphen <= 0) {
    return truncated;
  }
  return truncated.slice(0, lastHyphen);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-html.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/newspaper/ad-export-html.ts packages/server/src/newspaper/ad-export-html.test.ts
git commit -m "feat(newspaper): add slugify helper for house ad URLs"
```

---

## Task 3: `escapeHtml` pure function

**Files:**
- Modify: `packages/server/src/newspaper/ad-export-html.ts`
- Modify: `packages/server/src/newspaper/ad-export-html.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/newspaper/ad-export-html.test.ts`:

```ts
import { escapeHtml } from './ad-export-html.ts';

describe('escapeHtml', () => {
  test('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  test('passes plain text through unchanged', () => {
    expect(escapeHtml('Three Miles Up')).toBe('Three Miles Up');
  });

  test('escapes & before introducing new entities (no double-escape)', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
```

Move the existing `import { slugify } from './ad-export-html.ts';` line to combine the imports:

```ts
import { escapeHtml, slugify } from './ad-export-html.ts';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-html.test.ts`
Expected: FAIL — `escapeHtml` is not exported.

- [ ] **Step 3: Add `escapeHtml` to the source file**

Append to `packages/server/src/newspaper/ad-export-html.ts`:

```ts
/**
 * Escape the five HTML special characters so an arbitrary string is safe
 * to interpolate into element text or double-quoted attribute values.
 *
 * Order matters: `&` MUST be replaced first to avoid double-escaping
 * the entities introduced by the later replacements.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-html.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/newspaper/ad-export-html.ts packages/server/src/newspaper/ad-export-html.test.ts
git commit -m "feat(newspaper): add escapeHtml helper for house ad rendering"
```

---

## Task 4: `buildAdDestinationUrl` pure function

**Files:**
- Modify: `packages/server/src/newspaper/ad-export-html.ts`
- Modify: `packages/server/src/newspaper/ad-export-html.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/newspaper/ad-export-html.test.ts`:

```ts
import { buildAdDestinationUrl } from './ad-export-html.ts';

describe('buildAdDestinationUrl', () => {
  test('appends UTM params to a bare base URL', () => {
    const result: string = buildAdDestinationUrl('https://dailyorbit.org/', 7);
    const url: URL = new URL(result);
    expect(url.origin).toBe('https://dailyorbit.org');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('utm_source')).toBe('daily_orbit');
    expect(url.searchParams.get('utm_medium')).toBe('house_ad');
    expect(url.searchParams.get('utm_campaign')).toBe('launch');
    expect(url.searchParams.get('utm_content')).toBe('ad-7');
  });

  test('preserves an existing path', () => {
    const result: string = buildAdDestinationUrl(
      'https://dailyorbit.org/welcome',
      3,
    );
    expect(new URL(result).pathname).toBe('/welcome');
  });

  test('preserves existing query params and overrides on conflict', () => {
    const result: string = buildAdDestinationUrl(
      'https://dailyorbit.org/?ref=foo&utm_source=manual',
      12,
    );
    const url: URL = new URL(result);
    expect(url.searchParams.get('ref')).toBe('foo');
    expect(url.searchParams.get('utm_source')).toBe('daily_orbit');
    expect(url.searchParams.get('utm_content')).toBe('ad-12');
  });

  test('uses numeric id for utm_content even when id is large', () => {
    const result: string = buildAdDestinationUrl('https://dailyorbit.org/', 999);
    expect(new URL(result).searchParams.get('utm_content')).toBe('ad-999');
  });
});
```

Update the import line:

```ts
import { buildAdDestinationUrl, escapeHtml, slugify } from './ad-export-html.ts';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-html.test.ts`
Expected: FAIL — `buildAdDestinationUrl` is not exported.

- [ ] **Step 3: Add `buildAdDestinationUrl` to the source file**

Append to `packages/server/src/newspaper/ad-export-html.ts`:

```ts
/**
 * Append the standard daily-orbit UTM tracking params to a base URL,
 * preserving any path/query already present. Overrides utm_* params
 * on conflict so the canonical campaign attribution always wins.
 */
export function buildAdDestinationUrl(baseUrl: string, adId: number): string {
  const url: URL = new URL(baseUrl);
  url.searchParams.set('utm_source', 'daily_orbit');
  url.searchParams.set('utm_medium', 'house_ad');
  url.searchParams.set('utm_campaign', 'launch');
  url.searchParams.set('utm_content', `ad-${String(adId)}`);
  return url.toString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-html.test.ts`
Expected: PASS — all 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/newspaper/ad-export-html.ts packages/server/src/newspaper/ad-export-html.test.ts
git commit -m "feat(newspaper): add buildAdDestinationUrl with UTM params"
```

---

## Task 5: `renderAdHtml` template

**Files:**
- Modify: `packages/server/src/newspaper/ad-export-html.ts`
- Modify: `packages/server/src/newspaper/ad-export-html.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/newspaper/ad-export-html.test.ts`:

```ts
import { renderAdHtml } from './ad-export-html.ts';

describe('renderAdHtml', () => {
  const baseInput = {
    id: 7,
    slug: 'three-miles-up',
    tagline: 'Three Miles Up & Counting',
    destinationUrl: 'https://dailyorbit.org/?utm_source=daily_orbit',
    absoluteImageUrl: 'https://dailyorbit.org/ads/7-three-miles-up.webp',
  };

  test('starts with <!doctype html>', () => {
    expect(renderAdHtml(baseInput).startsWith('<!doctype html>')).toBe(true);
  });

  test('uses the relative image src so save-as works', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).toContain('src="7-three-miles-up.webp"');
    expect(html).not.toContain('https://dailyorbit.org/ads/7-three-miles-up.webp"\n');
  });

  test('embeds the tagline (HTML-escaped) in title, og:description, alt, and visible text', () => {
    const html: string = renderAdHtml({
      ...baseInput,
      tagline: 'Tom & "Jerry"',
    });
    expect(html).toContain('Tom &amp; &quot;Jerry&quot;');
    // The literal characters & and " must NOT appear unescaped inside attribute values
    expect(html).not.toMatch(/alt="[^"]*"[^"]*"/); // no broken alt
  });

  test('uses the destinationUrl on the wrapping anchor', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).toContain(
      'href="https://dailyorbit.org/?utm_source=daily_orbit"',
    );
  });

  test('uses the absoluteImageUrl in og:image meta tag', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).toContain(
      '<meta property="og:image" content="https://dailyorbit.org/ads/7-three-miles-up.webp">',
    );
  });

  test('contains exactly one anchor element (single click target)', () => {
    const html: string = renderAdHtml(baseInput);
    const anchorCount: number = (html.match(/<a /g) ?? []).length;
    expect(anchorCount).toBe(1);
  });

  test('contains no <script> tags', () => {
    const html: string = renderAdHtml(baseInput);
    expect(html).not.toContain('<script');
  });

  test('snapshot — full output', () => {
    expect(renderAdHtml(baseInput)).toMatchSnapshot();
  });
});
```

Update the import line:

```ts
import {
  buildAdDestinationUrl,
  escapeHtml,
  renderAdHtml,
  slugify,
} from './ad-export-html.ts';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-html.test.ts`
Expected: FAIL — `renderAdHtml` is not exported.

- [ ] **Step 3: Add `renderAdHtml` to the source file**

Append to `packages/server/src/newspaper/ad-export-html.ts`:

```ts
export type RenderAdHtmlInput = {
  id: number;
  slug: string;
  tagline: string;
  destinationUrl: string;
  absoluteImageUrl: string;
};

/**
 * Render a complete, self-contained HTML document for one house ad.
 *
 * - All styles inline on elements (survives Outlook/Gmail/Substack).
 * - Single wrapping <a> — entire card is one click target. No nested links.
 * - <img src> is RELATIVE to the HTML file so "Save Page As…" pulls both
 *   into one folder and the reference still resolves.
 * - og:/twitter: meta tags use the absolute image URL for chat previews.
 * - Google Fonts <link> for the newspaper typography; clients that strip
 *   remote stylesheets fall back to Georgia/Courier gracefully.
 * - Faithful port of the in-paper .house-ad look from newspaper.css.
 */
export function renderAdHtml(input: RenderAdHtmlInput): string {
  const tagline: string = escapeHtml(input.tagline);
  const slug: string = escapeHtml(input.slug);
  const destinationUrl: string = escapeHtml(input.destinationUrl);
  const absoluteImageUrl: string = escapeHtml(input.absoluteImageUrl);
  const relativeImageSrc: string = `${String(input.id)}-${slug}.webp`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The Daily Orbit — ${tagline}</title>
<meta property="og:title" content="The Daily Orbit">
<meta property="og:description" content="${tagline}">
<meta property="og:image" content="${absoluteImageUrl}">
<meta name="twitter:card" content="summary_large_image">
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital@0;1&family=Josefin+Slab:wght@600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:24px;background:#faf7f0;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;color:#1a1a1a">
<a href="${destinationUrl}" style="display:block;max-width:480px;margin:1rem auto;padding:1.25rem 1.5rem;background:#faf7f0;border:3px double #5c4a32;text-align:center;text-decoration:none;color:inherit">
<img src="${relativeImageSrc}" alt="${tagline}" width="320" height="320" style="display:block;max-width:100%;height:auto;margin:0 auto 0.75rem;border:1px solid #b8a88a">
<p style="font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-size:1.15rem;line-height:1.4;color:#5c4a32;margin:0.5rem 0">&ldquo;${tagline}&rdquo;</p>
<p style="font-family:'Josefin Slab','Courier New',serif;font-size:1rem;font-weight:600;color:#1a1a1a;margin:0.75rem 0 0.5rem">Subscribe to <em>The Daily Orbit</em> today!</p>
<p style="font-family:'Josefin Slab','Courier New',serif;font-size:0.7rem;font-variant:small-caps;letter-spacing:0.15em;color:#8b7355;margin:0.75rem 0 0">&#x2550;&#x2550; An Advertisement &#x2550;&#x2550;</p>
</a>
</body>
</html>
`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-html.test.ts`
Expected: PASS — all 23 tests green. The snapshot will be created on first run.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/newspaper/ad-export-html.ts packages/server/src/newspaper/ad-export-html.test.ts packages/server/src/newspaper/__snapshots__/
git commit -m "feat(newspaper): add renderAdHtml template for ad export"
```

---

## Task 6: `getHouseAdById` repository helper

**Files:**
- Modify: `packages/server/src/newspaper/repository.ts`
- Modify: `packages/server/src/newspaper/repository.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/server/src/newspaper/repository.test.ts` and find the existing house-ad describe block (or add one near `insertHouseAd`/`listHouseAds` tests). Add:

```ts
import { getHouseAdById } from './repository.ts';

describe('getHouseAdById', () => {
  it('returns the row for a known id', async () => {
    const conn: DuckDBConnection = await freshConn();
    const created = await insertHouseAd(conn, {
      tagline: 'Three Miles Up',
      imagePath: 'data/newspaper/images/library/house-ads/000.webp',
      imagePrompt: 'a vintage radio',
      generatedBy: 'test',
    });
    const fetched = await getHouseAdById(conn, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.tagline).toBe('Three Miles Up');
    conn.closeSync();
  });

  it('returns null for an unknown id', async () => {
    const conn: DuckDBConnection = await freshConn();
    const fetched = await getHouseAdById(conn, 99999);
    expect(fetched).toBeNull();
    conn.closeSync();
  });
});
```

> If `freshConn()` doesn't exist in the test file under that name, use whatever helper the existing `insertHouseAd` tests use to obtain a connection — match the local pattern.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/server exec vitest run src/newspaper/repository.test.ts -t "getHouseAdById"`
Expected: FAIL — `getHouseAdById` is not exported from `./repository.ts`.

- [ ] **Step 3: Add `getHouseAdById` to the repository**

Open `packages/server/src/newspaper/repository.ts`. Add this function immediately after `listHouseAds` (around line 540):

```ts
export async function getHouseAdById(
  conn: DuckDBConnection,
  id: number,
): Promise<HouseAd | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM house_ad WHERE id = ?`,
    [id] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToHouseAd(rows[0]!);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/server exec vitest run src/newspaper/repository.test.ts -t "getHouseAdById"`
Expected: PASS — both new tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/newspaper/repository.ts packages/server/src/newspaper/repository.test.ts
git commit -m "feat(newspaper): add getHouseAdById repository helper"
```

---

## Task 7: Ad export route factory + tests

**Files:**
- Create: `packages/server/src/newspaper/ad-export-routes.ts`
- Create: `packages/server/src/newspaper/ad-export-routes.test.ts`

The routes module exports a **factory** that takes its dependencies (lookup function, destination-URL provider, file reader). This makes the route handlers easy to test in isolation without spinning up DuckDB or touching the filesystem.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/newspaper/ad-export-routes.test.ts`:

```ts
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createAdExportRoutes, type AdExportDeps } from './ad-export-routes.ts';

const FAKE_WEBP: Buffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
let testDir: string;
let imagePath: string;
let app: Hono;

beforeAll(async () => {
  testDir = join(tmpdir(), `ad-export-test-${String(Date.now())}`);
  await mkdir(testDir, { recursive: true });
  imagePath = join(testDir, '007.webp');
  await writeFile(imagePath, FAKE_WEBP);

  const deps: AdExportDeps = {
    async lookupAd(id: number) {
      if (id === 7) {
        return {
          id: 7,
          tagline: 'Three Miles Up',
          imagePath,
        };
      }
      return null;
    },
    getDestinationBaseUrl: () => 'https://dailyorbit.org/',
  };

  app = new Hono();
  app.route('/ads', createAdExportRoutes(deps));
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('GET /ads/:idSlug.html', () => {
  it('serves the canonical HTML with correct headers', async () => {
    const res = await app.request('/ads/7-three-miles-up.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/html/);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const body: string = await res.text();
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('Three Miles Up');
    expect(body).toContain('src="7-three-miles-up.webp"');
    expect(body).toContain('utm_content=ad-7');
  });

  it('redirects bare id .html to canonical id-slug form', async () => {
    const res = await app.request('/ads/7.html');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/ads/7-three-miles-up.html');
  });

  it('redirects wrong-slug .html to canonical id-slug form', async () => {
    const res = await app.request('/ads/7-something-stale.html');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/ads/7-three-miles-up.html');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request('/ads/9999.html');
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-numeric id', async () => {
    const res = await app.request('/ads/abc.html');
    expect(res.status).toBe(404);
  });
});

describe('GET /ads/:idSlug.webp', () => {
  it('serves the canonical webp with correct headers', async () => {
    const res = await app.request('/ads/7-three-miles-up.webp');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const body: ArrayBuffer = await res.arrayBuffer();
    expect(Buffer.from(body)).toEqual(FAKE_WEBP);
  });

  it('redirects bare id .webp to canonical', async () => {
    const res = await app.request('/ads/7.webp');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/ads/7-three-miles-up.webp');
  });

  it('redirects wrong-slug .webp to canonical', async () => {
    const res = await app.request('/ads/7-stale.webp');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/ads/7-three-miles-up.webp');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request('/ads/9999.webp');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-routes.test.ts`
Expected: FAIL — module `./ad-export-routes.ts` not found.

- [ ] **Step 3: Implement the route factory**

Create `packages/server/src/newspaper/ad-export-routes.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import { Hono } from 'hono';
import {
  buildAdDestinationUrl,
  renderAdHtml,
  slugify,
} from './ad-export-html.ts';

/**
 * Minimal data shape the routes need from the repository.
 * Kept narrow so route tests can stub it without importing DuckDB.
 */
export type AdExportRecord = {
  id: number;
  tagline: string;
  imagePath: string;
};

export type AdExportDeps = {
  /** Look up a single ad by numeric id, or null if not found. */
  lookupAd(id: number): Promise<AdExportRecord | null>;
  /** Return the configured base destination URL for the click target. */
  getDestinationBaseUrl(): string;
};

/**
 * Parse the `:idSlug` route param into `{ id, slug }`. The slug part
 * is optional — `7.html` is allowed and resolves to `{ id: 7, slug: '' }`.
 *
 * Returns null if the id portion is not a positive integer.
 */
function parseIdSlug(idSlug: string): { id: number; slug: string } | null {
  const dash: number = idSlug.indexOf('-');
  const idStr: string = dash === -1 ? idSlug : idSlug.slice(0, dash);
  const slug: string = dash === -1 ? '' : idSlug.slice(dash + 1);
  if (!/^\d+$/.test(idStr)) return null;
  const id: number = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { id, slug };
}

function canonicalSlugFor(record: AdExportRecord): string {
  return slugify(record.tagline);
}

function absoluteImageUrl(
  reqUrl: string,
  id: number,
  slug: string,
): string {
  // Use the inbound request URL to derive scheme + host so dev (localhost)
  // and prod both work without extra config.
  const u: URL = new URL(reqUrl);
  return `${u.origin}/ads/${String(id)}-${slug}.webp`;
}

export function createAdExportRoutes(deps: AdExportDeps): Hono {
  const routes = new Hono();

  routes.get('/:idSlug{[^/]+\\.html}', async (c) => {
    const param: string = c.req.param('idSlug').replace(/\.html$/, '');
    const parsed = parseIdSlug(param);
    if (parsed == null) {
      return c.json({ error: 'Not found' }, 404);
    }

    const record = await deps.lookupAd(parsed.id);
    if (record == null) {
      return c.json({ error: 'Not found' }, 404);
    }

    const canonical: string = canonicalSlugFor(record);
    if (parsed.slug !== canonical) {
      return c.redirect(`/ads/${String(record.id)}-${canonical}.html`, 302);
    }

    const html: string = renderAdHtml({
      id: record.id,
      slug: canonical,
      tagline: record.tagline,
      destinationUrl: buildAdDestinationUrl(
        deps.getDestinationBaseUrl(),
        record.id,
      ),
      absoluteImageUrl: absoluteImageUrl(c.req.url, record.id, canonical),
    });

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  routes.get('/:idSlug{[^/]+\\.webp}', async (c) => {
    const param: string = c.req.param('idSlug').replace(/\.webp$/, '');
    const parsed = parseIdSlug(param);
    if (parsed == null) {
      return c.json({ error: 'Not found' }, 404);
    }

    const record = await deps.lookupAd(parsed.id);
    if (record == null) {
      return c.json({ error: 'Not found' }, 404);
    }

    const canonical: string = canonicalSlugFor(record);
    if (parsed.slug !== canonical) {
      return c.redirect(`/ads/${String(record.id)}-${canonical}.webp`, 302);
    }

    try {
      const info = await stat(record.imagePath);
      if (!info.isFile()) {
        return c.json({ error: 'Not found' }, 404);
      }
      const data: Buffer = await readFile(record.imagePath);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(data.length),
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  return routes;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/server exec vitest run src/newspaper/ad-export-routes.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/newspaper/ad-export-routes.ts packages/server/src/newspaper/ad-export-routes.test.ts
git commit -m "feat(newspaper): add ad export route factory"
```

---

## Task 8: Mount `/ads` in app.ts

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Add the import**

Open `packages/server/src/app.ts`. Find the existing `import { newspaperRoutes, newspaperAdminRoutes } from './newspaper/routes.ts';` line (around line 22) and add this import directly after it:

```ts
import { createAdExportRoutes } from './newspaper/ad-export-routes.ts';
import { DuckDBConnection } from '@duckdb/node-api';
import { getDb } from './lib/db.ts';
import { trackConnection } from './lib/graceful-shutdown.ts';
import { ensureNewspaperTables } from './newspaper/schema.ts';
import { getHouseAdById } from './newspaper/repository.ts';
```

If `getDb`, `trackConnection`, or `DuckDBConnection` are already imported elsewhere in the file, deduplicate.

- [ ] **Step 2: Mount the routes**

Find the existing `app.route('/api/newspaper', newspaperRoutes);` line (around line 101). Add immediately after it:

```ts
// House ad export — mounted OUTSIDE /api/* so URLs are short and shareable
// (e.g. https://dailyorbit.org/ads/7-three-miles-up.html). No auth.
app.route(
  '/ads',
  createAdExportRoutes({
    async lookupAd(id: number) {
      const db = await getDb();
      const conn: DuckDBConnection = await DuckDBConnection.create(db);
      trackConnection(conn);
      try {
        await ensureNewspaperTables(conn);
        const ad = await getHouseAdById(conn, id);
        if (ad == null) return null;
        return { id: ad.id, tagline: ad.tagline, imagePath: ad.imagePath };
      } finally {
        conn.closeSync();
      }
    },
    getDestinationBaseUrl: () =>
      getConfigService().get('houseAdDestinationUrl') as string,
  }),
);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm -C packages/server run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Start the dev server: `make dev` (or whatever the project's dev target is — see `Makefile`).

Then in another terminal:

```bash
curl -sI http://localhost:9900/ads/1.html | head -5
```

Expected (assuming at least one house ad exists in the local DB):
- A `302` redirect to `/ads/1-<slug>.html`, OR
- A `200` if you visit the canonical URL.

Then:

```bash
curl -s http://localhost:9900/ads/1.html -L | head -20
```

Expected: a small HTML document beginning with `<!doctype html>`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat(server): mount /ads house ad export routes"
```

---

## Task 9: Admin list endpoint `/api/admin/newspaper/house-ads`

**Files:**
- Modify: `packages/server/src/newspaper/routes.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/server/src/newspaper/repository.test.ts` (or create a small new test file `admin-house-ads-routes.test.ts` if you prefer to keep this isolated). Append a focused integration test that drives the route through Hono — but since the existing admin routes file doesn't yet have a routes.test.ts, the simplest approach is to **drive the handler logic via a tiny inline app** like `routes-images.test.ts` does. Create `packages/server/src/newspaper/admin-house-ads-routes.test.ts`:

```ts
import { describe, expect, it, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureNewspaperTables } from './schema.ts';
import { insertHouseAd } from './repository.ts';
import { buildHouseAdsAdminRoute } from './routes.ts';

let app: Hono;

beforeAll(async () => {
  const db: DuckDBInstance = await DuckDBInstance.create(':memory:');
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  await ensureNewspaperTables(conn);
  await insertHouseAd(conn, {
    tagline: 'Three Miles Up',
    imagePath: 'data/newspaper/images/library/house-ads/000.webp',
    imagePrompt: 'a vintage radio',
    generatedBy: 'test',
  });
  await insertHouseAd(conn, {
    tagline: 'All the Frequencies, Fit to Print!',
    imagePath: 'data/newspaper/images/library/house-ads/001.webp',
    imagePrompt: 'a printing press',
    generatedBy: 'test',
  });

  app = new Hono();
  app.route(
    '/api/admin/newspaper',
    buildHouseAdsAdminRoute(async () => conn),
  );
});

describe('GET /api/admin/newspaper/house-ads', () => {
  it('returns all house ads with derived slug, htmlPath, imagePath, thumbnailUrl', async () => {
    const res = await app.request('/api/admin/newspaper/house-ads');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ads: Array<{
        id: number;
        tagline: string;
        slug: string;
        htmlPath: string;
        imagePath: string;
        thumbnailUrl: string;
      }>;
    };
    expect(body.ads).toHaveLength(2);
    const first = body.ads[0]!;
    expect(first.tagline).toBe('Three Miles Up');
    expect(first.slug).toBe('three-miles-up');
    expect(first.htmlPath).toBe(`/ads/${String(first.id)}-three-miles-up.html`);
    expect(first.imagePath).toBe(`/ads/${String(first.id)}-three-miles-up.webp`);
    expect(first.thumbnailUrl).toContain('/api/newspaper/images/library/house-ads/');
    const second = body.ads[1]!;
    expect(second.slug).toBe('all-the-frequencies-fit-to-print');
  });
});
```

> This test imports a new helper `buildHouseAdsAdminRoute(connFactory)` that we'll add in the next step. The helper exists specifically so the test can inject an in-memory DuckDB connection without spinning up the whole `withConn` pipeline.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/server exec vitest run src/newspaper/admin-house-ads-routes.test.ts`
Expected: FAIL — `buildHouseAdsAdminRoute` not exported.

- [ ] **Step 3: Add the route to `routes.ts`**

Open `packages/server/src/newspaper/routes.ts`. Add this import to the existing repository import block at the top:

```ts
import {
  // … existing imports …
  listHouseAds,
} from './repository.ts';
```

```ts
import { slugify } from './ad-export-html.ts';
```

Then append, just **before** `export { newspaperRoutes, newspaperAdminRoutes };` (currently around line 531):

```ts
/**
 * Build a Hono router exposing GET /house-ads. Factored out so route
 * tests can inject a stubbed connection factory without spinning up
 * the real DB pipeline.
 */
export function buildHouseAdsAdminRoute(
  connFactory: () => Promise<DuckDBConnection>,
): Hono {
  const r = new Hono();
  r.get('/house-ads', async (c) => {
    const conn: DuckDBConnection = await connFactory();
    const ads = await listHouseAds(conn);
    const items = ads.map((ad) => {
      const slug: string = slugify(ad.tagline);
      const filename: string =
        ad.imagePath.split('/').pop() ?? '';
      return {
        id: ad.id,
        tagline: ad.tagline,
        slug,
        htmlPath: `/ads/${String(ad.id)}-${slug}.html`,
        imagePath: `/ads/${String(ad.id)}-${slug}.webp`,
        thumbnailUrl: `/api/newspaper/images/library/house-ads/${filename}`,
      };
    });
    return c.json({ ads: items });
  });
  return r;
}

// Wire the route into the existing admin router using the standard withConn helper
newspaperAdminRoutes.route(
  '/',
  buildHouseAdsAdminRoute(async () => {
    const db = await getDb();
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);
    await ensureNewspaperTables(conn);
    return conn;
  }),
);
```

> Note: this uses a long-lived connection per request rather than `withConn`'s try/finally close. To match the existing pattern more cleanly, prefer instead replacing the `newspaperAdminRoutes.route('/', …)` block with an inline handler:

```ts
newspaperAdminRoutes.get('/house-ads', async (c) => {
  const items = await withConn(async (conn) => {
    const ads = await listHouseAds(conn);
    return ads.map((ad) => {
      const slug: string = slugify(ad.tagline);
      const filename: string = ad.imagePath.split('/').pop() ?? '';
      return {
        id: ad.id,
        tagline: ad.tagline,
        slug,
        htmlPath: `/ads/${String(ad.id)}-${slug}.html`,
        imagePath: `/ads/${String(ad.id)}-${slug}.webp`,
        thumbnailUrl: `/api/newspaper/images/library/house-ads/${filename}`,
      };
    });
  });
  return c.json({ ads: items });
});
```

Use this inline form for the **production wiring**, and keep `buildHouseAdsAdminRoute` exported solely for the test injection. The duplication is small (the `.map(…)` body) — extract a private `mapHouseAdToListItem` helper inside `routes.ts` if you want to DRY it:

```ts
function mapHouseAdToListItem(ad: HouseAd): {
  id: number;
  tagline: string;
  slug: string;
  htmlPath: string;
  imagePath: string;
  thumbnailUrl: string;
} {
  const slug: string = slugify(ad.tagline);
  const filename: string = ad.imagePath.split('/').pop() ?? '';
  return {
    id: ad.id,
    tagline: ad.tagline,
    slug,
    htmlPath: `/ads/${String(ad.id)}-${slug}.html`,
    imagePath: `/ads/${String(ad.id)}-${slug}.webp`,
    thumbnailUrl: `/api/newspaper/images/library/house-ads/${filename}`,
  };
}
```

You'll also need to import `HouseAd` from `./types.ts` if not already imported.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/server exec vitest run src/newspaper/admin-house-ads-routes.test.ts`
Expected: PASS — both assertions green.

- [ ] **Step 5: Run the full server test suite to catch regressions**

Run: `pnpm -C packages/server test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/newspaper/routes.ts packages/server/src/newspaper/admin-house-ads-routes.test.ts
git commit -m "feat(newspaper): add admin house-ads list endpoint"
```

---

## Task 10: `HouseAdLibrary.tsx` admin page

**Files:**
- Create: `packages/web/src/admin/newspaper/HouseAdLibrary.tsx`

- [ ] **Step 1: Create the page component**

Create `packages/web/src/admin/newspaper/HouseAdLibrary.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api.ts';
import { Button } from '../../ui/button.tsx';

type HouseAdListItem = {
  id: number;
  tagline: string;
  slug: string;
  htmlPath: string;
  imagePath: string;
  thumbnailUrl: string;
};

type ListResponse = {
  ads: Array<HouseAdListItem>;
};

export default function HouseAdLibrary() {
  const [ads, setAds] = useState<Array<HouseAdListItem>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled: boolean = false;
    apiFetch<ListResponse>('/api/admin/newspaper/house-ads')
      .then((data: ListResponse) => {
        if (!cancelled) {
          setAds(data.ads);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load house ads');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const origin: string = typeof window === 'undefined' ? '' : window.location.origin;

  const allHtmlUrls: string = useMemo(
    () => ads.map((ad: HouseAdListItem) => `${origin}${ad.htmlPath}`).join('\n'),
    [ads, origin],
  );

  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(allHtmlUrls);
    } catch {
      /* clipboard blocked — silently no-op */
    }
  }, [allHtmlUrls]);

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading house ad library…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          className="text-sm text-on-surface-muted hover:text-on-surface"
          to="/admin/maintain/newspaper"
        >
          &larr; Editions
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">House Ad Library</h1>
          <p className="mt-1 text-sm text-on-surface-muted">
            {ads.length} ad{ads.length === 1 ? '' : 's'} — each one is available as a
            self-contained static HTML file plus a webp image at a permanent URL.
          </p>
        </div>
        <Button onClick={() => void handleCopyAll()}>Copy all HTML URLs</Button>
      </div>

      {ads.length === 0 ? (
        <p className="text-sm text-on-surface-muted">No house ads in the library yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ads.map((ad: HouseAdListItem) => (
            <HouseAdCard ad={ad} key={ad.id} origin={origin} />
          ))}
        </div>
      )}
    </div>
  );
}

function HouseAdCard({ ad, origin }: { ad: HouseAdListItem; origin: string }) {
  const absoluteHtmlUrl: string = `${origin}${ad.htmlPath}`;
  const absoluteImageUrl: string = `${origin}${ad.imagePath}`;

  return (
    <div className="overflow-hidden rounded-theme border border-border-theme bg-surface-card p-3">
      <a
        className="block"
        href={ad.htmlPath}
        rel="noreferrer"
        target="_blank"
      >
        <img
          alt={ad.tagline}
          className="aspect-square w-full object-cover"
          src={ad.thumbnailUrl}
        />
      </a>
      <p className="mt-2 text-sm font-serif italic text-on-surface" title={ad.tagline}>
        &ldquo;{ad.tagline}&rdquo;
      </p>
      <p className="mt-1 font-mono text-[11px] text-on-surface-muted">
        ad-{ad.id}-{ad.slug}
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        <CopyButton label="Copy HTML URL" primary value={absoluteHtmlUrl} />
        <CopyButton label="Copy image URL" value={absoluteImageUrl} />
        <a
          className="text-center text-xs text-on-surface-muted hover:text-on-surface"
          href={ad.htmlPath}
          rel="noreferrer"
          target="_blank"
        >
          ↗ Open HTML in new tab
        </a>
      </div>
    </div>
  );
}

function CopyButton({
  label,
  primary = false,
  value,
}: {
  label: string;
  primary?: boolean;
  value: string;
}) {
  const [copied, setCopied] = useState<boolean>(false);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — leave label unchanged */
    }
  }, [value]);

  return (
    <Button
      onClick={() => void handleClick()}
      variant={primary ? 'default' : 'secondary'}
    >
      {copied ? '✓ Copied!' : label}
    </Button>
  );
}
```

> The `Button` component's `variant` prop names depend on the local UI library — check `packages/web/src/ui/button.tsx` for the actual values (likely `'default' | 'secondary' | 'outline'` from shadcn). Adjust the `primary ? 'default' : 'secondary'` line if your project uses different names.

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm -C packages/web run typecheck`
Expected: no errors. If `Button` doesn't accept a `variant` prop with those names, fix to whatever the local component supports.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/admin/newspaper/HouseAdLibrary.tsx
git commit -m "feat(admin): add House Ad Library gallery page"
```

---

## Task 11: Wire route + sidebar link

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/admin/AdminSidebar.tsx`

- [ ] **Step 1: Add the lazy import in App.tsx**

Open `packages/web/src/App.tsx`. Find the existing line:

```ts
const PortraitLibrary = lazy(() => import('./admin/newspaper/PortraitLibrary.tsx'));
```

(around line 39). Add immediately after it:

```ts
const HouseAdLibrary = lazy(() => import('./admin/newspaper/HouseAdLibrary.tsx'));
```

- [ ] **Step 2: Add the route**

Find the existing `<Route … path="maintain/newspaper/portraits" />` block (around line 294-301). Add immediately after its closing `/>`:

```tsx
<Route
  element={
    <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
      <HouseAdLibrary />
    </Suspense>
  }
  path="maintain/newspaper/house-ads"
/>
```

- [ ] **Step 3: Add the sidebar link**

Open `packages/web/src/admin/AdminSidebar.tsx`. Find the Maintenance group's `items` array (around line 31-38). Add a new item directly after the existing `'Newspaper'` entry:

```ts
      { label: 'House Ads', path: '/admin/maintain/newspaper/house-ads' },
```

The Maintenance group should now read:

```ts
{
  icon: <Wrench className="h-4 w-4" />,
  items: [
    { label: 'Pipeline', path: '/admin/maintain/pipeline' },
    { label: 'Users', path: '/admin/maintain/users' },
    { label: 'Companies', path: '/admin/maintain/companies' },
    { label: 'Hidden Items', path: '/admin/maintain/hidden-items' },
    { label: 'Backups', path: '/admin/maintain/backups' },
    { label: 'Newspaper', path: '/admin/maintain/newspaper' },
    { label: 'House Ads', path: '/admin/maintain/newspaper/house-ads' },
  ],
  label: 'Maintenance',
  prefix: '/admin/maintain',
},
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm -C packages/web run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Make sure the dev server is running. Open `http://localhost:5973/admin/maintain/newspaper/house-ads` in a browser as an admin user. Expected:
- Page loads, shows the gallery grid of house ads.
- Each card has thumbnail + tagline + slug line + Copy HTML / Copy image / Open buttons.
- Clicking "Copy HTML URL" briefly flips the label to "✓ Copied!" and the clipboard contains the absolute URL.
- Clicking "↗ Open HTML in new tab" opens `/ads/<id>-<slug>.html` and renders the static ad with the newspaper styling.
- The sidebar shows a "House Ads" entry under Maintenance and highlights it when active.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/admin/AdminSidebar.tsx
git commit -m "feat(admin): wire House Ad Library route and sidebar link"
```

---

## Task 12: `HouseAdLibrary.test.tsx` (web component test)

**Files:**
- Create: `packages/web/src/admin/newspaper/HouseAdLibrary.test.tsx`

> Check `packages/web/src/admin/` for an existing component test (e.g. anything matching `*.test.tsx`) to confirm whether the project uses `@testing-library/react`, `vitest` `jsdom`, or some other setup. If no admin component tests exist, this task may need to be deferred — note that as a follow-up rather than blocking the plan.

- [ ] **Step 1: Inspect existing test patterns**

Run: `find packages/web/src -name "*.test.tsx" | head -5`

If results exist, open one and use it as the template. If no results, **skip Steps 2-5** and proceed to Step 6 (note follow-up).

- [ ] **Step 2: Write the failing test**

Following the existing project pattern, create `packages/web/src/admin/newspaper/HouseAdLibrary.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import HouseAdLibrary from './HouseAdLibrary.tsx';

vi.mock('../../lib/api.ts', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../lib/api.ts';

const SAMPLE = {
  ads: [
    {
      id: 1,
      tagline: 'Three Miles Up',
      slug: 'three-miles-up',
      htmlPath: '/ads/1-three-miles-up.html',
      imagePath: '/ads/1-three-miles-up.webp',
      thumbnailUrl: '/api/newspaper/images/library/house-ads/000.webp',
    },
    {
      id: 2,
      tagline: 'Frequencies Fit to Print',
      slug: 'frequencies-fit-to-print',
      htmlPath: '/ads/2-frequencies-fit-to-print.html',
      imagePath: '/ads/2-frequencies-fit-to-print.webp',
      thumbnailUrl: '/api/newspaper/images/library/house-ads/001.webp',
    },
  ],
};

beforeEach(() => {
  vi.mocked(apiFetch).mockResolvedValue(SAMPLE);
});

describe('HouseAdLibrary', () => {
  it('renders all ads from the API response', async () => {
    render(
      <MemoryRouter>
        <HouseAdLibrary />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Three Miles Up/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Frequencies Fit to Print/)).toBeInTheDocument();
  });

  it('copies the absolute HTML URL when "Copy HTML URL" is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <MemoryRouter>
        <HouseAdLibrary />
      </MemoryRouter>,
    );

    const buttons = await screen.findAllByText('Copy HTML URL');
    await userEvent.click(buttons[0]!);

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/ads/1-three-miles-up.html`,
    );

    // Label flips to "✓ Copied!"
    await waitFor(() => {
      expect(screen.getByText('✓ Copied!')).toBeInTheDocument();
    });
  });

  it('copies all HTML URLs joined by newlines when header button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <MemoryRouter>
        <HouseAdLibrary />
      </MemoryRouter>,
    );

    await screen.findByText('Copy all HTML URLs');
    await userEvent.click(screen.getByText('Copy all HTML URLs'));

    expect(writeText).toHaveBeenCalledWith(
      [
        `${window.location.origin}/ads/1-three-miles-up.html`,
        `${window.location.origin}/ads/2-frequencies-fit-to-print.html`,
      ].join('\n'),
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails (or sanity-check it passes)**

Run: `pnpm -C packages/web exec vitest run src/admin/newspaper/HouseAdLibrary.test.tsx`
Expected: tests run. If they fail because the project doesn't have `@testing-library/react` or `userEvent` installed, **stop and adapt** to whatever component testing tools the project uses (or skip this task and note as follow-up).

- [ ] **Step 4: Implementation already exists**

The component is already implemented in Task 10, so the tests should pass on first run after correctly mocking `apiFetch`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm -C packages/web exec vitest run src/admin/newspaper/HouseAdLibrary.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit (or note skip)**

If tests pass:

```bash
git add packages/web/src/admin/newspaper/HouseAdLibrary.test.tsx
git commit -m "test(admin): add HouseAdLibrary component tests"
```

If the project has no precedent for component tests, leave a TODO in the plan-review section and move on.

---

## Task 13: End-to-end smoke test + final commit

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test` from the repo root (or `make test` if that's the standard target — check `Makefile`).
Expected: all tests pass. Fix any failures before proceeding.

- [ ] **Step 2: Lint and format**

Run: `pnpm -C packages/server exec oxlint src/newspaper/ad-export-html.ts src/newspaper/ad-export-routes.ts`
Run: `pnpm -C packages/server exec oxfmt --check src/newspaper/ad-export-html.ts src/newspaper/ad-export-routes.ts`
Run the equivalent for `packages/web/src/admin/newspaper/HouseAdLibrary.tsx`.
Expected: no warnings. Fix any issues.

- [ ] **Step 3: End-to-end manual verification**

Restart the dev server. As an admin user, navigate to `/admin/maintain/newspaper/house-ads`. Verify:

1. The gallery loads and shows all house ads from the local DB.
2. Click "Copy HTML URL" on the first card; paste into a browser address bar; the static ad page renders with the newspaper styling.
3. Save the rendered ad page as HTML via "File → Save Page As…" — the saved folder should contain both the `.html` and `.webp` files, and opening the saved HTML offline should still render the image.
4. Visit the ad URL with a wrong slug suffix (e.g. `/ads/1-totally-wrong.html`) and confirm it 302-redirects to the canonical form.
5. Visit the bare-id form (`/ads/1.html`) and confirm the same redirect.
6. Visit `/ads/9999.html` and confirm a 404.
7. Paste an ad URL into Slack/iMessage and confirm a preview card with the ad image renders.

- [ ] **Step 4: Verify config can be overridden**

Use the admin config UI (or `daily-orbit config set`) to change `houseAdDestinationUrl` to a different URL. Reload an exported ad and confirm the new destination appears in the wrapping `<a href="…">` (with UTM params still appended). Restore to default.

- [ ] **Step 5: No final commit needed**

All work is already committed in earlier tasks. Run `git log --oneline -15` and confirm the feature is represented by clean conventional commits.

---

## Self-Review Notes

- **Spec coverage:**
  - Section 1 (Data Model) → no schema changes needed; slug derived in Task 2.
  - Section 2 (Endpoints) → Tasks 7 + 8.
  - Section 3 (HTML Template) → Tasks 3, 4, 5.
  - Section 4 (Config + UTM) → Tasks 1, 4, 8.
  - Section 5 (Admin Gallery UI) → Tasks 9, 10, 11.
  - Section 6 (Testing) → Tasks 2-7, 9, 12, 13.
- **Type/name consistency:** `AdExportDeps`, `AdExportRecord`, `RenderAdHtmlInput`, `HouseAdListItem`, `buildHouseAdsAdminRoute`, `createAdExportRoutes`, `getHouseAdById`, `slugify`, `escapeHtml`, `buildAdDestinationUrl`, `renderAdHtml` — all referenced consistently across tasks.
- **No placeholders:** every step contains the actual code or command. The two "check the local pattern" notes (Task 6's `freshConn`, Task 10's `Button` variant prop name, Task 12's component test framework) are explicit instructions to verify against existing code, not vague TODOs.
- **Scope:** focused on a single feature. No unrelated refactoring.
