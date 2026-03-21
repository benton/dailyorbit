import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

type FlaggedItem = {
  flag_id: number;
  content_type: string;
  content_key: string;
  reason: string | null;
  saved_search_id: number;
  flagged_at: string;
  search_name: string | null;
  item_title: string | null;
  item_subtitle: string | null;
};

export default function AlertsPage() {
  const [flags, setFlags] = useState<FlaggedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchFlags = useCallback(async () => {
    try {
      const res: Response = await fetch('/api/user/alerts/flagged');
      if (res.ok) {
        const data = (await res.json()) as FlaggedItem[];
        setFlags(data);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFlags();
  }, [fetchFlags]);

  const grouped: Map<string, FlaggedItem[]> = useMemo(() => {
    const map: Map<string, FlaggedItem[]> = new Map();
    for (const flag of flags) {
      const key: string = flag.search_name ?? 'Manual flags';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(flag);
    }
    return map;
  }, [flags]);

  const handleDismiss = useCallback(
    async (flagId: number) => {
      await fetch(`/api/user/flags/${String(flagId)}/dismiss`, {
        method: 'POST',
      });
      setFlags((prev: FlaggedItem[]) =>
        prev.filter((f: FlaggedItem) => f.flag_id !== flagId),
      );
    },
    [],
  );

  const handleDismissGroup = useCallback(
    async (groupName: string) => {
      const groupFlags: FlaggedItem[] =
        grouped.get(groupName) ?? [];
      await Promise.all(
        groupFlags.map((f: FlaggedItem) =>
          fetch(`/api/user/flags/${String(f.flag_id)}/dismiss`, {
            method: 'POST',
          }),
        ),
      );
      const ids: Set<number> = new Set(
        groupFlags.map((f: FlaggedItem) => f.flag_id),
      );
      setFlags((prev: FlaggedItem[]) =>
        prev.filter((f: FlaggedItem) => !ids.has(f.flag_id)),
      );
    },
    [grouped],
  );

  function contentUrl(flag: FlaggedItem): string {
    if (flag.content_type === 'filing') return `/filings/${flag.content_key}`;
    return `/news/${flag.content_key}`;
  }

  function formatDate(ts: string): string {
    const d: Date = new Date(ts);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <p className="text-sm text-neutral-500">Loading alerts...</p>
    );
  }

  if (flags.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Alerts
        </h1>
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-neutral-500 dark:text-neutral-400">
            No new alert matches. When content matches your saved searches
            with alerts enabled, it will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        Alerts
      </h1>
      {[...grouped.entries()].map(
        ([groupName, items]: [string, FlaggedItem[]]) => (
          <div
            className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
            key={groupName}
          >
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {groupName}
                <span className="ml-2 text-xs font-normal text-neutral-500">
                  {items.length} item{items.length !== 1 ? 's' : ''}
                </span>
              </h2>
              <button
                className="text-xs text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                onClick={() => void handleDismissGroup(groupName)}
                type="button"
              >
                Dismiss All
              </button>
            </div>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {items.map((flag: FlaggedItem) => (
                <li
                  className="flex items-center justify-between px-4 py-3"
                  key={flag.flag_id}
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      className="text-sm font-medium text-neutral-900 hover:text-pink-700 dark:text-neutral-100 dark:hover:text-pink-400"
                      to={contentUrl(flag)}
                    >
                      {flag.item_title ?? flag.content_key}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      {flag.item_subtitle != null && (
                        <span>{flag.item_subtitle}</span>
                      )}
                      <span>{formatDate(flag.flagged_at)}</span>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
                        {flag.content_type}
                      </span>
                    </div>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    <Link
                      className="rounded border border-neutral-200 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      to={contentUrl(flag)}
                    >
                      View
                    </Link>
                    <button
                      className="rounded border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500 hover:border-red-300 hover:text-red-600 dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-red-500 dark:hover:text-red-400"
                      onClick={() => void handleDismiss(flag.flag_id)}
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
