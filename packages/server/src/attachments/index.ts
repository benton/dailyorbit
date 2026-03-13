export { compactToHyphenated } from './file-number.ts';
export { parseAttachmentsFromHtml } from './html-parser.ts';
export {
  createAttachmentTable,
  getFilingsForScope,
  getPendingDownloads,
  markDownloaded,
  markFailed,
  upsertAttachments,
} from './repository.ts';
export {
  attachmentStoragePath,
  downloadFile,
  fileExists,
  getFileSize,
} from './storage.ts';
export { createProvider } from './provider.ts';
export { createFccReportProvider } from './fcc-report.ts';
export { fccGovProvider } from './fcc-gov.ts';
export { processQueue } from './queue.ts';
export { runAttachmentPipeline } from './pipeline.ts';
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
