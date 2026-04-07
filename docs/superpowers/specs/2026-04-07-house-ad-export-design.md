# House Ad Export — Design

**Date:** 2026-04-07
**Status:** Approved
**Goal:** Make every Daily Orbit house ad in the `house_ad` library copy-pasteable into emails, ad platforms, and chat — as a self-contained static HTML file plus its image — served from a stable, content-addressed application endpoint.

## Motivation

Launch day. The newspaper already generates ~30 house ads (image + tagline pairs) via `house-ad-library.ts` and renders them per-edition through `HouseAd.tsx`. None of those rendered ads are usable outside the React app: they fetch from `/api/newspaper/house-ad/:editionDate`, depend on `newspaper.css`, and embed internal `<Link>`s.

We want one creative per library row, available at a permanent URL, that:
- Is a single static HTML file with all styles inline.
- References its image with a relative path (so "Save Page As…" works).
- Has exactly one click target (the wrapping `<a>`) pointing at a configurable destination URL with auto-generated UTM params.
- Is browseable and copy-link-able from a new admin page.

## Non-Goals

- Per-edition snapshots ("the ad we ran on 2026-04-07") — out of scope.
- Multiple creative variants (compact + full) — compact only.
- Multiple ad sizes / responsive variants — fixed 320×320 webp.
- PNG fallback for old Outlook — webp only.
- Editing or deleting library entries from the admin UI — read-only.
- CDN fronting — origin-served today, CloudFront-frontable later for free.
- Per-ad destination URLs — single config-driven URL for all ads.

## Architecture Overview

Three new server modules and one new web page:

```
packages/server/src/newspaper/
  ad-export-html.ts        # pure: slugify, escapeHtml, buildAdDestinationUrl, renderAdHtml
  ad-export-html.test.ts
  ad-export-routes.ts      # GET /ads/:idSlug.html, GET /ads/:idSlug.webp (+redirects)
  ad-export-routes.test.ts

packages/web/src/admin/newspaper/
  HouseAdLibrary.tsx       # gallery + copy-URL affordances
  HouseAdLibrary.test.tsx
```

Plus:
- New admin API endpoint `GET /api/admin/newspaper/house-ads` (added to existing newspaper admin routes).
- New `ConfigService` default key `houseAdDestinationUrl`.
- New repository helper `listHouseAds(conn)` and `getHouseAdById(conn, id)` in `newspaper/repository.ts` if not already present.
- `AdminSidebar.tsx` and admin router updated for the new page.

No schema migrations: `house_ad.id INTEGER PRIMARY KEY` already exists (`packages/server/src/newspaper/schema.ts:71-72`).

## Section 1 — Data Model

`house_ad` table is unchanged. It already has:

- `id INTEGER PRIMARY KEY DEFAULT nextval('house_ad_id_seq')`
- `tagline VARCHAR NOT NULL`
- `image_path VARCHAR NOT NULL`
- `image_prompt VARCHAR`
- `generated_by VARCHAR`
- `created_at TIMESTAMP`

The slug is **derived**, not stored:

```ts
slugify(tagline: string): string
```

Rules: NFKD-normalize, strip diacritics, lowercase, replace any run of non-`[a-z0-9]` with `-`, collapse repeats, trim leading/trailing hyphens, truncate to 60 characters at a hyphen boundary. Pure function, no I/O.

Taglines are treated as permanent (the user generates new ads by adding new taglines, never editing existing ones), so the derived slug is stable in practice.

## Section 2 — Endpoints

Two public route families mounted **outside `/api/`** for short shareable URLs:

| Method + Path | Behavior |
| --- | --- |
| `GET /ads/:id-:slug.html` | Canonical. Renders static HTML via `renderAdHtml`. 200 `text/html; charset=utf-8`. |
| `GET /ads/:id-:slug.webp` | Canonical. Streams the file at `house_ad.image_path`. 200 `image/webp`. |
| `GET /ads/:id.html` | 302 redirect → canonical `:id-:slug.html`. |
| `GET /ads/:id.webp` | 302 redirect → canonical `:id-:slug.webp`. |
| `GET /ads/:id-:wrongslug.html` | 302 redirect → canonical `:id-:slug.html` (GitHub-issue-style slug correction). |
| Unknown id | 404. |
| Non-numeric id | 404. |

Headers:
- `Cache-Control: public, max-age=86400` on canonical 200 responses.
- HTML response references the image as a **relative** URL: `{id}-{slug}.webp`. So saving the page in any browser pulls both files into one folder and they still resolve.
- `og:image` in the HTML uses an **absolute** URL built from the inbound request's `Host` header (works in dev and prod with no extra config).

