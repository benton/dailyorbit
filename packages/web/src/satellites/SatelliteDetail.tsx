import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { Badge } from '../ui/badge.tsx';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';

// ── Types mirroring server-side models ──────────────────────────────

type SpaceStation = {
  space_station_key: number;
  us_name: string;
  itu_name: string | null;
  orbit_location: string | null;
  verbose: string | null;
  inactive_date: string | null;
};

type SatelliteFiling = {
  filing_key: number;
  file_number: string;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
  date_grant: string | null;
  address_attention: string | null;
  callsign: string | null;
  description: string | null;
};

type SatelliteStats = {
  totalFilings: number;
  mostRecentFilingDate: string | null;
  distinctApplicantCount: number;
};

type SatelliteDetailResponse = {
  satellite: SpaceStation;
  filings: PaginatedResponse<SatelliteFiling>;
  stats: SatelliteStats;
};

// ── Column definitions ──────────────────────────────────────────────

const filingColumns: Array<ColumnDef<SatelliteFiling, unknown>> = [
  {
    accessorKey: 'file_number',
    header: 'File Number',
    size: 240,
    cell: ({ row }) => (
      <Link
        to={`/filings/${row.original.file_number}`}
        className="text-blue-600 hover:underline dark:text-blue-400"
      >
        {row.original.file_number}
      </Link>
    ),
  },
  {
    accessorKey: 'app_type_code',
    header: 'App Type',
    size: 80,
  },
  {
    accessorKey: 'address_attention',
    header: 'Applicant',
    size: 200,
  },
  {
    accessorKey: 'date_filed',
    header: 'Date Filed',
    size: 120,
    cell: ({ getValue }) => {
      const value: string | null = getValue() as string | null;
      return value ? new Date(value).toLocaleDateString() : '';
    },
  },
  {
    accessorKey: 'status_code',
    header: 'Status',
    size: 100,
  },
];

// ── Component ───────────────────────────────────────────────────────

export default function SatelliteDetail() {
  const { id } = useParams<{ id: string }>();

  const [satellite, setSatellite] = useState<SpaceStation | null>(null);
  const [stats, setStats] = useState<SatelliteStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch satellite info and stats on mount
  useEffect(() => {
    let cancelled: boolean = false;
    setLoading(true);
    setError(null);

    apiFetch<SatelliteDetailResponse>(`/api/satellites/${id}`)
      .then((response: SatelliteDetailResponse) => {
        if (cancelled) return;
        setSatellite(response.satellite);
        setStats(response.stats);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message: string = err instanceof Error ? err.message : 'Failed to load satellite';
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // DataTable fetch function for server-side paginated filings
  const fetchFilings = useCallback(
    (params: DataTableFetchParams): Promise<PaginatedResponse<SatelliteFiling>> =>
      apiFetch<SatelliteDetailResponse>(
        `/api/satellites/${id}?page=${params.page}&pageSize=${params.pageSize}` +
          (params.sort != null ? `&sort=${params.sort}` : '') +
          (params.order != null ? `&order=${params.order}` : ''),
      ).then((response: SatelliteDetailResponse) => response.filings),
    [id],
  );

  const isActive: boolean = useMemo(
    () => satellite?.inactive_date == null,
    [satellite?.inactive_date],
  );

  const hasItuName: boolean = useMemo(
    () => satellite?.itu_name != null && satellite.itu_name !== satellite.us_name,
    [satellite?.itu_name, satellite?.us_name],
  );

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-neutral-500 dark:text-neutral-400">
        Loading satellite data...
      </div>
    );
  }

  if (error != null || satellite == null) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-red-600 dark:text-red-400">
        {error ?? 'Satellite not found'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {satellite.us_name}
          </h1>
          <Badge variant={isActive ? 'default' : 'destructive'}>
            {isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        {hasItuName && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            ITU Name: {satellite.itu_name}
          </p>
        )}
        {satellite.orbit_location != null && (
          <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
            Orbital Position: {satellite.orbit_location}
          </p>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: filings table (2/3 width) */}
        <div className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Associated Filings
            </h2>
            <DataTable<SatelliteFiling>
              columns={filingColumns}
              fetchData={fetchFilings}
              defaultSort="date_filed"
              defaultOrder="desc"
            />
          </section>

          {/* Frequency bands summary */}
          {satellite.verbose != null && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Details
              </h2>
              <div className="rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                {satellite.verbose}
              </div>
            </section>
          )}
        </div>

        {/* Right sidebar (1/3 width) */}
        <div className="space-y-6">
          {/* Satellite info card */}
          <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Satellite Info
            </h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-neutral-500 dark:text-neutral-400">US Name</dt>
                <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                  {satellite.us_name}
                </dd>
              </div>
              {satellite.itu_name != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">ITU Name</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                    {satellite.itu_name}
                  </dd>
                </div>
              )}
              {satellite.orbit_location != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Orbital Position</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                    {satellite.orbit_location}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-neutral-500 dark:text-neutral-400">Status</dt>
                <dd>
                  <Badge variant={isActive ? 'default' : 'destructive'} className="mt-1">
                    {isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {satellite.inactive_date != null && (
                    <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                      since {new Date(satellite.inactive_date).toLocaleDateString()}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500 dark:text-neutral-400">ID</dt>
                <dd className="font-mono text-neutral-900 dark:text-neutral-100">
                  {satellite.space_station_key}
                </dd>
              </div>
            </dl>
          </div>

          {/* Quick stats card */}
          {stats != null && (
            <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Quick Stats
              </h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Total Filings</dt>
                  <dd className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                    {stats.totalFilings}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Distinct Applicants</dt>
                  <dd className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                    {stats.distinctApplicantCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Most Recent Filing</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                    {stats.mostRecentFilingDate != null
                      ? new Date(stats.mostRecentFilingDate).toLocaleDateString()
                      : 'N/A'}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
