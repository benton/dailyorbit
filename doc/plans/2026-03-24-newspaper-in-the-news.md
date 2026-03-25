# Newspaper Section: In The News

## Overview

Add an "In The News" section to the newspaper view, presenting recent satellite industry news articles in a vintage newspaper style. This section reuses the existing news API from the home page's "Recent News" table but restyles it as a period-appropriate news bulletin board.

---

## Data Source

### Existing API
- **Endpoint:** `GET /api/news?pageSize=10&sort=published_at&order=desc`
- **Route handler:** `packages/server/src/news/routes.ts` (lines 45–70)
- **Repository:** `packages/server/src/news/repository.ts` — `listNewsItems(conn, pagination, filters)`

### Response Shape
```typescript
type PaginatedResponse<NewsListItem> = {
  data: Array<NewsListItem>;
  page: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
};

type NewsListItem = {
  id: number;
  newsSourceId: number;
  title: string;
  sourceUrl: string;
  author: string | null;
  publishedAt: string | null;    // ISO datetime
  sourceName: string | null;     // RSS feed name (e.g., "SpaceNews")
  summary: string | null;        // LLM-generated summary
  companyName: string | null;    // attributed company
  extractStatus: string;         // 'pending' | 'extracted' | 'failed'
  tags: Array<string>;           // RSS categories
};
```

### Key Fields to Display
- **Title** — the headline, primary content
- **Source** — feed name (SpaceNews, Via Satellite, SatNews, etc.)
- **Date** — publication date
- **Company** — attributed company (if any)
- **Summary** — shown on hover or as a brief blurb

---

## Frontend Design

### Component
- **File:** `packages/web/src/newspaper/sections/InTheNews.tsx`
- **Grid area:** New grid area in the newspaper layout

### Visual Style
A wire-service bulletin / news ticker aesthetic:
- Section header image: `headers/in-the-news.webp` (to be generated)
- Heading: "In The News"
- Each item rendered as a compact news brief:
  - **Title** in `var(--np-font-headline)` at ~16px, styled as a link to the source URL
  - **Source + Date** line beneath in small italic `var(--np-font-body)` at 11px
  - **Company attribution** as a small-caps tag when present
  - **Summary** as 1-2 line blurb in body font at 13px (truncated with ellipsis if needed)
- Items separated by thin horizontal rules (`1px solid var(--np-sepia-light)`)
- Dense vertical spacing — newspaper column style
- External links open in new tab (`target="_blank"`)
- Optional: 2-column layout via CSS `column-count: 2` at wider viewports (>1200px), similar to classifieds

### Data Fetching
- Fetch `GET /api/news?pageSize=10&sort=published_at&order=desc` in `NewspaperView.tsx`
- Pass the news items array as props to the section component
- No new API endpoint needed

---

## Layout Integration

### Grid Position
Place "In The News" as a full-width fourth row, or share the third row with "Yesterday's Filings":

**Option A: Two full-width rows (simpler)**
```
"fakead  lead      lead      orbital"
"company editorial editorial classifieds"
"filings filings   filings   filings"
"news    news      news      news"
```

**Option B: Side by side in row 3 (denser)**
```
"fakead  lead      lead      orbital"
"company editorial editorial classifieds"
"filings filings   news      news"
```

### Recommendation: Option B
Side-by-side in a third row creates a denser, more newspaper-like layout. Both sections are tabular/list data that works well in constrained widths. Filings gets the left half, news gets the right half.

---

## CSS Changes

```css
.newspaper-grid {
  grid-template-areas:
    "fakead  lead      lead      orbital"
    "company editorial editorial classifieds"
    "filings filings   news      news";
}

.grid-news { grid-area: news; }
```

### News Item Styles
```css
.news-brief { ... }              /* individual news item wrapper */
.news-brief-title { ... }        /* headline link */
.news-brief-meta { ... }         /* source + date line */
.news-brief-company { ... }      /* company attribution tag */
.news-brief-summary { ... }      /* truncated summary blurb */
```

---

## Files to Create
1. `packages/web/src/newspaper/sections/InTheNews.tsx`

## Files to Modify
1. `packages/web/src/newspaper/NewspaperView.tsx` — add data fetch, render section
2. `packages/web/src/newspaper/newspaper.css` — add grid area, news brief styles
3. `packages/web/src/newspaper/types.ts` — add `NewsListItem` type (or import from shared)

## No Server Changes Required
The existing `GET /api/news` endpoint provides everything needed.

---

## Design Considerations

- **No AI generation needed** — these sections render live data, not LLM-generated content
- **Always shown** — unlike weekly content (editorial, cartoon, etc.), filings and news are available every edition day
- **Row 3 conditional** — only render the third row if filings or news data is available (graceful degradation if API fails)
- **Link behavior** — filing file numbers link to internal filing detail pages; news titles link to external source URLs
