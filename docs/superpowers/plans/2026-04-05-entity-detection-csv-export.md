# Entity Detection CSV Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a CSV (one row per attachment with a summary) and a JSON data dictionary for offline entity detection research.

**Architecture:** A shell script runs a DuckDB `COPY` query against the production database, then writes a companion JSON schema file. No TypeScript code needed.

**Tech Stack:** DuckDB CLI, shell script

**Spec:** `docs/superpowers/specs/2026-04-05-entity-detection-csv-export-design.md`

---

### Task 1: Create the export script

**Files:**
- Create: `scripts/export-entity-detection-csv.sh`

- [ ] **Step 1: Create the script**

Write `scripts/export-entity-detection-csv.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="$PROJECT_DIR/data/daily-orbit.duckdb"
EXPORT_DIR="$PROJECT_DIR/data/exports"
CSV_PATH="$EXPORT_DIR/entity-detection-export.csv"
SCHEMA_PATH="$EXPORT_DIR/entity-detection-export.schema.json"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$EXPORT_DIR"

echo "Exporting entity detection CSV from $DB_PATH ..."

duckdb "$DB_PATH" "
COPY (
  SELECT f.file_number,
         a.attachment_key,
         f.address_attention,
         f.applicant_frn,
         f.applicant_street,
         f.applicant_city,
         f.applicant_state,
         f.applicant_zip_code,
         f.applicant_country,
         f.signer_name,
         f.contact_attention,
         f.transferor_name,
         f.transferee_name,
         f.subsystem_code,
         f.app_type_code,
         f.date_filed,
         f.company_id,
         c.name AS company_name,
         a.summary
  FROM attachment a
  JOIN filing f ON a.file_number = f.file_number
  LEFT JOIN company c ON c.id = f.company_id
  WHERE a.summary IS NOT NULL
  ORDER BY f.file_number, a.attachment_key
) TO '$CSV_PATH'
  WITH (HEADER, DELIMITER ',');
"

# Get accurate row count from DuckDB (wc -l fails on embedded newlines)
ROW_COUNT=$(duckdb "$DB_PATH" -noheader -list \
  "SELECT COUNT(*) FROM attachment a JOIN filing f ON a.file_number = f.file_number WHERE a.summary IS NOT NULL;")
FILE_SIZE=$(du -h "$CSV_PATH" | cut -f1)

echo "Exported $ROW_COUNT rows to $CSV_PATH ($FILE_SIZE)"

# Write JSON data dictionary
cat > "$SCHEMA_PATH" <<SCHEMA_EOF
{
  "export_date": "$(date +%Y-%m-%d)",
  "row_count": $ROW_COUNT,
  "description": "One row per attachment with a text summary, joined to its parent filing and any attributed company. Intended for entity detection research.",
  "columns": [
    {
      "name": "file_number",
      "position": 1,
      "type": "VARCHAR",
      "nullable": false,
      "description": "FCC-assigned filing identifier (e.g. SAT-LOA-20230614-00142)",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "attachment_key",
      "position": 2,
      "type": "INTEGER",
      "nullable": false,
      "description": "Unique attachment identifier within the database",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "address_attention",
      "position": 3,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Applicant name as filed — the primary signal for company identity. Typically a legal entity name (e.g. 'Hughes Network Systems, LLC'). May contain person names for individual filers.",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "applicant_frn",
      "position": 4,
      "type": "VARCHAR",
      "nullable": true,
      "description": "FCC Registration Number — a numeric ID assigned to the filing entity. Strong clustering key: all filings by the same FRN are the same legal entity.",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "applicant_street",
      "position": 5,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Applicant mailing address — street line",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "applicant_city",
      "position": 6,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Applicant mailing address — city",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "applicant_state",
      "position": 7,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Applicant mailing address — US state code (e.g. 'CA', 'TX')",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "applicant_zip_code",
      "position": 8,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Applicant mailing address — ZIP or postal code",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "applicant_country",
      "position": 9,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Applicant mailing address — country (often blank for US filers)",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "signer_name",
      "position": 10,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Name of the person who signed the filing. Useful for person-to-organization linking.",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "contact_attention",
      "position": 11,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Contact person or firm name. Often a law firm or regulatory agent, not the applicant company itself.",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "transferor_name",
      "position": 12,
      "type": "VARCHAR",
      "nullable": true,
      "description": "For transfer-of-control (T/C) and assignment (ASG) filings: the selling/transferring party name. NULL for non-transfer filings.",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "transferee_name",
      "position": 13,
      "type": "VARCHAR",
      "nullable": true,
      "description": "For transfer-of-control (T/C) and assignment (ASG) filings: the buying/receiving party name. NULL for non-transfer filings.",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "subsystem_code",
      "position": 14,
      "type": "VARCHAR",
      "nullable": false,
      "description": "FCC filing subsystem: SAT (satellite), SES (earth station), CAB (cable), etc.",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "app_type_code",
      "position": 15,
      "type": "VARCHAR",
      "nullable": false,
      "description": "Application type: LOA (launch/operate authority), MOD (modification), T/C (transfer of control), RWL (renewal), STA (special temporary authority), etc.",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "date_filed",
      "position": 16,
      "type": "TIMESTAMP",
      "nullable": true,
      "description": "Date the filing was submitted to the FCC",
      "provenance": "FCC IBFS/ICFS bulk data"
    },
    {
      "name": "company_id",
      "position": 17,
      "type": "INTEGER",
      "nullable": true,
      "description": "Foreign key to the company table. Produced by automated alias-based attribution — NOT human-verified. ~45% of filings have a value; the rest are NULL (unattributed).",
      "provenance": "machine-generated: alias-based attribution"
    },
    {
      "name": "company_name",
      "position": 18,
      "type": "VARCHAR",
      "nullable": true,
      "description": "Canonical company name from the company table. NULL when company_id is NULL.",
      "provenance": "machine-generated: alias-based attribution"
    },
    {
      "name": "summary",
      "position": 19,
      "type": "VARCHAR",
      "nullable": false,
      "description": "LLM-generated text summary of the attachment content.",
      "provenance": "machine-generated: LLM summarization"
    }
  ]
}
SCHEMA_EOF

echo "Schema written to $SCHEMA_PATH"
echo "Done."
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/export-entity-detection-csv.sh
```

- [ ] **Step 3: Run the export**

```bash
./scripts/export-entity-detection-csv.sh
```

Expected:
```
Exporting entity detection CSV from data/daily-orbit.duckdb ...
Exported 259321 rows to data/exports/entity-detection-export.csv (XXXM)
Schema written to data/exports/entity-detection-export.schema.json
Done.
```

- [ ] **Step 4: Verify the output**

```bash
# CSV header has all 19 columns
head -1 data/exports/entity-detection-export.csv

# JSON schema is valid and has correct column count
python3 -c "import json; d=json.load(open('data/exports/entity-detection-export.schema.json')); print(f'{d[\"row_count\"]} rows, {len(d[\"columns\"])} columns')"

# Quick DuckDB round-trip test
duckdb -c "SELECT COUNT(*) as rows, COUNT(DISTINCT file_number) as filings FROM 'data/exports/entity-detection-export.csv'"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/export-entity-detection-csv.sh doc/design/company-detection/
git commit -m "feat(export): add entity detection CSV export script and research sources"
```
