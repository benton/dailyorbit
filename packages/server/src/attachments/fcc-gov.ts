import type { AttachmentMetadata, DiscoveryProvider } from './types.ts';

/** Stub provider for fcc.gov — the official site is currently offline. */
export const fccGovProvider: DiscoveryProvider = {
  name: 'fcc-gov',
  async discover(
    _fileNumber: string,
    _filingKey: number,
  ): Promise<AttachmentMetadata[]> {
    console.log(
      'fcc-gov provider: FCC licensing site is currently offline. Returning empty results.',
    );
    return [];
  },
};
