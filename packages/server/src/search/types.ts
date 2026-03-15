/** Result row from filing search */
export type FilingSearchResult = {
  file_number: string;
  callsign: string | null;
  address_attention: string | null;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
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
};

/** Filters for satellite search */
export type SatelliteSearchFilters = {
  us_name?: string;
  itu_name?: string;
  orbit_location?: string;
  active?: boolean;
};

/** Result row from earth station search */
export type EarthStationSearchResult = {
  callsign: string;
  address_attention: string | null;
  filing_count: number;
  most_recent_filing: string | null;
};

/** Filters for earth station search */
export type EarthStationSearchFilters = {
  callsign?: string;
  applicant?: string;
  state?: string;
  city?: string;
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
