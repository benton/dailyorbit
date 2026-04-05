# Entity Detection CSV Export

## Goal

Export a CSV and JSON data dictionary for a data scientist to develop company entity detection algorithms using Pandas/DuckDB/Python notebooks. Once they find good approaches, the algorithms will be back-ported into the Daily Orbit ingestion pipeline.

## Background

- 143K filings total; 95 seed companies with 391 hand-curated aliases drive current attribution
- Current `attributeFiling()` uses a 3-tier lookup: exact alias match on `address_attention`, case-insensitive match, then FRN clustering
- Result: 45% attributed (64,556), 55% unattributed (78,536)
- 259K attachments have text summaries
- 63K filings have at least one attachment with a summary
- 25,570 distinct `address_attention` values; 16,600 distinct FRNs

## Output Files

Two files in `data/exports/`:

1. `entity-detection-export.csv` — one row per attachment with a summary (~259K rows)
2. `entity-detection-export.schema.json` — data dictionary describing every column

## CSV Column Layout

| # | Column | Type | Nullable | Source | Purpose |
|---|--------|------|----------|--------|---------|
| 1 | `file_number` | VARCHAR | No | `filing.file_number` | FCC-assigned filing ID (e.g. `SAT-LOA-20230614-00142`) |
| 2 | `attachment_key` | INTEGER | No | `attachment.attachment_key` | Unique attachment ID |
| 3 | `address_attention` | VARCHAR | Yes | `filing.address_attention` | Primary company name signal — the applicant name as filed |
| 4 | `applicant_frn` | VARCHAR | Yes | `filing.applicant_frn` | FCC Registration Number — strong clustering key |
| 5 | `applicant_street` | VARCHAR | Yes | `filing.applicant_street` | Mailing address |
| 6 | `applicant_city` | VARCHAR | Yes | `filing.applicant_city` | |
| 7 | `applicant_state` | VARCHAR | Yes | `filing.applicant_state` | |
| 8 | `applicant_zip_code` | VARCHAR | Yes | `filing.applicant_zip_code` | |
| 9 | `applicant_country` | VARCHAR | Yes | `filing.applicant_country` | |
| 10 | `signer_name` | VARCHAR | Yes | `filing.signer_name` | Person who signed — useful for person-to-org linking |
| 11 | `contact_attention` | VARCHAR | Yes | `filing.contact_attention` | Contact name (often a law firm or agent) |
| 12 | `transferor_name` | VARCHAR | Yes | `filing.transferor_name` | For T/C filings — the selling party |
| 13 | `transferee_name` | VARCHAR | Yes | `filing.transferee_name` | For T/C filings — the buying party |
| 14 | `subsystem_code` | VARCHAR | No | `filing.subsystem_code` | Filing category (SAT, SES, etc.) |
| 15 | `app_type_code` | VARCHAR | No | `filing.app_type_code` | Application type (LOA, MOD, T/C, etc.) |
| 16 | `date_filed` | TIMESTAMP | Yes | `filing.date_filed` | When filed |
| 17 | `company_id` | INTEGER | Yes | `filing.company_id` | Existing automated attribution |
| 18 | `company_name` | VARCHAR | Yes | `company.name` | Resolved company name |
| 19 | `summary` | VARCHAR | No | `attachment.summary` | Text summary of the attachment |

## JSON Data Dictionary

Machine-readable schema file with an entry per column:

```json
{
  "export_date": "2026-04-05",
  "row_count": 259321,
  "description": "One row per attachment with a text summary, joined to its parent filing and any attributed company.",
  "columns": [
    {
      "name": "file_number",
      "position": 1,
      "type": "VARCHAR",
      "nullable": false,
      "description": "FCC-assigned filing identifier (e.g. SAT-LOA-20230614-00142)",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    ...
  ]
}
```

The `provenance` field distinguishes:
- `"FCC IBFS/ICFS bulk data"` — human-generated FCC data
- `"machine-generated: alias-based attribution"` — for `company_id` and `company_name`
- `"machine-generated: LLM summarization"` — for `summary`

## Implementation

A short TypeScript script (or shell wrapper) that:

1. Runs a DuckDB `COPY` query to produce the CSV
2. Writes the JSON data dictionary with actual row count
3. Reports file size and row count

### SQL Query

```sql
COPY (
  SELECT f.file_number, a.attachment_key,
         f.address_attention, f.applicant_frn,
         f.applicant_street, f.applicant_city, f.applicant_state,
         f.applicant_zip_code, f.applicant_country,
         f.signer_name, f.contact_attention,
         f.transferor_name, f.transferee_name,
         f.subsystem_code, f.app_type_code, f.date_filed,
         f.company_id, c.name AS company_name,
         a.summary
  FROM attachment a
  JOIN filing f ON a.file_number = f.file_number
  LEFT JOIN company c ON c.id = f.company_id
  WHERE a.summary IS NOT NULL
  ORDER BY f.file_number, a.attachment_key
) TO 'data/exports/entity-detection-export.csv'
  WITH (HEADER, DELIMITER ',');
```

## Intended Usage

The data scientist loads the CSV in Python:

```python
import duckdb
con = duckdb.connect()
df = con.sql("FROM 'entity-detection-export.csv'").df()
```

Or for large-memory-constrained environments:

```python
import duckdb
con = duckdb.connect()
con.sql("CREATE TABLE filings AS FROM 'entity-detection-export.csv'")
# Query in-place without loading into memory
```

Key entity detection techniques to explore:
- String similarity (Levenshtein, Jaro-Winkler, cosine) on `address_attention`
- Blocking by `applicant_frn`, address, or `subsystem_code`
- Clustering via transitive closure
- Libraries: Splink, recordlinkage, EMM
