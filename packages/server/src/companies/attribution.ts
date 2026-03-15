import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { Company, CompanySeedEntry } from './types.ts';
import { addAlias, createCompany, getCompanyByAlias } from './repository.ts';

/**
 * Attribute a single filing to a company using four-tier matching:
 * 1. Exact alias match
 * 2. Case-insensitive alias match
 * 3. Prefix alias match — address_attention starts with a prefix alias
 * 4. FRN clustering — inherit company_id from another filing with the same FRN
 *
 * Returns the company_id if matched, or null if no match found.
 */
export async function attributeFiling(
  conn: DuckDBConnection,
  addressName: string | null,
  applicantFrn: string | null,
): Promise<number | null> {
  if (addressName == null || addressName.trim() === '') {
    // Try FRN clustering only
    if (applicantFrn != null && applicantFrn.trim() !== '') {
      return clusterByFrn(conn, applicantFrn);
    }
    return null;
  }

  // Tier 1 + 2: alias lookup (exact then ILIKE)
  const company: Company | null = await getCompanyByAlias(conn, addressName);
  if (company != null) return company.id;

  // Tier 3: FRN clustering
  if (applicantFrn != null && applicantFrn.trim() !== '') {
    return clusterByFrn(conn, applicantFrn);
  }

  return null;
}

/**
 * FRN clustering: find any already-attributed filing with the same FRN
 * and inherit its company_id.
 */
async function clusterByFrn(
  conn: DuckDBConnection,
  frn: string,
): Promise<number | null> {
  const reader = await conn.runAndReadAll(
    `SELECT company_id FROM filing
     WHERE applicant_frn = $1 AND company_id IS NOT NULL
     LIMIT 1`,
    [frn] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length > 0 && rows[0]!.company_id != null) {
    return Number(rows[0]!.company_id);
  }
  return null;
}

/**
 * Run batch attribution across all unattributed filings.
 * Returns counts of attributed and skipped filings.
 */
export async function runBatchAttribution(
  conn: DuckDBConnection,
  onProgress?: (processed: number, total: number) => void,
): Promise<{ attributed: number; skipped: number }> {
  const reader = await conn.runAndReadAll(
    `SELECT filing_key, address_attention, applicant_frn
     FROM filing
     WHERE company_id IS NULL`,
  );

  const rows = reader.getRowObjectsJS();
  const total: number = rows.length;
  let attributed: number = 0;
  let skipped: number = 0;

  for (const row of rows) {
    const filingKey: number = Number(row.filing_key);
    const addressName: string | null =
      row.address_attention != null ? String(row.address_attention) : null;
    const applicantFrn: string | null =
      row.applicant_frn != null ? String(row.applicant_frn) : null;

    const companyId: number | null = await attributeFiling(
      conn,
      addressName,
      applicantFrn,
    );

    if (companyId != null) {
      await conn.run(
        `UPDATE filing SET company_id = $1 WHERE filing_key = $2`,
        [companyId, filingKey] as DuckDBValue[],
      );
      attributed++;
    } else {
      skipped++;
    }

    const processed: number = attributed + skipped;
    if (onProgress != null && processed % 1000 === 0) {
      onProgress(processed, total);
    }
  }

  return { attributed, skipped };
}

/**
 * Seed companies from the predefined seed data.
 * Idempotent — skips companies whose canonical name already exists as an alias.
 */
export async function seedCompanies(
  conn: DuckDBConnection,
  seedData: ReadonlyArray<CompanySeedEntry>,
): Promise<{ created: number; aliasesAdded: number }> {
  // First pass: create all companies (without parent refs)
  const nameToId: Map<string, number> = new Map();
  let created: number = 0;
  let aliasesAdded: number = 0;

  for (const entry of seedData) {
    // Check if company already exists by alias match
    const existing: Company | null = await getCompanyByAlias(conn, entry.name);
    if (existing != null) {
      nameToId.set(entry.name, existing.id);
      // Still add any missing aliases
      for (const alias of entry.aliases) {
        const aliasExists: Company | null = await getCompanyByAlias(
          conn,
          alias,
        );
        if (aliasExists == null) {
          await addAlias(conn, existing.id, alias);
          aliasesAdded++;
        }
      }
      // Add prefix aliases
      for (const prefix of entry.prefixAliases ?? []) {
        await addAlias(conn, existing.id, prefix, 'prefix');
        aliasesAdded++;
      }
      continue;
    }

    const company: Company = await createCompany(conn, {
      name: entry.name,
      stockTicker: entry.ticker,
      stockExchange: entry.exchange,
      website: entry.website,
    });
    nameToId.set(entry.name, company.id);
    created++;

    // Add aliases
    for (const alias of entry.aliases) {
      await addAlias(conn, company.id, alias);
      aliasesAdded++;
    }
    // Add prefix aliases
    for (const prefix of entry.prefixAliases ?? []) {
      await addAlias(conn, company.id, prefix, 'prefix');
      aliasesAdded++;
    }
  }

  // Second pass: set parent relationships
  for (const entry of seedData) {
    if (entry.parentRef == null) continue;
    const childId: number | undefined = nameToId.get(entry.name);
    const parentId: number | undefined = nameToId.get(entry.parentRef);
    if (childId != null && parentId != null) {
      await conn.run(
        `UPDATE company SET parent_company_id = $1, updated_at = current_timestamp WHERE id = $2`,
        [parentId, childId] as DuckDBValue[],
      );
    }
  }

  return { created, aliasesAdded };
}
