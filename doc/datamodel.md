# Data Model

## 1. Application

Represents an Application to the IBFS.

The following applications are available on IBFS for electronic filing:

- Space and Earth Station Applications:
  - Earth Station Authorizations – Form 312
  - Earth Station Special Temporary Authority
  - Space Station Authorizations – Form 312
  - Space Station Special Temporary Authority
  - Modifications of Authorization – Form 312
  - Amendments to Pending Applications – Form 312
  - Transfers of Control of License – Form 312
  - Assignments of License – Form 312
- International Accounting Rate Change Filings
- Submarine Cable Landing License Applications
- Requests for Assignment of Data Network Identification Codes
- Foreign Carrier Affiliation Notification Filings
- International Section 214 Applications
- International Section 214 Special Temporary Authority
- International Signaling Point Code Filings
- Recognized Operating Agency Filings
- Renewal of Radio License in Specific Services

Fields:

- File Number
- Report Number

### 1.1. Application File Number

The FCC assigns file numbers to electronic applications in order to facilitate processing.
The FCC only assigns file numbers for administrative convenience; they do not mean that an application is acceptable for filing.

IBFS uses a standard file number format for all processes handled in the International Bureau. The standard file number format is composed of four, hyphenated parts:

- Subsystem
- Application Type
- Date Filed (Year,Month,Day)
- Sequential File Number

Example: `SAT-LOA-20040701-00011`

#### 1.1.1. Subsystem

The IBFS system consists of 13 subsystems, each representing a specific service category. They are:

325 Section 325-C applications for permit to foreign broadcast (Part 73)
ARC Accounting Rate Changes filings (Part 63)
DNC Requests for assignment of a data network identification code (Part 64)
FCN IHF IPF ISP ITC SAT SCL SES Foreign Carrier Notification Filings (Part 64)
International HF Broadcast Applications (Part 73)
International Public Fixed Radio applications (Part 23)
International Special Projects filings (Part 63)
International Telecommunications Certificate (Part 63)
ROA Requests for Recognized Operating Agency status (Part 63)
Applications for satellite space station authorizations (Part 25)
Applications for Submarine Cable Landing licenses (Part 63)
Applications for Satellite Earth Station licenses or registration
(Part 25)
SPC Requests for assignment of an international Signalling Point Code
(Part 64)

#### 1.1.2. Application Type

3.  Application types are defined as follows:

214 Section 214 Authority
AMD Amendment to a pending application
A/O Authority to operate a satellite space station
ASG Assignment of License
C/P Construction Permit
DRZ Declaratory Ruling for Zoning
EXT Request for Extension of time to construct
ISP International Special Project (determined by the FCC)
ITC International Telecommunications
L/A Authority to launch a satellite space station
2
LFS Authority to access a non-U.S. satellite not currently authorized to
provide the proposed service in the proposed frequencies in the
United States
LIC License to operate
LOA Authority to launch and operate a satellite space station
LOI Letter of Intent to participate in a satellite space station processing
round
LPN Landing Points Notification
MSC Miscellaneous filing (determined by FCC)
MOD Modification to a current license, authorization or accounting rate
NDS Request for non-dominant status
NEW New application -- use only for the 325, DNC, FCN and ROA
subsystems
NOT Notification
PDR Petition for Declaratory Ruling
PPL Petition for Declaratory Ruling to be added to the Permitted List
REG Registration of a receive-only earth station
RPL Replacement Satellite Application - no new frequency bands
RWL Renewal of license or authorization
STA Request for Special Temporary Authority
TOA Request for Special Temporary Authority for the ISP, ITC and SCL
subsystems
T/C Transfer of Control
WAV Request for Waiver -- used only for the ISP, ITC, SAT and SCL
subsystems
WVZ Request for Waiver of the FCC zoning regulations; used only in SAT
subsystem.

#### 1.1.3 Official Date Filed

#### 1.1.4. Sequential File Number

A sequential number is assigned by the IBFS system to a filing within a subsystem. This number is an internal tracking number for use by the Bureau.

### 1.2. Application Report Number

Each ‘Accepted for Filing’ Public Notice has a report number. Below are examples of various types of applications and their corresponding report number (the ‘x’ represents a sequential number).

Type of Application: Report Number

