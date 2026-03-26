import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api.ts';

type FlaggedItem = {
  content_key: string;
  content_type: string;
  flag_id: number;
  flagged_at: string;
  item_subtitle: string | null;
  item_title: string | null;
  reason: string | null;
  saved_search_id: number;
  search_name: string | null;
};

function contentUrl(flag: FlaggedItem): string {
  if (flag.content_type === 'filing') {
    return `/filings/${flag.content_key}`;
  }
  return `/news/${flag.content_key}`;
}

function formatDate(ts: string): string {
  const d: Date = new Date(ts);
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function AlertsPage() {
  const [flags, setFlags] = useState<Array<FlaggedItem>>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchFlags = useCallback(async () => {
    try {
      const data = await apiFetch<Array<FlaggedItem>>('/api/user/alerts/flagged');
      setFlags(data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFlags();
  }, [fetchFlags]);

  const grouped: Map<string, Array<FlaggedItem>> = useMemo(() => {
    const map: Map<string, Array<FlaggedItem>> = new Map();
    for (const flag of flags) {
      const key: string = flag.search_name ?? 'Manual flags';
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(flag);
    }
    return map;
  }, [flags]);

  const handleDismiss = useCallback(async (flagId: number) => {
    await apiFetch(`/api/user/flags/${String(flagId)}/dismiss`, { method: 'POST' });
    setFlags((prev: Array<FlaggedItem>) => prev.filter((f: FlaggedItem) => f.flag_id !== flagId));
  }, []);

  const handleDismissGroup = useCallback(
    async (groupName: string) => {
      const groupFlags: Array<FlaggedItem> = grouped.get(groupName) ?? [];
      await Promise.all(
        groupFlags.map((f: FlaggedItem) =>
          apiFetch(`/api/user/flags/${String(f.flag_id)}/dismiss`, { method: 'POST' }),
        ),
      );
      const ids: Set<number> = new Set(groupFlags.map((f: FlaggedItem) => f.flag_id));
      setFlags((prev: Array<FlaggedItem>) => prev.filter((f: FlaggedItem) => !ids.has(f.flag_id)));
    },
    [grouped],
  );

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading alerts...</p>;
  }

  if (flags.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-on-surface">Alerts</h1>
        <div className="rounded-theme border border-border-theme bg-surface-card p-8 text-center">
          <p className="text-on-surface-muted">
            No new alert matches. When content matches your saved searches with alerts enabled, it
            will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-on-surface">Alerts</h1>
      {[...grouped.entries()].map(([groupName, items]: [string, FlaggedItem[]]) => (
        <div className="rounded-theme border border-border-theme bg-surface-card" key={groupName}>
          <div className="flex items-center justify-between border-b border-border-theme px-4 py-3">
            <h2 className="text-sm font-semibold text-on-surface">
              {groupName}
              <span className="ml-2 text-xs font-normal text-on-surface-muted">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>
            </h2>
            <button
              className="text-xs text-on-surface-muted hover:text-red-600"
              onClick={() => void handleDismissGroup(groupName)}
              type="button"
            >
              Dismiss All
            </button>
          </div>
          <ul className="divide-y divide-border-theme/50">
            {items.map((flag: FlaggedItem) => (
              <li className="flex items-center justify-between px-4 py-3" key={flag.flag_id}>
                <div className="min-w-0 flex-1">
                  <Link
                    className="text-sm font-medium text-on-surface hover:text-accent-theme"
                    to={contentUrl(flag)}
                  >
                    {flag.item_title ?? flag.content_key}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-on-surface-muted">
                    {flag.item_subtitle != null && <span>{flag.item_subtitle}</span>}
                    <span>{formatDate(flag.flagged_at)}</span>
                    <span className="rounded bg-surface px-1.5 py-0.5 text-[10px]">
                      {flag.content_type}
                    </span>
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2">
                  <Link
                    className="rounded border border-border-theme px-2.5 py-1 text-xs text-on-surface hover:bg-on-surface/5"
                    to={contentUrl(flag)}
                  >
                    View
                  </Link>
                  <button
                    className="rounded border border-border-theme px-2.5 py-1 text-xs text-on-surface-muted hover:border-red-300 hover:text-red-600"
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
      ))}
    </div>
  );
}
