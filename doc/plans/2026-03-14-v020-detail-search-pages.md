# v0.2.0 — Detail Pages & Search

## Overview

Add read-only detail pages for the three core entities (Filing, Satellite, Earth Station) and a basic search page. Each entity gets a RESTful API endpoint and a corresponding frontend page. A reusable data table component is introduced for search results and related-entity listings.

---

## URL Scheme

| Entity        | URL Pattern                            | Identifier             |
|---------------|----------------------------------------|------------------------|
| Filing        | `/filings/SAT-LOA-20250221-00050`      | `file_number` (unique) |
| Satellite     | `/satellites/1475`                     | `space_station_key` (integer PK) |
| Earth Station | `/earth-stations/E921000`              | `callsign` (unique per station) |
| Search        | `/search`                              | —                      |

### Rationale

- **Filing**: `file_number` is the canonical FCC identifier — human-readable, unique, and how attorneys already reference filings.
- **Satellite**: `us_name` is not unique (e.g. "INTELSAT AOR" has 13 rows at different orbital positions). `space_station_key` is the only reliable unique ID. The satellite name is displayed prominently on the page.
- **Earth Station**: `callsign` is unique per physical station. Multiple filings reference the same callsign (modifications, renewals, STAs, etc.).

---

## API Endpoints

### Filing

```
GET /api/filings/:fileNumber
```

Returns the filing record joined with:
- Status text (from `status_code` lookup)
- Subsystem label (from `subsystem_code` lookup)
- App type label (from `app_type_code` lookup)
- Attachments (from `attachment` table)
- Petitions/comments (from `petition_to_deny` table)
- Related space station or earth station link (if SAT or SES subsystem)

### Satellite

```
GET /api/satellites/:id
```

Returns the `space_station` record plus:
- Associated filings (paginated, via join on `space_station_key` or callsign match)
- Quick stats: total filing count, most recent filing date, distinct applicant count

### Earth Station

```
GET /api/earth-stations/:callsign
```

Returns earth station info aggregated from SES filings for this callsign, plus:
- Associated filings (paginated)
- Antenna and frequency data (from `antenna` → `frequency` join chain through `site`)
- Quick stats: total filing count, most recent filing date, antenna count

### Search

```
GET /api/search/filings?page=1&pageSize=25&sort=date_filed&order=desc&subsystem=SAT,SES&applicant=intelsat
GET /api/search/satellites?page=1&pageSize=25&sort=us_name&order=asc&name=intelsat&active=true
GET /api/search/earth-stations?page=1&pageSize=25&sort=callsign&order=asc&callsign=E92&state=CA
```

All search endpoints return `{ rows: T[], total: number }` for server-side pagination.

Text fields use DuckDB `ILIKE` with automatic wildcard wrapping for fuzzy matching, plus `trim()` for whitespace normalization.

---

## Page Designs

### Filing Detail Page (`/filings/:fileNumber`)

**Header area:**
- File number as page title
- Subsystem badge (colored, using existing `SUBSYSTEM_CODES` mapping) + app type label
- Status badge (from `status_code` lookup)
- Applicant name (`address_attention`) linked to a search filtered by that applicant
- Date filed

**Two-column layout:**

*Left column (wider):*
- **Brief Description** — `brief_description` field (ICFS-enriched filings)
- **Attachments** — list with filenames, linked to download/view
- **Comments/Petitions** — from `petition_to_deny` records, if any

*Right column (sidebar):*
- **Filing Details card** — callsign, DA number, red light status, streamlined flag, environmental impact, nature of service
- **Related Entity links** — SAT subsystem → link to satellite page; SES → link to earth station page
- **Dates card** — date filed, date signed, last action date, begin/end dates
- **Transfer Info** (conditional) — transferor/transferee names and addresses

---

### Satellite Detail Page (`/satellites/:id`)

**Header area:**
- Satellite name (`us_name`) as page title
- ITU name in smaller text if different
- Orbital position (`orbit_location`) prominently displayed
- Active/inactive badge based on `inactive_date`

**Two-column layout:**

*Left column (wider):*
- **Associated Filings** — data table: file number (linked), app type, applicant, date filed, status. Sorted newest-first. Server-side paginated.
- **Frequency Bands** — summary of bands from associated filing antennas (uplink/downlink ranges, polarization)

