import { apiFetch } from './api.ts';

export async function bulkCheckViewed(fileNumbers: Array<string>): Promise<Set<string>> {
  if (fileNumbers.length === 0) {
    return new Set();
  }
  const result = await apiFetch<{ viewed: Array<string> }>('/api/user/viewing-history/bulk-check', {
    body: JSON.stringify({ fileNumbers }),
    method: 'POST',
  });
  return new Set(result.viewed);
}

export async function markRead(fileNumber: string): Promise<void> {
  await apiFetch('/api/user/viewing-history/mark-read', {
    body: JSON.stringify({ fileNumber }),
    method: 'POST',
  });
}

export async function markUnread(fileNumber: string): Promise<void> {
  await apiFetch('/api/user/viewing-history/mark-unread', {
    body: JSON.stringify({ fileNumber }),
    method: 'POST',
  });
}

export async function markNewsRead(newsItemId: number): Promise<void> {
  await apiFetch('/api/user/viewing-history/news/mark-read', {
    body: JSON.stringify({ newsItemId }),
    method: 'POST',
  });
}

export async function markAllRead(
  contentType: 'filing' | 'news',
): Promise<{ ok: boolean; watermarkAt: string }> {
  return apiFetch<{ ok: boolean; watermarkAt: string }>('/api/user/viewing-history/mark-all-read', {
    body: JSON.stringify({ contentType }),
    method: 'POST',
  });
}

export async function getWatermarks(): Promise<{
  filing: string | null;
  news: string | null;
}> {
  return apiFetch<{ filing: string | null; news: string | null }>(
    '/api/user/viewing-history/watermarks',
  );
}
