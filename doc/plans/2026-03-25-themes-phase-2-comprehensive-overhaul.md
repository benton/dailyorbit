# Site-Wide Themes — Phase 2: Comprehensive Overhaul

**Date:** 2026-03-25
**Status:** Draft
**Depends on:** Phase 1 (proof of concept)

---

## Overview

Phase 1 proves the theming concept by applying `--do-*` CSS tokens to the layout shell
(header, page background, site title). Phase 2 completes the job: every UI component,
every page, and every interactive element respects the active theme. After Phase 2,
switching to Broadsheet should feel like stepping into a different era — not just a
different header.

This plan also establishes the **extension point** for future themes. Adding a third
theme (e.g., "Terminal", "Blueprint") should require only a new `[data-theme="..."]`
block in CSS and a new card on the Profile page.

---

## Step 1 — Tailwind `@theme` integration

**File:** `packages/web/src/App.css`

Register the semantic tokens as Tailwind custom theme values so they're available as
utility classes throughout the codebase:

```css
@theme {
  --color-surface:        var(--do-bg);
  --color-surface-card:   var(--do-bg-card);
  --color-on-surface:     var(--do-text);
  --color-on-surface-muted: var(--do-text-muted);
  --color-on-surface-heading: var(--do-text-heading);
  --color-border-theme:   var(--do-border);
  --color-accent-theme:   var(--do-accent);
  --font-family-body:     var(--do-font-body);
  --font-family-heading:  var(--do-font-heading);
  --font-family-mono:     var(--do-font-mono);
  --radius-theme:         var(--do-radius);
}
```

This enables classes like `bg-surface`, `text-on-surface`, `border-border-theme`,
`rounded-theme`, `font-heading`, etc. — all automatically theme-aware.

---

## Step 2 — Component library sweep

Convert all `ui/*` components from hard-coded neutral palette to semantic tokens.
Each component gets a focused PR-sized change.

### 2a. `button.tsx` (CVA variants)

| Variant | Current | Themed |
|---|---|---|
| `default` | `bg-neutral-900 text-neutral-50` | `bg-on-surface text-surface` |
| `outline` | `border-neutral-200` | `border-border-theme` |
| all | `rounded-md` | `rounded-theme` |

The broadsheet button becomes: square corners, double-rule border, serif font.

### 2b. `badge.tsx`

Replace neutral/colored backgrounds with semantic equivalents. The broadsheet badge
uses a ruled-border pill with sepia text instead of a filled pill.

### 2c. `input.tsx`

Border, background, border-radius, and font-family switch to tokens.
Broadsheet inputs get a subtle inset shadow and serif placeholder text.

### 2d. `dialog.tsx`

Modal overlay, card background, border, and border-radius use tokens.
Broadsheet dialogs get the paper texture background.

### 2e. `table.tsx` / `DataTable.tsx`

Header background, row borders, hover colors, and font switch to tokens.
Broadsheet tables use double-rule header borders and alternating warm/cool row tones.

### 2f. `toast.tsx`

Background, border, text colors use tokens.

### 2g. `label.tsx`

Font and color use tokens.

### 2h. `FlagToggle.tsx` / `HideToggle.tsx`

Icon and hover colors use tokens.

### 2i. `SummaryTooltip.tsx`

Tooltip background, text, and border use tokens.

### 2j. `UserMenu.tsx`

Dropdown background, border, hover states use tokens.

---

## Step 3 — Page-level conversions

Each page layout has its own set of hard-coded Tailwind colors that need to adopt
semantic tokens. Ordered by user visibility:

### 3a. `HomePage.tsx` / `UserHomePage.tsx`

Dashboard cards, section headings, stat boxes.

### 3b. `SearchPage.tsx`

Search input, filter pills, result cards.

### 3c. `NewsPage.tsx` / `NewsDetail.tsx`

Article cards, source badges, date text.

### 3d. `FilingDetail.tsx`

Timeline visualization, comment cards, attachment list.

### 3e. `CompaniesPage.tsx` / `CompanyDetail.tsx`

Company cards, hierarchy tree, ownership timeline.

### 3f. `SatelliteDetail.tsx` / `EarthStationDetail.tsx`

Detail panels, data tables.

### 3g. `ChatPage.tsx`

Message bubbles, input area, typing indicators.

### 3h. `AlertsPage.tsx`

Alert cards, unread badges, action buttons.

### 3i. `ProfilePage.tsx`

The rest of the profile page beyond the theme selector (avatar card, toggles, etc.).

### 3j. Global `Link` component

**File:** `packages/web/src/App.tsx`

The custom `Link` wrapper currently uses `text-pink-700 dark:text-pink-400`.
Switch to `text-accent-theme` so broadsheet links use the accent-red (`#8b2500`).

---

## Step 4 — Broadsheet typographic enhancements

CSS-only additions scoped under `[data-theme="broadsheet"]`:

### 4a. Drop caps

```css
[data-theme="broadsheet"] .prose > p:first-of-type::first-letter {
  font-family: var(--do-font-heading);
  font-size: 3.5em;
  float: left;
  line-height: 0.8;
  margin: 0.05em 0.12em 0 0;
  color: var(--np-accent-red);
}
```

Apply to article/news detail body text and filing summaries.

### 4b. Section dividers

Replace `<hr>` and section separators with ornamental rule patterns:

```css
[data-theme="broadsheet"] hr {
  border: none;
  height: 1px;
  background: repeating-linear-gradient(
    90deg, var(--np-sepia-dark) 0, var(--np-sepia-dark) 4px, transparent 4px, transparent 8px
  );
  margin: 2rem 0;
}
```

### 4c. Heading treatments

