import { type ColumnDef } from '@tanstack/react-table';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';

const CompanyGraph = lazy(() => import('./CompanyGraph.tsx'));

type CompanyListItem = {
  id: number;
  name: string;
  parentName: string | null;
  filingCount: number;
};

type AttributionStats = {
  totalFilings: number;
  attributedFilings: number;
  unattributedFilings: number;
  coveragePercent: number;
  topUnattributedNames: Array<{ name: string; count: number }>;
};

export default function Companies() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AttributionStats | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<AttributionStats>('/api/admin/companies/attribution')
      .then(setStats)
      .catch(() => {});
  }, []);

  const fetchData = useCallback(
    async (params: DataTableFetchParams): Promise<PaginatedResponse<CompanyListItem>> => {
      const query: string = new URLSearchParams({
        page: String(params.page),
        pageSize: String(params.pageSize),
        ...(params.sort != null ? { sort: params.sort } : {}),
        ...(params.order != null ? { order: params.order } : {}),
      }).toString();
      return apiFetch<PaginatedResponse<CompanyListItem>>(`/api/companies?${query}`);
    },
    [],
  );

  const columns: Array<ColumnDef<CompanyListItem, unknown>> = useMemo(
    (): Array<ColumnDef<CompanyListItem, unknown>> => [
      {
        accessorKey: 'name',
        header: 'Name',
        size: 300,
        cell: ({ row }) => (
          <Link
            to={`/companies/${row.original.id}`}
            className="text-blue-600 hover:underline dark:text-blue-400"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'parentName',
        header: 'Parent',
        size: 250,
        cell: ({ getValue }) => (getValue() as string | null) ?? '',
      },
      {
        accessorKey: 'filingCount',
        header: 'Filings',
        size: 100,
        cell: ({ getValue }) => (getValue() as number).toLocaleString(),
      },
    ],
    [],
  );

  const handleRowClick = useCallback(
    (row: CompanyListItem) => {
      void navigate(`/companies/${row.id}`);
    },
    [navigate],
  );

  const runAction = useCallback(async (endpoint: string, label: string) => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const result = await apiFetch<Record<string, unknown>>(endpoint, {
        method: 'POST',
      });
      setActionMessage(`${label}: ${JSON.stringify(result)}`);
    } catch (err: unknown) {
      setActionMessage(`${label} failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  }, []);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Companies</h1>
      </div>

      {/* Attribution coverage banner */}
      {stats != null && (
        <div className="mb-6 rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <h2 className="mb-2 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
            Attribution Coverage
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {stats.coveragePercent}%
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Coverage</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {stats.attributedFilings.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Attributed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {stats.unattributedFilings.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Unattributed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {stats.totalFilings.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Total Filings</div>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/seed', 'Seed')}
        >
          Seed Companies
        </button>
        <button
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/attribute', 'Attribution')}
        >
          Run Attribution
        </button>
        <button
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          disabled={actionLoading}
          onClick={() =>
            void runAction('/api/admin/companies/extract-ownership', 'Ownership Extraction')
          }
        >
          Extract Ownership
        </button>
        <button
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/enrich', 'Enrichment')}
        >
          Enrich (GLEIF/Wikidata)
        </button>
      </div>

      {/* Action feedback */}
      {actionMessage != null && (
        <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          {actionMessage}
        </div>
      )}

      {/* Companies table */}
      <div className="max-h-[50vh] overflow-y-auto">
        <DataTable<CompanyListItem>
          columns={columns}
          fetchData={fetchData}
          defaultSort="name"
          defaultOrder="asc"
          defaultPageSize={25}
          onRowClick={handleRowClick}
        />
      </div>

      {/* Company hierarchy graph */}
      <div className="mt-8">
        <Suspense
          fallback={<p className="text-sm text-neutral-500">Loading company graph...</p>}
        >
          <CompanyGraph />
        </Suspense>
      </div>
    </>
  );
}
