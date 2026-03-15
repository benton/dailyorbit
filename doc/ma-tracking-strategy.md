# M&A Tracking Strategy

How Daily Orbit detects and tracks ownership changes in the satellite communications industry.

---

## 1. Overview

Ownership of satellite licenses changes frequently through mergers, acquisitions, and corporate reorganizations. Each change is reflected in FCC filings, public financial data, and corporate registry records. Daily Orbit combines these sources to maintain a temporal model of who owns what and when ownership changed.

The system draws on four data sources, ranked by reliability:

| Priority | Source | Signal Type | Confidence |
|----------|--------|-------------|------------|
| 1 | FCC Transfer/Assignment filings | Direct regulatory record of ownership change | Highest |
| 2 | GLEIF LEI registry | Legal entity hierarchy and parent relationships | High |
| 3 | Wikidata structured data | Corporate parentage, subsidiaries, stock listings | Medium |
| 4 | LLM-assisted inference | Contextual matching using industry knowledge | Low (requires review) |

---

## 2. FCC Transfer and Assignment Filings

### 2.1. Detection

Two FCC application types directly represent ownership changes:

- **T/C (Transfer of Control):** The licensee entity remains the same, but its controlling interest changes hands. Example: Company A acquires a majority stake in Company B, which holds the license.
- **ASG (Assignment of License):** The license itself is transferred from one entity to another. Example: Company A sells a satellite license to Company B.

These filings are identified by filtering the filing dataset:

```sql
SELECT *
FROM filing
WHERE app_type_code IN ('T/C', 'ASG')
ORDER BY date_filed DESC
```

### 2.2. Party Matching

Each T/C or ASG filing identifies the parties involved:

- **Transferor / Assignor:** The entity relinquishing control or the license
- **Transferee / Assignee:** The entity gaining control or the license

These party names are matched to Company entities using the same four-tier attribution algorithm described in the [Attribution Strategy](attribution-strategy.md). When a match is found for both parties, the system records an **OwnershipEvent** linking the two Companies with a timestamp derived from the filing's grant date (or filed date if not yet granted).

### 2.3. Filing Attachment Analysis

Transfer and assignment filings typically include narrative attachments describing the transaction: the parties, the licenses being transferred, the business rationale, and any conditions. These attachments are processed through full-text extraction and can be summarized by LLM to extract structured transaction details when the filing metadata alone is insufficient.

---

## 3. GLEIF LEI Enrichment

### 3.1. What is LEI?

The Legal Entity Identifier (LEI) is a 20-character alphanumeric code that uniquely identifies legal entities participating in financial transactions. The Global Legal Entity Identifier Foundation (GLEIF) maintains the public LEI registry.

### 3.2. Relevant Data Points

GLEIF Level 1 and Level 2 data provide:

- **Entity legal name and registered address** -- useful for alias discovery
- **Direct parent relationship** -- the immediate parent entity
- **Ultimate parent relationship** -- the top-level controlling entity
- **Relationship status and dates** -- when parent relationships were established or terminated

### 3.3. Integration Approach

For each Company entity with a known LEI:

1. Query the GLEIF API (`https://api.gleif.org/api/v1/lei-records/{lei}`)
2. Extract direct and ultimate parent LEIs
3. Match parent LEIs to existing Company entities (or create new ones)
4. Record parent-subsidiary relationships with effective dates from the GLEIF relationship record

GLEIF data is refreshed periodically (weekly or on-demand) since LEI records are updated when corporate structures change.

### 3.4. Limitations

- Not all satellite companies have LEIs (LEI registration is primarily driven by financial regulation, not FCC licensing)
- GLEIF parent relationships reflect the current state; historical relationships require querying the relationship history endpoint
- Some complex structures (joint ventures, trusts) may not be fully represented

---

## 4. Wikidata Enrichment

### 4.1. Relevant Properties

Wikidata provides structured corporate relationship data through the following properties:

| Property | Label | Description |
|----------|-------|-------------|
| P749 | Parent organization | The immediate parent company |
| P355 | Subsidiaries | Child companies |
| P414 | Stock exchange | Where the company's shares are traded |
| P249 | Ticker symbol | The company's stock ticker |
| P571 | Inception date | When the company was founded |
| P576 | Dissolved/abolished date | When the company ceased to exist |
| P1365 | Replaces | Predecessor entity |
| P1366 | Replaced by | Successor entity |

### 4.2. SPARQL Query Approach

Company hierarchies are retrieved via the Wikidata Query Service. Example query for a company's parent chain and subsidiaries:

```sparql
SELECT ?company ?companyLabel ?parent ?parentLabel ?subsidiary ?subsidiaryLabel WHERE {
  VALUES ?company { wd:Q184581 }  # Example: Intelsat
  OPTIONAL { ?company wdt:P749 ?parent . }
  OPTIONAL { ?subsidiary wdt:P749 ?company . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
```

For stock exchange and ticker data:

```sparql
SELECT ?company ?companyLabel ?exchange ?exchangeLabel ?ticker WHERE {
  VALUES ?company { wd:Q184581 }
  OPTIONAL { ?company wdt:P414 ?exchange . }
  OPTIONAL { ?company wdt:P249 ?ticker . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
```

### 4.3. Matching Wikidata Entities to Companies

Companies are matched to Wikidata entities (QIDs) through:

