export { fetchWithRetry } from './fetch-retry.ts';
export { parseAttachmentsFromHtml } from './html-parser.ts';
export {
  createAttachmentTable,
  getFilingsForScope,
  getPendingDownloads,
  getPendingExtractions,
  markDownloaded,
  markExtracted,
  markExtractionFailed,
  markExtractionSkipped,
  markFailed,
  upsertAttachments,
} from './repository.ts';
export {
  attachmentStoragePath,
  downloadFile,
  fileExists,
  getFileSize,
  SessionExpiredError,
} from './storage.ts';
export type { DownloadFileOptions } from './storage.ts';
export { createProvider } from './provider.ts';
export { createFccReportProvider } from './fcc-report.ts';
export { fccGovProvider } from './fcc-gov.ts';
export { processQueue } from './queue.ts';
export { runAttachmentPipeline } from './pipeline.ts';
export { runExtractionPipeline } from './extract-pipeline.ts';
export type {
  ExtractionPipelineOptions,
  ExtractionPipelineResult,
} from './extract-pipeline.ts';
export type { ExtractionResult } from './extract-text.ts';
export type {
  ExtractionQueryOptions,
  PendingExtractionRow,
} from './repository.ts';
export type {
  AttachmentMetadata,
  AttachmentPipelineOptions,
  AttachmentPipelineResult,
  AttachmentRow,
  DiscoveryProvider,
  DiscoveryScope,
  FilingRow,
  UpsertResult,
} from './types.ts';
