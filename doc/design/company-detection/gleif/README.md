# GLEIF Data Reference

Technical reference for using GLEIF (Global Legal Entity Identifier Foundation) data
in the Daily Orbit company detection pipeline.

## Contents

- [golden-copy-api.md](golden-copy-api.md) - Bulk data download API (no auth required)
- [lei-lookup-api.md](lei-lookup-api.md) - REST API for individual LEI lookups
- [data-files.md](data-files.md) - File types, formats, and field reference
- [supporting-documents.md](supporting-documents.md) - Links to official specs, schemas, and samples

## Why GLEIF?

GLEIF maintains the authoritative global registry of Legal Entity Identifiers (LEIs).
Their data provides:

- **Level 1 (Who is Who)**: 3.27M legal entities with names, addresses, registration
  details, legal form, status, and geocoordinates
- **Level 2 (Who Owns Whom)**: 469K parent-child relationship records
- **Reporting Exceptions**: 6M records explaining why ownership data is unavailable

This is our **source of truth** for matching FCC filing entities to canonical legal
entities. The data is free, updated 3x daily, and available in CSV/JSON/XML.

## Relevance to Company Detection

The company detection algorithm needs to resolve messy entity names from FCC filings
(e.g. "SPACEX SERVICES INC", "Space Exploration Technologies Corp dba SpaceX") to
canonical company records. GLEIF provides:

1. Canonical legal names and trade names (aliases)
2. Jurisdiction and registration authority codes
3. Legal addresses and HQ addresses (with geocoordinates)
4. Corporate ownership chains
5. Entity status (active, inactive, merged, etc.)

The LEI-CDF CSV (~455MB compressed) is small enough to load into DuckDB for
fuzzy matching against our filing entity names.
