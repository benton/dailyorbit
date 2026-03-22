import type { DuckDBInstance } from '@duckdb/node-api';
import type { FileNumber } from '../lib/file-number.ts';

/** Metadata for a single attachment discovered from a filing page */
export type AttachmentMetadata = {
  attachmentKey: number;
  filingKey: number;
  fileNumber: FileNumber;
  /** Origin section: 'attachment' (from Attachments table) or 'file' (from Files table) */
  source: string;
  attachmentName: string;
  description: string;
  downloadUrl: string;
};

/** Scope filter for which filings to discover attachments for */
export type DiscoveryScope = {
  fileNumbers?: FileNumber[] | undefined;
  subsystems?: string[] | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  limit?: number | undefined;
  /** Only filings not scraped since this ISO timestamp */
  notScrapedSince?: string | undefined;
  /** Only filings not scraped within this duration (e.g. "7d", "24h", "30m") */
  staleAfter?: string | undefined;
};

/** Interface for attachment discovery providers */
export type DiscoveryProvider = {
  name: string;
  discover(
    fileNumber: FileNumber,
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
  downloadOnly?: boolean;
  retryFailed?: boolean;
  /** Skip downloading if the file already exists on disk (default: true) */
  skipExisting?: boolean;
  delayMs?: number;
  concurrency?: number;
  verbose?: boolean;
  onProgress?: (msg: string) => void;
  /** Skip the summarization stage (default: false) */
  skipSummarization?: boolean;
  /** AWS region for Bedrock inference (default: from config or 'us-east-2') */
  bedrockRegion?: string;
  /** Model ID for summarization (default: from config) */
  summarizationModel?: string;
  /** Concurrency for Bedrock inference calls (default: 10) */
  summarizationConcurrency?: number;
  /** Cookie header string for authenticated ServiceNow downloads */
  authCookies?: string | undefined;
  /** Abort signal for cooperative cancellation */
  signal?: AbortSignal | undefined;
};

/** Result summary from a pipeline run */
export type AttachmentPipelineResult = {
  filingsProcessed: number;
  attachmentsDiscovered: number;
  attachmentsDownloaded: number;
  attachmentsFailed: number;
  attachmentsSkipped: number;
  downloadsSkipped: number;
  textsExtracted: number;
  textsSkippedNoText: number;
  textsSkippedAuthError: number;
  textsFailed: number;
  summariesGenerated: number;
  summariesCopied: number;
  summariesFailed: number;
  durationMs: number;
};

/** A filing row with the columns needed for attachment discovery */
export type FilingRow = {
  filingKey: number;
  fileNumber: FileNumber;
  subsystemCode: string;
  appTypeCode: string;
  discoveredAt: string | null;
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
