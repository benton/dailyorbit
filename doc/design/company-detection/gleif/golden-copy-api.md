# GLEIF Golden Copy Download API

The Golden Copy files are the authoritative, deduplicated snapshots of the entire
global LEI dataset. No authentication or API key required.

## Discovery Endpoint

```
GET https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest
```

Returns JSON listing all available files with direct download URLs.

To request a specific date:

```
GET https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/{YYYYMMDD}-{HHMM}
```

## Update Schedule

Three snapshots published daily at:
- 02:00 UTC
- 10:00 UTC
- 18:00 UTC

## Response Structure

```json
{
  "data": {
    "publish_date": "2026-04-05 16:00:00",
    "lei2": {
      "full_file": {
        "csv": { "url": "...", "size_human_readable": "454.88 MB", "record_count": 3271451 },
        "json": { "url": "...", "size_human_readable": "874.77 MB", "record_count": 3271451 },
        "xml": { "url": "...", "size_human_readable": "842.14 MB", "record_count": 3271451 }
      },
      "delta_files": {
        "IntraDay": { "csv": { "url": "..." }, "json": { "url": "..." }, "xml": { "url": "..." } },
        "LastDay":  { "csv": { "url": "..." }, "json": { "url": "..." }, "xml": { "url": "..." } },
        "LastWeek": { "csv": { "url": "..." }, "json": { "url": "..." }, "xml": { "url": "..." } },
        "LastMonth":{ "csv": { "url": "..." }, "json": { "url": "..." }, "xml": { "url": "..." } }
      }
    },
    "rr": { /* same structure */ },
    "repex": { /* same structure */ }
  }
}
```

## File URL Pattern

```
https://goldencopy.gleif.org/storage/golden-copy-files/{YYYY}/{MM}/{DD}/{id}/{timestamp}-gleif-goldencopy-{type}-{variant}.{format}.zip
```

Where:
- `type`: `lei2`, `rr`, `repex`
- `variant`: `golden-copy`, `intra-day`, `last-day`, `last-week`, `last-month`
- `format`: `csv`, `json`, `xml`

All files are zip-compressed.

## Delta Files

Each snapshot includes delta files showing only changes since:

| Delta       | Window    | Typical CSV Size (LEI2) |
|-------------|-----------|------------------------|
| IntraDay    | ~8 hours  | ~80 KB                 |
| LastDay     | ~24 hours | ~568 KB                |
| LastWeek    | ~7 days   | ~6.3 MB                |
| LastMonth   | ~31 days  | ~30.7 MB               |

For the PoC, we fetch the full golden copy once, then use delta files for updates.

## Example: Fetch Latest CSV URLs

```bash
curl -s https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest \
  | jq '{
      lei2: .data.lei2.full_file.csv.url,
      rr: .data.rr.full_file.csv.url,
      repex: .data.repex.full_file.csv.url
    }'
```

## Size Summary (as of 2026-04-05)

| Dataset | Records   | CSV (zipped) | JSON (zipped) | XML (zipped) |
|---------|-----------|-------------|---------------|-------------|
| LEI2    | 3,271,451 | 455 MB      | 875 MB        | 842 MB      |
| RR      | 469,000   | 22 MB       | 32 MB         | 30 MB       |
| REPEX   | 6,020,000 | 56 MB       | 58 MB         | 62 MB       |

CSV is the smallest and easiest to load into DuckDB. Total download: ~533 MB compressed.
