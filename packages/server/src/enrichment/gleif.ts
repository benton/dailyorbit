import type {
  GleifEntity,
  GleifParentRelation,
  GleifSearchResult,
} from './types.ts';

const GLEIF_BASE_URL: string = 'https://api.gleif.org/api/v1';
const RATE_LIMIT_MS: number = 300;

let lastRequestTime: number = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now: number = Date.now();
  const elapsed: number = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_MS - elapsed),
    );
  }
  lastRequestTime = Date.now();
  return fetch(url, {
    headers: { Accept: 'application/vnd.api+json' },
  });
}

/** Parse a GLEIF entity from the API response data object */
export function parseGleifEntity(data: Record<string, unknown>): GleifEntity {
  const attrs = data.attributes as Record<string, unknown>;
  const entity = attrs.entity as Record<string, unknown>;
  const legalName = entity.legalName as Record<string, unknown>;
  const legalJurisdiction = entity.legalJurisdiction as Record<
    string,
    unknown
  > | null;

  return {
    lei: String(data.id ?? ''),
    legalName: String(legalName?.name ?? ''),
    legalJurisdiction:
      legalJurisdiction?.id != null ? String(legalJurisdiction.id) : null,
    category: entity.category != null ? String(entity.category) : null,
    status: String(entity.status ?? 'UNKNOWN'),
  };
}

/** Search GLEIF for LEI records by legal name */
export async function searchGleif(name: string): Promise<GleifSearchResult> {
  const encodedName: string = encodeURIComponent(name);
  const url: string = `${GLEIF_BASE_URL}/lei-records?filter[entity.legalName]=${encodedName}&page[size]=5`;

  const response: Response = await rateLimitedFetch(url);
  if (!response.ok) {
    return { total: 0, records: [] };
  }

  const json = (await response.json()) as Record<string, unknown>;
  const meta = json.meta as Record<string, unknown> | undefined;
  const total: number = meta?.total != null ? Number(meta.total) : 0;

  const dataArray = json.data as Array<Record<string, unknown>> | undefined;
  if (dataArray == null || dataArray.length === 0) {
    return { total: 0, records: [] };
  }

  const records: GleifEntity[] = dataArray.map(parseGleifEntity);
  return { total, records };
}

/** Get a specific GLEIF LEI record by LEI */
export async function getGleifRecord(lei: string): Promise<GleifEntity | null> {
  const url: string = `${GLEIF_BASE_URL}/lei-records/${lei}`;
  const response: Response = await rateLimitedFetch(url);
  if (!response.ok) return null;

  const json = (await response.json()) as Record<string, unknown>;
  const data = json.data as Record<string, unknown> | undefined;
  if (data == null) return null;

  return parseGleifEntity(data);
}

/** Get the direct parent relationship for a LEI */
export async function getGleifParent(
  lei: string,
): Promise<GleifParentRelation | null> {
  const url: string = `${GLEIF_BASE_URL}/lei-records/${lei}/direct-parent`;
  const response: Response = await rateLimitedFetch(url);
  if (!response.ok) return null;

  const json = (await response.json()) as Record<string, unknown>;
  const data = json.data as Record<string, unknown> | undefined;
  if (data == null) return null;

  const attrs = data.attributes as Record<string, unknown>;
  const relationship = attrs.relationship as Record<string, unknown>;

  return {
    parentLei: String(relationship?.parentLei ?? ''),
    parentName: String(relationship?.parentName ?? ''),
    relationshipType: String(relationship?.type ?? 'UNKNOWN'),
  };
}
