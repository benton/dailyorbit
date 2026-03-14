# Plan: Admin Config Editor UI

**Depends on:** [DB-Backed Configuration System](2026-03-14-db-config.md)

## Context

With config stored in DuckDB via the config service, we need a web UI for viewing and editing configuration values. This plan covers the UI components, API routes, and page — without authorization gating. All requests can access the admin UI. Authorization will be added as a separate concern later.

## Component Library Recommendations

| Purpose | Library | Rationale |
|---------|---------|-----------|
| **UI primitives** | **shadcn/ui** (Radix + Tailwind) | Copy-paste components, native Tailwind, no extra CSS runtime. Perfect fit for existing Tailwind-only approach. |
| **Data grid** | **TanStack Table v8** | Headless (Tailwind-friendly), supports sorting/filtering/server-side pagination. ~15KB gzip. shadcn/ui has a DataTable recipe built on it. |
| **Charts** | **TBD — research phase** | See below |

**Why these over alternatives (UI + grid):**
- Mantine / Ant Design bring their own CSS runtimes — conflicts with Tailwind-only approach
- AG Grid is ~300KB and overkill for read-only display
- Tremor overlaps with shadcn/ui components, creating conflicts

### Chart Library: Research Phase

The charting library will be used extensively for the main dashboard UI, so this decision deserves a dedicated spike. Candidates to evaluate:

| Library | Notes |
|---------|-------|
| **Recharts** | Most mature React-specific. SVG-based, styleable via CSS vars. ~45KB gzip. |
| **Nivo** | Beautiful defaults, built on D3. More opinionated but polished. |
| **ECharts / react-echarts** | Extremely powerful. Canvas-based (harder to theme with Tailwind). |
| **Cosmograph** | GPU-accelerated graph visualization. Good for network/relationship data. |
| **DuckPlot** | Built specifically for DuckDB — generates plots directly from SQL queries. Natural fit for our stack. |
| **Shaper** | From project roadmap — evaluate for dashboard data shaping/visualization. |

**Research deliverable:** Build a small test page (could be part of `/admin`) that renders the same sample dataset with 2-3 of these libraries side-by-side, evaluating: Tailwind/dark-mode theming, bundle size, DuckDB integration ergonomics, and chart type coverage.

## Implementation Steps

### Step 1: Install shadcn/ui dependencies

**Modify:** `packages/web/package.json`

Add: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@radix-ui/react-slot`

**New file:** `packages/web/src/lib/cn.ts` — Tailwind merge utility

### Step 2: Copy shadcn/ui components

**New files in** `packages/web/src/ui/`:
- `button.tsx`, `input.tsx`, `label.tsx`, `table.tsx`, `badge.tsx`, `dialog.tsx`, `toast.tsx`

These are source files (shadcn/ui model), not npm imports.

### Step 3: Config API routes (server)

**New file:** `packages/server/src/config/routes.ts`

Hono router mounted at `/api/admin/config`:
- `GET /api/admin/config` — returns all config entries (sensitive values masked)
- `PUT /api/admin/config/:key` — updates a single value
- No authorization middleware — accessible to all requests

**Modify:** `packages/server/src/app.ts` — mount config routes

**New test:** `packages/server/src/config/routes.test.ts`

### Step 4: API client helper (frontend)

**New file:** `packages/web/src/lib/api.ts`

Thin `fetch` wrapper: prepends server URL, includes credentials, handles JSON + errors.

### Step 5: Admin layout + routing

**New file:** `packages/web/src/admin/AdminLayout.tsx`

- Simple layout chrome wrapping `<Outlet />`
- No auth checks — accessible to all users

**Modify:** `packages/web/src/App.tsx`

```tsx
<Route element={<AdminLayout />} path="/admin">
  <Route element={<ConfigEditor />} index />
</Route>
```

### Step 6: Config editor page

**New file:** `packages/web/src/admin/ConfigEditor.tsx`

- Fetches `GET /api/admin/config` on mount
- Renders shadcn/ui `<Table>` of config entries
- Each row: key, description, value (masked if sensitive), edit button
- Edit opens inline input or `<Dialog>` with appropriate input type
- Save calls `PUT /api/admin/config/:key`
- Toast on success/error

## File Summary

### New files
```
packages/server/src/config/routes.ts
packages/server/src/config/routes.test.ts
packages/web/src/lib/cn.ts
packages/web/src/lib/api.ts
packages/web/src/ui/{button,input,label,table,badge,dialog,toast}.tsx
packages/web/src/admin/AdminLayout.tsx
packages/web/src/admin/ConfigEditor.tsx
```

### Modified files
```
packages/server/src/app.ts            — mount /api/admin/config routes
packages/web/src/App.tsx               — add /admin route
packages/web/package.json              — add shadcn/ui deps
```

## Verification

1. Start server, navigate to `/admin` — config editor loads
2. Edit `clientDomain`, save — verify CORS origin changes without restart
3. `curl` the config API — returns config entries with sensitive values masked
4. All tests pass
