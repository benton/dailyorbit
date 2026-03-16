# ServiceNow Attachment Download Gap

**Date:** 2026-03-15
**Updated:** 2026-03-16 (browser investigation of ICFS portal)
**Status:** Blocked — PDF attachments require FCC Okta SSO authentication

---

## Problem Summary

43,752 attachment records in the database have download URLs pointing to
`fccprod.servicenowservices.com` that return an HTML login page instead of
file content. These attachments span filings from the 1970s through 2026 and
include critical document types (applications, narratives, grants, schedule S
data). They represent **17% of all known attachments** and are completely
inaccessible through the current pipeline.

Browser testing on 2026-03-16 confirmed that **all PDF attachment downloads
on ICFS require FCC Okta SSO authentication**. There is no public download
path for these files.

---

## Current State (as of 2026-03-15)

| Metric                         | Count   |
|--------------------------------|---------|
| Total attachment records       | 256,939 |
| Successfully downloaded        | 209,460 |
| ServiceNow URLs (blocked)      | 43,752  |
| Other pending (relative URLs)  |     616 |
| Previously failed              |   3,111 |
| Text extracted from PDFs       |   5,835 |
| PDFs awaiting text extraction  | 129,139 |

---

## How Attachments Are Discovered

The fcc.report provider (`packages/server/src/attachments/fcc-report.ts`)
scrapes `https://fcc.report/IBFS/{fileNumber}` and parses two HTML tables:

1. **"Attachments" table** — application documents (source: `attachment`)
2. **"Files" table** — comments, letters, decisions (source: `file`)

Each table row yields a download URL. For most attachments, fcc.report hosts
the file directly and the URL looks like:

    https://fcc.report/IBFS/SAT-LOA-20050216-00040/418123.pdf

But for a subset of attachments, fcc.report links to FCC's ServiceNow
instance instead:

    https://fccprod.servicenowservices.com/sys_attachment.do?sys_id=73cc7e...

---

## How Downloads Work Today

The download pipeline (`packages/server/src/attachments/storage.ts`) issues a
plain `fetch(url)` with exponential-backoff retry. There is **no
authentication**: no cookies, no API keys, no session tokens.

- **fcc.report URLs**: work fine, return the binary file directly.
- **ServiceNow URLs**: return HTTP 200 with `Content-Length: 0` and
  `Set-Cookie` headers, followed by an HTML login page. The pipeline saves
  18 bytes of text reading "Invalid attachment".

---

## ICFS Portal Investigation (2026-03-16)

Browser testing with Playwright confirmed the following access model:

### Publicly accessible (no login)

| Content | Notes |
|---------|-------|
| ICFS home page, search, recent filings/notices | Full navigation works |
| Filing summary metadata (for *some* filings) | Via `?id=ibfs_application_summary&number={fileNumber}` navigated from home page |
| Filing Documents table (attachment list) | Metadata only — document names, descriptions, and download links are visible |
| EDOCS Public Notices | Full PDF + text at `docs.fcc.gov/public/attachments/DOC-{id}.{pdf,txt}` |

### Requires FCC Okta SSO authentication

| Content | Behavior |
|---------|----------|
| **PDF attachment downloads** (`sys_attachment.do?sys_id=...`) | Redirects to `fcc-ext.okta.com` SSO login page |
| **View Form** (full application form, `?id=app&sys_id=...`) | Redirects to Okta SSO |
| **Schedule B data** (technical parameters) | Page loads but API returns 401; shows "Failed to load Schedule" |
| **Older filing summaries** (accessed by sys_id) | "Application information isn't publicly available" |

### Key finding: EDOCS vs. ICFS

ICFS public notice links (e.g., `SAT-01982`) redirect to the FCC **EDOCS**
system at `fcc.gov/edocs`, where the Public Notice documents are available
as both PDF and plain text. However, these are **Public Notice documents**
(batch listings of filings accepted/acted upon), not the individual
per-filing attachments (Application.pdf, Narrative.pdf, Schedule S, etc.).

