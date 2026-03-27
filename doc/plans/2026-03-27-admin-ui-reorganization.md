# Admin UI Reorganization

## Problem

The admin navigation is a flat list of 12+ links in a breadcrumb-style header bar. Pages that serve fundamentally different purposes (static configuration vs. one-off maintenance actions vs. read-only monitoring) are intermixed. This makes the admin area harder to navigate as the page count grows.

Additionally, the inference settings for all LLM-powered features should be presented uniformly using the existing `PromptEditor` component pattern (collapsible card with variable substitution help).

## Current State

### Navigation (AdminLayout.tsx)

Flat breadcrumb bar with links to all pages:

```
Admin / Dashboard / Settings / Companies / Users / Costs / Pipeline / History / Hidden Items / Backups / Newspaper / Logs
```

### Settings Sub-tabs (SettingsLayout.tsx)

```
Settings | AI | News | Consultants
```

### Page Inventory

| Page | Route | Current Group | Purpose |
|---|---|---|---|
| Dashboard | `/admin` | top-level | Info — dataset stats |
| ConfigEditor | `/admin/settings` | Settings tab | Config — key-value pairs |
| AiSettings | `/admin/settings/ai` | Settings tab | Config — inference models & prompts |
| NewsSourcesAdmin | `/admin/settings/news` | Settings tab | Config + Maintenance (feed CRUD, one-time pulls) |
| ConsultantAdmin | `/admin/settings/consultants` | Settings tab | Config — AI consultant personas |
| Companies | `/admin/companies` | top-level | Maintenance — company attribution, seeding, enrichment |
| Users | `/admin/users` | top-level | Maintenance — user accounts, roles, test emails |
| InferenceCosts | `/admin/costs` | top-level | Info — Bedrock API usage costs |
| PipelinePage | `/admin/pipeline` | top-level | Maintenance — run pipeline stages |
| PipelineHistoryPage | `/admin/pipeline/history` | top-level | Info — past pipeline runs |
| HiddenItemsAdmin | `/admin/hidden-items` | top-level | Maintenance — system-wide content filtering |
| BackupsPage | `/admin/backups` | top-level | Maintenance — database snapshots |
| EditionBrowser | `/admin/newspaper` | top-level | Maintenance — newspaper edition listing |
| EditionDetail | `/admin/newspaper/:date` | top-level | Maintenance — per-article management |
| PortraitLibrary | `/admin/newspaper/portraits` | top-level | Maintenance — portrait asset library |
| LogsPage | `/admin/logs` | top-level | Info — application logs |

## Proposed Structure

Replace the flat breadcrumb nav with a **grouped navigation** that reflects three functional categories. Each category becomes a section in a sidebar or a top-level tab group, with its own sub-pages.

### Category 1: Configuration

Static values that change the program's later behavior.

| Page | New Route | Notes |
|---|---|---|
| General Config | `/admin/config` | Existing ConfigEditor (key-value table) |
| AI & Inference | `/admin/config/ai` | All inference settings (see below) |
| News Sources | `/admin/config/news` | Feed CRUD; one-time pull action stays here |
| Consultants | `/admin/config/consultants` | AI consultant personas |

### Category 2: Maintenance

Actions that modify the database or trigger side effects.

| Page | New Route | Notes |
|---|---|---|
| Pipeline | `/admin/maintain/pipeline` | Run pipeline stages + collapsible recent run history |
| Users | `/admin/maintain/users` | User accounts, roles |
| Companies | `/admin/maintain/companies` | Attribution, seeding, enrichment |
| Hidden Items | `/admin/maintain/hidden-items` | System-wide content filtering |
| Backups | `/admin/maintain/backups` | Database snapshots |
| Newspaper | `/admin/maintain/newspaper` | Edition browser, detail, portraits (nested) |

### Category 3: Info

Read-only monitoring and diagnostics.

| Page | New Route | Notes |
|---|---|---|
| Dashboard | `/admin` | Dataset statistics (landing page, outside groups) |
| Inference Costs | `/admin/info/costs` | Bedrock API usage |
| Logs | `/admin/info/logs` | Application and query logs |

### Navigation Design

Replace the flat breadcrumb bar with a **sidebar** (or a three-segment top nav). Each category is a collapsible group with its sub-pages listed underneath. The active page is highlighted. A breadcrumb can still appear in the content header for context.

Rough wireframe:

```
┌──────────────────┬────────────────────────────────────────┐
│  ⚙ Configuration │                                        │
│    General        │   [page content]                       │
│    AI & Inference │                                        │
│    News Sources   │                                        │
│    Consultants    │                                        │
│                   │                                        │
│  🔧 Maintenance  │                                        │
│    Pipeline       │                                        │
│    Users          │                                        │
│    Companies      │                                        │
│    Hidden Items   │                                        │
│    Backups        │                                        │
│    Newspaper      │                                        │
│                   │                                        │
│  📊 Info          │                                        │
│    Dashboard      │                                        │
│    Pipeline Hx    │                                        │
│    Costs          │                                        │
│    Logs           │                                        │
│                   │                                        │
│  ← Back to app   │                                        │
└──────────────────┴────────────────────────────────────────┘
```

## Inference Settings Consolidation

### Current State

The `AiSettings.tsx` component already contains all inference prompt/model settings in one place, including newspaper generation. This is correct — newspaper inference settings are **not** on the general config page (ConfigEditor filters them out via `AI_CONFIG_KEYS`).