1. **Stored QID:** If a Company record already has a `wikidata_qid`, use it directly.
2. **Name search:** Query the Wikidata search API with the Company's canonical name and verify the result entity has relevant properties (e.g., is classified as a satellite operator, telecommunications company, or similar).
3. **LEI cross-reference:** Wikidata property P1278 stores LEI codes, enabling direct matching for companies that have both an LEI and a Wikidata entry.

### 4.4. Limitations

- Wikidata is community-maintained; data may be incomplete, outdated, or occasionally incorrect
- Temporal qualifier support is inconsistent (some parent relationships lack start/end dates)
- Rate limits on the Wikidata Query Service require batching and caching

---

## 5. Temporal Hierarchy Modeling

### 5.1. The Core Challenge

Company hierarchies are not static. A subsidiary today may have been independent five years ago, or owned by a different parent. The system must answer questions like:

- "Who owned Hughes Network Systems in 2015?" (Answer: EchoStar Corporation)
- "Who owned Hughes Network Systems in 2024?" (Answer: EchoStar Corporation, post-DISH re-merger)
- "When did SES acquire O3b?" (Answer: majority stake 2012, full acquisition 2016)

### 5.2. Data Model

Ownership is modeled as a series of **OwnershipEvent** records, each representing a point-in-time change:

```
OwnershipEvent {
  id:               UUID
  acquirer_id:      Company.id     -- the entity gaining control
  target_id:        Company.id     -- the entity being acquired or transferred
  event_type:       ENUM('acquisition', 'divestiture', 'merger', 'transfer_of_control', 'assignment')
  effective_date:   DATE           -- when the change took effect
  source_type:      ENUM('fcc_filing', 'gleif', 'wikidata', 'manual')
  source_reference: TEXT           -- filing number, LEI, QID, or admin note
  notes:            TEXT           -- optional context
}
```

### 5.3. Deriving the Hierarchy at a Point in Time

To reconstruct who owned whom on a given date, the system walks the OwnershipEvent timeline:

1. Start with all Companies
2. For each Company, find the most recent OwnershipEvent where it is the `target_id` and the `effective_date` is on or before the query date
3. That event's `acquirer_id` is the Company's parent at that point in time
4. Recurse upward to find the ultimate parent

This approach naturally handles chains of ownership (A acquires B, then C acquires A) and corporate restructurings.

### 5.4. Conflict Resolution

When multiple sources disagree on ownership:

| Conflict | Resolution |
|----------|------------|
| FCC filing vs. Wikidata | FCC filing takes precedence (regulatory record of record) |
| GLEIF vs. Wikidata | GLEIF takes precedence (audited registry) |
| Multiple FCC filings for same target on same date | Review manually; flag for admin attention |
| Source says parent, but no FCC transfer filing exists | Record the relationship with lower confidence; it may represent a foreign transaction not requiring FCC approval |

---

## 6. Data Source Reliability Ranking

Each data source has distinct strengths and weaknesses for ownership tracking:

### 6.1. FCC Filings (Highest Reliability)

**Strengths:**
- Authoritative regulatory record; ownership changes affecting FCC licenses *must* be filed
- Contains specific license and party details
- Timestamped with official filing and grant dates

**Weaknesses:**
- Only captures changes affecting FCC-licensed assets (not all corporate M&A)
- Party names may not match canonical company names without alias resolution
- Pending filings may not yet reflect completed transactions

### 6.2. GLEIF LEI (High Reliability)

**Strengths:**
- Standardized, audited data maintained by accredited Local Operating Units
- Global coverage including non-US entities
- Direct and ultimate parent relationships with effective dates

**Weaknesses:**
- Coverage gaps for privately held companies and smaller entities
- Reflects current state more reliably than historical state
- Relationship records may lag real-world changes by weeks or months

### 6.3. Wikidata (Medium Reliability)

**Strengths:**
- Broad coverage including historical entities and predecessor relationships
- Rich structured data (stock tickers, founding dates, dissolution dates)
- Free and openly accessible

**Weaknesses:**
- Community-maintained; not audited
- Temporal qualifiers may be missing or imprecise
- Occasional errors or vandalism (mitigated by checking against other sources)

### 6.4. LLM-Assisted Inference (Low Reliability)

**Strengths:**
- Can synthesize information from unstructured text (filing attachments, news articles)
- Useful for bootstrapping initial company hierarchies from industry knowledge

**Weaknesses:**
- Requires human review before data is committed
- May hallucinate relationships that do not exist
- Cannot be cited as an authoritative source

---

## 7. Implementation Workflow

### Phase 1: FCC Filing Scan
1. Query all T/C and ASG filings from the dataset
2. Match transferor/transferee names to Company entities
3. Create OwnershipEvent records for each matched pair

### Phase 2: GLEIF Enrichment
1. For Companies with known LEIs, fetch GLEIF relationship data
2. Create or update parent-subsidiary relationships
3. Record OwnershipEvents with source_type = 'gleif'

### Phase 3: Wikidata Enrichment
1. For Companies with known QIDs (or discoverable via search), fetch P749/P355 relationships
2. Cross-reference with existing OwnershipEvents to fill gaps
3. Add stock exchange and ticker metadata

### Phase 4: Admin Review
1. Surface unresolved conflicts and low-confidence inferences
2. Provide admin UI for confirming, correcting, or rejecting proposed relationships
3. Mark reviewed records as manually verified
