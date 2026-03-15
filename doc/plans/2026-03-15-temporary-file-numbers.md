# Research: Temporary / Interim File Numbers

## Status: Not started

## Problem

The FCC accepts filings into IBFS/ICFS before assigning a permanent file number. During this period, the filing has an interim identifier with the format:

    {SUBSYSTEM}{APP_TYPE}INTR{YYYY}{SEQ}
    e.g. SESSTAINTR202503215

There are ~8,295 interim file numbers in the current database.

## Questions to answer

1. **Does the interim number eventually get replaced by a permanent one?** If so, can we track the mapping (interim → permanent)?

2. **Does ICFS expose interim filings?** Can we look up `SES-STA-INTR2025-03215` on the detail page? If so, does the response include the permanent number?

3. **Are interim filings visible in ICFS search results?** The discovery process currently filters out `DRAFT-` prefixed results but does not handle `INTR`.

4. **What is the typical lifecycle?** How long does a filing stay in interim status? Days? Weeks?

5. **Is this a data freshness concern?** If a filing transitions from interim → permanent, do we lose track of it? Do we end up with both an interim row and a permanent row for the same filing?

6. **What subsystems / app types use interim numbers most?** Initial data suggests SES-STA and FCN-NEW are heavy users.

## Approach

- Query ICFS detail pages for a sample of interim file numbers
- Check whether the response includes a cross-reference to a permanent number
- Search the XML bulk data for any interim → permanent mapping fields
- Review FCC documentation on the filing acceptance process