EDOCS URL pattern:

    https://docs.fcc.gov/public/attachments/DOC-{docId}A1.pdf
    https://docs.fcc.gov/public/attachments/DOC-{docId}A1.txt

---

## Affected Filings by Era

| Era                  | Filings |
|----------------------|---------|
| Pre-2010             |   2,299 |
| 2010 -- 2019         |   1,561 |
| 2020 -- 2023         |     746 |
| 2024 -- 2026 (ICFS)  |     641 |
| **Total**            | **5,247** |

This is **not** only an ICFS-era problem. The ServiceNow URLs appear across
all eras, suggesting that fcc.report delegates certain attachments to
ServiceNow regardless of when the filing was made.

4,062 of these 5,247 filings have at least some attachments that _were_
successfully downloaded via fcc.report, so it is a per-attachment issue, not a
per-filing issue.

---

## Affected Attachment Types

| Attachment Name          | Count |
|--------------------------|-------|
| Application.pdf          | 4,479 |
| HTML.htm                 | 4,428 |
| Schedule S GXT.txt       | 3,014 |
| Schedule S document.pdf  | 1,029 |
| Schedule S GXT.pdf       |   923 |
| STA Request.pdf          |   890 |
| Narrative.pdf            |   842 |
| letter.pdf               |   555 |
| Completed Schedule S.mdb |   533 |
| ex parte.pdf             |   488 |
| Sched S Tech Report.pdf  |   477 |
| Exhibit A.pdf            |   449 |
| Withdraw Receipt.htm     |   351 |
| Schedule S Tech Data.pdf |   329 |
| grant.pdf                |   324 |

These include the most important filing documents: the application itself, the
narrative, schedule S technical data, and regulatory orders.

---

## Subsystem Breakdown

Almost exclusively SAT filings:

| Subsystem | Attachments |
|-----------|-------------|
| SAT       |      43,705 |
| SES       |          47 |

---

## Other Pending (Non-ServiceNow)

616 attachments have relative or internal FCC URLs that cannot be fetched:

- `/ibfs?id=ibfs_schedule_b_edit&schedule_b=...` — interactive Schedule B
  forms, not downloadable as files (page loads but data requires auth).
- `/nav_to.do?uri=x_fmc_ibfs_sv3_satellite.do?sys_id=...` — ServiceNow
  navigation links (not direct file URLs).

These are not downloadable without authentication.

---

## Possible Strategies

### 1. FOIA Request
File a Freedom of Information Act request for bulk access to IBFS/ICFS
attachment data. The FCC is required to provide public records.
Pros: legally entitled to the data. Cons: slow (weeks to months).

### 2. FCC API / Data Feeds
Investigate whether the FCC provides a bulk data feed or API that includes
attachment binaries. The IBFS bulk XML feed provided metadata but not
binary attachments.

### 3. Alternative Sources
- **fcc.report** already mirrors most attachments; the 43k ServiceNow
  URLs are the ones fcc.report itself couldn't serve.
- **Internet Archive / Wayback Machine** may have historical snapshots
  of IBFS filing pages with working attachment links.
- **Google Cache** or other search engine caches may have indexed some
  of the PDF content.

### 4. Authenticated Access
If the application obtains FCC credentials (e.g., through a registered
ICFS account), the `sys_attachment.do` URLs would work. This would require
storing and managing FCC session tokens in the pipeline.

---

## Immediate Next Steps

- [x] Run `make attachments-extract` to extract text from the 129k
      already-downloaded PDFs (~3.5 hours)
- [x] Browser-test ICFS portal to determine public vs. auth-gated content
- [ ] Investigate FOIA or bulk data request options
- [ ] Check Internet Archive for historical IBFS attachment snapshots
- [ ] Evaluate whether authenticated ICFS access is feasible/appropriate
- [ ] Ingest EDOCS Public Notice documents (PDF + text) as a supplementary
      data source — these are publicly available and cover regulatory actions
