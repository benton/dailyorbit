/** A single attachment associated with a filing */
export type FilingAttachment = {
  attachmentKey: number;
  attachmentName: string;
  description: string;
  source: string;
  downloadUrl: string;
  downloadStatus: string;
  contentType: string | null;
  fileSizeBytes: number | null;
};

/** A petition/comment associated with a filing */
export type FilingPetition = {
  filingKey: number;
  partyName: string | null;
  dateFiled: string | null;
  description: string | null;
};

/** Related space station link (for SAT filings) */
export type RelatedSpaceStation = {
  spaceStationKey: number;
  usName: string;
  ituName: string | null;
  orbitLocation: string | null;
};

/** Full detail response for GET /api/filings/:fileNumber */
export type FilingDetail = {
  filingKey: number;
  fileNumber: string;
  subsystemCode: string;
  subsystemLabel: string | null;
  appTypeCode: string;
  appTypeLabel: string | null;
  statusCode: string | null;
  statusText: string | null;
  callsign: string | null;
  applicantName: string | null;
  applicantFrn: string | null;
  dateFiled: string | null;
  dateSigned: string | null;
  dateGrant: string | null;
  dateBegin: string | null;
  dateExpire: string | null;
  lastAction: string | null;
  lastActionDate: string | null;
  briefDescription: string | null;
  description: string | null;
  daNumber: string | null;
  redLightStatus: string | null;
  streamlined: string | null;
  environmentalImpact: string | null;
  natureOfService: string | null;
  transferorName: string | null;
  transfereeName: string | null;
  attachments: FilingAttachment[];
  petitions: FilingPetition[];
  relatedSpaceStation: RelatedSpaceStation | null;
  relatedEarthStationCallsign: string | null;
};
