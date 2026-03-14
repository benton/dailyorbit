# ICFS → DuckDB Field Mapping

Comparison of ICFS SP Page API fields against the existing DuckDB `filing` table schema
(sourced from IBFS bulk data). Generated 2026-03-14.

## Mapping: ICFS Summary → DuckDB filing

| DuckDB Column | Type | ICFS Field | ICFS Label | Notes |
|---|---|---|---|---|
| `filing_key` | INTEGER | `legacy_filing_key` | Legacy Filing Key | Populated for pre-ICFS filings only. Empty for new filings. Formatted with commas (e.g., `-1,499,997,387`). New filings need a synthetic key. |
| `file_number` | VARCHAR | `number` | File Number | Direct match. ICFS also includes `DRAFT-` prefixed numbers. |
| `subsystem_code` | VARCHAR | _(derived from file_number)_ | — | Not a separate ICFS field; parse from file number prefix (e.g., `SAT`, `SES`). |
| `app_type_code` | VARCHAR | _(derived from file_number)_ | — | Not a separate ICFS field; parse from file number (e.g., `LOA`, `MOD`, `STA`). |
| `callsign` | VARCHAR | `call_sign` | Call Sign | Direct match. |
| `status_code` | VARCHAR | `state` | Application Status | Values differ: ICFS uses display names like "Current", "Pending Review" vs. IBFS 5-char codes. Needs mapping table. |
| `status_date` | TIMESTAMP | `status_date` | Status Date | ICFS returns date string `YYYY-MM-DD`. |
| `last_action` | VARCHAR | `last_action` | Last Action | ICFS display value may differ from IBFS 3-char codes. |
| `last_action_date` | TIMESTAMP | `action_taken_date` | Last Action Date | |
| `date_filed` | TIMESTAMP | `submission_date` | Date Filed | ICFS returns `YYYY-MM-DD HH:MM:SS`. |
| `date_grant` | TIMESTAMP | `grant_date` | Grant Date | |
| `date_begin` | TIMESTAMP | `begin_date` | Term Begin Date | |
| `date_expire` | TIMESTAMP | `expiration_date` | Term End Date | |
| `aff_pub_notice_date` | TIMESTAMP | `afpn_date` | Accepted for Filing PN Date | ICFS also provides URL to FCC PN search. |
| `act_pub_notice_date` | TIMESTAMP | `action_pn_date` | Actions Taken PN Date | ICFS also provides URL to FCC PN search. |
| `description` | VARCHAR | `brief_application_description` | Brief Application Description | |
| `address_key` | INTEGER | — | — | ICFS has inline address fields, no separate key. |
| `address_attention` | VARCHAR | `applicant_name` | Applicant Name | |
| `address_phone_num` | VARCHAR | — | — | Not in ICFS summary response. |
| `address_e_mail` | VARCHAR | — | — | Not in ICFS summary response. |
| `contact_key` | INTEGER | — | — | No separate key in ICFS. |
| `contact_attention` | VARCHAR | `contact_name` | Contact Name | |
| `contact_phone_num` | VARCHAR | — | — | Not in ICFS summary response. |
| `contact_e_mail` | VARCHAR | — | — | Not in ICFS summary response. |
| `signer_name` | VARCHAR | — | — | Not in ICFS summary. |
| `signer_title` | VARCHAR | — | — | Not in ICFS summary. |
| `date_signed` | TIMESTAMP | — | — | Not in ICFS summary. |
| `filing_state` | TINYINT | — | — | Not in ICFS. |
| `mts_number` | INTEGER | — | — | Not in ICFS. |
| `mellon_date` | TIMESTAMP | — | — | Not in ICFS. |
| `date_deny` | TIMESTAMP | — | — | Not directly available. May be inferrable from `state`. |
| `date_dismiss` | TIMESTAMP | — | — | Not directly available. |
| `date_surrender` | TIMESTAMP | — | — | Not directly available. |
| `date_last_update` | TIMESTAMP | — | — | Not in ICFS summary. Could use `status_date`. |
| `submission_id` | VARCHAR | — | — | Not in ICFS. |
| `fee_control_number` | VARCHAR | — | — | Not in ICFS. |

