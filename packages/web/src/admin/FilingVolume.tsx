import { useEffect, useRef, useState } from 'react';
import { vg } from '@cosmograph/react';
import { apiFetch } from '../lib/api.ts';
import { SUBSYSTEM_CODES, SUBSYSTEM_COLORS } from '../lib/subsystems.ts';

type YearlyFilingVolume = {
  count: number;
  subsystem_code: string;
  year: string;
};

export default function FilingVolume(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
          vg.colorLegend(true),
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
          // Stack legend below the chart instead of beside it
          chart.style.display = 'flex';
          chart.style.flexDirection = 'column';
          containerRef.current.replaceChildren(chart);
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
      </div>
    </>
  );
}
