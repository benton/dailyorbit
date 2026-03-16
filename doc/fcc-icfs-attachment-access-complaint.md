# Formal Comment Regarding Public Access to ICFS Filing Attachments

**Filed in:** GN Docket No. 25-194 (ICFS Modernization)

**Date:** March 15, 2026

**To:** Space Bureau and Office of International Affairs, Federal Communications Commission

---

## Summary

The new International Communications Filing System (ICFS), launched June 24, 2025, does not provide public access to filing attachment documents. Attachment download links on the ICFS public portal redirect to an Okta single sign-on page requiring FCC credentials, effectively placing approximately 43,000 public-record documents behind a login wall.

## Background

ICFS contains "applications, supporting documents, pleadings, comments, public notices, Commission actions, and final authorizations" for services regulated by the Space Bureau and the Office of International Affairs (DA 25-510). The Commission's own Public Access to Applications & Associated Public Records page lists ICFS as one of the systems through which the public may access filed documents.

The predecessor system (IBFS) served these same documents without authentication. Third-party mirrors such as fcc.report were able to retrieve and republish these attachment files to improve public access, consistent with the Commission's transparency obligations.

## The Problem

Each filing detail page on the public ICFS portal (e.g., `fccprod.servicenowservices.com/ibfs?id=ibfs_application_summary&number=SAT-MOD-20240103-00004`) displays a "Filing Documents" table with "Download" links for each attachment. These links point to the ServiceNow `sys_attachment.do` endpoint. Clicking any such link, or fetching it programmatically, results in a redirect to `fcc-ext.okta.com`, which presents a SAML authentication challenge requiring an FCC username and password.

No public-facing alternative download path is provided.

## Scope of Impact

An analysis of the ICFS attachment corpus reveals:

| Metric | Count |
|---|---|
| Total attachment records | 256,939 |
| Attachments with `sys_attachment.do` URLs (inaccessible) | 43,755 |
| Affected filings | 5,248 |
| Affected filings with zero publicly accessible attachments | 1,186 |

The affected documents include core filing materials: applications, narratives, Schedule S technical data, grants, and regulatory orders. The affected filings span all eras from the 1970s through 2026 and are overwhelmingly in the SAT subsystem (43,705 of 43,755).

## Legal Basis for Public Access

Under 47 C.F.R. Part 1, Subpart Y, the International Communications Filing System is the Commission's designated repository for public filings in international and satellite services. These filings are submitted to the public record and are not subject to confidentiality treatment absent a specific request and grant of such treatment. Requiring authentication to download publicly filed documents is inconsistent with the Commission's obligations under the Freedom of Information Act, the E-Government Act of 2002, and its own Open Government directives.

## Requested Action

1. Configure the ICFS `sys_attachment.do` endpoint to serve publicly filed attachment documents without requiring authentication.
2. Until the above is resolved, provide an alternative public download endpoint or API through the ICFS Service Portal that does not require a login.
3. Confirm that the public accessibility of filing attachments is a design requirement for ICFS, not merely an unintended omission.

## Contact

Inquiries regarding this comment may be directed to the filing party at the address on record.

---

*Filed electronically via ECFS in GN Docket No. 25-194.*
