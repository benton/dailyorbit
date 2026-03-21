# FCC Filing System History

## IBFS (International Bureau Filing System)

The original FCC filing system for international and satellite services. This project's scraper was built to ingest data from IBFS bulk data feeds.

**Status:** Frozen / Legacy as of June 2025.

## Migration to ICFS (International Communications Filing System)

On **June 24, 2025**, the FCC completed the migration from IBFS to ICFS, a new cloud-based filing platform built on ServiceNow. A filing blackout period ran from June 18–23, 2025 during the cutover.

- The last filing in the IBFS dataset is dated **2025-06-18**
- All new filings since 2025-06-24 are submitted through ICFS

### ICFS Resources

- Portal: https://fccprod.servicenowservices.com/icfs
- User Guide: https://www.fcc.gov/sites/default/files/ICFS-User-Guide.pdf
- Help Line: 202-418-2222 / ICFSINFO@fcc.gov
- FCC Announcement: https://www.fcc.gov/international-affairs/upgraded-international-communications-filing-system-icfs-preview

## Government Shutdown (Oct–Nov 2025)

A government shutdown ran from **October 1 through November 13, 2025**. During this period:

- The FCC furloughed over 81% of its workforce
- ICFS and other FCC systems were taken offline
- Systems came back online around November 18, 2025
- Filing deadlines were extended for filings due during the shutdown

## Data Sources

### 1. IBFS FTP Bulk Data (Current Pipeline Source)

- **URL:** `ftp://ftp.fcc.gov/pub/Bureaus/International/databases/IBFS.zip`
- **Format:** Pipe-delimited `.dat` files with Sybase DDL schema, 67+ tables
- **Status: Frozen.** Last filing dated 2025-06-18. No new data since ICFS migration.

### 2. fcc.report Mirror

- **URL:** `https://fcc.report/IBFS/`
- **Format:** HTML pages per filing, with attachment links; RSS feed available
- **Status: Stale since June 2023.** The mirror stopped ingesting IBFS data ~2 years before the ICFS migration. RSS feed last build date is June 14, 2023.

### 3. FCC Open Data (Socrata)

- **URL:** `https://opendata.fcc.gov/resource/78n9-wprc`
- **Format:** Not a tabular dataset — just a metadata/link page pointing to the FTP bulk data
- **Status: Not usable.** Returns "Non-tabular datasets do not support rows requests" via SODA API. Metadata last updated May 2017.

### 4. ICFS ServiceNow Portal (New System)

- **URL:** `https://fccprod.servicenowservices.com/icfs`
- **Format:** ServiceNow Government Cloud portal; no official public API
- **Status: Active.** All new filings since 2025-06-24 go through ICFS.
- **App scope:** `x_fmc_ibfs`
- **Portal ID:** `6865628b1bd2625069c154e2604bcbf2`
- **Notes:** `robots.txt` disallows all crawlers. No official API documentation. FCC help available at ICFSInfo@fcc.gov. Public comment docket: GN Docket No. 25-194.

#### 4.1 ICFS Search API (confirmed working, unauthenticated)

```
POST /api/now/sp/search
Content-Type: application/json

{
  "query": "SAT-LOA-2025",
  "portal": "6865628b1bd2625069c154e2604bcbf2",
  "source": "ibfs-search-applications",
  "count": 200
}
```

**Confirmed behavior (March 2026):**

- No auth required — works with plain HTTP POST
- `count` parameter works up to at least 200; server caps at some upper bound
- `start` parameter exists but does **not** offset results (pagination is broken or not supported)
- `include_facets: true` returns facet data (dict keyed by source, but observed empty)
- `total_number_results` always returns `0` even when results are present
- `pagination_supported` returns `true` but actual offset pagination does not work

**Search sources:**

- `ibfs-search-applications` — **works**, returns filings from `x_fmc_ibfs_base_table`
- `ibfs-search-all` — returns 0 results for targeted queries (may need different query format)
- `ibfs-search-pns` — returns 0 results (public notices; may require different query terms)
- `ibfs-search-pac` — returns 0 results (pleadings/comments)
- `ibfs-search-callsigns`, `ibfs-search-frns` — untested

**Result schema (per item):**