325-C Applications: 325-xxxxx
Accounting Rate Change: ARC-xxxxx
Foreign Carrier Affiliation Notification: FCN-xxxxx
International High Frequency: IHF-xxxxx
International Public Fixed: IPF-xxxxx
Recognized Operating Agency: ROA-xxxxx
Satellite Space Station: SAT-xxxxx
Satellite Earth Station: SES-xxxxx
International Telecommunications
Streamlined: TEL-xxxxxS
Non-streamlined: TEL-xxxxxNS and/or DA
Submarine Cable Landing
Streamlined: SCL-xxxxxS
Non-streamlined: SCL-xxxxxNS and/or DA

---

## 2. Applicant

Fields:

- Name
- FCC Registration Number (FRN)

---

## 3. Attachment

Represents a binary file submitted as part of an Application or Comment.

---

## 4. Comment

---

## 5. Application Event

---

## 6. Company

Represents a real-world corporate entity that files applications with the FCC. A single Company may appear under many different applicant name strings in the filing dataset (see [Attribution Strategy](attribution-strategy.md) for details on how filings are attributed to Companies).

Fields:

- ID (UUID, primary key)
- Name (canonical display name, e.g., "Hughes Network Systems")
- Parent Company ID (optional foreign key to Company, for hierarchical corporate structures)
- LEI (optional, 20-character Legal Entity Identifier from the GLEIF registry)
- Wikidata QID (optional, e.g., "Q184581")
- Description (optional, brief description of the company and its role in the industry)
- Created At
- Updated At

### 6.1. Company Hierarchy

Companies may form parent-subsidiary trees. The `parent_company_id` field points to the immediate parent Company. The hierarchy is temporal: the current parent is stored on the Company record, while historical parent relationships are tracked through OwnershipEvent records (see section 8).

Examples:
- Hughes Network Systems -> EchoStar Corporation
- SES Americom -> SES S.A.
- O3b Limited -> SES S.A.

---

## 7. CompanyAlias

Maps an applicant name string (as it appears in FCC filings) to a Company entity. Each alias belongs to exactly one Company. A Company may have many aliases.

Fields:

- ID (UUID, primary key)
- Company ID (foreign key to Company)
- Alias (the applicant name string as it appears in filing data, e.g., "HUGHES NETWORK SYSTEMS, LLC")
- Source (how the alias was created: 'manual', 'frn_cluster', 'gleif', 'wikidata')
- Created At

### 7.1. Alias Uniqueness

Each alias string maps to exactly one Company. If the same legal name string has been used by genuinely different entities at different times, the conflict must be resolved manually (e.g., by qualifying the alias with additional context or choosing the most frequent association).

### 7.2. FRN-Derived Aliases

When FRN clustering (Tier 3 of the attribution algorithm) identifies a new name variant, the system may automatically create a CompanyAlias record with source = 'frn_cluster'. These aliases are flagged for admin review.

---

## 8. OwnershipEvent

Represents a point-in-time change in the ownership or control of a Company. OwnershipEvents are derived from FCC Transfer of Control (T/C) and Assignment (ASG) filings, GLEIF parent relationship records, Wikidata corporate parentage data, or manual admin entry. See [M&A Tracking Strategy](ma-tracking-strategy.md) for the full detection and enrichment workflow.

Fields:

- ID (UUID, primary key)
- Acquirer Company ID (foreign key to Company, the entity gaining control)
- Target Company ID (foreign key to Company, the entity being acquired or transferred)
- Event Type (one of: 'acquisition', 'divestiture', 'merger', 'transfer_of_control', 'assignment')
- Effective Date (the date the ownership change took effect)
- Source Type (one of: 'fcc_filing', 'gleif', 'wikidata', 'manual')
- Source Reference (the filing number, LEI, Wikidata QID, or admin note that supports this record)
- Notes (optional, free-text context about the event)
- Created At

### 8.1. Temporal Queries

The OwnershipEvent table enables point-in-time hierarchy reconstruction. To determine who owned a given Company on a specific date, query the most recent OwnershipEvent for that target Company with an effective date on or before the query date. The acquirer in that event is the Company's parent at that point in time.

### 8.2. Source Priority

When multiple sources report conflicting ownership for the same target and time period, the following priority order applies:

1. FCC filing (regulatory record of record)
2. GLEIF (audited financial registry)
3. Wikidata (community-maintained structured data)
4. Manual entry (admin-supplied, reviewed)

---
