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
