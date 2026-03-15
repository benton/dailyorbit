import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { getSubsystem } from '../lib/subsystems.ts';

type SubsystemCount = { count: number; subsystem_code: string };
type AttachmentStats = {
  downloaded: number;
  failed: number;
  pending: number;
  total: number;
  total_bytes: number;
};
type DatasetStats = {
  attachment_stats: AttachmentStats;
  db_size_bytes: number;
  filing_count: number;
  filings_by_subsystem: Array<SubsystemCount>;
};

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
  const gb: number = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

const cardClass: string =
  'rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 p-4';

export default function Dashboard() {
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data: DatasetStats = await apiFetch<DatasetStats>('/api/admin/stats');
      setStats(data);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading dataset statistics...</p>;
  }

  if (error != null || stats == null) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error ?? 'No data available'}</p>;
  }

  const { attachment_stats: attachments }: DatasetStats = stats;
  const maxSubsystemCount: number = Math.max(
    ...stats.filings_by_subsystem.map((s: SubsystemCount) => s.count),
    1,
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Dataset overview and storage statistics.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Total Filings */}
        <div className={cardClass}>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Total Filings</p>
          <p className="mt-1 text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
            {stats.filing_count.toLocaleString()}
          </p>
        </div>

        {/* Database Size */}
        <div className={cardClass}>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Database File Size</p>
          <p className="mt-1 text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
            {formatBytes(stats.db_size_bytes)}
          </p>
        </div>

        {/* Total Attachment Size */}
        <div className={cardClass}>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Total Attachment Size</p>
          <p className="mt-1 text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
            {formatBytes(attachments.total_bytes)}
          </p>
        </div>

        {/* Attachments */}
        <div className={cardClass}>
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Attachments</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-600 dark:text-neutral-300">Total</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">
                {attachments.total.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-600 dark:text-neutral-300">Downloaded</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">
                {attachments.downloaded.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-600 dark:text-neutral-300">Pending</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">
                {attachments.pending.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-600 dark:text-neutral-300">Failed</span>
              <span className="font-mono text-red-600 dark:text-red-400">
                {attachments.failed.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Filings by Subsystem */}
        <div className={`${cardClass} sm:col-span-2 lg:col-span-3`}>
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
            Filings by Subsystem
          </p>
          <div className="mt-3 space-y-1.5">
            {stats.filings_by_subsystem.map((sub: SubsystemCount) => {
              const info = getSubsystem(sub.subsystem_code);
              const pct: number = (sub.count / maxSubsystemCount) * 100;
              return (
                <div className="flex items-center gap-2" key={sub.subsystem_code}>
                  <span className="w-8 shrink-0 text-right font-mono text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    {sub.subsystem_code}
                  </span>
                  <span className="w-36 shrink-0 truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {info.label}
                  </span>
                  <div className="relative h-5 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full rounded transition-all"
                      style={{ backgroundColor: info.hex, width: `${String(Math.max(pct, 0.5))}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-xs text-neutral-700 dark:text-neutral-300">
                    {sub.count.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