```json
{
  "sys_id": "0e294fa41bdea6104c2b877ae54bcb6f",
  "__search_source_id__": "ibfs-search-applications",
  "table_fields": ["number", "call_sign", "applicant_name", "submission_date"],
  "label": "SAT-LOA-20250221-00050",
  "fields": [
    { "display_value": "ICEYE US, Inc.", "label": "Applicant Name" },
    { "display_value": "SAT", "label": "Subsystem" }
  ],
  "url": "?id=ibfs_application_summary&number=SAT-LOA-20250221-00050",
  "table": "x_fmc_ibfs_base_table"
}
```

**Limitations:**

- Results are sparse — only file number, applicant name, subsystem (no dates, status, or attachments)
- Useful for **enumeration** (discovering file numbers) but not for detail ingestion
- Query is text-search based: `SAT-LOA-2025` matches file numbers containing that substring; `SpaceX` matches applicant names
- Tested `SAT-LOA-2025` → 67 results; covers all SAT-LOA filings from 2025

#### 4.2 ICFS Filing Detail via SP Page API (confirmed working, unauthenticated)

```
GET /api/now/sp/page?id=ibfs_application_summary&portal_id=6865628b1bd2625069c154e2604bcbf2&number={file_number}
```

**Confirmed behavior (March 2026):**

- No auth required — returns full filing detail as JSON
- Data is in `result.containers[2].rows[0].columns[0].widgets[0].widget.data`
- `data.found` indicates whether the filing exists
- `data.summary` contains 41 fields with `{ display_value, label }` pairs
- `data.record_id` is the ServiceNow `sys_id` for the filing record
- `data.tabs.data.widgets` contains tabbed sub-data (documents, pleadings, etc.)

**Filing summary fields (41 fields):**

```
accepted_pn_da_number, action_pn_da_number, action_pn_date, action_taken_date,
adopted_date, afpn_date, applicant_city, applicant_country, applicant_frn,
applicant_frns, applicant_name, applicant_state, applicant_street,
applicant_street_2, applicant_zip_code, begin_date, brief_application_description,
call_sign, contact_city, contact_country, contact_frn, contact_frns, contact_name,
contact_state, contact_street, contact_street_2, contact_zip_code, da_number,
environmental_impact, expiration_date, grant_date, last_action, legacy_filing_key,
nature_of_service, number, red_light_status, release_date, state, status_date,
streamlined, submission_date
```

**Tab widgets:**

- **Filing Documents** — `fields_array: [sys_created_on, document_name, u_description, actions]`
  - Contains attachment metadata with `sys_id` and download links
  - Schedule S links point to `x_fmc_ibfs_sv3_satellite` table records
  - Attachment download URL pattern: `/sys_attachment.do?sys_id={attachment_sys_id}`
- **Pleadings & Comments** — `fields_array: [number, pleading_type, sys_created_on, filer_name, extra_pac_descriptions_list, extra_exhibit_attachment_list]`
  - Contains inline HTML `<a>` tags with direct attachment download URLs
- **Tab 2** (empty in tested filings)
- **Tab 3** (empty in tested filings)

**Key observations:**

- `legacy_filing_key` is populated for pre-ICFS filings (e.g., `-1,499,997,387`) but empty for new ICFS-native filings
- `publicly_available` is `false` for all tested filings (may just mean "not on public notice yet")
- Old IBFS filings (pre-2004) return `found: false` for some records

#### 4.3 ICFS Attachment Downloads (require authentication)

- **URL:** `/sys_attachment.do?sys_id={sys_id}`
- **Status:** Redirects to login page (302 → `auth_redirect.do`) without a session
- Attachments require an authenticated ServiceNow session (JSESSIONID + g_ck token)

#### 4.4 Standard Table API (requires authentication)

- **URL:** `/api/now/table/x_fmc_ibfs_base_table`
- **Status:** Returns 401 — requires authenticated user

## FCC Budget Context

The FCC's budget has been held flat at $390.2 million since FY 2024 (effectively a cut after inflation). Staffing is at its lowest modern level (1,404 FTEs, down from 1,478). Despite DOGE scrutiny in late 2025, Congress rejected most proposed spending cuts and the FCC remains fully operational for filing purposes.
