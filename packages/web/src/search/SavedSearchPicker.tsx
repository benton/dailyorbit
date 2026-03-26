import { Bell, BellOff, Bookmark, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Button } from '../ui/button.tsx';

export type SavedSearch = {
  alert_enabled: boolean;
  content_type: 'filing' | 'news';
  created_at: string;
  filters: Record<string, unknown>;
  id: number;
  include_time_scope: boolean;
  name: string;
  updated_at: string;
};

type SavedSearchPickerProps = {
  onLoad: (search: SavedSearch) => void;
};

export function SavedSearchPicker({ onLoad }: SavedSearchPickerProps) {
  const [searches, setSearches] = useState<Array<SavedSearch>>([]);
  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchSearches = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Array<SavedSearch>>('/api/user/saved-searches');
      setSearches(data);
    } catch {
      setSearches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchSearches();
    }
  }, [open, fetchSearches]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await apiFetch(`/api/user/saved-searches/${id}`, { method: 'DELETE' });
    setSearches((prev: Array<SavedSearch>) => prev.filter((s: SavedSearch) => s.id !== id));
  }, []);

  const handleToggleAlert = useCallback(async (e: React.MouseEvent, search: SavedSearch) => {
    e.stopPropagation();
    const newValue: boolean = !search.alert_enabled;
    await apiFetch(`/api/user/saved-searches/${search.id}`, {
      body: JSON.stringify({ alert_enabled: newValue }),
      method: 'PATCH',
    });
    setSearches((prev: Array<SavedSearch>) =>
      prev.map((s: SavedSearch) => (s.id === search.id ? { ...s, alert_enabled: newValue } : s)),
    );
  }, []);

  const handleSelect = useCallback(
    (search: SavedSearch) => {
      onLoad(search);
      setOpen(false);
    },
    [onLoad],
  );

  return (
    <div className="relative">
      <Button onClick={() => setOpen(!open)} size="sm" variant="outline">
        <Bookmark className="mr-1.5 h-3.5 w-3.5" />
        Saved Searches
        {searches.length > 0 && open && (
          <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            {searches.length}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-96 rounded-md border border-border-theme bg-white shadow-lg dark:border-border-theme dark:bg-on-surface">
          <div className="flex items-center justify-between border-b border-border-theme px-3 py-2 dark:border-border-theme">
            <span className="text-sm font-medium text-on-surface">Saved Searches</span>
            <button
              className="rounded p-0.5 text-on-surface-muted hover:text-on-surface"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="px-3 py-4 text-center text-sm text-on-surface-muted">Loading...</div>
            )}
            {!loading && searches.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-on-surface-muted">
                No saved searches yet.
              </div>
            )}
            {!loading &&
              searches.map((search: SavedSearch) => (
                <div
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm hover:bg-on-surface/5"
                  key={search.id}
                  onClick={() => handleSelect(search)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleSelect(search);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-on-surface">{search.name}</div>
                    <div className="text-xs text-on-surface-muted">
                      {search.content_type} &middot;{' '}
                      {new Date(search.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-0.5">
                    <button
                      className={`rounded p-1 ${
                        search.alert_enabled
                          ? 'text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:text-amber-400 dark:hover:bg-amber-900/20'
                          : 'text-on-surface-muted hover:bg-on-surface/10 hover:text-on-surface'
                      }`}
                      onClick={(e) => void handleToggleAlert(e, search)}
                      title={search.alert_enabled ? 'Disable alert' : 'Enable alert'}
                      type="button"
                    >
                      {search.alert_enabled ? (
                        <Bell className="h-3.5 w-3.5" />
                      ) : (
                        <BellOff className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      className="rounded p-1 text-on-surface-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      onClick={(e) => void handleDelete(e, search.id)}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
