import type { DuckDBInstance } from '@duckdb/node-api';

/** Metadata for a single attachment discovered from a filing page */
export type AttachmentMetadata = {
  attachmentKey: number;
  filingKey: number;
  fileNumber: string;
  attachmentName: string;
  description: string;
  downloadUrl: string;
};

/** Scope filter for which filings to discover attachments for */
export type DiscoveryScope = {
  fileNumbers?: string[] | undefined;
  subsystems?: string[] | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  limit?: number | undefined;
};

/** Interface for attachment discovery providers */
export type DiscoveryProvider = {
  name: string;
  discover(
    fileNumber: string,
    filingKey: number,
  ): Promise<AttachmentMetadata[]>;
};

/** Options for the attachment pipeline */
export type AttachmentPipelineOptions = {
  databaseUrl?: string;
  dbInstance?: DuckDBInstance;
  storageBasePath: string;
  provider?: 'fcc-report' | 'fcc-gov';
  scope: DiscoveryScope;
  discoverOnly?: boolean;
  retryFailed?: boolean;
  delayMs?: number;
  concurrency?: number;
  onProgress?: (msg: string) => void;
};

/** Result summary from a pipeline run */
export type AttachmentPipelineResult = {
  filingsProcessed: number;
  attachmentsDiscovered: number;
  attachmentsDownloaded: number;
  attachmentsFailed: number;
  durationMs: number;
};

/** A filing row with the columns needed for attachment discovery */
export type FilingRow = {
  filingKey: number;
  fileNumber: string;
  subsystemCode: string;
  appTypeCode: string;
};

/** Result of an upsert operation */
export type UpsertResult = {
  inserted: number;
  existing: number;
};

/** An attachment row from the database, including download status */
export type AttachmentRow = AttachmentMetadata & {
  downloadStatus: string;
  fileSizeBytes: number | null;
  contentType: string | null;
  localPath: string | null;
  discoveredAt: string;
  downloadedAt: string | null;
  fullText: string | null;
  textLength: number | null;
  summary: string | null;
};
