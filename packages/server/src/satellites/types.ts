/** A space station record from the space_station table */
export type SpaceStation = {
  space_station_key: number;
  us_name: string;
  itu_name: string | null;
  orbit_location: string | null;
  verbose: string | null;
  inactive_date: string | null;
};

/** A filing row returned as part of satellite filings */
export type SatelliteFiling = {
  filing_key: number;
  file_number: string;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
  date_grant: string | null;
  address_attention: string | null;
  callsign: string | null;
  description: string | null;
};

/** Quick stats for a satellite */
export type SatelliteStats = {
  totalFilings: number;
  mostRecentFilingDate: string | null;
  distinctApplicantCount: number;
};
