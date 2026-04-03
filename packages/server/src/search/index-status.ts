export type IndexName =
  | 'fts_filing'
  | 'fts_attachment'
  | 'fts_pleading'
  | 'fts_news_item'
  | 'vector';

export type IndexStatus = {
  ready: boolean;
  rebuilding: boolean;
  lastRebuiltAt: string | null;
  error: string | null;
};

const ALL_INDEX_NAMES: IndexName[] = [
  'fts_filing',
  'fts_attachment',
  'fts_pleading',
  'fts_news_item',
  'vector',
];

// Module-level singleton — fast, no DB query needed
const statuses = new Map<IndexName, IndexStatus>(
  ALL_INDEX_NAMES.map((name) => [
    name,
    { ready: true, rebuilding: false, lastRebuiltAt: null, error: null },
  ]),
);

export function getIndexStatus(name: IndexName): IndexStatus {
  return (
    statuses.get(name) ?? {
      ready: true,
      rebuilding: false,
      lastRebuiltAt: null,
      error: null,
    }
  );
}

export function getAllIndexStatuses(): Record<IndexName, IndexStatus> {
  return Object.fromEntries(statuses) as Record<IndexName, IndexStatus>;
}

export function setIndexNotReady(name: IndexName): void {
  statuses.set(name, {
    ready: false,
    rebuilding: false,
    lastRebuiltAt: null,
    error: null,
  });
}

export function setIndexRebuilding(name: IndexName): void {
  const current = statuses.get(name);
  statuses.set(name, {
    ready: false,
    rebuilding: true,
    lastRebuiltAt: current?.lastRebuiltAt ?? null,
    error: null,
  });
}

export function setIndexReady(name: IndexName): void {
  statuses.set(name, {
    ready: true,
    rebuilding: false,
    lastRebuiltAt: new Date().toISOString(),
    error: null,
  });
}

export function setIndexError(name: IndexName, error: string): void {
  const current = statuses.get(name);
  statuses.set(name, {
    ready: false,
    rebuilding: false,
    lastRebuiltAt: current?.lastRebuiltAt ?? null,
    error,
  });
}

export function anyIndexNotReady(): boolean {
  for (const status of statuses.values()) {
    if (!status.ready || status.rebuilding) return true;
  }
  return false;
}
