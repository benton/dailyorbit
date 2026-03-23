import type { FileNumber } from '../lib/file-number.ts';
import { getLogger } from '../lib/logger.ts';
import type { AttachmentMetadata, DiscoveryProvider } from './types.ts';

/** Stub provider for fcc.gov — the official site is currently offline. */
export const fccGovProvider: DiscoveryProvider = {
  name: 'fcc-gov',
  async discover(
    _fileNumber: FileNumber,
    _filingKey: number,
  ): Promise<AttachmentMetadata[]> {
    getLogger().info(
      'fcc-gov provider: FCC licensing site is currently offline. Returning empty results.',
    );
    return [];
  },
};
