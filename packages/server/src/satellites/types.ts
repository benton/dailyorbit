/** A space station record from the space_station table */
export type SpaceStation = {
  spaceStationKey: number;
  usName: string;
  ituName: string | null;
  orbitLocation: string | null;
  verbose: string | null;
  inactiveDate: string | null;
};

/** A filing row returned as part of satellite filings */
export type SatelliteFiling = {
  filingKey: number;
  fileNumber: string;
  subsystemCode: string;
  appTypeCode: string;
  statusCode: string | null;
  dateFiled: string | null;
  dateGrant: string | null;
  addressAttention: string | null;
  callsign: string | null;
  description: string | null;
};

/** Quick stats for a satellite */
export type SatelliteStats = {
  totalFilings: number;
  mostRecentFilingDate: string | null;
  distinctApplicantCount: number;
};
