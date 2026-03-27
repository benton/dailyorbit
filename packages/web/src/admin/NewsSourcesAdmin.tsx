import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Button } from '../ui/button.tsx';

type NewsSource = {
  category: string;
  createdAt: string;
  enabled: boolean;
  feedUrl: string;
  fetchIntervalMinutes: number;
  id: number;
  lastFetchedAt: string | null;
  lastFetchError: string | null;
  lastFetchStatus: string | null;
  name: string;
  updatedAt: string;
};

type NewSourceForm = {
  category: string;
  enabled: boolean;
  feedUrl: string;
  fetchIntervalMinutes: number;
  name: string;
};

const EMPTY_FORM: NewSourceForm = {
  category: 'industry',
  enabled: true,
  feedUrl: '',
  fetchIntervalMinutes: 60,
  name: '',
};

export default function NewsSourcesAdmin() {
  const [sources, setSources] = useState<Array<NewsSource>>([]);
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
      const data: Array<NewsSource> = await apiFetch<Array<NewsSource>>('/api/admin/news/sources');
      setSources(data);
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to load sources');
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
        body: JSON.stringify(addForm),
        method: 'POST',
      });
      setShowAdd(false);
      setAddForm(EMPTY_FORM);
      await fetchSources();
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to add source');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: number): Promise<void> => {
    setSaving(true);
    try {
      await apiFetch<NewsSource>(`/api/admin/news/sources/${String(id)}`, {
        body: JSON.stringify(editForm),
        method: 'PUT',
      });
      setEditId(null);
      await fetchSources();
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to update source');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    if (!confirm('Delete this source? All its news items will remain.')) {
      return;
    }
    try {
      await apiFetch(`/api/admin/news/sources/${String(id)}`, { method: 'DELETE' });
      await fetchSources();
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to delete source');
    }
  };

  const handleToggleEnabled = async (source: NewsSource): Promise<void> => {
    const action: string = source.enabled ? 'Disable' : 'Enable';
    if (!confirm(`${action} "${source.name}"?`)) {
      return;
    }
    try {
      await apiFetch<NewsSource>(`/api/admin/news/sources/${String(source.id)}`, {
        body: JSON.stringify({ enabled: !source.enabled }),
        method: 'PUT',
      });
      await fetchSources();
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to toggle source');
    }
  };

  const handleFetchNow = async (id: number, name: string): Promise<void> => {
    if (!confirm(`Fetch articles from "${name}" now?`)) {
      return;
    }
    setFetchingId(id);
    try {
      await apiFetch(`/api/admin/news/sources/${String(id)}/fetch`, { method: 'POST' });
      await fetchSources();
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Fetch failed');
    } finally {
      setFetchingId(null);
    }
  };

  const startEdit = (source: NewsSource): void => {
    setEditId(source.id);
    setEditForm({
      category: source.category,
      enabled: source.enabled,
      feedUrl: source.feedUrl,
      fetchIntervalMinutes: source.fetchIntervalMinutes,
      name: source.name,
    });
  };

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-on-surface">News Sources</h2>
        <Button
          onClick={() => setShowAdd(!showAdd)}
          size="sm"
          variant={showAdd ? 'ghost' : 'default'}
        >
          {showAdd ? 'Cancel' : 'Add Source'}
        </Button>
      </div>

      {error != null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Add form */}
      {showAdd && (
        <div className="rounded-theme border border-border-theme p-4 dark:border-border-theme">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              placeholder="Source name"
              value={addForm.name}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => setAddForm({ ...addForm, feedUrl: e.target.value })}
              placeholder="Feed URL"
              value={addForm.feedUrl}
            />
            <select
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
              value={addForm.category}
            >
              <option value="industry">Industry</option>
              <option value="regulatory">Regulatory</option>
              <option value="company">Company</option>
              <option value="general">General</option>
            </select>
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              min="5"
              onChange={(e) =>
                setAddForm({ ...addForm, fetchIntervalMinutes: Number(e.target.value) })
              }
              placeholder="Fetch interval (min)"
              type="number"
              value={addForm.fetchIntervalMinutes}
            />
          </div>
          <Button
            className="mt-3"
            disabled={saving || addForm.name.trim() === '' || addForm.feedUrl.trim() === ''}
            onClick={() => void handleAdd()}
            size="sm"
            variant="default"
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      )}

      {/* Sources table */}
      <div className="overflow-x-auto rounded-theme border border-border-theme">
        <table className="min-w-full text-sm">
          <thead className="bg-surface text-left text-xs text-on-surface-muted dark:bg-on-surface/10 dark:text-on-surface-muted">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Enabled</th>
              <th className="px-3 py-2">Last Fetch</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-theme">
            {sources.map((source: NewsSource) => (
              <tr key={source.id}>
                {editId === source.id ? (
                  <>
                    <td className="px-3 py-2">
                      <input
                        className="w-full rounded-theme border border-border-theme bg-surface-card px-1 py-0.5 text-sm"
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        value={editForm.name}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="rounded-theme border border-border-theme bg-surface-card px-1 py-0.5 text-sm"
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
                    <td className="px-3 py-2 text-xs text-on-surface-muted">—</td>
                    <td className="px-3 py-2 text-xs text-on-surface-muted">—</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button
                          disabled={saving}
                          onClick={() => void handleUpdate(source.id)}
                          size="sm"
                          variant="default"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </Button>
                        <Button onClick={() => setEditId(null)} size="sm" variant="ghost">
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-medium text-on-surface">
                      {source.name}
                      <div className="truncate text-xs text-on-surface-muted">{source.feedUrl}</div>
                    </td>
                    <td className="px-3 py-2 text-on-surface-muted">{source.category}</td>
                    <td className="px-3 py-2">
                      <button
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          source.enabled
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : 'bg-on-surface/10 text-on-surface-muted dark:bg-on-surface/10 dark:text-on-surface-muted'
                        }`}
                        onClick={() => void handleToggleEnabled(source)}
                        type="button"
                      >
                        {source.enabled ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-on-surface-muted">
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
                      <div className="flex items-center gap-1">
                        <Button
                          disabled={fetchingId === source.id}
                          onClick={() => void handleFetchNow(source.id, source.name)}
                          size="sm"
                          variant="outline"
                        >
                          {fetchingId === source.id ? 'Fetching...' : 'Fetch now'}
                        </Button>
                        <Button onClick={() => startEdit(source)} size="sm" variant="ghost">
                          Edit
                        </Button>
                        <Button
                          onClick={() => void handleDelete(source.id)}
                          size="sm"
                          variant="destructive"
                        >
                          Delete
                        </Button>
                      </div>
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
