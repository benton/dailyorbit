import { apiFetch } from './api.ts';

export async function bulkCheckViewed(fileNumbers: string[]): Promise<Set<string>> {
  if (fileNumbers.length === 0) return new Set();
  const result = await apiFetch<{ viewed: string[] }>('/api/user/viewing-history/bulk-check', {
    method: 'POST',
    body: JSON.stringify({ fileNumbers }),
  });
  return new Set(result.viewed);
}

export async function markRead(fileNumber: string): Promise<void> {
  await apiFetch('/api/user/viewing-history/mark-read', {
    method: 'POST',
    body: JSON.stringify({ fileNumber }),
  });
}

export async function markUnread(fileNumber: string): Promise<void> {
  await apiFetch('/api/user/viewing-history/mark-unread', {
    method: 'POST',
    body: JSON.stringify({ fileNumber }),
  });
}
