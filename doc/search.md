# Search

The Search page is the primary interface for finding filings, satellites, and earth stations in the IBFS dataset. It combines structured filtered browsing with full-text content search.

---

## Browse Mode (Filtered Search)

When no content query is entered, the Search page operates in **browse mode** with three tabs:

### Filings Tab

Browse FCC filings with the following filters:

| Filter | Type | Behavior |
|--------|------|----------|
| File Number | Text | Prefix match (e.g. `SAT-LOA-2024`) |
| Callsign | Autocomplete | Case-insensitive substring match |
| Applicant | Autocomplete | Case-insensitive substring match on `address_attention` |
| Company | Autocomplete | Matches by company name, including subsidiaries |
| Subsystem | Multi-select | Filter by subsystem code (SAT, SES, ITC, etc.) |
| App Type | Multi-select | Filter by application type (LOA, MOD, STA, etc.) |
| Status | Autocomplete multi-select | Filter by status code |
| Date Filed From / To | Date picker | Inclusive date range |

Results display: File Number, Subsystem, App Type, Applicant, Company, Callsign, Status, Date Filed. Default sort is by date filed (newest first). Hovering over a file number shows the filing summary in a tooltip.

### Satellites Tab

Browse satellite space stations with filters for US Name, ITU Name, Orbital Position, Company, and Active/Inactive status. Default sort is by US name (alphabetical).

### Earth Stations Tab

Browse earth stations with filters for Callsign, Applicant, State, City, and Company. Default sort is by callsign (alphabetical).

### Autocomplete

Text filter inputs offer type-ahead suggestions after 2 characters. Suggestions are fetched from the database and appear in a dropdown. Click a suggestion or keep typing to narrow results.

### Pagination and Sorting

All result tables are paginated (default 25 rows per page). Click any column header to sort by that column. Click again to reverse the sort order.

---

## Content Search

Typing a query into the search bar at the top of the page activates **content search mode**. This searches across the full text of:

- **Filing metadata** — description and brief description fields
- **Attachments** — extracted full text and AI-generated summaries of PDF attachments
- **Comments (pleadings)** — filer name and exhibit/attachment HTML content

### How It Works

Content search uses BM25 full-text ranking. BM25 is a standard information retrieval scoring algorithm that considers:

- **Term frequency** — how often your search terms appear in a document
- **Inverse document frequency** — rarer terms contribute more to relevance
- **Document length normalization** — longer documents don't get unfair advantage

The search index applies English stemming (so "filing" matches "filed"), English stop-word removal, and case-insensitive matching.

### Result Deduplication

When the same filing matches in multiple sources (e.g. both the filing description and an attachment), only the **highest-scoring match** is shown. The "Source" column indicates where the best match came from:

| Source Label | What Matched |
|-------------|-------------|
| Filing | Filing description or brief description |
| Attachment | Extracted text or summary of a PDF attachment |
| Comment | A pleading/comment filed against the application |

### Snippet Highlighting

Each result includes a snippet showing the matching text with search terms highlighted in bold. Snippets are approximately 200 characters long, centered on the first occurrence of a matching term.

### Filtering Content Search

Content search results can be narrowed using the same filing filters (Subsystem, App Type, Status, Date Range, Company, Callsign, Applicant). Open the Filters panel to combine content search with structured filters.

### Sorting Content Search

By default, content search results are sorted by relevance score (highest first). You can also sort by File Number, Date Filed, Subsystem, Applicant, or Company Name.

### Search Modes

The search bar includes a mode selector:

- **Keyword** (active) — BM25 full-text search as described above
- **Semantic** (coming soon) — vector similarity search using embeddings
- **Hybrid** (coming soon) — combines keyword and semantic ranking

---

## Clicking a Result

Clicking any row in any search result table navigates to the detail page for that entity:

- Filing rows → Filing detail page (`/filings/:file_number`)
- Satellite rows → Satellite detail page (`/satellites/:space_station_key`)
- Earth station rows → Earth station detail page (`/earth-stations/:callsign`)

Content search results always navigate to the filing detail page.

---

## Rebuilding the Search Index

The full-text search index must be rebuilt after data ingestion. This happens automatically at the end of the attachment sync pipeline, or can be triggered manually:

```bash
make search-rebuild-index
```

This runs `./daily-orbit search rebuild-index`, which creates BM25 indexes on all three tables. The operation is idempotent — running it multiple times is safe and always produces a fresh index from the current data.

---

## API Reference

All search functionality is available via the REST API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/search/filings` | Browse filings with filters |
| `GET /api/search/satellites` | Browse satellites with filters |
| `GET /api/search/earth-stations` | Browse earth stations with filters |
| `GET /api/search/content` | Full-text content search |
| `GET /api/autocomplete/:entity/:field` | Type-ahead suggestions |

### Content Search Parameters

```
GET /api/search/content?q=spectrum+sharing&mode=keyword&page=1&pageSize=25
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `q` | Yes | Search query string |
| `mode` | No | `keyword` (default), `semantic`, or `hybrid` |
| `page` | No | Page number (default 1) |
| `pageSize` | No | Results per page (default 25) |
| `sort` | No | Sort column: `score`, `file_number`, `date_filed`, `subsystem_code`, `address_attention`, `company_name` |
| `order` | No | `asc` or `desc` (default: `desc` for score, `asc` otherwise) |
| `subsystem_code` | No | Comma-separated subsystem codes |
| `app_type_code` | No | Comma-separated application type codes |
| `status_code` | No | Comma-separated status codes |
| `date_filed_from` | No | Start date (YYYY-MM-DD) |
| `date_filed_to` | No | End date (YYYY-MM-DD) |
| `company` | No | Company name substring |
| `callsign` | No | Callsign substring |
| `applicant` | No | Applicant name substring |

### Content Search Response

```json
{
  "data": [
    {
      "file_number": "SAT-LOA-20240701-00011",
      "source": "attachment",
      "source_key": "12345",
      "score": 3.42,
      "snippet": "...proposed <mark>spectrum sharing</mark> arrangement between...",
      "callsign": "E040123",
      "address_attention": "HUGHES NETWORK SYSTEMS, LLC",
      "subsystem_code": "SAT",
      "app_type_code": "LOA",
      "status_code": "A",
      "date_filed": "2024-07-01",
      "company_name": "Hughes Network Systems"
    }
  ],
  "total": 142,
  "page": 1,
  "pageSize": 25
}
```
