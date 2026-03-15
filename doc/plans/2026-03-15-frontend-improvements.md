# Frontend Improvements Plan

Status: **planned** (user will implement)

## 2A. Admin Companies page — use standard DataTable

**File:** `packages/web/src/admin/Companies.tsx`

Replace the hand-rolled HTML table with the app's `DataTable` component from `packages/web/src/ui/DataTable.tsx`.

- Import `DataTable`, `DataTableFetchParams`, `PaginatedResponse` from `../ui/DataTable.tsx`
- Define `ColumnDef<CompanyListItem>[]` columns: Name (link to `/companies/:id`), Parent, Filing Count
- Implement `fetchData` function that calls `/api/companies` with pagination/sort params
- Keep the attribution stats banner and action buttons above the table
- Use `onRowClick` to navigate to `/companies/:id`

## 2B. Remove Applicant Network Graph page

**Files:**
- `packages/web/src/admin/AdminLayout.tsx` — remove "Graph" nav link
- `packages/web/src/App.tsx` — remove `/admin/graph` route and `ApplicantGraph` lazy import
- `packages/web/src/admin/ApplicantGraph.tsx` — delete file (but see 2D below first — salvage the data pattern)

## 2C. Company Graph improvements

**File:** `packages/web/src/admin/CompanyGraph.tsx`

1. **Dark background**: Change the container wrapper to use a near-black background (e.g., `bg-neutral-900` or `bg-[#1a1a2e]`). Wrap the entire graph in a div with matching `backgroundColor` to work around the Cosmograph "Visualized by" badge having an opaque background that matches the wrapper instead of being transparent.

2. **Cosmograph badge workaround**: Create a reusable wrapper component (e.g., `packages/web/src/ui/CosmographWrapper.tsx`) that:
   - Wraps children in a div with the dark graph background color
   - This ensures the opaque "Visualized by Cosmograph" badge blends with the surrounding background
   - Reuse this wrapper in all Cosmograph visualizations
   - Add a note in the component JSDoc explaining the CSS distribution bug workaround

3. **Full-size layout**: Replace `h-[600px]` with `h-[calc(100vh-200px)]` (or similar, accounting for admin nav + heading) and remove any max-width constraints. The graph should fill all available horizontal space (up to outer template margins) and most vertical space.

4. **Thicker edges**: Add `linkWidthBy` prop or set `linkWidth` to 2–3px. Since the graph is sparse (~20-30 links), thicker lines improve readability.

5. **Node size contrast**: Change the size formula from `Math.log2(filingCount + 1) * 3` to something with more contrast, e.g., `Math.max(3, Math.sqrt(filingCount) * 2)` or use a power scale. The current log scale compresses the range too much — the difference between 10 filings and 10,000 filings should be dramatic.

6. **Color legend**: Add a small legend below or overlaid on the graph explaining what colors mean (parent company vs subsidiary). Also explain what node size represents (filing count). Consider a `<dl>` with colored dots and labels.

## 2D. Repurpose Applicant Graph → Company Filing Network (move to home page)

**New file:** `packages/web/src/home/CompanyFilingGraph.tsx` (or similar)

Transform the applicant-filing graph into a company-filing graph:
- Instead of fetching from `/api/admin/stats/applicant-graph`, create a new API endpoint (e.g., `/api/companies/graph` or `/api/stats/company-graph`) that returns companies (not raw applicants) and their attributed filings
- Discard unattributed filings — only show filings with `company_id IS NOT NULL`
- Company nodes sized by filing count; filing nodes small and uniform
- Links connect companies to their filings
- Use the `CosmographWrapper` from 2C for consistent styling

**Route changes:**
- `packages/web/src/App.tsx` — replace `/` `Home` component with the new `CompanyFilingGraph` (lazy-loaded)
- Remove the template boilerplate `Home` and `About` components (or keep About at `/about`)

**API changes:**
- `packages/server/src/companies/routes.ts` or `packages/server/src/stats/routes.ts` — add endpoint returning `{ companies: [...], filings: [...] }` where filings are attributed filings only

## 2E. Search page — add Company filter

**File:** `packages/web/src/search/SearchPage.tsx`

In the **Filings** tab filter form (`FilingFilterForm`):
- Replace the "Applicant" `AutocompleteInput` with "Company" (or add Company alongside Applicant)
- The Company filter should autocomplete against `/api/autocomplete/companies/name` (may need a new autocomplete endpoint)
- When a company is selected, the search API should filter filings by `company_id` (matching the selected company and its subsidiaries)
- This requires a server-side change: `packages/server/src/search/routes.ts` needs to accept a `company` or `companyId` query parameter and filter accordingly

In the **Satellites** and **Earth Stations** tabs:
- Consider whether the "Applicant" filter should also become "Company" — likely yes for consistency

**Server-side support needed:**
- Autocomplete endpoint for company names: `GET /api/autocomplete/companies/name?q=...`
- Search filter support: add `companyId` param to filing search query in `packages/server/src/search/routes.ts`
