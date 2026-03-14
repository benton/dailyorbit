export { searchFilings, getFilingDetail } from './client.ts';
export type { SearchOptions } from './client.ts';

export { buildDiscoveryQueries, discoverNewFilings } from './discovery.ts';

export { parseSearchResponse, parseFilingDetail } from './parse.ts';

export { runIcfsIngest } from './pipeline.ts';
export type { IcfsIngestOptions, IcfsIngestResult } from './pipeline.ts';

export { upsertIcfsFiling } from './repository.ts';

export { ensureIcfsColumns } from './schema.ts';

export type {
  IcfsAttachment,
  IcfsAttachmentLink,
  IcfsFilingDetail,
  IcfsFilingSummary,
  IcfsPleading,
  IcfsSearchResult,
  IcfsServiceType,
  IcfsTransferParties,
} from './types.ts';
export { ICFS_BASE_URL, ICFS_PORTAL_ID } from './types.ts';
