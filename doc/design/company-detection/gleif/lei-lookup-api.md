# GLEIF LEI Lookup API

REST API for searching and retrieving individual LEI records. Free, no auth required.

## Base URL

```
https://api.gleif.org/api/v1
```

Full docs: https://api.gleif.org/docs (redirects to Postman collection)

## Key Endpoints

### Search LEI Records

```
GET /lei-records?filter[entity.legalName]=SpaceX
GET /lei-records?filter[entity.legalName]=Space%20Exploration&page[size]=50
```

### Get by LEI

```
GET /lei-records/{lei}
```

### Fuzzy Name Search

```
GET /fuzzycompletions?field=entity.legalName&q=spacex
```

### Search by Jurisdiction

```
GET /lei-records?filter[entity.jurisdiction]=US-DE
```

### Relationship Data

```
GET /lei-records/{lei}/direct-parent
GET /lei-records/{lei}/ultimate-parent
GET /lei-records/{lei}/direct-children
```

### Mapped Identifiers (BIC, ISIN)

```
GET /lei-records?filter[bic]={bic_code}
```

## Key Features

- **Fuzzy matching** on names and addresses
- **Full-text search** across all fields
- **Single-field filters** (name, jurisdiction, registration authority, status, etc.)
- **Relationship traversal** (parent/child/ultimate parent)
- **Pagination**: up to 200 records per request
- **JSON:API** response format

## Response Format (JSON:API)

```json
{
  "data": [
    {
      "type": "lei-records",
      "id": "5493001KJTIIGC8Y1R12",
      "attributes": {
        "lei": "5493001KJTIIGC8Y1R12",
        "entity": {
          "legalName": { "name": "SPACE EXPLORATION TECHNOLOGIES CORP.", "language": "en" },
          "otherNames": [...],
          "legalAddress": { ... },
          "headquartersAddress": { ... },
          "registeredAt": { "id": "RA000598" },
          "registeredAs": "4232738",
          "jurisdiction": "US-DE",
          "category": "GENERAL",
          "legalForm": { "id": "8888", "other": "LLC" },
          "status": "ACTIVE",
          "creationDate": "2014-03-06T00:00:00.000Z"
        },
        "registration": { ... }
      },
      "relationships": {
        "direct-parent": { ... },
        "ultimate-parent": { ... }
      }
    }
  ],
  "meta": { "pagination": { "currentPage": 1, "perPage": 10, "total": 1 } }
}
```

## Use in Company Detection

The lookup API is useful for:
- **Validation**: confirm a candidate match from bulk data
- **Real-time enrichment**: look up an entity on-demand during filing ingestion
- **Relationship exploration**: once we have a match, trace ownership chains

For bulk matching (our primary use case), the Golden Copy CSV is more appropriate.
The API is better for spot-checks and interactive exploration.
