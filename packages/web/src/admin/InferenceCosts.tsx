import { type ColumnDef } from '@tanstack/react-table';
import { useCallback, useMemo } from 'react';
import { apiFetch } from '../lib/api.ts';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';

type InferenceLogRow = {
  caller: string | null;
  conversationId: string | null;
  costCents: number;
  createdAt: string;
  id: number;
  inputTokens: number;
  latencyMs: number;
  modelId: string;
  operation: string;
  outputTokens: number;
  userEmail: string | null;
  userId: string | null;
};

/** Format a model ID for display by stripping common prefixes. */
function shortModel(modelId: string): string {
  return modelId
    .replace(/^us\./, '')
    .replace(/^amazon\./, '')
    .replace(/^anthropic\./, '');
}

/** Format cost in cents to a dollar string. */
function formatCost(cents: number): string {
  if (cents === 0) {
    return '$0.00';
  }
  if (cents < 0.01) {
    return '<$0.01';
  }
  return `$${(cents / 100).toFixed(4)}`;
}

export default function InferenceCosts() {
  const fetchData = useCallback(
    async (params: DataTableFetchParams): Promise<PaginatedResponse<InferenceLogRow>> => {
      const query: string = new URLSearchParams({
        page: String(params.page),
        pageSize: String(params.pageSize),
        ...(params.sort != null ? { sort: params.sort } : {}),
        ...(params.order != null ? { order: params.order } : {}),
      }).toString();
      return apiFetch<PaginatedResponse<InferenceLogRow>>(`/api/admin/inference/costs?${query}`);
    },
    [],
  );

  const columns: Array<ColumnDef<InferenceLogRow, unknown>> = useMemo(
    (): Array<ColumnDef<InferenceLogRow, unknown>> => [
      {
        accessorKey: 'created_at',
        cell: ({ row }) => {
          const date: Date = new Date(row.original.createdAt);
          return date.toLocaleString();
        },
        header: 'Time',
        size: 180,
      },
      {
        accessorKey: 'model_id',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{shortModel(row.original.modelId)}</span>
        ),
        header: 'Model',
        size: 200,
      },
      {
        accessorKey: 'operation',
        cell: ({ row }) => row.original.operation,
        header: 'Operation',
        size: 120,
      },
      {
        accessorKey: 'caller',
        cell: ({ row }) => row.original.caller ?? '',
        header: 'Caller',
        size: 120,
      },
      {
        accessorKey: 'user_id',
        cell: ({ row }) => row.original.userEmail ?? row.original.userId ?? '',
        header: 'User',
        size: 160,
      },
      {
        accessorKey: 'conversation_id',
        cell: ({ row }) => {
          const cid: string | null = row.original.conversationId;
          if (cid == null) {
            return '';
          }
          return <span className="font-mono text-xs">{cid.slice(0, 8)}</span>;
        },
        header: 'Chat',
        size: 90,
      },
      {
        accessorKey: 'input_tokens',
        cell: ({ row }) => row.original.inputTokens.toLocaleString(),
        header: 'In Tokens',
        size: 100,
      },
      {
        accessorKey: 'output_tokens',
        cell: ({ row }) => row.original.outputTokens.toLocaleString(),
        header: 'Out Tokens',
        size: 100,
      },
      {
        accessorFn: (row) => row.costCents,
        cell: ({ row }) => <span className="font-mono">{formatCost(row.original.costCents)}</span>,
        enableSorting: false,
        header: 'Cost',
        id: 'cost',
        size: 90,
      },
      {
        accessorKey: 'latency_ms',
        cell: ({ row }) => `${row.original.latencyMs.toLocaleString()} ms`,
        header: 'Latency',
        size: 100,
      },
    ],
    [],
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-on-surface">Inference Costs</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          All LLM inference calls with token usage and computed costs.
        </p>
      </div>

      <DataTable<InferenceLogRow>
        columns={columns}
        defaultOrder="desc"
        defaultPageSize={50}
        defaultSort="created_at"
        fetchData={fetchData}
      />
    </>
  );
}
