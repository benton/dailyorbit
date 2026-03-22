import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

type HiddenItemRow = {
  content_key: string;
  content_type: string;
  created_at: string;
  id: number;
  reason: string | null;
  removed_at: string | null;
  scope: string;
  user_id: string;
};

type HideForm = {
  content_key: string;
  content_type: string;
  reason: string;
};

const EMPTY_FORM: HideForm = {
  content_key: '',
  content_type: 'filing',
  reason: '',
};

export default function HiddenItemsAdmin() {
  const [filingItems, setFilingItems] = useState<Array<HiddenItemRow>>([]);
  const [newsItems, setNewsItems] = useState<Array<HiddenItemRow>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [addForm, setAddForm] = useState<HideForm>(EMPTY_FORM);
  const [saving, setSaving] = useState<boolean>(false);
  const [unhidingId, setUnhidingId] = useState<number | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const [filings, news] = await Promise.all([
        apiFetch<Array<HiddenItemRow>>('/api/admin/hidden-items?content_type=filing'),
        apiFetch<Array<HiddenItemRow>>('/api/admin/hidden-items?content_type=news'),
      ]);
      setFilingItems(filings);
      setNewsItems(news);
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to load hidden items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const handleAdd = async (): Promise<void> => {
    setSaving(true);
    try {
      await apiFetch('/api/admin/hidden-items', {
        body: JSON.stringify({
          content_key: addForm.content_key,
          content_type: addForm.content_type,
          reason: addForm.reason || undefined,
        }),
        method: 'POST',
      });
      setShowAdd(false);
      setAddForm(EMPTY_FORM);
      await fetchItems();
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to hide item');
    } finally {
      setSaving(false);
    }
  };

  const handleUnhide = async (id: number): Promise<void> => {
    setUnhidingId(id);
    try {
      await apiFetch(`/api/admin/hidden-items/${String(id)}/unhide`, { method: 'POST' });
      await fetchItems();
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to unhide item');
    } finally {
      setUnhidingId(null);
    }
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString();
  };

  const contentLink = (type: string, key: string): string => {
    if (type === 'filing') {
      return `/filings/${encodeURIComponent(key)}`;
    }
    if (type === 'news') {
      return `/news/${encodeURIComponent(key)}`;
    }
    return '#';
  };

  const allItems: Array<HiddenItemRow> = [...filingItems, ...newsItems];

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Hidden Items</h2>
        <button
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          onClick={() => setShowAdd(!showAdd)}
          type="button"
        >
          {showAdd ? 'Cancel' : 'Hide Item'}
        </button>
      </div>

      {error != null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Add form */}
      {showAdd && (
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => setAddForm({ ...addForm, content_type: e.target.value })}
              value={addForm.content_type}
            >
              <option value="filing">Filing</option>
              <option value="news">News</option>
            </select>
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => setAddForm({ ...addForm, content_key: e.target.value })}
              placeholder="Content key (e.g. file number or news ID)"
              value={addForm.content_key}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => setAddForm({ ...addForm, reason: e.target.value })}
              placeholder="Reason (optional)"
              value={addForm.reason}
            />
          </div>
          <button
            className="mt-3 rounded-md bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            disabled={saving || addForm.content_key.trim() === ''}
            onClick={() => void handleAdd()}
            type="button"
          >
            {saving ? 'Saving...' : 'Hide'}
          </button>
        </div>
      )}

      {/* Hidden items table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2">Content Type</th>
              <th className="px-3 py-2">Content Key</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Hidden By</th>
              <th className="px-3 py-2">Hidden At</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {allItems.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-neutral-400" colSpan={6}>
                  No hidden items
                </td>
              </tr>
            )}
            {allItems.map((item: HiddenItemRow) => (
              <tr key={item.id}>
                <td className="px-3 py-2 text-neutral-500">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
                    {item.content_type}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                  <a
                    className="text-blue-600 hover:underline dark:text-blue-400"
                    href={contentLink(item.content_type, item.content_key)}
                  >
                    {item.content_key}
                  </a>
                </td>
                <td className="px-3 py-2 text-neutral-500">{item.reason ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {item.scope === 'system' ? 'System' : item.user_id}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">{formatDate(item.created_at)}</td>
                <td className="px-3 py-2">
                  <button
                    className="text-xs text-red-600 hover:underline disabled:text-neutral-400"
                    disabled={unhidingId === item.id}
                    onClick={() => void handleUnhide(item.id)}
                    type="button"
                  >
                    {unhidingId === item.id ? 'Unhiding...' : 'Unhide'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
