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
  attachmentStorageKey,
  downloadFile,
  SessionExpiredError,
} from './storage.ts';
export type { DownloadFileOptions } from './storage.ts';
export {
  createFsBackend,
  createS3Backend,
  createMemoryBackend,
} from './storage-backend.ts';
export type { StorageBackend } from './storage-backend.ts';
export { createStorageFromConfig } from './create-storage.ts';
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
export { runValidationPipeline } from './validate-pipeline.ts';
export type {
  ValidationPipelineOptions,
  ValidationPipelineResult,
} from './validate-pipeline.ts';
export { detectContentType } from './validate-content-type.ts';
export type { DetectedContentType } from './validate-content-type.ts';
export type { ExtractionResult } from './extract-text.ts';
export type {
  ExtractionQueryOptions,
  PendingExtractionRow,
  PendingValidationRow,
  ValidationQueryOptions,
} from './repository.ts';
export {
  getPendingValidations,
  markContentTypeValidated,
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
