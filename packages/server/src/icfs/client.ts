import { parseFilingDetail, parseSearchResponse } from './parse.ts';
import type { IcfsFilingDetail, IcfsSearchResult } from './types.ts';
import { ICFS_BASE_URL, ICFS_PORTAL_ID } from './types.ts';

export type SearchOptions = {
  source?: string;
  count?: number;
};

export async function searchFilings(
  query: string,
  options: SearchOptions = {},
): Promise<IcfsSearchResult[]> {
  const source: string = options.source ?? 'ibfs-search-applications';
  const count: number = options.count ?? 200;

  const response: Response = await fetch(
    `${ICFS_BASE_URL}/api/now/sp/search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        portal: ICFS_PORTAL_ID,
        source,
        count,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`ICFS search failed: ${String(response.status)}`);
  }

  const json: unknown = await response.json();
  return parseSearchResponse(json);
}

export async function getFilingDetail(
  fileNumber: string,
): Promise<IcfsFilingDetail> {
  const url: URL = new URL(`${ICFS_BASE_URL}/api/now/sp/page`);
  url.searchParams.set('id', 'ibfs_application_summary');
  url.searchParams.set('portal_id', ICFS_PORTAL_ID);
  url.searchParams.set('number', fileNumber);

  const response: Response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `ICFS filing detail failed: ${String(response.status)}`,
    );
  }

  const json: unknown = await response.json();
  return parseFilingDetail(json);
}
