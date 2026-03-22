import { apiFetch } from './api.ts';

/** Hide a single item for the current user. Returns the hidden item ID. */
export async function hideItem(
  contentType: string,
  contentKey: string,
  reason?: string,
): Promise<number> {
  const result = await apiFetch<{ id: number }>('/api/user/hidden-items', {
    body: JSON.stringify({ content_key: contentKey, content_type: contentType, reason }),
    method: 'POST',
  });
  return result.id;
}

/** Unhide a single item. */
export async function unhideItem(id: number): Promise<void> {
  await apiFetch(`/api/user/hidden-items/${String(id)}/unhide`, { method: 'POST' });
}

/** Bulk-check which content keys are hidden. */
export async function bulkCheckHidden(
  contentType: string,
  keys: Array<string>,
): Promise<Set<string>> {
  const result = await apiFetch<{ hidden: Array<string> }>('/api/user/hidden-items/bulk-check', {
    body: JSON.stringify({ content_keys: keys, content_type: contentType }),
    method: 'POST',
  });
  return new Set(result.hidden);
}

/** Unhide all user-scope hidden items. Returns count of items unhidden. */
export async function unhideAll(): Promise<number> {
  const result = await apiFetch<{ count: number }>('/api/user/hidden-items/unhide-all', {
    method: 'POST',
  });
  return result.count;
}

/** List active user-scope hidden items. */
export async function listHiddenItems(contentType: string): Promise<
  Array<{
    content_key: string;
    content_type: string;
    created_at: string;
    id: number;
    reason: string | null;
  }>
> {
  return apiFetch(`/api/user/hidden-items?content_type=${encodeURIComponent(contentType)}`);
}
