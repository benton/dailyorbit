/** GLEIF LEI record entity information */
export type GleifEntity = {
  lei: string;
  legalName: string;
  legalJurisdiction: string | null;
  category: string | null;
  status: string;
};

/** GLEIF LEI search result */
export type GleifSearchResult = {
  total: number;
  records: GleifEntity[];
};

/** GLEIF parent relationship */
export type GleifParentRelation = {
  parentLei: string;
  parentName: string;
  relationshipType: string;
};

/** Wikidata entity basic info */
export type WikidataEntity = {
  wikidataId: string;
  label: string;
  description: string | null;
  parentOrgId: string | null;
  parentOrgLabel: string | null;
  stockExchange: string | null;
  stockTicker: string | null;
  industry: string | null;
};

/** Result of enriching a single company */
export type EnrichmentResult = {
  companyId: number;
  gleifLei: string | null;
  wikidataId: string | null;
  fieldsUpdated: string[];
};

/** Summary of a batch enrichment run */
export type EnrichmentSummary = {
  enriched: number;
  skipped: number;
  errors: number;
};
