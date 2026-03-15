import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

type MonthlyFilingVolume = {
  count: number;
  month: string;
  subsystem_code: string;
};

type MonthRow = {
  month: string;
  segments: Array<{ code: string; count: number }>;
  total: number;
};

const SUBSYSTEM_COLORS: Array<string> = [
  'bg-blue-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-purple-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-teal-500',
];

function getColor(index: number): string {
  return SUBSYSTEM_COLORS[index % SUBSYSTEM_COLORS.length];
}

export default function FilingVolume(): React.ReactElement {
  const [data, setData] = useState<Array<MonthlyFilingVolume>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData(): Promise<void> {
      try {
        const result: Array<MonthlyFilingVolume> = await apiFetch<Array<MonthlyFilingVolume>>(
          '/api/admin/stats/filing-volume',
        );
        setData(result);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load filing volume data');
      } finally {
        setLoading(false);
      }
    }
    void fetchData();
  }, []);

  const subsystemCodes: Array<string> = useMemo(() => {
    const codes: Set<string> = new Set<string>();
    for (const row of data) {
      codes.add(row.subsystem_code);
    }
    return Array.from(codes).sort();
  }, [data]);

  const colorMap: Map<string, string> = useMemo(() => {
    const map: Map<string, string> = new Map<string, string>();
    for (let i: number = 0; i < subsystemCodes.length; i++) {
      map.set(subsystemCodes[i], getColor(i));
    }
    return map;
  }, [subsystemCodes]);

  const { maxTotal, rows } = useMemo(() => {
    const grouped: Map<string, Map<string, number>> = new Map<string, Map<string, number>>();
    for (const row of data) {
      let monthMap: Map<string, number> | undefined = grouped.get(row.month);
      if (monthMap == null) {
        monthMap = new Map<string, number>();
        grouped.set(row.month, monthMap);
      }
      monthMap.set(row.subsystem_code, (monthMap.get(row.subsystem_code) ?? 0) + row.count);
    }

    const monthRows: Array<MonthRow> = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, segmentMap]: [string, Map<string, number>]) => {
        const segments: Array<{ code: string; count: number }> = Array.from(
          segmentMap.entries(),
        ).map(([code, count]: [string, number]) => ({ code, count }));
        const total: number = segments.reduce(
          (sum: number, s: { code: string; count: number }) => sum + s.count,
          0,
        );
        return { month, segments, total };
      });

    const computedMax: number = Math.max(...monthRows.map((r: MonthRow) => r.total), 1);
    return { maxTotal: computedMax, rows: monthRows };
  }, [data]);

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading filing volume data...</p>;
  }

  if (error != null) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Filing Volume by Month
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Stacked bar chart of filing counts per subsystem, grouped by month.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        {/* Legend */}
        <div className="mb-4 flex flex-wrap gap-3">
          {subsystemCodes.map((code: string) => (
            <div className="flex items-center gap-1.5" key={code}>
              <span className={`inline-block h-3 w-3 rounded-sm ${colorMap.get(code) ?? ''}`} />
              <span className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
                {code}
              </span>
            </div>
          ))}
        </div>

        {/* Chart rows */}
        <div className="space-y-2">
          {rows.map((row: MonthRow) => (
            <div className="flex items-center gap-3" key={row.month}>
              <span className="w-20 shrink-0 text-right font-mono text-sm text-neutral-600 dark:text-neutral-400">
                {row.month}
              </span>
              <div
                className="flex h-7 overflow-hidden rounded"
                style={{ minWidth: '2px', width: `${(row.total / maxTotal) * 100}%` }}
              >
                {row.segments.map((seg: { code: string; count: number }) => (
                  <div
                    className={`${colorMap.get(seg.code) ?? ''} h-full`}
                    key={seg.code}
                    style={{ width: `${(seg.count / row.total) * 100}%` }}
                    title={`${seg.code}: ${String(seg.count)}`}
                  />
                ))}
              </div>
              <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                {row.total}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
