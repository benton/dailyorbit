import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

type BackupSnapshot = {
  error: string | null;
  finished_at: string | null;
  id: number;
  s3_key: string | null;
  size_bytes: number | null;
  started_at: string;
  status: string;
  triggered_by: string;
};

type BackupStatus = {
  configured?: boolean;
  running: boolean;
};

const cardClass: string =
  'rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 p-4';

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb: number = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb: number = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function BackupsPage() {
  const [snapshots, setSnapshots] = useState<Array<BackupSnapshot>>([]);
  const [status, setStatus] = useState<BackupStatus>({ running: false });
  const [loading, setLoading] = useState<boolean>(true);
  const [triggering, setTriggering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [snapshotData, statusData] = await Promise.all([
        apiFetch<Array<BackupSnapshot>>('/api/admin/backups'),
        apiFetch<BackupStatus>('/api/admin/backups/status'),
      ]);
      setSnapshots(snapshotData);
      setStatus(statusData);
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to load backup data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    // Poll every 10s while a backup is running
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      void fetchData();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const triggerBackup = async (): Promise<void> => {
    setTriggering(true);
    try {
      await apiFetch('/api/admin/backups/trigger', { method: 'POST' });
      // Refresh after a short delay to pick up the new running backup
      setTimeout(() => void fetchData(), 1000);
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to trigger backup');
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading backup data...</p>;
  }

  const latest: BackupSnapshot | undefined = snapshots[0];

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Backups</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Database snapshot history and manual trigger.
          </p>
        </div>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={status.running || triggering || status.configured === false}
          onClick={() => void triggerBackup()}
          type="button"
        >
          {status.running ? 'Backup Running...' : 'Trigger Backup'}
        </button>
      </div>

      {error != null && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {status.configured === false && (
        <div
          className={`${cardClass} mb-4 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950`}
        >
          <p className="text-sm text-amber-800 dark:text-amber-200">
            S3 snapshot bucket is not configured. Set <code>snapshotBucket</code> in{' '}
            <a className="underline" href="/admin/settings">
              Settings
            </a>{' '}
            to enable backups.
          </p>
        </div>
      )}

      {/* Latest Backup Card */}
      {latest != null && (
        <div className={`${cardClass} mb-6`}>
          <h2 className="mb-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">
            Latest Backup
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-neutral-400">Status</p>
              <p
                className={`text-sm font-medium ${
                  latest.status === 'completed'
                    ? 'text-green-600 dark:text-green-400'
                    : latest.status === 'failed'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-yellow-600 dark:text-yellow-400'
                }`}
              >
                {latest.status}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">Started</p>
              <p className="text-sm">{formatDate(latest.started_at)}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">Size</p>
              <p className="text-sm">
                {latest.size_bytes != null ? formatBytes(Number(latest.size_bytes)) : '\u2014'}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">Triggered by</p>
              <p className="text-sm">{latest.triggered_by}</p>
            </div>
          </div>
          {latest.error != null && <p className="mt-2 text-xs text-red-500">{latest.error}</p>}
        </div>
      )}

      {/* History Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-medium text-neutral-500 dark:text-neutral-400">
          Backup History
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-700">
              <th className="pb-2 font-medium text-neutral-500">Started</th>
              <th className="pb-2 font-medium text-neutral-500">Status</th>
              <th className="pb-2 font-medium text-neutral-500">Size</th>
              <th className="pb-2 font-medium text-neutral-500">S3 Key</th>
              <th className="pb-2 font-medium text-neutral-500">Trigger</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s: BackupSnapshot) => (
              <tr className="border-b border-neutral-100 dark:border-neutral-800" key={s.id}>
                <td className="py-2">{formatDate(s.started_at)}</td>
                <td
                  className={`py-2 ${
                    s.status === 'completed'
                      ? 'text-green-600 dark:text-green-400'
                      : s.status === 'failed'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-yellow-600 dark:text-yellow-400'
                  }`}
                >
                  {s.status}
                </td>
                <td className="py-2">
                  {s.size_bytes != null ? formatBytes(Number(s.size_bytes)) : '\u2014'}
                </td>
                <td className="py-2 font-mono text-xs text-neutral-500">{s.s3_key ?? '\u2014'}</td>
                <td className="py-2">{s.triggered_by}</td>
              </tr>
            ))}
            {snapshots.length === 0 && (
              <tr>
                <td className="py-4 text-center text-neutral-400" colSpan={5}>
                  No backups recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