### Goal

Ensure every inference call in the application exposes its settings through the same UI pattern:

1. **Model selector** — radio buttons for available models
2. **PromptEditor** — the existing component with:
   - System prompt textarea (blank = built-in default)
   - User prompt textarea (blank = built-in default)
   - Collapsible card showing template variable substitutions with descriptions and examples

### Current Inference Sections in AiSettings.tsx

| Section | Model Key | Prompt Keys | Uses PromptEditor? |
|---|---|---|---|
| Bedrock defaults | `bedrockDefaultModel` | — | N/A |
| Attachment summarization | `summarizationModel` | `summarizationSystemPrompt`, `summarizationUserPrompt` | Yes |
| News summarization | `newsSummarizationModel` | `newsSummarizationSystemPrompt`, `newsSummarizationUserPrompt` | Yes |
| Search / RAG | `queryRewriteModel`, `queryGenerateModel` | `queryRewriteSystemPrompt`, `queryGenerateSystemPrompt`, `queryGenerateUserPrompt` | Needs audit |
| Embeddings | `embeddingModel` | — | N/A (no prompts) |
| Newspaper copy | `newspaperCopyModel` | `newspaperCopySystemPrompt`, `newspaperCopyUserPrompt` | Yes |
| Newspaper editorial | — | `newspaperEditorialSystemPrompt`, `newspaperEditorialUserPrompt` | Yes |
| Newspaper images | `newspaperImageModel` | — | N/A (image gen) |

### Action Items

1. **Audit search/RAG prompts** — verify the query rewrite and query generate sections use `PromptEditor` with variable help. If not, add it.
2. **Consistent section layout** — each inference section should follow the same visual pattern: heading → description → model selector → PromptEditor. Standardize any that deviate.
3. **Consider sub-tabs within AI page** — if the single AI settings page becomes too long, split it into sub-tabs (e.g., Summarization | Search | Newspaper) under the AI route.

## Implementation Plan

### Phase 1: Navigation Restructuring

1. **Create `AdminSidebar.tsx`** — new sidebar component with three collapsible groups. Use the same styling tokens as the rest of the admin UI.
2. **Update `AdminLayout.tsx`** — replace the flat breadcrumb header with the sidebar layout. Keep the wide/narrow toggle and "Back to app" link.
3. **Update route definitions in `App.tsx`** — remap routes to the new `/admin/{config,maintain,info}/*` structure. Dashboard stays at `/admin`.
4. **Add redirects** — old routes (`/admin/settings`, `/admin/companies`, etc.) redirect to their new locations for bookmarks/history.
5. **Remove `SettingsLayout.tsx`** — its tab navigation is replaced by the sidebar. The config sub-pages render directly under their category.
6. **Fold Pipeline History into Pipeline page** — add a collapsible "Recent Runs" section to `PipelinePage.tsx`. Delete `PipelineHistoryPage.tsx` as a standalone route.

### Phase 2: Inference Settings Polish

1. **Audit each AI section** — ensure all use `PromptEditor` where applicable.
2. **Standardize section layout** — consistent heading/description/model/prompts structure.
3. **Optional: sub-tab the AI page** — if scroll length is unwieldy after audit.

### Phase 3: News Sources UX Fix

The action buttons on `NewsSourcesAdmin` (pull, enable/disable) currently render as borderless colored text. This is dangerous — clicking what looks like a label silently modifies the database. Fix:

1. **Add visible button borders/backgrounds** — use the existing `Button` component variants (`outline` or `default`) instead of bare text links.
2. **Add confirmation dialogs** for destructive or state-changing actions (disable feed, force pull).

### Phase 4: Cleanup

1. Remove dead routes and imports.
2. Update any admin links elsewhere in the app (e.g., pipeline status links from the dashboard).
3. Test all navigation paths.

## Files to Modify

| File | Change |
|---|---|
| `packages/web/src/admin/AdminLayout.tsx` | Replace breadcrumb nav with sidebar layout |
| `packages/web/src/admin/AdminSidebar.tsx` | New file — sidebar navigation component |
| `packages/web/src/admin/SettingsLayout.tsx` | Delete (replaced by sidebar) |
| `packages/web/src/App.tsx` | Remap admin routes, remove PipelineHistoryPage route |
| `packages/web/src/admin/AiSettings.tsx` | Audit/standardize inference sections |
| `packages/web/src/admin/pipeline/PipelinePage.tsx` | Add collapsible recent run history section |
| `packages/web/src/admin/pipeline/PipelineHistoryPage.tsx` | Delete (folded into PipelinePage) |
| `packages/web/src/admin/NewsSourcesAdmin.tsx` | Fix button UX — use proper Button components, add confirmations |
| Various admin pages | Update any internal `<Link>` targets |

## Resolved Decisions

1. **Sidebar nav** — sidebar, not top tabs. Scales better for 16+ pages across 3 categories.
2. **Pipeline History** — fold into the Pipeline maintenance page as a collapsible section. Fewer pages = better.
3. **News Sources** — keep in Config. The "pull now" action is a convenience shortcut on a config page. But fix the button UX (see Phase 3).
4. **Dashboard** — stays at `/admin` as the landing page, outside the three category groups. Info group holds secondary diagnostics (Costs, Logs).