*Right column (sidebar):*
- **Satellite Info card** — space station key, US name, ITU name, orbital location, inactive date
- **Quick Stats** — total filing count, most recent filing date, distinct applicant count

---

### Earth Station Detail Page (`/earth-stations/:callsign`)

**Header area:**
- Callsign as page title
- Applicant name (from most recent filing) as subtitle
- Active/inactive status badge

**Two-column layout:**

*Left column (wider):*
- **Associated Filings** — data table (same pattern as satellite page)
- **Antennas & Frequencies** — grouped by antenna: manufacturer, model, diameter, then frequency bands (lower/upper, polarization, transmit/receive, EIRP)

*Right column (sidebar):*
- **Station Info card** — callsign, location (city, state), coordinates (lat/lon)
- **Quick Stats** — total filing count, most recent filing date, antenna count

---

### Search Page (`/search`)

Three tabs at the top: **Filings**, **Satellites**, **Earth Stations**. One form visible at a time. Collapsible filter panel above the results data table. All filters default to "Any" (no constraint).

#### Filing Search Form

| Field           | Cardinality | UI Element                                    |
|-----------------|-------------|-----------------------------------------------|
| File number     | free text   | Text input, `ILIKE` wildcard matching         |
| Callsign        | ~41K        | Text input with autocomplete                  |
| Applicant name  | ~18K        | Text input with autocomplete                  |
| Subsystem       | 13          | Multi-select dropdown (prepopulated)          |
| App type        | 37          | Multi-select dropdown (prepopulated)          |
| Status          | 82          | Multi-select dropdown (showing `status_text`) |
| Date filed      | range       | Date range picker (from / to)                 |

#### Satellite Search Form

| Field            | Cardinality | UI Element                    |
|------------------|-------------|-------------------------------|
| US name          | 738         | Text input with autocomplete  |
| ITU name         | 668         | Text input with autocomplete  |
| Orbital position | 450         | Text input with autocomplete  |
| Active/Inactive  | 2           | Toggle or dropdown            |

#### Earth Station Search Form

| Field          | Cardinality | UI Element                           |
|----------------|-------------|--------------------------------------|
| Callsign       | ~41K        | Text input with autocomplete         |
| Applicant name | ~18K        | Text input with autocomplete         |
| State          | ~50         | Multi-select dropdown (prepopulated) |
| City           | high        | Text input with autocomplete         |

#### Autocomplete

High-cardinality fields use a dedicated autocomplete endpoint:

```
GET /api/autocomplete/:entity/:field?q=intel&limit=10
```

Returns `string[]` of matching values from the DB, using `ILIKE` with prefix matching.

---

## Data Table Component

**Library:** TanStack Table (headless, styled with Tailwind)

**Required features:**
- Server-side pagination (offset-based, configurable page size)
- Sortable columns (click header to toggle asc/desc)
- Column filtering
- Resizable columns (`columnResizing` feature)
- Resizable overall table width

**API contract for paginated endpoints:**

```typescript
type PaginatedRequest = {
  page: number;        // 1-indexed
  pageSize: number;    // default 25
  sort: string;        // column name
  order: 'asc' | 'desc';
  filters: Record<string, string | string[]>;
};

type PaginatedResponse<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};
```

This data table will become the app-standard component, reused across search results and the associated-filings listings on detail pages.

---

## Implementation Sequence

### Phase 1 — Foundation
1. Add TanStack Table dependency
2. Create the reusable `DataTable` component with pagination, sorting, column resize
3. Create shared API utilities for paginated queries (server-side query builder)

### Phase 2 — API Layer
4. Filing repository + routes (`GET /api/filings/:fileNumber`)
5. Satellite repository + routes (`GET /api/satellites/:id`)
6. Earth Station repository + routes (`GET /api/earth-stations/:callsign`)
7. Search repositories + routes (all three entity search endpoints)
8. Autocomplete endpoint

### Phase 3 — Frontend Pages
9. Filing detail page
10. Satellite detail page
11. Earth Station detail page
12. Search page with tabbed forms

### Phase 4 — Integration
13. Wire up cross-entity links (filing → satellite/earth station, detail pages → search)
14. Add routes to `App.tsx`
15. Add navigation links to page header/breadcrumbs

Each phase should have tests written before implementation (TDD per project rules).
