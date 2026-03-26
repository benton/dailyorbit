# Site-Wide Themes — Phase 1: Proof of Concept

**Date:** 2026-03-25
**Status:** Draft

---

## Overview

Add a user-selectable theme system with two themes: **Modern** (the current default look)
and **Broadsheet** (the early-1900s newspaper aesthetic applied to all non-Newspaper pages).

Phase 1 proves the concept end-to-end: DB setting → API → settings context → CSS variable
swap → visible change on `PublicLayout` + header + cards. The Newspaper page is untouched —
it always uses its own isolated styling regardless of theme.

### Design Decisions

1. **Broadsheet ignores dark mode.** The newspaper aesthetic is inherently light-on-parchment.
   When broadsheet is active, `prefers-color-scheme: dark` is overridden.
2. **Newspaper page has no theme awareness.** It keeps its own CSS; no `data-theme` attribute
   is consulted. Theme selection only affects pages under `PublicLayout`.
3. **Theme requires authentication.** Unauthenticated users see the modern theme.
   The Newspaper is the default landing page (separate routing change, out of scope here).
4. **`data-theme` attribute on `<html>`** is the sole mechanism. All theme-aware CSS
   is scoped via `[data-theme="broadsheet"]` selectors. No JS conditional styling.

---

## Step 1 — Database: add `theme` column

### 1a. Schema migration

**File:** `packages/server/src/user-settings/schema.ts`

Add `theme VARCHAR NOT NULL DEFAULT 'modern'` to the `user_settings` table:

```sql
CREATE TABLE IF NOT EXISTS user_settings (
  user_id            VARCHAR PRIMARY KEY,
  email_daily_orbit  BOOLEAN NOT NULL DEFAULT FALSE,
  wide_view          BOOLEAN NOT NULL DEFAULT FALSE,
  theme              VARCHAR NOT NULL DEFAULT 'modern'
)
```

Since DuckDB doesn't have a formal migration system, also add an `ALTER TABLE` guard that
runs on startup to handle existing databases:

```sql
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme VARCHAR NOT NULL DEFAULT 'modern'
```

### 1b. Repository types and field map

**File:** `packages/server/src/user-settings/repository.ts`

- Add `theme: string` to `RawSettingsRow` (as `theme`) and `UserSettings`
- Add `theme` → `'theme'` to `FIELD_MAP`
- Add `theme?: string` to `SettingsPatch`
- Update `rowToSettings` to include `theme`

### 1c. Test

Write an integration test that:
- Creates a user setting with default theme
- Patches theme to `'broadsheet'`
- Reads back and asserts `theme === 'broadsheet'`

---

## Step 2 — Frontend settings context

**File:** `packages/web/src/lib/settings-context.tsx`

Add `theme: string` to the `UserSettings` type. No other changes needed — the existing
`updateSetting` generic already handles new keys.

```typescript
export type UserSettings = {
  emailDailyOrbit: boolean;
  theme: string;
  userId: string;
  wideView: boolean;
};
```

---

## Step 3 — ThemeProvider component

**New file:** `packages/web/src/lib/theme-provider.tsx`

A thin component that reads `settings.theme` and sets `document.documentElement.dataset.theme`.

```typescript
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const theme: string = settings?.theme ?? 'modern';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [theme]);

  return <>{children}</>;
}
```

**File:** `packages/web/src/App.tsx`

Wrap the route tree inside `<ThemeProvider>`, nested within `<SettingsProvider>`:

```tsx
<AuthProvider>
  <SettingsProvider>
    <ThemeProvider>
      <Routes>...</Routes>
    </ThemeProvider>
  </SettingsProvider>
</AuthProvider>
```

---

## Step 4 — CSS semantic design tokens

**File:** `packages/web/src/App.css`

Define a set of `--do-*` (Daily Orbit) semantic variables with modern defaults,
then override them under `[data-theme="broadsheet"]`.

