/** ICFS ServiceNow portal constants */
export const ICFS_BASE_URL =
  'https://fccprod.servicenowservices.com' as const;
export const ICFS_PORTAL_ID =
  '6865628b1bd2625069c154e2604bcbf2' as const;

/** A single result from the ICFS search API */
export type IcfsSearchResult = {
  sysId: string;
  fileNumber: string;
  applicantName: string;
  subsystem: string;
};

/** Summary fields from the SP Page API filing detail */
export type IcfsFilingSummary = {
  fileNumber: string;
  sysId: string;
  callSign: string;
  applicantName: string;
  applicantFrn: string;
  applicantStreet: string;
  applicantCity: string;
  applicantState: string;
  applicantZipCode: string;
  applicantCountry: string;
  contactName: string;
  contactStreet: string;
  contactCity: string;
  contactState: string;
  contactZipCode: string;
  contactCountry: string;
  briefDescription: string;
  natureOfService: string;
  status: string;
  statusDate: string;
  submissionDate: string;
  grantDate: string;
  beginDate: string;
  expirationDate: string;
  lastAction: string;
  lastActionDate: string;
  afpnDate: string;
  actionPnDate: string;
  daNumber: string;
  redLightStatus: string;
  streamlined: string;
  environmentalImpact: string;
  legacyFilingKey: string;
  releaseDate: string;
  adoptedDate: string;
  acceptedPnDaNumber: string;
  actionPnDaNumber: string;
};

/** Transfer/assignment party data (populated for T/C and ASG filings) */
export type IcfsTransferParties = {
  transferorName: string;
  transferorStreet: string;
  transferorCity: string;
  transferorZipCode: string;
  transfereeName: string;
  transfereeStreet: string;
  transfereeCity: string;
  transfereeZipCode: string;
};

/** A single ITC 214 service type flag */
export type IcfsServiceType = {
  fieldName: string;
  label: string;
  value: string;
};

/** Attachment metadata from the Filing Documents tab */
export type IcfsAttachment = {
  sysId: string;
  documentName: string;
  /** The attachment type value (e.g., "html_and_pdf", "pdf") */
  attachmentType: string;
  /** Download links extracted from the actions field */
  links: IcfsAttachmentLink[];
};

/** A download link for an attachment */
export type IcfsAttachmentLink = {
  displayValue: string;
  url: string;
};

/** A pleading/comment entry */
export type IcfsPleading = {
  number: string;
  sysId: string;
  pleadingType: string;
  filerName: string;
  createdOn: string;
  /** Raw HTML containing exhibit/attachment links */
  exhibitAttachmentHtml: string;
};

/** Complete parsed result from the SP Page API */
export type IcfsFilingDetail = {
  found: boolean;
  summary: IcfsFilingSummary | null;
  transferParties: IcfsTransferParties | null;
  serviceTypes: IcfsServiceType[];
  attachments: IcfsAttachment[];
  pleadings: IcfsPleading[];
};
