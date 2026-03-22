import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { searchGleif } from './gleif.ts';
import { searchWikidata } from './wikidata.ts';
import type { EnrichmentResult, EnrichmentSummary } from './types.ts';

/**
 * Enrich a single company with data from GLEIF and Wikidata.
 * Updates the company record with any new data found.
 */
export async function enrichCompany(
  conn: DuckDBConnection,
  companyId: number,
): Promise<EnrichmentResult> {
  const reader = await conn.runAndReadAll(
    `SELECT id, name, gleif_lei, wikidata_id, stock_ticker, stock_exchange, industry
     FROM company WHERE id = $1`,
    [companyId] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) {
    return { companyId, gleifLei: null, wikidataId: null, fieldsUpdated: [] };
  }

  const row = rows[0]!;
  const name: string = String(row.name);
  const existingLei: string | null =
    row.gleif_lei != null ? String(row.gleif_lei) : null;
  const existingWikidata: string | null =
    row.wikidata_id != null ? String(row.wikidata_id) : null;
  const fieldsUpdated: string[] = [];

  let gleifLei: string | null = existingLei;
  let wikidataId: string | null = existingWikidata;

  // GLEIF enrichment
  if (existingLei == null) {
    try {
      const gleifResult = await searchGleif(name);
      if (gleifResult.records.length > 0) {
        gleifLei = gleifResult.records[0]!.lei;
        fieldsUpdated.push('gleif_lei');
      }
    } catch {
      // GLEIF API failure is non-fatal
    }
  }

  // Wikidata enrichment
  if (existingWikidata == null) {
    try {
      const wikidataResult = await searchWikidata(name);
      if (wikidataResult != null) {
        wikidataId = wikidataResult.wikidataId;
        fieldsUpdated.push('wikidata_id');

        // Also update stock info and industry if missing
        if (row.stock_ticker == null && wikidataResult.stockTicker != null) {
          fieldsUpdated.push('stock_ticker');
        }
        if (
          row.stock_exchange == null &&
          wikidataResult.stockExchange != null
        ) {
          fieldsUpdated.push('stock_exchange');
        }
        if (row.industry == null && wikidataResult.industry != null) {
          fieldsUpdated.push('industry');
        }

        // Build dynamic update
        const sets: string[] = [];
        const params: DuckDBValue[] = [];
        let idx: number = 1;

        if (wikidataId != null) {
          sets.push(`wikidata_id = $${idx}`);
          params.push(wikidataId);
          idx++;
        }
        if (row.stock_ticker == null && wikidataResult.stockTicker != null) {
          sets.push(`stock_ticker = $${idx}`);
          params.push(wikidataResult.stockTicker);
          idx++;
        }
        if (
          row.stock_exchange == null &&
          wikidataResult.stockExchange != null
        ) {
          sets.push(`stock_exchange = $${idx}`);
          params.push(wikidataResult.stockExchange);
          idx++;
        }
        if (row.industry == null && wikidataResult.industry != null) {
          sets.push(`industry = $${idx}`);
          params.push(wikidataResult.industry);
          idx++;
        }

        if (sets.length > 0) {
          sets.push('updated_at = current_timestamp');
          params.push(companyId);
          await conn.run(
            `UPDATE company SET ${sets.join(', ')} WHERE id = $${idx}`,
            params,
          );
        }
      }
    } catch {
      // Wikidata API failure is non-fatal
    }
  }

  // Update GLEIF LEI if found
  if (gleifLei != null && existingLei == null) {
    await conn.run(
      `UPDATE company SET gleif_lei = $1, updated_at = current_timestamp WHERE id = $2`,
      [gleifLei, companyId] as DuckDBValue[],
    );
  }

  return { companyId, gleifLei, wikidataId, fieldsUpdated };
}

/**
 * Enrich all companies that are missing external data.
 */
export async function enrichAllCompanies(
  conn: DuckDBConnection,
  onProgress?: (processed: number, total: number) => void,
): Promise<EnrichmentSummary> {
  const reader = await conn.runAndReadAll(
    `SELECT id FROM company
     WHERE (gleif_lei IS NULL OR wikidata_id IS NULL)
       AND enrichment_attempted_at IS NULL
     ORDER BY id`,
  );

  const rows = reader.getRowObjectsJS();
  const total: number = rows.length;
  let enriched: number = 0;
  let skipped: number = 0;
  let errors: number = 0;

  for (const row of rows) {
    const companyId: number = Number(row.id);
    try {
      const result: EnrichmentResult = await enrichCompany(conn, companyId);
      if (result.fieldsUpdated.length > 0) {
        enriched++;
      } else {
        skipped++;
      }
    } catch {
      errors++;
    }

    // Always stamp attempt regardless of outcome
    await conn.run(
      `UPDATE company SET enrichment_attempted_at = current_timestamp WHERE id = $1`,
      [companyId] as DuckDBValue[],
    );

    if (onProgress != null) {
      onProgress(enriched + skipped + errors, total);
    }
  }

  return { enriched, skipped, errors };
}