Move the newspaper font `@import` from `newspaper.css` to `App.css` so the fonts are
available site-wide when broadsheet is active. (Browsers only download fonts when they're
actually used in rendered text, so there's no performance cost for modern-theme users.)

```css
/* ── Semantic design tokens (modern defaults) ── */
:root {
  --do-bg:            #fafafa;
  --do-bg-card:       #ffffff;
  --do-text:          #111111;
  --do-text-muted:    #737373;
  --do-text-heading:  #111111;
  --do-border:        #e5e5e5;
  --do-border-style:  1px solid var(--do-border);
  --do-accent:        #be185d;
  --do-font-body:     system-ui, -apple-system, sans-serif;
  --do-font-heading:  system-ui, -apple-system, sans-serif;
  --do-font-mono:     ui-monospace, 'SF Mono', monospace;
  --do-radius:        0.5rem;
}

/* Keep existing dark-mode overrides for modern theme */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="broadsheet"]) {
    --do-bg:          rgb(20, 20, 20);
    --do-bg-card:     rgb(23, 23, 23);
    --do-text:        rgb(230, 230, 230);
    --do-text-muted:  rgb(163, 163, 163);
    --do-text-heading: rgb(245, 245, 245);
    --do-border:      rgb(64, 64, 64);
    --do-accent:      #f472b6;
  }
}

/* ── Broadsheet theme ── */
[data-theme="broadsheet"] {
  --do-bg:            #f9f4e8;
  --do-bg-card:       #f4edd3;
  --do-text:          #1a1a1a;
  --do-text-muted:    #8b7355;
  --do-text-heading:  #1a1a1a;
  --do-border:        #5c4a32;
  --do-border-style:  2px double var(--do-border);
  --do-accent:        #8b2500;
  --do-font-body:     'Libre Baskerville', Georgia, 'Times New Roman', serif;
  --do-font-heading:  'Abril Fatface', Georgia, serif;
  --do-font-mono:     'IBM Plex Mono', 'Courier New', monospace;
  --do-radius:        0;
}
```

### 4a. Update `body` rule

```css
body {
  background-color: var(--do-bg);
  color: var(--do-text);
  font-family: var(--do-font-body);
}
```

---

## Step 5 — Apply tokens to PublicLayout (the visible proof)

**File:** `packages/web/src/ui/PublicLayout.tsx`

Replace hard-coded Tailwind classes on the outer shell with inline style references
to `--do-*` vars. This is the minimum set for Phase 1:

| Element | Current | Broadsheet |
|---|---|---|
| Page wrapper `div` | `bg-neutral-50 dark:bg-neutral-950` | `style={{ backgroundColor: 'var(--do-bg)' }}` |
| `<header>` | `bg-white dark:bg-neutral-900` border | `style={{ backgroundColor: 'var(--do-bg-card)', borderBottom: 'var(--do-border-style)' }}` |
| Site title | `text-neutral-900 dark:text-neutral-100` | `style={{ color: 'var(--do-text-heading)', fontFamily: 'var(--do-font-heading)' }}` |
| Nav links | `text-neutral-500` / active | `style={{ color: 'var(--do-text-muted)' }}` |

Only the layout shell changes in Phase 1. Inner page content will still use Tailwind
defaults, which is acceptable — the header/chrome is the most visible part and proves
the concept works.

---

## Step 6 — Theme selector on Profile page

**File:** `packages/web/src/user/ProfilePage.tsx`

Add a "Theme" section to the Preferences card, between the existing toggles and the
Hidden Items section. Two radio-style cards:

```
┌─────────────────────────────────────┐
│  Theme                              │
│                                     │
│  [Modern]  ●    [Broadsheet]  ○     │
│  Clean &         1900s newsprint    │
│  minimal         with serif fonts   │
└─────────────────────────────────────┘
```

Each card is a `<button>` with:
- A small color swatch (background + border sample)
- A font sample ("Aa" in the theme's heading font)
- A label and one-line description
- A selected/unselected visual state

Clicking fires `updateSetting('theme', 'broadsheet')` or `updateSetting('theme', 'modern')`.

---

## Step 7 — Broadsheet texture on page background

**File:** `packages/web/src/App.css`

Add the SVG fractal-noise paper texture (already used in `newspaper.css`) to the body
when broadsheet is active:

```css
[data-theme="broadsheet"] body {
  background-image: url("data:image/svg+xml,...<noise filter>...");
}
```

This is a CSS-only addition that gives the broadsheet theme its signature aged-paper feel
across all pages, not just the newspaper.

---

## Verification

- [ ] New user gets `theme: 'modern'` by default
- [ ] PATCH `/api/user/settings` with `{ theme: 'broadsheet' }` persists and returns updated settings
- [ ] Selecting Broadsheet on Profile page immediately changes header to serif fonts + parchment colors
- [ ] Refreshing the page preserves the theme (read from DB on auth)
- [ ] Newspaper page (`/admin/newspaper/:date/view`) is visually unchanged regardless of theme
- [ ] Modern theme still respects `prefers-color-scheme: dark`
- [ ] Broadsheet theme ignores dark mode (always light parchment)
- [ ] `make test` passes
- [ ] `make build` succeeds (no type errors)

---

## Files Changed

| File | Change |
|---|---|
| `packages/server/src/user-settings/schema.ts` | Add `theme` column |
| `packages/server/src/user-settings/repository.ts` | Add `theme` to types + field map |
| `packages/server/src/user-settings/__tests__/*` | Integration test for theme setting |
| `packages/web/src/lib/settings-context.tsx` | Add `theme` to `UserSettings` type |
| `packages/web/src/lib/theme-provider.tsx` | **New** — sets `data-theme` on `<html>` |
| `packages/web/src/App.tsx` | Wrap with `<ThemeProvider>` |
| `packages/web/src/App.css` | Semantic `--do-*` tokens + broadsheet overrides + texture |
| `packages/web/src/ui/PublicLayout.tsx` | Header/shell uses `--do-*` vars |
| `packages/web/src/user/ProfilePage.tsx` | Theme selector cards |
