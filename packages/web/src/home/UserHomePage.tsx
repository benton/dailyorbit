import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import ReadUnreadToggle from '../filings/ReadUnreadToggle.tsx';
import { apiFetch } from '../lib/api.ts';
import { filingUrl } from '../lib/filing-url.ts';
import { markAllRead } from '../lib/viewing-history.ts';

type UnreadFiling = {
  applicantName: string | null;
  appTypeCode: string | null;
  dateFiled: string | null;
  fileNumber: string;
  subsystemCode: string | null;
};

type ViewRecord = {
  fileNumber: string;
  lastViewedAt: string;
};

const cardClass: string =
  'rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 p-4';

export default function UserHomePage() {
  const navigate = useNavigate();
  const [unread, setUnread] = useState<Array<UnreadFiling>>([]);
  const [unreadLoading, setUnreadLoading] = useState<boolean>(true);
  const [recent, setRecent] = useState<Array<ViewRecord>>([]);
  const [recentLoading, setRecentLoading] = useState<boolean>(true);
  const [markingAllRead, setMarkingAllRead] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<Array<UnreadFiling>>('/api/user/viewing-history/unread?since=7')
      .then((data: Array<UnreadFiling>) => setUnread(data))
      .catch(() => {})
      .finally(() => setUnreadLoading(false));
  }, []);

  useEffect(() => {
    apiFetch<Array<ViewRecord>>('/api/user/viewing-history/recent?limit=10')
      .then((data: Array<ViewRecord>) => setRecent(data))
      .catch(() => {})
      .finally(() => setRecentLoading(false));
  }, []);

  const goToFiling = useCallback(
    (fileNumber: string) => void navigate(filingUrl(fileNumber)),
    [navigate],
  );

  const handleMarkAllRead = useCallback(async () => {
    setMarkingAllRead(true);
    try {
      await Promise.all([markAllRead('filing'), markAllRead('news')]);
      setUnread([]);
    } finally {
      setMarkingAllRead(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          The Daily Orbit
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Your personalized filing dashboard.
        </p>
      </div>

      {/* Unread Filings */}
      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
            Unread Filings (Last 7 Days)
          </p>
          {unread.length > 0 && (
            <button
              className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
              disabled={markingAllRead}
              onClick={handleMarkAllRead}
              title="Marks all filings and news articles up to this moment as read, not just the items shown here"
              type="button"
            >
              {markingAllRead ? 'Marking...' : 'Mark all as read'}
            </button>
          )}
        </div>
        <div className="mt-3">
          {unreadLoading ? (
            <p className="text-sm text-neutral-500">Loading...</p>
          ) : unread.length === 0 ? (
            <p className="text-sm text-neutral-500">All caught up!</p>
          ) : (
            <div className="space-y-1">
              {unread.map((f: UnreadFiling) => (
                <div
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  key={f.fileNumber}
                  onClick={() => goToFiling(f.fileNumber)}
                >
                  <ReadUnreadToggle fileNumber={f.fileNumber} initialRead={false} />
                  <span className="font-mono text-xs text-blue-600 dark:text-blue-400">
                    {f.fileNumber}
                  </span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {f.subsystemCode} {f.appTypeCode}
                  </span>
                  <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">
                    {f.dateFiled != null ? new Date(f.dateFiled).toLocaleDateString() : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recently Viewed */}
      <div className={cardClass}>
        <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
          Recently Viewed
        </p>
        <div className="mt-3">
          {recentLoading ? (
            <p className="text-sm text-neutral-500">Loading...</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-neutral-500">No filings viewed yet.</p>
          ) : (
            <div className="space-y-1">
              {recent.map((r: ViewRecord) => (
                <div
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  key={r.fileNumber}
                  onClick={() => goToFiling(r.fileNumber)}
                >
                  <ReadUnreadToggle fileNumber={r.fileNumber} initialRead={true} />
                  <span className="font-mono text-xs text-blue-600 dark:text-blue-400">
                    {r.fileNumber}
                  </span>
                  <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">
                    {new Date(r.lastViewedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
