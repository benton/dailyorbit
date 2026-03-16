# ServiceNow Attachment Download Gap

**Date:** 2026-03-15
**Status:** Investigation needed

---

## Problem Summary

43,752 attachment records in the database have download URLs pointing to
`fccprod.servicenowservices.com` that return an HTML login page instead of
file content. These attachments span filings from the 1970s through 2026 and
include critical document types (applications, narratives, grants, schedule S
data). They represent **17% of all known attachments** and are completely
inaccessible through the current pipeline.

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
  forms, not downloadable as files.
- `/nav_to.do?uri=x_fmc_ibfs_sv3_satellite.do?sys_id=...` — ServiceNow
  navigation links (not direct file URLs).

These are likely not downloadable in any straightforward way.

---

## Questions for Deep Dive

1. **Is there a public ServiceNow API for these attachments?**
   The ICFS portal (`/ibfs`) is unauthenticated and uses portal API
   endpoints. Does the portal expose an attachment download endpoint that
   works without a session?

2. **Can we get a session cookie from the public portal?**
   The `sys_attachment.do` endpoint sets `JSESSIONID` and `BIGipServer`
   cookies. Perhaps establishing a session through the public portal first
   would allow attachment downloads.

3. **Does fcc.report have an API or bulk download option?**
   If fcc.report is sourcing these files from ServiceNow, perhaps there is
   an alternative URL pattern on fcc.report that serves the same content.

4. **Are these the same files accessible through ICFS search results?**
   The ICFS search API returns filing detail pages. Do those detail pages
   include working attachment download links?

5. **Is there a rate limit or IP block in play?**
   The "Invalid attachment" response may be access-control rather than
   authentication — worth testing from different networks or with different
   user-agent strings.

---

## Immediate Next Steps

- [ ] Run `make attachments-extract` to extract text from the 129k already-downloaded PDFs (~3.5 hours)
- [ ] Investigate ServiceNow attachment access (deep dive)
- [ ] Determine whether ICFS portal API provides alternative download paths
- [ ] Test `sys_attachment.do` with session cookies obtained from the portal
