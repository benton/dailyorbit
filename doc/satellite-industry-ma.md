# Satellite Industry M&A Context for LLM Inference

This document provides structured context about major mergers, acquisitions, and corporate reorganizations in the satellite communications industry. It is intended as a reference for LLM-assisted inference when resolving company relationships, attributing filings, and interpreting ownership changes in the FCC IBFS/ICFS dataset.

All information is drawn from publicly available sources including SEC filings, FCC public notices, and company press releases.

---

## 1. Major M&A Events

### 1.1. EchoStar / Hughes / DISH Consolidation

| Date | Event | Source |
|------|-------|--------|
| 2011-02 | DISH Network acquires DBSD North America (now EchoStar XXI) | FCC DA 11-332 |
| 2012-03 | DISH Network acquires TerreStar Networks spectrum assets | FCC DA 12-335 |
| 2017-02 | EchoStar Corporation merges with Hughes Network Systems (already a subsidiary since 2011 spin-off from DISH) | EchoStar 8-K, 2017-02-01 |
| 2024-01 | DISH Network and EchoStar Corporation complete re-merger, forming EchoStar Corporation as the surviving entity | EchoStar 8-K, 2024-01-02 |
| 2024-11 | DIRECTV terminates proposed acquisition of DISH DBS satellite TV business | DIRECTV press release, 2024-11-11 |

**Key name variants in IBFS data:** DISH Network, DISH Operating L.L.C., EchoStar Satellite Services L.L.C., EchoStar Corporation, Hughes Network Systems LLC, Hughes Communications Inc., DBSD North America Inc., TerreStar Networks Inc.

### 1.2. Intelsat Bankruptcy and Emergence

| Date | Event | Source |
|------|-------|--------|
| 2020-05 | Intelsat S.A. files Chapter 11 bankruptcy (SDNY Case 20-32299) | Intelsat 8-K, 2020-05-13 |
| 2022-02 | Intelsat emerges from Chapter 11 as a privately held company | Intelsat press release, 2022-02-23 |
| 2023-11 | SES S.A. announces agreement to acquire Intelsat for approximately $3.1 billion enterprise value | SES press release, 2023-11-01 |
| 2025-03 | SES and Intelsat announce regulatory approval for the combination | FCC DA 25-xxx (pending/expected) |

**Key name variants:** Intelsat S.A., Intelsat License LLC, Intelsat General Corporation, Intelsat North America LLC, PanAmSat Corporation, PanAmSat Licensee Corp.

### 1.3. SES / O3b / New Skies Acquisitions

| Date | Event | Source |
|------|-------|--------|
| 2006-03 | SES acquires New Skies Satellites N.V. | SES press release, 2006-03-01 |
| 2016-08 | SES completes acquisition of O3b Networks (initially acquired majority stake 2012) | SES Annual Report 2016 |
| 2023-11 | SES announces proposed acquisition of Intelsat (see 1.2 above) | SES press release, 2023-11-01 |

**Key name variants:** SES S.A., SES Americom Inc., SES Satellites (Gibraltar) Ltd., New Skies Satellites B.V., O3b Limited, O3b Networks Ltd., SES Government Solutions.

### 1.4. Eutelsat / OneWeb Merger

| Date | Event | Source |
|------|-------|--------|
| 2022-07 | Eutelsat Communications S.A. announces combination with OneWeb | Eutelsat press release, 2022-07-26 |
| 2023-09 | Eutelsat Group formed as combined entity, with Bharti Global and French state as key shareholders | Eutelsat 8-K equivalent (AMF filing), 2023-09-29 |

**Key name variants:** Eutelsat S.A., Eutelsat Communications, OneWeb Ltd., OneWeb Technologies Inc.

### 1.5. Viasat / Inmarsat Acquisition

| Date | Event | Source |
|------|-------|--------|
| 2021-11 | Viasat Inc. announces agreement to acquire Inmarsat plc for approximately $7.3 billion | Viasat 8-K, 2021-11-08 |
| 2023-05 | Viasat completes acquisition of Inmarsat | Viasat 8-K, 2023-05-30 |

**Key name variants:** Viasat Inc., ViaSat Inc., Inmarsat plc, Inmarsat Global Limited, Inmarsat Government Inc.

### 1.6. DIRECTV Spin-off from AT&T

| Date | Event | Source |
|------|-------|--------|
| 2015-07 | AT&T Inc. completes acquisition of DIRECTV | AT&T 8-K, 2015-07-24 |
| 2021-08 | AT&T spins off 70% of DIRECTV into a standalone company (AT&T retains 30%) | AT&T 8-K, 2021-08-02 |

**Key name variants:** DIRECTV LLC, DIRECTV Enterprises LLC, AT&T Inc., AT&T Services Inc.

### 1.7. Other Notable Transactions

