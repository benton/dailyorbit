export type SubsystemCount = {
  subsystem_code: string;
  count: number;
};

export type AttachmentStats = {
  total: number;
  downloaded: number;
  pending: number;
  failed: number;
  total_bytes: number;
};

export type DatasetStats = {
  filing_count: number;
  filings_by_subsystem: SubsystemCount[];
  attachment_stats: AttachmentStats;
  db_size_bytes: number;
};

export type ApplicantNode = {
  id: string;
  name: string;
  filing_count: number;
};

export type ApplicantFiling = {
  applicant_name: string;
  file_number: string;
  subsystem_code: string;
  app_type_code: string;
  date_filed: string | null;
  status_code: string | null;
};

export type YearlyFilingVolume = {
  year: string; // 'YYYY'
  subsystem_code: string;
  count: number;
};

export type RecentFiling = {
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

export type CompanyFilingVolume = {
  month: string; // 'YYYY-MM'
  company_name: string;
  count: number;
};

export type TopLineStats = {
  filing_count: number;
  recent_ownership_events: number;
  most_active_filings: Array<{
    file_number: string;
    company_name: string | null;
    activity_count: number;
  }>;
};
