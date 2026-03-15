import type { WikidataEntity } from './types.ts';

const WIKIDATA_SPARQL_URL: string = 'https://query.wikidata.org/sparql';
const RATE_LIMIT_MS: number = 1000;
const USER_AGENT: string =
  'DailyOrbit/0.3.0 (https://github.com/daily-orbit; contact@daily-orbit.dev)';

let lastRequestTime: number = 0;

async function rateLimitedSparql(
  query: string,
): Promise<Record<string, unknown>[]> {
  const now: number = Date.now();
  const elapsed: number = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_MS - elapsed),
    );
  }
  lastRequestTime = Date.now();

  const url: string = `${WIKIDATA_SPARQL_URL}?query=${encodeURIComponent(query)}&format=json`;
  const response: Response = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    return [];
  }

  const json = (await response.json()) as Record<string, unknown>;
  const results = json.results as Record<string, unknown>;
  const bindings = results.bindings as
    | Array<Record<string, unknown>>
    | undefined;
  return bindings ?? [];
}

/** Extract a string value from a SPARQL binding */
function bindingValue(
  binding: Record<string, unknown>,
  key: string,
): string | null {
  const entry = binding[key] as Record<string, unknown> | undefined;
  if (entry == null) return null;
  return String(entry.value ?? '');
}

/** Extract the Wikidata ID (Q-number) from a full URI */
function extractQId(uri: string | null): string | null {
  if (uri == null) return null;
  const match: RegExpMatchArray | null = uri.match(/Q\d+$/);
  return match != null ? match[0] : null;
}

/**
 * Search Wikidata for a company by name and return enrichment data.
 * Uses properties:
 * - P749: parent organization
 * - P355: subsidiaries (not queried here, just parent)
 * - P414: stock exchange
 * - P249: ticker symbol
 * - P452: industry
 */
export async function searchWikidata(
  companyName: string,
): Promise<WikidataEntity | null> {
  const sparql: string = `
    SELECT ?item ?itemLabel ?itemDescription
           ?parentOrg ?parentOrgLabel
           ?stockExchange ?stockExchangeLabel
           ?ticker
           ?industry ?industryLabel
    WHERE {
      ?item rdfs:label "${companyName.replace(/"/g, '\\"')}"@en .
      ?item wdt:P31/wdt:P279* wd:Q4830453 .
      OPTIONAL { ?item wdt:P749 ?parentOrg . }
      OPTIONAL { ?item wdt:P414 ?stockExchange . }
      OPTIONAL { ?item wdt:P249 ?ticker . }
      OPTIONAL { ?item wdt:P452 ?industry . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    }
    LIMIT 1
  `;

  const bindings: Record<string, unknown>[] = await rateLimitedSparql(sparql);
  if (bindings.length === 0) return null;

  const b: Record<string, unknown> = bindings[0]!;

  return {
    wikidataId: extractQId(bindingValue(b, 'item')) ?? '',
    label: bindingValue(b, 'itemLabel') ?? companyName,
    description: bindingValue(b, 'itemDescription'),
    parentOrgId: extractQId(bindingValue(b, 'parentOrg')),
    parentOrgLabel: bindingValue(b, 'parentOrgLabel'),
    stockExchange: bindingValue(b, 'stockExchangeLabel'),
    stockTicker: bindingValue(b, 'ticker'),
    industry: bindingValue(b, 'industryLabel'),
  };
}

/**
 * Parse a SPARQL result binding into a WikidataEntity.
 * Exported for unit testing with mocked data.
 */
export function parseWikidataBinding(
  b: Record<string, unknown>,
  fallbackName: string,
): WikidataEntity {
  return {
    wikidataId: extractQId(bindingValue(b, 'item')) ?? '',
    label: bindingValue(b, 'itemLabel') ?? fallbackName,
    description: bindingValue(b, 'itemDescription'),
    parentOrgId: extractQId(bindingValue(b, 'parentOrg')),
    parentOrgLabel: bindingValue(b, 'parentOrgLabel'),
    stockExchange: bindingValue(b, 'stockExchangeLabel'),
    stockTicker: bindingValue(b, 'ticker'),
    industry: bindingValue(b, 'industryLabel'),
  };
}