```css
[data-theme="broadsheet"] h1 {
  font-family: var(--do-font-heading);
  letter-spacing: 0.02em;
  border-bottom: var(--do-border-style);
  padding-bottom: 0.3em;
}

[data-theme="broadsheet"] h2 {
  font-family: var(--do-font-heading);
  font-style: italic;
}
```

### 4d. Scrollbar styling

```css
[data-theme="broadsheet"] ::-webkit-scrollbar-thumb {
  background: var(--np-sepia-medium);
  border-radius: 0;
}

[data-theme="broadsheet"] ::-webkit-scrollbar-track {
  background: var(--np-parchment-light);
}
```

---

## Step 5 — Admin pages (lower priority)

Admin pages (`AdminLayout` and children) can optionally adopt theme tokens.
Since admin is a tool UI rather than a reading experience, the broadsheet treatment
should be lighter — primarily fonts and colors, without ornamental flourishes.

### 5a. `AdminLayout.tsx`

Sidebar background, nav links, active indicators use tokens.

### 5b. Admin dashboard, config editors, pipeline pages

Card backgrounds, table styles, form inputs use tokens.
These are lower priority and can be done incrementally.

---

## Step 6 — Cosmograph / data visualizations

The Cosmograph charts and data visualizations need themed color palettes.

**File:** `packages/web/src/ui/CosmographWrapper.tsx`

Read `document.documentElement.dataset.theme` and pass appropriate color configs:
- Modern: the current neutral/blue palette
- Broadsheet: sepia-toned palette using `--np-*` colors

This may require a `useTheme()` hook (simple wrapper around `useSettings()` that
returns just the theme string) for non-CSS contexts.

---

## Step 7 — Theme transition animations

Add a smooth CSS transition when switching themes so the change feels intentional:

```css
html {
  transition: background-color 0.3s ease, color 0.3s ease;
}

html * {
  transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
}
```

Scoped carefully to avoid interfering with other animations (hover states, etc.).

---

## Step 8 — Future theme extension point

### 8a. Theme registry

Create a simple theme metadata structure for the Profile page selector:

**New file:** `packages/web/src/lib/themes.ts`

```typescript
export type ThemeDefinition = {
  id: string;
  name: string;
  description: string;
  fontSample: string;      // CSS font-family for the "Aa" preview
  swatchBg: string;        // Preview card background color
  swatchBorder: string;    // Preview card border
  swatchAccent: string;    // Preview card accent dot
};

export const THEMES: ThemeDefinition[] = [
  {
    id: 'modern',
    name: 'Modern',
    description: 'Clean lines, rounded corners, system fonts',
    fontSample: 'system-ui, sans-serif',
    swatchBg: '#fafafa',
    swatchBorder: '1px solid #e5e5e5',
    swatchAccent: '#be185d',
  },
  {
    id: 'broadsheet',
    name: 'Broadsheet',
    description: 'Early 1900s newsprint with serif fonts',
    fontSample: "'Abril Fatface', Georgia, serif",
    swatchBg: '#f4edd3',
    swatchBorder: '2px double #5c4a32',
    swatchAccent: '#8b2500',
  },
];
```

Adding a new theme requires:
1. A new `[data-theme="..."]` block in `App.css`
2. A new entry in the `THEMES` array
3. No other code changes

### 8b. Validate theme values

Server-side: validate that PATCH'd theme values are in an allowlist.
Reject unknown theme IDs with a 400 response.

---

## Step 9 — Comprehensive testing

### 9a. Unit tests

- Theme provider sets `data-theme` correctly
- Theme selector component renders all themes from registry
- Settings context round-trips theme value

### 9b. Visual regression (optional)

If Playwright is available, add snapshot tests for key pages in both themes:
- Home page
- Search results
- Filing detail
- News detail
- Profile page

### 9c. Integration test

- Login → set theme to broadsheet → navigate to each major page → verify no
  visual breakage (Playwright `page.screenshot()` comparison)

---

## Execution Order

The steps above are ordered by dependency, but within each step the work is
parallelizable. Suggested batching:

| Batch | Steps | Description |
|---|---|---|
| A | 1, 8a | Tailwind theme + theme registry (pure infra, no visual change) |
| B | 2a–2j | Component library sweep (can be split across PRs) |
| C | 3a–3j | Page conversions (can be split across PRs) |
| D | 4a–4d | Broadsheet typography (CSS-only, single PR) |
| E | 5a–5b | Admin pages (low priority, incremental) |
| F | 6 | Visualization theming |
| G | 7, 8b, 9 | Polish: transitions, validation, testing |

---

## Files Changed (estimated)

| Scope | Files | Nature |
|---|---|---|
| `packages/web/src/App.css` | 1 | `@theme` block + broadsheet typography |
| `packages/web/src/ui/*.tsx` | 10 | Component token adoption |
| `packages/web/src/App.tsx` | 1 | Link component colors |
| `packages/web/src/lib/themes.ts` | 1 | **New** — theme registry |
| Page components | ~15 | Token adoption across all pages |
| Admin components | ~10 | Token adoption (lower priority) |
| `packages/web/src/ui/CosmographWrapper.tsx` | 1 | Themed viz palettes |
| Tests | ~5 | Visual regression + unit tests |
| **Total** | ~44 | |

---

## Non-Goals for Phase 2

- **Per-page theme overrides** — every page uses the global theme
- **Custom user themes** — only pre-built themes from the registry
- **Theme scheduling** — no "broadsheet on weekdays, modern on weekends"
- **Newspaper page theming** — the Newspaper view keeps its own isolated CSS
- **Admin-only themes** — admin pages get the same theme as public pages
