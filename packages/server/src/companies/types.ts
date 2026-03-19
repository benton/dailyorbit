/** A company entity in the satellite industry hierarchy */
export type Company = {
  id: number;
  name: string;
  parentCompanyId: number | null;
  stockTicker: string | null;
  stockExchange: string | null;
  industry: string | null;
  logoUrl: string | null;
  website: string | null;
  description: string | null;
  gleifLei: string | null;
  wikidataId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Alias type for company name variants */
export type AliasType =
  | 'legal_name'
  | 'dba'
  | 'former_name'
  | 'case_variant'
  | 'prefix';

/** A name variant (alias) associated with a company */
export type CompanyAlias = {
  companyId: number;
  aliasName: string;
  aliasType: AliasType;
};

/** Type of ownership change event */
export type OwnershipEventType = 'transfer_of_control' | 'assignment';

/** Status of an ownership event */
export type OwnershipEventStatus =
  | 'pending'
  | 'granted'
  | 'denied'
  | 'dismissed'
  | 'unknown';

/** An ownership change event derived from T/C or ASG filings */
export type OwnershipEvent = {
  eventId: number;
  filingFileNumber: string;
  transferorCompanyId: number | null;
  transfereeCompanyId: number | null;
  effectiveDate: string | null;
  eventType: OwnershipEventType;
  status: OwnershipEventStatus;
  description: string | null;
};

/** An ownership event with resolved company names for list display */
export type OwnershipEventListItem = OwnershipEvent & {
  transferorName: string | null;
  transfereeName: string | null;
};

/** Full company detail response including related entities */
export type CompanyDetail = {
  company: Company;
  aliases: CompanyAlias[];
  subsidiaries: CompanyListItem[];
  parent: CompanyListItem | null;
  filingCount: number;
  ownershipEvents: OwnershipEvent[];
};

/** Summary item for company listings */
export type CompanyListItem = {
  id: number;
  name: string;
  parentName: string | null;
  filingCount: number;
};

/** Attribution coverage statistics */
export type AttributionStats = {
  totalFilings: number;
  attributedFilings: number;
  unattributedFilings: number;
  coveragePercent: number;
  topUnattributedNames: Array<{ name: string; count: number }>;
};

/** Seed data entry for a company and its aliases */
export type CompanySeedEntry = {
  name: string;
  ticker: string | null;
  exchange: string | null;
  website: string | null;
  parentRef: string | null;
  aliases: string[];
  /** Prefix aliases match any address_attention that starts with the prefix (case-insensitive) */
  prefixAliases?: string[];
};
