# Plan: Move Preferences to /settings route

## Goal

Extract the Preferences and Hidden Items sections from the Profile page into a dedicated `/settings` route, and enable the disabled "Settings" item in the UserMenu dropdown to navigate there.

## Current State

| Component | File | Status |
|-----------|------|--------|
| Preferences UI (toggles, theme picker, hidden items) | `packages/web/src/user/ProfilePage.tsx` lines 109-177 | Embedded in Profile page |
| Settings menu item | `packages/web/src/ui/UserMenu.tsx` lines 59-64 | `disabled: true`, empty `onClick` |
| Route config | `packages/web/src/App.tsx` line 159 | `/profile` exists, no `/settings` |
| Settings API + context | `packages/web/src/lib/settings-context.tsx` | Fully wired, no changes needed |

## Changes

### 1. Create `packages/web/src/user/SettingsPage.tsx`

New page component that contains:
- The **Preferences** card (Email Alerts toggle, Wide View toggle, Theme selector) — currently ProfilePage lines 109-145
- The **Hidden Items** card (Unhide All button) — currently ProfilePage lines 147-177
- The helper components `ToggleRow` and `ThemeCard` — currently ProfilePage lines 182-256

The page should use the same `useSettings()` hook and layout pattern (`mx-auto max-w-2xl space-y-6`) as ProfilePage.

### 2. Trim `packages/web/src/user/ProfilePage.tsx`

Remove:
- The Preferences card (lines 109-145)
- The Hidden Items card (lines 147-177)
- The `ToggleRow` component (lines 182-215)
- The `ThemeCard` component (lines 217-256)
- Unused imports: `useSettings`, `THEMES`, `unhideAll`

ProfilePage retains only the avatar + name + role section.

### 3. Add `/settings` route in `packages/web/src/App.tsx`

- Lazy-import `SettingsPage`
- Add a `<Route>` for `/settings` inside the authenticated `PublicLayout` block, next to the `/profile` route (around line 159)

### 4. Enable Settings menu item in `packages/web/src/ui/UserMenu.tsx`

Change lines 59-64 from:
```ts
{
  disabled: true,
  icon: <Settings className="h-4 w-4" />,
  label: 'Settings',
  onClick: () => {},
}
```
to:
```ts
{
  icon: <Settings className="h-4 w-4" />,
  label: 'Settings',
  onClick: () => void navigate('/settings'),
}
```

## Files touched

| File | Action |
|------|--------|
| `packages/web/src/user/SettingsPage.tsx` | **Create** — new page with extracted Preferences + Hidden Items |
| `packages/web/src/user/ProfilePage.tsx` | **Edit** — remove Preferences/Hidden Items sections and helper components |
| `packages/web/src/App.tsx` | **Edit** — add lazy import + `/settings` route |
| `packages/web/src/ui/UserMenu.tsx` | **Edit** — enable Settings item, wire navigation |

## No backend changes required

The existing `GET/PATCH /api/user/settings` endpoints and `useSettings()` context are unchanged.
