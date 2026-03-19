import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

type NewsSource = {
  id: number;
  name: string;
  feedUrl: string;
  category: string;
  enabled: boolean;
  fetchIntervalMinutes: number;
  lastFetchedAt: string | null;
  lastFetchStatus: string | null;
  lastFetchError: string | null;
  createdAt: string;
  updatedAt: string;
};

type NewSourceForm = {
  name: string;
  feedUrl: string;
  category: string;
  enabled: boolean;
  fetchIntervalMinutes: number;
};

const EMPTY_FORM: NewSourceForm = {
  name: '',
  feedUrl: '',
  category: 'industry',
  enabled: true,
  fetchIntervalMinutes: 60,
};

export default function NewsSourcesAdmin() {
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [addForm, setAddForm] = useState<NewSourceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState<boolean>(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<NewSourceForm>(EMPTY_FORM);
  const [fetchingId, setFetchingId] = useState<number | null>(null);

  const fetchSources = useCallback(async () => {
    try {
      const data: NewsSource[] = await apiFetch<NewsSource[]>(
        '/api/admin/news/sources',
      );
      setSources(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  const handleAdd = async (): Promise<void> => {
    setSaving(true);
    try {
      await apiFetch<NewsSource>('/api/admin/news/sources', {
        method: 'POST',
        body: JSON.stringify(addForm),
      });
      setShowAdd(false);
      setAddForm(EMPTY_FORM);
      await fetchSources();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add source');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: number): Promise<void> => {
    setSaving(true);
    try {
      await apiFetch<NewsSource>(`/api/admin/news/sources/${String(id)}`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });
      setEditId(null);
      await fetchSources();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update source');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    if (!confirm('Delete this source? All its news items will remain.')) return;
    try {
      await apiFetch(`/api/admin/news/sources/${String(id)}`, { method: 'DELETE' });
      await fetchSources();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete source');
    }
  };

  const handleToggleEnabled = async (source: NewsSource): Promise<void> => {
    try {
      await apiFetch<NewsSource>(`/api/admin/news/sources/${String(source.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      await fetchSources();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to toggle source');
    }
  };

  const handleFetchNow = async (id: number): Promise<void> => {
    setFetchingId(id);
    try {
      await apiFetch(`/api/admin/news/sources/${String(id)}/fetch`, { method: 'POST' });
      await fetchSources();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setFetchingId(null);
    }
  };

  const startEdit = (source: NewsSource): void => {
    setEditId(source.id);
    setEditForm({
      name: source.name,
      feedUrl: source.feedUrl,
      category: source.category,
      enabled: source.enabled,
      fetchIntervalMinutes: source.fetchIntervalMinutes,
    });
  };

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
          News Sources
        </h2>
        <button
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          onClick={() => setShowAdd(!showAdd)}
          type="button"
        >
          {showAdd ? 'Cancel' : 'Add Source'}
        </button>
      </div>

      {error != null && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              placeholder="Source name"
              value={addForm.name}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => setAddForm({ ...addForm, feedUrl: e.target.value })}
              placeholder="Feed URL"
              value={addForm.feedUrl}
            />
            <select
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
              value={addForm.category}
            >
              <option value="industry">Industry</option>
              <option value="regulatory">Regulatory</option>
              <option value="company">Company</option>
              <option value="general">General</option>
            </select>
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              min="5"
              onChange={(e) => setAddForm({ ...addForm, fetchIntervalMinutes: Number(e.target.value) })}
              placeholder="Fetch interval (min)"
              type="number"
              value={addForm.fetchIntervalMinutes}
            />
          </div>
          <button
            className="mt-3 rounded-md bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            disabled={saving || addForm.name.trim() === '' || addForm.feedUrl.trim() === ''}
            onClick={() => void handleAdd()}
            type="button"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Sources table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Enabled</th>
              <th className="px-3 py-2">Last Fetch</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {sources.map((source: NewsSource) => (
              <tr key={source.id}>
                {editId === source.id ? (
                  <>
                    <td className="px-3 py-2">
                      <input
                        className="w-full rounded border border-neutral-300 px-1 py-0.5 text-sm dark:border-neutral-600 dark:bg-neutral-800"
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        value={editForm.name}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="rounded border border-neutral-300 px-1 py-0.5 text-sm dark:border-neutral-600 dark:bg-neutral-800"
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        value={editForm.category}
                      >
                        <option value="industry">Industry</option>
                        <option value="regulatory">Regulatory</option>
                        <option value="company">Company</option>
                        <option value="general">General</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        checked={editForm.enabled}
                        onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
                        type="checkbox"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-400">—</td>
                    <td className="px-3 py-2 text-xs text-neutral-400">—</td>
                    <td className="px-3 py-2">
                      <button
                        className="mr-2 text-xs text-green-600 hover:underline"
                        disabled={saving}
                        onClick={() => void handleUpdate(source.id)}
                        type="button"
                      >
                        Save
                      </button>
                      <button
                        className="text-xs text-neutral-500 hover:underline"
                        onClick={() => setEditId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                      {source.name}
                      <div className="truncate text-xs text-neutral-400">{source.feedUrl}</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{source.category}</td>
                    <td className="px-3 py-2">
                      <button
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          source.enabled
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                        }`}
                        onClick={() => void handleToggleEnabled(source)}
                        type="button"
                      >
                        {source.enabled ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      {source.lastFetchedAt != null
                        ? new Date(source.lastFetchedAt).toLocaleString()
                        : 'Never'}
                    </td>
                    <td className="px-3 py-2">
                      {source.lastFetchStatus != null && (
                        <span
                          className={`text-xs ${
                            source.lastFetchStatus === 'success'
                              ? 'text-green-600'
                              : source.lastFetchStatus === 'failed'
                                ? 'text-red-600'
                                : 'text-amber-600'
                          }`}
                        >
                          {source.lastFetchStatus}
                        </span>
                      )}
                      {source.lastFetchError != null && (
                        <div
                          className="max-w-[200px] truncate text-xs text-red-400"
                          title={source.lastFetchError}
                        >
                          {source.lastFetchError}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="mr-2 text-xs text-blue-600 hover:underline disabled:text-neutral-400"
                        disabled={fetchingId === source.id}
                        onClick={() => void handleFetchNow(source.id)}
                        type="button"
                      >
                        {fetchingId === source.id ? 'Fetching...' : 'Fetch now'}
                      </button>
                      <button
                        className="mr-2 text-xs text-neutral-600 hover:underline dark:text-neutral-400"
                        onClick={() => startEdit(source)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => void handleDelete(source.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
