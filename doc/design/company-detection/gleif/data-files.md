# GLEIF Data File Reference

## Three Data Sets

### Level 1: LEI-CDF 3.1 (lei2) — "Who is Who"

The primary dataset. Each row is a legal entity with an LEI.

**Key fields for company detection:**

| Field | Description | Example |
|-------|-------------|---------|
| LEI | 20-char alphanumeric identifier | `5493001KJTIIGC8Y1R12` |
| Entity.LegalName | Official registered name | `SPACE EXPLORATION TECHNOLOGIES CORP.` |
| Entity.OtherEntityNames | Trade names, aliases | `SpaceX` |
| Entity.LegalAddress.* | Registered address (street, city, region, country, postal) | |
| Entity.HeadquartersAddress.* | HQ address (may differ from legal) | |
| Entity.LegalAddress.Geocoding.* | Latitude/longitude for legal address | |
| Entity.HeadquartersAddress.Geocoding.* | Latitude/longitude for HQ | |
| Entity.RegistrationAuthority.RegistrationAuthorityID | Authority code (e.g. RA000602 = US-SEC) | |
| Entity.RegistrationAuthority.RegistrationAuthorityEntityID | Entity's ID at the authority | |
| Entity.LegalJurisdiction | ISO 3166-1/2 code | `US-DE` |
| Entity.EntityCategory | GENERAL, BRANCH, FUND, SOLE_PROPRIETOR | |
| Entity.LegalForm.EntityLegalFormCode | ELF code (ISO 20275) | |
| Entity.EntityStatus | ACTIVE, INACTIVE | |
| Entity.EntityCreationDate | When the entity was created | |
| Registration.RegistrationStatus | ISSUED, LAPSED, RETIRED, etc. | |
| Registration.ManagingLOU | LEI of the issuing organization | |

**~3.27M records, ~455 MB CSV compressed** (as of 2026-04-05)

### Level 2: RR-CDF 2.1 (rr) — "Who Owns Whom"

Relationship records linking child entities to parent entities.

**Key fields:**

| Field | Description |
|-------|-------------|
| Relationship.StartNode.NodeID | LEI of the child entity |
| Relationship.EndNode.NodeID | LEI of the parent entity |
| Relationship.RelationshipType | IS_DIRECTLY_CONSOLIDATED_BY, IS_ULTIMATELY_CONSOLIDATED_BY, IS_INTERNATIONAL_BRANCH_OF, IS_FUND_MANAGED_BY, IS_FEEDER_FUND, IS_SUBFUND |
| Relationship.RelationshipStatus | ACTIVE, INACTIVE |
| Relationship.RelationshipPeriods | Start/end dates, accounting standard |

**~469K records, ~22 MB CSV compressed**

### Level 2: Reporting Exceptions (repex)

Explains why relationship data is missing for an entity.

**Exception reasons:**
- `NO_KNOWN_PERSON` — no natural person(s) control the entity
- `NON_CONSOLIDATING` — legal entity not subject to consolidation
- `NO_LEI` — parent exists but doesn't have an LEI
- `NATURAL_PERSONS` — controlled by natural person(s)
- `NON_PUBLIC` — information not publicly available
- `BINDING_LEGAL_OBLIGATIONS` — contractual/legal restrictions

**~6M records, ~56 MB CSV compressed**

## Data Quality Notes

- Golden Copy files are **deduplicated** — each LEI appears exactly once
- LEI records include entities from **all jurisdictions worldwide**
- Entity names are in the **official language of registration** (with transliterations)
- `OtherEntityNames` includes trade names, previous names, and transliterations
- Geocoordinates are enriched by GLEIF (not from the original registration)
- Satellite/telecom companies registered in the US will typically have `LegalJurisdiction` = `US-*`

## Format Versions

| Dataset | CDF Version | Schema |
|---------|-------------|--------|
| LEI records | LEI-CDF 3.1 | [lei-cdf-v3.1.xsd](https://www.gleif.org/en/about-lei/common-data-file-format/current-versions) |
| Relationships | RR-CDF 2.1 | [rr-cdf-v2.1.xsd](https://www.gleif.org/en/about-lei/common-data-file-format/current-versions) |
| Exceptions | RepEx 2.1 | [repex-cdf-v2.1.xsd](https://www.gleif.org/en/about-lei/common-data-file-format/current-versions) |