## New fields available from ICFS (not in current DuckDB schema)

| ICFS Field | Label | Value Example | Notes |
|---|---|---|---|
| `record_id` (sys_id) | — | `0e294fa41bdea6104c2b877ae54bcb6f` | ServiceNow record ID. Useful as a stable identifier for the record. |
| `da_number` | DA Number | `25-346` | FCC Designation & Authorization number. |
| `applicant_frn` | Applicant FRN | `0030543268` | FCC Registration Number — links to applicant entity. |
| `applicant_city` | Applicant City | `Irvine` | |
| `applicant_state` | Applicant State | `CA` | |
| `applicant_street` | Applicant Street Address | `70 Discovery` | |
| `applicant_zip_code` | Applicant Zip Code | `92618-` | |
| `applicant_country` | — | _(often empty)_ | |
| `contact_city` | Contact City | `Washington` | |
| `contact_state` | Contact State | `DC` | |
| `contact_street` | Contact Street Address | `555 Thirteenth Street NW` | |
| `contact_zip_code` | Contact Zip Code | `20004` | |
| `red_light_status` | Red Light Status | `No` | Indicates unpaid debts to FCC. |
| `environmental_impact` | 9. Environmental Impact | `No` | |
| `streamlined` | Streamlined | _(often empty)_ | |
| `nature_of_service` | 5e. Nature of Service | _(often empty)_ | |
| `adopted_date` | Adopted Date | | |
| `release_date` | Release Date | | |
| `accepted_pn_da_number` | Accepted PN DA Number | | |
| `action_pn_da_number` | Action PN DA Number | | |
| `applicant_frns` | — | _(list?)_ | Multiple FRNs. |
| `contact_frn` | Contact FRN | | |
| `contact_frns` | — | | |

## Coverage Assessment

### Well-covered by ICFS (direct or close mapping)
- Core filing identifiers: file_number, callsign, subsystem, app_type
- Key dates: date_filed, grant_date, status_date, begin/expire dates, PN dates
- Applicant info: name, FRN, full address
- Contact info: name, full address
- Status: application status, last action
- Description

### Missing from ICFS (available only in IBFS bulk data)
- `filing_key` (integer primary key) — ICFS uses `sys_id` UUIDs instead
- `filing_state` (tinyint)
- `mts_number`
- Phone numbers and email addresses
- Signer information (name, title, date)
- `submission_id`, `fee_control_number`
- `date_deny`, `date_dismiss`, `date_surrender` (specific denial/dismissal dates)
- Various keyword and blocking fields

### New from ICFS (not in IBFS bulk data)
- `applicant_frn` — FCC Registration Number (critical for entity linking)
- `da_number` — DA/FCC number for orders
- `red_light_status` — payment compliance flag
- `environmental_impact` — environmental review status
- Full applicant and contact addresses (street, city, state, zip)
- Rich attachment metadata including `sys_id` identifiers
- Inline pleadings/comments with attachment links

## Recommendations for Pipeline Adaptation

1. **Primary key strategy**: For new ICFS-native filings, generate synthetic `filing_key` values (e.g., negative auto-increment or hash-based) since `legacy_filing_key` is empty. Store `sys_id` as a new column for ICFS record cross-referencing.

2. **Status code mapping**: Build a lookup table mapping ICFS display values ("Current", "Pending Review", "Granted", etc.) to IBFS 5-character status codes, or migrate to using the display values directly.

3. **Two-phase ingestion**:
   - Phase 1 (Search API): Enumerate new file numbers by querying `{subsystem}-{type}-{YYYYMM}` patterns
   - Phase 2 (SP Page API): Fetch full detail for each discovered filing

4. **Attachment handling**: Attachments require authenticated sessions. The SP Page API provides attachment metadata (names, descriptions, sys_ids) without auth, but downloading the actual files needs session cookies. This is a separate concern from filing metadata ingestion.

5. **Schema additions**: Add columns for `sys_id`, `applicant_frn`, `da_number`, and address fields to take advantage of ICFS data richness.
