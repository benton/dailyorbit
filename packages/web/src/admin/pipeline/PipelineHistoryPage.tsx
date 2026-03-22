import type { ColumnDef } from '@tanstack/react-table';
import { vg } from '@cosmograph/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.ts';
import { Badge } from '../../ui/badge.tsx';
import {
  DataTable,
  type DataTableFetchParams,
  type PaginatedResponse,
} from '../../ui/DataTable.tsx';

// ── Types ──────────────────────────────────────────────────────────────

type PipelineRunStats = {
  finished_at: string | null;
  id: number;
  items_discovered: number;
  items_failed: number;
  items_processed: number;
  mode: string;
  stage_summary: string | null;
  started_at: string;
  status: string;
  summary: string | null;
  triggered_by: string;
};

type StageRun = {
  finished_at: string | null;
  id: number;
  items_discovered: number;
  items_failed: number;
  items_processed: number;
  pipeline_run_id: number;
  stage_id: string;
  started_at: string;
  status: string;
  summary: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (finishedAt == null) {
    return 'running...';
  }
  const ms: number = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const totalSec: number = Math.round(ms / 1000);
  const minutes: number = Math.floor(totalSec / 60);
  const seconds: number = totalSec % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function statusVariant(status: string): 'default' | 'destructive' | 'secondary' {
  if (status === 'completed') {
    return 'default';
  }
  if (status === 'failed') {
    return 'destructive';
  }
  return 'secondary';
}

function modeVariant(mode: string): 'outline' | 'secondary' {
  return mode === 'probe' ? 'outline' : 'secondary';
}

// ── Chart colors ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e',
  failed: '#ef4444',
  running: '#3b82f6',
  short_circuited: '#94a3b8',
};

// ── Columns ────────────────────────────────────────────────────────────

const columns: Array<ColumnDef<PipelineRunStats, unknown>> = [
  {
    accessorKey: 'started_at',
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return new Date(v).toLocaleString();
    },
    header: 'Time',
    size: 180,
  },
  {
    accessorKey: 'mode',
    cell: ({ getValue }) => {
      const mode = getValue() as string;
      return <Badge variant={modeVariant(mode)}>{mode}</Badge>;
    },
    header: 'Mode',
    size: 80,
  },
  {
    accessorKey: 'status',
    cell: ({ getValue }) => {
      const status = getValue() as string;
      return <Badge variant={statusVariant(status)}>{status}</Badge>;
    },
    header: 'Status',
    size: 100,
  },
  {
    cell: ({ row }) => formatDuration(row.original.started_at, row.original.finished_at),
    enableSorting: false,
    header: 'Duration',
    id: 'duration',
    size: 90,
  },
  {
    accessorKey: 'items_discovered',
    header: 'Discovered',
    size: 100,
  },
  {
    accessorKey: 'items_processed',
    header: 'Ingested',
    size: 90,
  },
  {
    accessorKey: 'items_failed',
    header: 'Failed',
    size: 80,
  },
];

// ── Stage detail sub-table ─────────────────────────────────────────────

