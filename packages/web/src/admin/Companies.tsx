import { type ColumnDef } from '@tanstack/react-table';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';

const CompanyGraph = lazy(() => import('./CompanyGraph.tsx'));

type CompanyListItem = {
  filingCount: number;
  id: number;
  name: string;
  parentName: string | null;
};

type AttributionStats = {
  attributedFilings: number;
  coveragePercent: number;
  topUnattributedNames: Array<{ count: number; name: string }>;
  totalFilings: number;
  unattributedFilings: number;
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
        cell: ({ row }) => (
          <Link
            className="text-blue-600 hover:underline dark:text-blue-400"
            onClick={(e) => e.stopPropagation()}
            to={`/companies/${row.original.id}`}
          >
            {row.original.name}
          </Link>
        ),
        header: 'Name',
        size: 300,
      },
      {
        accessorKey: 'parentName',
        cell: ({ getValue }) => (getValue() as string | null) ?? '',
        header: 'Parent',
        size: 250,
      },
      {
        accessorKey: 'filingCount',
        cell: ({ getValue }) => (getValue() as number).toLocaleString(),
        header: 'Filings',
        size: 100,
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
    } catch (error: unknown) {
      setActionMessage(
        `${label} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setActionLoading(false);
    }
  }, []);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-on-surface">Companies</h1>
      </div>

      {/* Attribution coverage banner */}
      {stats != null && (
        <div className="mb-6 rounded-theme border border-border-theme bg-white p-4 dark:border-border-theme dark:bg-on-surface">
          <h2 className="mb-2 text-sm font-semibold tracking-wider text-on-surface-muted uppercase dark:text-on-surface-muted">
            Attribution Coverage
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-2xl font-bold text-on-surface">{stats.coveragePercent}%</div>
              <div className="text-xs text-on-surface-muted">Coverage</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-on-surface">
                {stats.attributedFilings.toLocaleString()}
              </div>
              <div className="text-xs text-on-surface-muted">Attributed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-on-surface">
                {stats.unattributedFilings.toLocaleString()}
              </div>
              <div className="text-xs text-on-surface-muted">Unattributed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-on-surface">
                {stats.totalFilings.toLocaleString()}
              </div>
              <div className="text-xs text-on-surface-muted">Total Filings</div>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          className="rounded-theme border border-border-theme bg-surface-card px-3 py-1.5 text-sm font-medium text-on-surface hover:bg-on-surface/5 disabled:opacity-50"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/seed', 'Seed')}
        >
          Seed Companies
        </button>
        <button
          className="rounded-theme border border-border-theme bg-surface-card px-3 py-1.5 text-sm font-medium text-on-surface hover:bg-on-surface/5 disabled:opacity-50"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/attribute', 'Attribution')}
        >
          Run Attribution
        </button>
        <button
          className="rounded-theme border border-border-theme bg-surface-card px-3 py-1.5 text-sm font-medium text-on-surface hover:bg-on-surface/5 disabled:opacity-50"
          disabled={actionLoading}
          onClick={() =>
            void runAction('/api/admin/companies/extract-ownership', 'Ownership Extraction')
          }
        >
          Extract Ownership
        </button>
        <button
          className="rounded-theme border border-border-theme bg-surface-card px-3 py-1.5 text-sm font-medium text-on-surface hover:bg-on-surface/5 disabled:opacity-50"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/enrich', 'Enrichment')}
        >
          Enrich (GLEIF/Wikidata)
        </button>
      </div>

      {/* Action feedback */}
      {actionMessage != null && (
        <div className="mb-6 rounded-theme border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          {actionMessage}
        </div>
      )}

      {/* Companies table */}
      <div className="max-h-[50vh] overflow-y-auto">
        <DataTable<CompanyListItem>
          columns={columns}
          defaultOrder="asc"
          defaultPageSize={25}
          defaultSort="name"
          fetchData={fetchData}
          onRowClick={handleRowClick}
        />
      </div>

      {/* Company hierarchy graph */}
      <div className="mt-8">
        <Suspense
          fallback={<p className="text-sm text-on-surface-muted">Loading company graph...</p>}
        >
          <CompanyGraph />
        </Suspense>
      </div>
    </>
  );
}
