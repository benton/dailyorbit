# Filing Attribution Strategy

How Daily Orbit attributes FCC filings to the companies that filed them.

---

## 1. The Problem

The FCC IBFS/ICFS dataset contains **142,926 filings** from **25,603 distinct applicant names**. These names are free-text fields entered by filers over more than two decades, resulting in significant variation. A single company may appear under dozens of name variants:

| Company | Distinct Name Variants | Examples |
|---------|----------------------|----------|
| Hughes | 23 | Hughes Network Systems LLC, Hughes Network Systems, Ltd., HUGHES NETWORK SYSTEMS, LLC, Hughes Communications Inc., HNS License Sub, LLC |
| EchoStar | 19 | EchoStar Satellite Services L.L.C., ECHOSTAR SATELLITE OPERATING CORPORATION, EchoStar Corporation, Echostar 77 Corporation |
| Intelsat | 17 | Intelsat License LLC, INTELSAT LICENSE LLC, Intelsat North America LLC, PanAmSat Licensee Corp., Intelsat General Corporation |

Without attribution, the application cannot answer basic questions like "How many filings does Hughes have?" or "Show me all of Intelsat's pending applications."

---

## 2. The Company Entity

Daily Orbit introduces a **Company** entity that represents a single real-world organization, regardless of how many name variants it has used in FCC filings. Each Company has:

- A canonical display name (e.g., "Hughes Network Systems")
- One or more **aliases** that map applicant name strings to the Company
- An optional parent Company, supporting hierarchical corporate structures
- An optional LEI (Legal Entity Identifier) for cross-referencing with GLEIF data
- An optional Wikidata QID for enrichment

---

## 3. Three-Tier Attribution Algorithm

Attribution is the process of linking each filing's applicant name to a Company entity. The algorithm applies three matching tiers in order of specificity and confidence.

### Tier 1: Exact Alias Match

```
SELECT c.id
FROM company_alias a
JOIN company c ON c.id = a.company_id
WHERE a.alias = filing.applicant_name
```

The highest-confidence match. If a filing's applicant name exactly matches a known alias string, the filing is attributed to that Company. This handles the most common name variants for well-known companies.

**Confidence: High** -- No ambiguity. An exact string match against a curated alias.

### Tier 2: Case-Insensitive Match

```
SELECT c.id
FROM company_alias a
JOIN company c ON c.id = a.company_id
WHERE a.alias ILIKE filing.applicant_name
```

Many name variants differ only in capitalization (e.g., "HUGHES NETWORK SYSTEMS, LLC" vs. "Hughes Network Systems, LLC"). Case-insensitive matching captures these without requiring separate alias entries for every capitalization pattern.

**Confidence: High** -- Capitalization differences in legal entity names do not indicate different entities.

### Tier 3: FRN Clustering

```
SELECT DISTINCT c.id
FROM filing f2
JOIN company_alias a ON a.alias = f2.applicant_name
JOIN company c ON c.id = a.company_id
WHERE f2.frn = filing.frn
  AND f2.frn IS NOT NULL
```

If a filing's applicant name has no alias match, but the filing's **FCC Registration Number (FRN)** matches other filings that *are* attributed to a Company, the filing is attributed to that same Company.

**Rationale:** The FCC assigns each registrant a unique FRN. If a legal entity files under different name strings but the same FRN, those filings belong to the same entity. This captures name variants that were not anticipated when aliases were created.

**Confidence: Medium** -- FRN reuse is a strong signal of entity identity, but FRNs can occasionally be reassigned after corporate restructuring. Results should be reviewed.

---

## 4. Coverage Projections

The filing dataset follows a heavy power-law distribution: a small number of companies account for a disproportionate share of all filings.

| Seed Companies | Estimated Aliases | Projected Filing Coverage |
|---------------|------------------|--------------------------|
| 10 | ~150 | ~15% of all filings |
| 30 | ~400 | ~30% of all filings |
| 50 | ~600 | ~40% of all filings |
| 100 | ~1,000 | ~55% of all filings |

Seeding approximately **30 to 50 companies** with their known aliases should cover more than **30% of the total filing corpus** -- and the most strategically relevant 30% at that, since the largest filers are the major satellite operators.

FRN clustering (Tier 3) is expected to add an additional 5-10% coverage on top of alias matching alone, by pulling in name variants that were not explicitly catalogued.

---

## 5. Handling the Long Tail

The remaining ~20,000+ applicant names belong to smaller entities: law firms filing on behalf of clients, one-time applicants, foreign administrations, and defunct companies. Strategies for the long tail:

### 5.1. Admin UI for Manual Alias Addition

Administrators can review unattributed filings and add new aliases through the admin interface. The workflow:

1. View a ranked list of unattributed applicant names, sorted by filing count
2. Search for an existing Company or create a new one
3. Add the applicant name as an alias for that Company
4. All matching filings are immediately re-attributed

### 5.2. Suggested Aliases

The system can suggest probable alias matches using string similarity (trigram distance, Levenshtein distance) between unattributed names and existing Company names. An administrator reviews and approves suggestions.

### 5.3. Bulk Import

For initial seeding, aliases can be bulk-imported from a CSV or JSON file mapping applicant name strings to canonical company names.

---

## 6. Attribution Refresh

Attribution is not a one-time operation. It must be refreshed when:

- New filings are ingested (new applicant names may appear)
- New aliases are added (previously unattributed filings become attributed)
- Company hierarchies change (parent reassignment may affect rollup counts)

The attribution process is idempotent and designed to run incrementally. Only filings without a current attribution -- or filings whose applicant name matches a newly added alias -- are re-evaluated.

---

## 7. Data Integrity Constraints

- Each alias string maps to exactly one Company. If the same legal name is used by different entities (rare but possible), the alias must be qualified or the conflict resolved manually.
- A Company may have zero filings attributed to it (e.g., a holding company that never files directly).
- Deleting a Company cascades to its aliases and clears attribution from affected filings.
- FRN clustering is applied only when the FRN maps to a single Company. If an FRN is associated with filings attributed to multiple Companies (indicating a data quality issue), Tier 3 matching is skipped for that FRN and the conflict is flagged for manual review.
