import { useEffect, useRef, useState } from 'react';
import { vg } from '@cosmograph/react';
import { apiFetch } from '../lib/api.ts';
import { getSubsystem, SUBSYSTEM_CODES, SUBSYSTEM_COLORS } from '../lib/subsystems.ts';

type YearlyFilingVolume = {
  count: number;
  subsystem_code: string;
  year: string;
};

export default function FilingVolume(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCodes, setActiveCodes] = useState<Array<string>>([]);

  useEffect(() => {
    let cancelled: boolean = false;

    async function render(): Promise<void> {
      try {
        const data: Array<YearlyFilingVolume> = await apiFetch<Array<YearlyFilingVolume>>(
          '/api/admin/stats/filing-volume',
        );
        if (cancelled || containerRef.current == null) {
          return;
        }

        // Pass API data directly to vgplot marks (no DuckDB coordinator needed)
        const chart = vg.plot(
          vg.barY(
            data,
            {
              fill: 'subsystem_code',
              tip: true,
              x: 'year',
              y: 'count',
            },
          ),
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

        if (!cancelled && containerRef.current != null) {
          containerRef.current.replaceChildren(chart);
          const codes: Array<string> = [...new Set(data.map((d: YearlyFilingVolume) => d.subsystem_code))];
          codes.sort();
          setActiveCodes(codes);
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Failed to load filing volume data');
          setLoading(false);
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error != null) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Filing Volume by Year
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Stacked bar chart of filing counts per subsystem, grouped by year.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        {loading && (
          <p className="text-sm text-neutral-500">Loading filing volume chart...</p>
        )}
        <div ref={containerRef} />
        {activeCodes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            {activeCodes.map((code: string) => {
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
    </>
  );
}