| Date | Event | Source |
|------|-------|--------|
| 2007-01 | Loral Space & Communications acquires Telesat Canada (joint venture with PSP Investments) | Loral 8-K, 2007-10-31 |
| 2019-10 | Northrop Grumman completes acquisition of Orbital ATK (now Northrop Grumman Space Systems) | NG 10-K, 2019 |
| 2020-07 | Amazon/Kuiper Systems files initial FCC application for 3,236-satellite LEO constellation | FCC File No. SAT-LOA-20200721-00073 |
| 2021-07 | Boeing receives FCC approval for V-band NGSO constellation | FCC DA 21-883 |
| 2024-02 | Telesat completes financing for Lightspeed LEO constellation | Telesat press release, 2024-02-15 |

---

## 2. Key Company Hierarchies (as of 2025)

These hierarchies reflect the current parent-subsidiary relationships most relevant to FCC filings.

### EchoStar Corporation (post-DISH re-merger)
- DISH Network L.L.C.
- DISH Operating L.L.C.
- DISH DBS Corporation
- EchoStar Satellite Services L.L.C.
- Hughes Network Systems, LLC
- Hughes Satellite Systems Corporation

### SES S.A.
- SES Americom, Inc.
- SES Government Solutions
- O3b Limited
- New Skies Satellites B.V.
- Intelsat S.A. (acquisition pending/completed)
  - Intelsat License LLC
  - Intelsat General Corporation

### Viasat, Inc.
- Inmarsat Global Limited
- Inmarsat Government Inc.

### Eutelsat Group
- Eutelsat S.A.
- OneWeb Ltd.
- OneWeb Technologies Inc.

### Amazon.com, Inc.
- Kuiper Systems LLC

### SpaceX (Space Exploration Technologies Corp.)
- SpaceX Services, Inc. (Starlink operator)

### Telesat Canada
- Telesat Government Solutions Inc.

### Loral Space & Communications
- Telesat Canada (joint venture with PSP Investments)

---

## 3. Active Spectrum and Orbital Competition Dynamics

### 3.1. GEO vs. NGSO Conflict

The satellite industry's most significant competitive dynamic is the tension between incumbent GEO operators and emerging NGSO (non-geostationary orbit) constellations. Key fronts:

- **Ku/Ka-band sharing**: NGSO systems (Starlink, OneWeb, Kuiper) must coordinate with incumbent GEO operators under ITU Radio Regulations Article 22. Disputes over interference criteria and EPFD limits drive many FCC proceedings.
- **V-band**: Next-generation spectrum frontier with filings from SES, Boeing, SpaceX, Amazon, and Telesat competing for allocations.
- **12 GHz proceeding**: DISH/EchoStar vs. SpaceX/Starlink dispute over whether terrestrial 5G service should share the 12.2-12.7 GHz band currently used by DBS satellites. (FCC WT Docket No. 20-443)

### 3.2. LEO Mega-Constellation Race

Active or planned NGSO broadband constellations with FCC authorizations or pending applications:

| Operator | Constellation | Approximate Satellites | Status |
|----------|--------------|----------------------|--------|
| SpaceX | Starlink (Gen1 + Gen2) | 12,000+ authorized, 42,000 requested | Operational, expanding |
| Amazon | Kuiper | 3,236 authorized | First launches 2024-2025 |
| OneWeb (Eutelsat) | OneWeb | 648 authorized | Initial constellation complete |
| Telesat | Lightspeed | 198 authorized | Under construction |
| SES | O3b mPOWER | 11 MEO satellites | Operational |

### 3.3. C-band Clearing and Reallocation

The FCC's C-band Order (FCC 20-22) required satellite operators to clear the 3.7-3.98 GHz band for 5G terrestrial use, with accelerated clearing incentive payments totaling $9.7 billion. Key beneficiaries: Intelsat (~$4.87B), SES (~$3.97B), Eutelsat (~$507M), Telesat (~$344M).

---

## 4. Inference Guidelines

When using this document for company relationship inference:

1. **Name variants are common.** A single company may file under its parent name, subsidiary name, a "doing business as" name, or a prior legal name. The filing date relative to M&A events determines which entity is the correct parent.
2. **Temporal context matters.** Hughes Network Systems filings before 2011 are associated with Hughes Communications Inc. (independent). After 2011 they are associated with EchoStar. After 2024, they are associated with the re-merged EchoStar/DISH entity.
3. **FRN continuity.** FCC Registration Numbers (FRNs) generally persist across ownership changes. A T/C filing transfers control of an existing license and its associated FRN, so the same FRN may appear under different corporate parents at different times.
4. **Transfer filings are signals.** Application types T/C (Transfer of Control) and ASG (Assignment of License) directly indicate ownership changes and should be used to infer parent-subsidiary relationship transitions.
