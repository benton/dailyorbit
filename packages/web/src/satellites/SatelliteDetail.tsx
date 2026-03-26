import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { filingUrl } from '../lib/filing-url.ts';
import { Badge } from '../ui/badge.tsx';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';

// ── Types mirroring server-side models ──────────────────────────────

type SpaceStation = {
  inactiveDate: string | null;
  ituName: string | null;
  orbitLocation: string | null;
  spaceStationKey: number;
  usName: string;
  verbose: string | null;
};

type SatelliteFiling = {
  addressAttention: string | null;
  appTypeCode: string;
  callsign: string | null;
  dateFiled: string | null;
  dateGrant: string | null;
  description: string | null;
  fileNumber: string;
  filingKey: number;
  statusCode: string | null;
  subsystemCode: string;
  summary: string | null;
};

type SatelliteStats = {
  distinctApplicantCount: number;
  mostRecentFilingDate: string | null;
  totalFilings: number;
};

type SatelliteDetailResponse = {
  filings: PaginatedResponse<SatelliteFiling>;
  satellite: SpaceStation;
  stats: SatelliteStats;
};

// ── Column definitions ──────────────────────────────────────────────

const filingColumns: Array<ColumnDef<SatelliteFiling, unknown>> = [
  {
    accessorKey: 'fileNumber',
    cell: ({ row }) => (
      <Link
        className="text-blue-600 hover:underline dark:text-blue-400"
        to={filingUrl(row.original.fileNumber)}
      >
        {row.original.fileNumber}
      </Link>
    ),
    header: 'File Number',
    size: 240,
  },
  {
    accessorKey: 'appTypeCode',
    header: 'App Type',
    size: 80,
  },
  {
    accessorKey: 'addressAttention',
    header: 'Applicant',
    size: 200,
  },
  {
    accessorKey: 'dateFiled',
    cell: ({ getValue }) => {
      const value: string | null = getValue() as string | null;
      return value ? new Date(value).toLocaleDateString() : '';
    },
    header: 'Date Filed',
    size: 120,
  },
  {
    accessorKey: 'statusCode',
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
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setError(null);

    apiFetch<SatelliteDetailResponse>(`/api/satellites/${id}`)
      .then((response: SatelliteDetailResponse) => {
        if (cancelled) {
          return;
        }
        setSatellite(response.satellite);
        setStats(response.stats);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message: string = error instanceof Error ? error.message : 'Failed to load satellite';
        setError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
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
    () => satellite?.inactiveDate == null,
    [satellite?.inactiveDate],
  );

  const hasItuName: boolean = useMemo(
    () => satellite?.ituName != null && satellite.ituName !== satellite.usName,
    [satellite],
  );

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-on-surface-muted">
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
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-on-surface">{satellite.usName}</h1>
          <Badge variant={isActive ? 'default' : 'destructive'}>
            {isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        {hasItuName && (
          <p className="text-sm text-on-surface-muted">ITU Name: {satellite.ituName}</p>
        )}
        {satellite.orbitLocation != null && (
          <p className="text-lg font-medium text-on-surface">
            Orbital Position: {satellite.orbitLocation}
          </p>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: filings table (2/3 width) */}
        <div className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-on-surface">Associated Filings</h2>
            <DataTable<SatelliteFiling>
              columns={filingColumns}
              defaultOrder="desc"
              defaultSort="date_filed"
              fetchData={fetchFilings}
              rowTooltip={(row: SatelliteFiling) => row.summary}
            />
          </section>

          {/* Frequency bands summary */}
          {satellite.verbose != null && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-on-surface">Details</h2>
              <div className="rounded-theme border border-border-theme bg-surface-card p-4 text-sm text-on-surface">
                {satellite.verbose}
              </div>
            </section>
          )}
        </div>

        {/* Right sidebar (1/3 width) */}
        <div className="space-y-6">
          {/* Satellite info card */}
          <div className="rounded-theme border border-border-theme bg-surface-card p-4">
            <h3 className="mb-3 text-sm font-semibold tracking-wider text-on-surface-muted uppercase">
              Satellite Info
            </h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-on-surface-muted">US Name</dt>
                <dd className="font-medium text-on-surface">{satellite.usName}</dd>
              </div>
              {satellite.ituName != null && (
                <div>
                  <dt className="text-on-surface-muted">ITU Name</dt>
                  <dd className="font-medium text-on-surface">{satellite.ituName}</dd>
                </div>
              )}
              {satellite.orbitLocation != null && (
                <div>
                  <dt className="text-on-surface-muted">Orbital Position</dt>
                  <dd className="font-medium text-on-surface">{satellite.orbitLocation}</dd>
                </div>
              )}
              <div>
                <dt className="text-on-surface-muted">Status</dt>
                <dd>
                  <Badge className="mt-1" variant={isActive ? 'default' : 'destructive'}>
                    {isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {satellite.inactiveDate != null && (
                    <span className="ml-2 text-xs text-on-surface-muted">
                      since {new Date(satellite.inactiveDate).toLocaleDateString()}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-muted">ID</dt>
                <dd className="font-mono text-on-surface">{satellite.spaceStationKey}</dd>
              </div>
            </dl>
          </div>

          {/* Quick stats card */}
          {stats != null && (
            <div className="rounded-theme border border-border-theme bg-surface-card p-4">
              <h3 className="mb-3 text-sm font-semibold tracking-wider text-on-surface-muted uppercase">
                Quick Stats
              </h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-on-surface-muted">Total Filings</dt>
                  <dd className="text-2xl font-bold text-on-surface">{stats.totalFilings}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-muted">Distinct Applicants</dt>
                  <dd className="text-2xl font-bold text-on-surface">
                    {stats.distinctApplicantCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-on-surface-muted">Most Recent Filing</dt>
                  <dd className="font-medium text-on-surface">
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