Lives in `packages/server/src/newspaper/ad-export-routes.ts`. Mounted in the main app file alongside other public newspaper routes.

## Section 3 — HTML Template

Pure function in `packages/server/src/newspaper/ad-export-html.ts`:

```ts
export function renderAdHtml(input: {
  id: number;
  slug: string;
  tagline: string;
  destinationUrl: string;
  absoluteImageUrl: string;
}): string;
```

Output is a complete `<!doctype html>` document. Faithful port of the in-paper `.house-ad` look from `newspaper.css:338-418`, with all styles inline and the **features list omitted** (compact creative, single click target).

Resolved palette and fonts (literals, no CSS variables in the output):

| Var | Value |
| --- | --- |
| `--np-ink-black` | `#1a1a1a` |
| `--np-charcoal` | `#3a3a3a` |
| `--np-sepia-dark` | `#5c4a32` |
| `--np-sepia-medium` | `#8b7355` |
| `--np-sepia-light` | `#b8a88a` |
| `--np-aged-white` | `#faf7f0` |
| `--np-font-body` | `'Libre Baskerville', Georgia, 'Times New Roman', serif` |
| `--np-font-ad` | `'Josefin Slab', 'Courier New', serif` |

Template:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>The Daily Orbit — {tagline}</title>
  <meta property="og:title" content="The Daily Orbit">
  <meta property="og:description" content="{tagline}">
  <meta property="og:image" content="{absoluteImageUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital@0;1&family=Josefin+Slab:wght@600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:24px;background:#faf7f0;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;color:#1a1a1a">
  <a href="{destinationUrl}"
     style="display:block;max-width:480px;margin:1rem auto;padding:1.25rem 1.5rem;background:#faf7f0;border:3px double #5c4a32;text-align:center;text-decoration:none;color:inherit">
    <img src="{id}-{slug}.webp" alt="{tagline}" width="320" height="320"
         style="display:block;max-width:100%;height:auto;margin:0 auto 0.75rem;border:1px solid #b8a88a">
    <p style="font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-size:1.15rem;line-height:1.4;color:#5c4a32;margin:0.5rem 0">
      &ldquo;{tagline}&rdquo;
    </p>
    <p style="font-family:'Josefin Slab','Courier New',serif;font-size:1rem;font-weight:600;color:#1a1a1a;margin:0.75rem 0 0.5rem">
      Subscribe to <em>The Daily Orbit</em> today!
    </p>
    <p style="font-family:'Josefin Slab','Courier New',serif;font-size:0.7rem;font-variant:small-caps;letter-spacing:0.15em;color:#8b7355;margin:0.75rem 0 0">
      &#x2550;&#x2550; An Advertisement &#x2550;&#x2550;
    </p>
  </a>
</body>
</html>
```

Properties:
- **Single wrapping `<a>`** — entire card is one click target. No nested links.
- **All styles inline on elements** — no `<style>` block, no external CSS. Survives Outlook/Gmail/Substack.
- **Google Fonts via `<link>`** — newspaper typography in browsers and most webmail; clients that strip remote stylesheets fall back to Georgia / Courier New gracefully.
- **`og:` and `twitter:` meta tags** — pasting the URL into Slack/iMessage/Discord renders a preview card. Free distribution surface.
- **No JavaScript.**
- `tagline` is HTML-escaped before interpolation. New `escapeHtml()` helper in the same file (`&`, `<`, `>`, `"`, `'`).

## Section 4 — Config + UTM

**New config key** added to `ConfigService` defaults:

| Key | Default | Purpose |
| --- | --- | --- |
| `houseAdDestinationUrl` | `https://dailyorbit.org/` | Base URL for the wrapping `<a>`. |

**UTM construction** — pure function in `ad-export-html.ts`:

```ts
buildAdDestinationUrl(baseUrl: string, adId: number): string
```

Result shape:

```
{baseUrl}?utm_source=daily_orbit&utm_medium=house_ad&utm_campaign=launch&utm_content=ad-{id}
```

- Implementation uses `new URL(baseUrl)` and `searchParams.set` so it correctly handles a base URL that already has a path or query string.
- `utm_content=ad-{id}` uses the **numeric id**, not the slug, so click-attribution stays stable even if a tagline is ever renamed.
- Resolved at **request time**, not bake time — flipping the config value updates every exported ad on the next fetch with no re-rendering.
- No opt-out flag. The user can manually strip UTM params from copied URLs if desired.

**Absolute image URL for `og:image`** is built at request time from the inbound request's `Host` header:

```
https://{host}/ads/{id}-{slug}.webp
```

No new config, works in dev (`localhost`) and prod automatically. Scheme is `https` in prod; the route handler can use `req.protocol` if available for dev.

## Section 5 — Admin Gallery UI

