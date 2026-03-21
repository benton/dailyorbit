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

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: number) => {
      e.stopPropagation();
      await apiFetch(`/api/user/saved-searches/${id}`, { method: 'DELETE' });
      setSearches((prev: Array<SavedSearch>) => prev.filter((s: SavedSearch) => s.id !== id));
    },
    [],
  );

  const handleToggleAlert = useCallback(
    async (e: React.MouseEvent, search: SavedSearch) => {
      e.stopPropagation();
      const newValue: boolean = !search.alert_enabled;
      await apiFetch(`/api/user/saved-searches/${search.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ alert_enabled: newValue }),
      });
      setSearches((prev: Array<SavedSearch>) =>
        prev.map((s: SavedSearch) =>
          s.id === search.id ? { ...s, alert_enabled: newValue } : s,
        ),
      );
    },
    [],
  );

  const handleSelect = useCallback(
    (search: SavedSearch) => {
      onLoad(search);
      setOpen(false);
    },
    [onLoad],
  );

  return (
    <div className="relative">
      <Button
        onClick={() => setOpen(!open)}
        size="sm"
        variant="outline"
      >
        <Bookmark className="mr-1.5 h-3.5 w-3.5" />
        Saved Searches
        {searches.length > 0 && open && (
          <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            {searches.length}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-96 rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Saved Searches
            </span>
            <button
              className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="px-3 py-4 text-center text-sm text-neutral-500">Loading...</div>
            )}
            {!loading && searches.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-neutral-500">
                No saved searches yet.
              </div>
            )}
            {!loading &&
              searches.map((search: SavedSearch) => (
                <div
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  key={search.id}
                  onClick={() => handleSelect(search)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSelect(search);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {search.name}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {search.content_type} &middot;{' '}
                      {new Date(search.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-0.5">
                    <button
                      className={`rounded p-1 ${
                        search.alert_enabled
                          ? 'text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:text-amber-400 dark:hover:bg-amber-900/20'
                          : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
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
                      className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
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
