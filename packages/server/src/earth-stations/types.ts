import type { PaginatedResponse } from '../lib/pagination.ts';

/** Summary info for an earth station, aggregated from SES filings */
export type EarthStationInfo = {
  callsign: string;
  applicantName: string | null;
  applicantCity: string | null;
  applicantState: string | null;
  applicantCountry: string | null;
  mostRecentFileNumber: string;
  mostRecentDateFiled: string | null;
  mostRecentStatus: string | null;
};

/** A filing row associated with an earth station */
export type EarthStationFiling = {
  filingKey: number;
  fileNumber: string;
  appTypeCode: string;
  statusCode: string | null;
  dateFiled: string | null;
  dateGrant: string | null;
  dateExpire: string | null;
  description: string | null;
};

/** A frequency record associated with an antenna */
export type AntennaFrequency = {
  frequencyKey: number;
  polarizationCode: string | null;
  eirp: number | null;
  eirpDensity: number | null;
  emission: string | null;
  frequencyLower: string | null;
  frequencyUpper: string | null;
  transMode: string | null;
  modulation: string | null;
};

/** An antenna with its nested frequencies */
export type EarthStationAntenna = {
  antennaKey: number;
  antennaId: string;
  siteKey: number;
  diameter: number | null;
  manufacturer: string | null;
  model: string | null;
  maxInputPower: number | null;
  maxOutputEirp: number | null;
  frequencies: AntennaFrequency[];
};

/** Quick stats for an earth station callsign */
export type EarthStationStats = {
  totalFilingCount: number;
  mostRecentFilingDate: string | null;
  antennaCount: number;
};

/** Full response for GET /api/earth-stations/:callsign */
export type EarthStationDetailResponse = {
  info: EarthStationInfo;
  filings: PaginatedResponse<EarthStationFiling>;
  antennas: EarthStationAntenna[];
  stats: EarthStationStats;
};