**New page:** `packages/web/src/admin/newspaper/HouseAdLibrary.tsx`, parallel to `PortraitLibrary.tsx`. Wired into `AdminSidebar.tsx` under the Newspaper section, route added to the admin router.

**New admin API endpoint** added to existing newspaper admin routes:

```
GET /api/admin/newspaper/house-ads
```

Admin-gated like other admin newspaper routes. Returns:

```ts
type HouseAdListItem = {
  id: number;
  tagline: string;
  slug: string;          // server-computed via slugify(tagline)
  htmlPath: string;      // "/ads/{id}-{slug}.html"
  imagePath: string;     // "/ads/{id}-{slug}.webp"
  thumbnailUrl: string;  // existing libraryImageUrl(imageSubpath)
};

GET /api/admin/newspaper/house-ads → { ads: HouseAdListItem[] }
```

Slug is computed server-side (single source of truth) and shipped to the client so the UI never has to know the slugify rules.

**Page layout** — responsive grid of cards, one per ad:

```
┌─────────────────────┐
│   [320×320 thumb]   │
│                     │
│ "Three Miles Up…"   │   tagline (italic, sepia)
│ ad-7-three-miles-up │   slug, monospace, dim
│                     │
│ [📋 Copy HTML URL]  │   primary action
│ [📋 Copy image URL] │   secondary
│ [↗ Open HTML]       │   opens in new tab
└─────────────────────┘
```

**Copy-URL behavior:**
- Buttons call `navigator.clipboard.writeText(absoluteUrl)`. Absolute URL built client-side: `window.location.origin + htmlPath`.
- On success, button label briefly flips to "✓ Copied!" for ~1.5s then reverts. No toast library needed.
- HTML URL button is the **primary** affordance (larger, accent color) — the launch-day workhorse.
- Card itself is also clickable (opens HTML in a new tab) for quick previewing.

**Page header** has a single "Copy all HTML URLs" button that copies a newline-separated list of all 30 absolute HTML URLs — convenient for pasting into a launch checklist or doc.

**No edit/delete UI.** This page is read-only. The library is populated by the existing `house-ad-library.ts` generator.

## Section 6 — Testing

Following the existing pattern (`*.test.ts` next to source, real DuckDB for repository/route tests, no mocks for DB).

**`ad-export-html.test.ts`** — pure functions, no DB:
- `slugify()` — ASCII passthrough; accents stripped; punctuation/quotes removed; whitespace → hyphens; max length; idempotent; handles a few real taglines from the existing house_ad rows.
- `escapeHtml()` — `&`, `<`, `>`, `"`, `'` correctly escaped; tagline with quotes round-trips safely through the template.
- `buildAdDestinationUrl()` — base URL with no query, with existing query, with path, with trailing slash; UTM params present and correct; `utm_content` uses numeric id.
- `renderAdHtml()` — output contains expected tagline; relative image src `{id}-{slug}.webp`; absolute destination URL with UTM; absolute `og:image` URL. Snapshot test for the full HTML string (visual regressions).

**`ad-export-routes.test.ts`** — real DuckDB, real HTTP (matching the pattern in `newspaper/routes.test.ts`):
- `GET /ads/{id}-{slug}.html` → 200, `text/html`, body matches `renderAdHtml`.
- `GET /ads/{id}-{slug}.webp` → 200, `image/webp`, correct `Content-Length`.
- `GET /ads/{id}.html` → 302 → canonical.
- `GET /ads/{id}-wrong-slug.html` → 302 → canonical.
- `GET /ads/9999.html` → 404.
- `GET /ads/abc.html` → 404.
- `Cache-Control` header present on 200 responses.

**`HouseAdLibrary.test.tsx`** — web component test, following existing admin component test patterns:
- Renders all ads from a mocked API response.
- "Copy HTML URL" button calls `navigator.clipboard.writeText` with the absolute URL.
- Clicked button shows "✓ Copied!" then reverts.
- "Copy all HTML URLs" copies a newline-joined list.

**Admin list endpoint test** added to the existing admin newspaper routes test file:
- `GET /api/admin/newspaper/house-ads` returns shape with id, tagline, slug, htmlPath, imagePath, thumbnailUrl.
- Requires admin auth.

## Open Questions

None at design time.

## Future Work

- CloudFront fronting of `/ads/*` (free win once traffic justifies it; responses are pure functions of `id` + `houseAdDestinationUrl`).
- Per-edition snapshot variant if "archival proof of what we ran" becomes useful.
- Per-ad destination URLs if A/B testing creative-to-landing-page pairs becomes interesting.
- Click tracking (impression/click counts per ad id) — `utm_content=ad-{id}` already in place to support this.
