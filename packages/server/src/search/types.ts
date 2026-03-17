/** Result row from filing search */
export type FilingSearchResult = {
  file_number: string;
  callsign: string | null;
  address_attention: string | null;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
  company_name: string | null;
  summary: string | null;
};

/** Filters for filing search */
export type FilingSearchFilters = {
  file_number?: string;
  callsign?: string;
  applicant?: string;
  company?: string;
  subsystem_code?: string[];
  app_type_code?: string[];
  status_code?: string[];
  date_filed_from?: string;
  date_filed_to?: string;
};

/** Result row from satellite search */
export type SatelliteSearchResult = {
  space_station_key: number;
  us_name: string;
  itu_name: string | null;
  orbit_location: string | null;
  inactive_date: string | null;
  company_name: string | null;
};

/** Filters for satellite search */
export type SatelliteSearchFilters = {
  us_name?: string;
  itu_name?: string;
  orbit_location?: string;
  active?: boolean;
  company?: string;
};

/** Result row from earth station search */
export type EarthStationSearchResult = {
  callsign: string;
  address_attention: string | null;
  filing_count: number;
  most_recent_filing: string | null;
  company_name: string | null;
};

/** Filters for earth station search */
export type EarthStationSearchFilters = {
  callsign?: string;
  applicant?: string;
  state?: string;
  city?: string;
  company?: string;
};

/** Search mode for content search */
export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

/** Content search query parameters (on top of existing filters) */
export type ContentSearchQuery = {
  /** Free-text search query */
  q: string;
  /** Search mode */
  mode?: SearchMode;
};

/** A single content search hit */
export type ContentSearchHit = {
  /** The filing's file_number */
  file_number: string;
  /** Which source matched: filing metadata, attachment text, or pleading */
  source: 'filing' | 'attachment' | 'pleading';
  /** Source identifier (attachment_key or pleading_key, null for filing) */
  source_key: string | null;
  /** BM25 relevance score */
  score: number;
  /** Snippet with <mark> highlights */
  snippet: string;
  /** Filing metadata for display */
  callsign: string | null;
  address_attention: string | null;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
  company_name: string | null;
};

/** Whitelist of allowed entity/field combos for autocomplete */
export const AUTOCOMPLETE_WHITELIST: Record<string, ReadonlySet<string>> = {
  filings: new Set([
    'file_number',
    'callsign',
    'address_attention',
    'subsystem_code',
    'app_type_code',
    'status_code',
  ]),
  satellites: new Set(['us_name', 'itu_name', 'orbit_location']),
  'earth-stations': new Set(['callsign', 'address_attention', 'state', 'city']),
  companies: new Set(['name']),
};

/**
 * Maps autocomplete entity names to database tables.
 * earth-stations autocomplete queries the filing table (SES subsystem)
 * except for state/city which come from the earth_station_sta join.
 */
export const AUTOCOMPLETE_ENTITY_CONFIG: Record<
  string,
  { table: string; columnMap: Record<string, string> }
> = {
  filings: {
    table: 'filing',
    columnMap: {
      file_number: 'file_number',
      callsign: 'callsign',
      address_attention: 'address_attention',
      subsystem_code: 'subsystem_code',
      app_type_code: 'app_type_code',
      status_code: 'status_code',
    },
  },
  satellites: {
    table: 'space_station',
    columnMap: {
      us_name: 'us_name',
      itu_name: 'itu_name',
      orbit_location: 'orbit_location',
    },
  },
  'earth-stations': {
    table: 'filing',
    columnMap: {
      callsign: 'callsign',
      address_attention: 'address_attention',
      state: 'e.state_code',
      city: 'e.city',
    },
  },
  companies: {
    table: 'company',
    columnMap: {
      name: 'name',
    },
  },
};
