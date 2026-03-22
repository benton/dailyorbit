import type { DuckDBConnection } from '@duckdb/node-api';
import type { NewsItem } from './types.ts';
import {
  getNewsItemsNeedingAttribution,
  setNewsItemCompany,
  stampNewsItemMatchAttempted,
} from './repository.ts';

type AliasEntry = {
  companyId: number;
  aliasName: string;
};

type AttributionResult = {
  attributed: number;
  skipped: number;
};

/**
 * Heuristic company attribution for news articles.
 * Scans title + first 500 chars of full_text for case-insensitive alias matches.
 * Single match → set company_id. Multiple matches → pick most frequent alias.
 * Zero matches → leave null (skipped).
 */
export async function attributeNewsItems(
  conn: DuckDBConnection,
  limit: number = 500,
): Promise<AttributionResult> {
  // Load all company aliases
  const aliasReader = await conn.runAndReadAll(
    `SELECT company_id, alias_name FROM company_alias ORDER BY LENGTH(alias_name) DESC`,
  );
  const aliases: AliasEntry[] = aliasReader
    .getRowObjectsJS()
    .map((r: Record<string, unknown>) => ({
      companyId: Number(r.company_id),
      aliasName: String(r.alias_name),
    }));

  if (aliases.length === 0) {
    console.log('No company aliases found — skipping attribution.');
    return { attributed: 0, skipped: 0 };
  }

  const items: NewsItem[] = await getNewsItemsNeedingAttribution(conn, limit);

  let attributed: number = 0;
  let skipped: number = 0;

  for (const item of items) {
    // Build the text to scan: title + first 500 chars of full_text
    const scanText: string = [item.title, (item.fullText ?? '').slice(0, 500)]
      .join(' ')
      .toLowerCase();

    // Count matches per company
    const companyCounts: Map<number, number> = new Map();
    for (const alias of aliases) {
      if (scanText.includes(alias.aliasName.toLowerCase())) {
        const current: number = companyCounts.get(alias.companyId) ?? 0;
        companyCounts.set(alias.companyId, current + 1);
      }
    }

    if (companyCounts.size === 0) {
      await stampNewsItemMatchAttempted(conn, item.id);
      skipped++;
      continue;
    }

    // Pick the company with the most alias matches
    let bestCompanyId: number = 0;
    let bestCount: number = 0;
    for (const [companyId, count] of companyCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestCompanyId = companyId;
      }
    }

    await setNewsItemCompany(conn, item.id, bestCompanyId);
    attributed++;
  }

  return { attributed, skipped };
}
