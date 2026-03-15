import { vg } from '@cosmograph/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { getSubsystem, SUBSYSTEM_CODES, SUBSYSTEM_COLORS } from '../lib/subsystems.ts';

type SubsystemCount = { count: number; subsystem_code: string };
type PublicStats = {
  filing_count: number;
  filings_by_subsystem: Array<SubsystemCount>;
};

type YearlyFilingVolume = {
  count: number;
  subsystem_code: string;
  year: string;
};

const cardClass: string =
  'rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 p-4';

export default function HomePage() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const volumeRef = useRef<HTMLDivElement>(null);
  const [volumeLoading, setVolumeLoading] = useState<boolean>(true);
  const [volumeCodes, setVolumeCodes] = useState<Array<string>>([]);

  const fetchStats = useCallback(async () => {
    try {
      const data: PublicStats = await apiFetch<PublicStats>('/api/stats');
      setStats(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Filing volume chart
  useEffect(() => {
    let cancelled: boolean = false;

    async function renderVolume(): Promise<void> {
      try {
        const data: Array<YearlyFilingVolume> = await apiFetch<Array<YearlyFilingVolume>>(
          '/api/stats/filing-volume',
        );
        if (cancelled || volumeRef.current == null) return;

        const chart = vg.plot(
          vg.barY(data, {
            fill: 'subsystem_code',
            tip: true,
            x: 'year',
            y: 'count',
          }),
          vg.colorDomain(SUBSYSTEM_CODES),
          vg.colorRange(SUBSYSTEM_COLORS),
          vg.height(400),
          vg.width(800),
          vg.xLabel('Year'),
          vg.xTickSpacing(120),
          vg.xTickRotate(-45),
          vg.yGrid(true),
          vg.yLabel('Filings'),
        );

        if (!cancelled && volumeRef.current != null) {
          volumeRef.current.replaceChildren(chart);
          const codes: Array<string> = [...new Set(data.map((d) => d.subsystem_code))];
          codes.sort();
          setVolumeCodes(codes);
          setVolumeLoading(false);
        }
      } catch {
        if (!cancelled) setVolumeLoading(false);
      }
    }

    void renderVolume();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading...</p>;
  }

  if (error != null || stats == null) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error ?? 'No data available'}</p>;
  }

  const maxSubsystemCount: number = Math.max(
    ...stats.filings_by_subsystem.map((s: SubsystemCount) => s.count),
    1,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          FCC IBFS Explorer
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Satellite communications filing data at a glance.
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

        {/* Filings by Subsystem */}
        <div className={`${cardClass} sm:col-span-2 lg:col-span-2`}>
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
                      style={{
                        backgroundColor: info.hex,
                        width: `${String(Math.max(pct, 0.5))}%`,
                      }}
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

      {/* Filing Volume by Year */}
      <div className={cardClass}>
        <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
          Filing Volume by Year
        </p>
        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          Stacked bar chart of filing counts per subsystem, grouped by year.
        </p>
        <div className="mt-3">
          {volumeLoading && (
            <p className="text-sm text-neutral-500">Loading filing volume chart...</p>
          )}
          <div ref={volumeRef} />
          {volumeCodes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              {volumeCodes.map((code: string) => {
                const info = getSubsystem(code);
                return (
                  <div className="flex items-center gap-1.5" key={code}>
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ backgroundColor: info.hex }}
                    />
                    <span className="text-xs text-neutral-600 dark:text-neutral-400">
                      <span className="font-semibold">{code}</span> {info.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