function StageDetail({ runId }: { runId: number }) {
  const [stages, setStages] = useState<Array<StageRun>>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled: boolean = false;
    apiFetch<Array<StageRun>>(`/api/admin/pipeline/history/${runId}`)
      .then((data: Array<StageRun>) => {
        if (!cancelled) {
          setStages(data);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) {
    return <p className="px-4 py-2 text-sm text-neutral-500">Loading stages...</p>;
  }
  if (stages.length === 0) {
    return <p className="px-4 py-2 text-sm text-neutral-500">No stage data.</p>;
  }

  return (
    <div className="overflow-x-auto border-t border-neutral-200 dark:border-neutral-700">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-neutral-50 dark:bg-neutral-800/50">
            <th className="px-3 py-1.5 text-left font-medium">Stage</th>
            <th className="px-3 py-1.5 text-left font-medium">Status</th>
            <th className="px-3 py-1.5 text-left font-medium">Duration</th>
            <th className="px-3 py-1.5 text-right font-medium">Discovered</th>
            <th className="px-3 py-1.5 text-right font-medium">Processed</th>
            <th className="px-3 py-1.5 text-right font-medium">Failed</th>
            <th className="px-3 py-1.5 text-left font-medium">Summary</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s: StageRun) => (
            <tr className="border-t border-neutral-100 dark:border-neutral-800" key={s.id}>
              <td className="px-3 py-1.5 font-mono text-xs">{s.stage_id}</td>
              <td className="px-3 py-1.5">
                <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
              </td>
              <td className="px-3 py-1.5">{formatDuration(s.started_at, s.finished_at)}</td>
              <td className="px-3 py-1.5 text-right">{s.items_discovered}</td>
              <td className="px-3 py-1.5 text-right">{s.items_processed}</td>
              <td className="px-3 py-1.5 text-right">{s.items_failed}</td>
              <td className="px-3 py-1.5 text-neutral-500">{s.summary ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function PipelineHistoryPage() {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartLoading, setChartLoading] = useState<boolean>(true);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);

  // Load chart data
  useEffect(() => {
    let cancelled: boolean = false;

    async function renderChart(): Promise<void> {
      try {
        const runs: Array<PipelineRunStats> = await apiFetch<Array<PipelineRunStats>>(
          '/api/admin/pipeline/history/stats?limit=200',
        );

        if (cancelled || chartRef.current == null) {
          return;
        }

        // Transform for charting: x = time, y = items_processed, fill = status
        const chartData: Array<{ count: number; status: string; time: Date }> = runs
          .filter((r: PipelineRunStats) => r.started_at != null)
          .map((r: PipelineRunStats) => ({
            count: r.items_processed,
            status: r.status,
            time: new Date(r.started_at),
          }))
          .reverse(); // chronological order

        const statuses: Array<string> = [...new Set(chartData.map((d) => d.status))];
        const colors: Array<string> = statuses.map((s: string) => STATUS_COLORS[s] ?? '#94a3b8');

        const yMax: number = Math.max(5, ...chartData.map((d) => d.count));
        const chart = vg.plot(
          vg.barY(chartData, {
            fill: 'status',
            tip: true,
            x: 'time',
            y: 'count',
          }),
          vg.colorDomain(statuses),
          vg.colorRange(colors),
          vg.height(300),
          vg.width(900),
          vg.xLabel('Time'),
          vg.yDomain([0, yMax]),
          vg.yGrid(true),
          vg.yLabel('Filings Ingested'),
        );

        if (!cancelled && chartRef.current != null) {
          chartRef.current.replaceChildren(chart);
          setChartLoading(false);
        }
      } catch {
        if (!cancelled) {
          setChartLoading(false);
        }
      }
    }

    void renderChart();
    return () => {
      cancelled = true;
    };
  }, []);

  // DataTable fetch function
  const fetchRuns = useCallback(
    async (params: DataTableFetchParams): Promise<PaginatedResponse<PipelineRunStats>> => {
      const qs = new URLSearchParams();
      qs.set('page', String(params.page));
      qs.set('pageSize', String(params.pageSize));
      if (params.sort != null) {
        qs.set('sort', params.sort);
      }
      if (params.order != null) {
        qs.set('order', params.order);
      }
      return apiFetch<PaginatedResponse<PipelineRunStats>>(
        `/api/admin/pipeline/history?${qs.toString()}`,
      );
    },
    [],
  );

  const handleRowClick = useCallback((row: PipelineRunStats) => {
    setExpandedRunId((prev: number | null) => (prev === row.id ? null : row.id));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Pipeline History
      </h1>

      {/* Histogram */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-neutral-700 dark:text-neutral-300">
          Filings Ingested per Run
        </h2>
        {chartLoading && <p className="text-sm text-neutral-500">Loading chart...</p>}
        <div className="overflow-x-auto" ref={chartRef} />
      </section>

      {/* Data table */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-neutral-700 dark:text-neutral-300">
          Run History
        </h2>
        <DataTable<PipelineRunStats>
          columns={columns}
          defaultOrder="desc"
          defaultPageSize={50}
          defaultSort="started_at"
          fetchData={fetchRuns}
          onRowClick={handleRowClick}
          rowTooltip={(row: PipelineRunStats) => row.summary ?? row.stage_summary}
        />
        {expandedRunId != null && (
          <div className="mt-2 rounded-md border border-neutral-200 dark:border-neutral-700">
            <div className="flex items-center justify-between bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
              <span className="text-sm font-medium">Stage breakdown for run #{expandedRunId}</span>
              <button
                className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                onClick={() => setExpandedRunId(null)}
                type="button"
              >
                Close
              </button>
            </div>
            <StageDetail runId={expandedRunId} />
          </div>
        )}
      </section>
    </div>
  );
}
