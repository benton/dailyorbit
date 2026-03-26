import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { filingUrl } from '../lib/filing-url.ts';
import { Badge } from '../ui/badge.tsx';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.tsx';

// ── Types matching server-side models (camelCase) ────────────────────────────

type EarthStationInfo = {
  applicantCity: string | null;
  applicantCountry: string | null;
  applicantName: string | null;
  applicantState: string | null;
  callsign: string;
  mostRecentDateFiled: string | null;
  mostRecentFileNumber: string;
  mostRecentStatus: string | null;
};

type EarthStationFiling = {
  appTypeCode: string;
  dateExpire: string | null;
  dateFiled: string | null;
  dateGrant: string | null;
  description: string | null;
  fileNumber: string;
  filingKey: number;
  statusCode: string | null;
  summary: string | null;
};

type AntennaFrequency = {
  eirp: number | null;
  eirpDensity: number | null;
  emission: string | null;
  frequencyKey: number;
  frequencyLower: string | null;
  frequencyUpper: string | null;
  modulation: string | null;
  polarizationCode: string | null;
  transMode: string | null;
};

type EarthStationAntenna = {
  antennaId: string;
  antennaKey: number;
  diameter: number | null;
  frequencies: Array<AntennaFrequency>;
  manufacturer: string | null;
  maxInputPower: number | null;
  maxOutputEirp: number | null;
  model: string | null;
  siteKey: number;
};

type EarthStationStats = {
  antennaCount: number;
  mostRecentFilingDate: string | null;
  totalFilingCount: number;
};

type EarthStationResponse = {
  antennas: Array<EarthStationAntenna>;
  filings: PaginatedResponse<EarthStationFiling>;
  info: EarthStationInfo;
  stats: EarthStationStats;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Determine whether a station status is "active" for badge display */
function isActiveStatus(status: string | null): boolean {
  if (status == null) {
    return false;
  }
  const normalized: string = status.toLowerCase();
  return normalized.includes('grant') || normalized.includes('active') || normalized === 'g';
}

function formatFrequency(value: string | null): string {
  if (value == null) {
    return '';
  }
  const mhz: number = Number(value);
  if (Number.isNaN(mhz)) {
    return value;
  }
  if (mhz >= 1000) {
    return `${(mhz / 1000).toFixed(3)} GHz`;
  }
  return `${mhz.toFixed(2)} MHz`;
}

// ── Filing Columns ───────────────────────────────────────────────────────────

const filingColumns: Array<ColumnDef<EarthStationFiling, unknown>> = [
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
    header: 'Type',
    size: 80,
  },
  {
    accessorKey: 'dateFiled',
    cell: ({ row }) => {
      const raw: string | null = row.original.dateFiled;
      if (raw == null) {
        return '';
      }
      return new Date(raw).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    },
    header: 'Date Filed',
    size: 120,
  },
  {
    accessorKey: 'statusCode',
    header: 'Status',
    size: 100,
  },
  {
    accessorKey: 'description',
    header: 'Description',
    size: 200,
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function EarthStationDetail() {
  const { callsign } = useParams<{ callsign: string }>();

  const [info, setInfo] = useState<EarthStationInfo | null>(null);
  const [antennas, setAntennas] = useState<Array<EarthStationAntenna>>([]);
  const [stats, setStats] = useState<EarthStationStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch non-paginated data on mount
  useEffect(() => {
    if (callsign == null) {
      return;
    }
    let cancelled: boolean = false;
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setLoading(true);
    setError(null);

    apiFetch<EarthStationResponse>(`/api/earth-stations/${encodeURIComponent(callsign)}`)
      .then((response: EarthStationResponse) => {
        if (cancelled) {
          return;
        }
        setInfo(response.info);
        setAntennas(response.antennas);
        setStats(response.stats);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setError(error instanceof Error ? error.message : 'Failed to load earth station');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [callsign]);

  // Fetch function for DataTable (server-side pagination)
  const fetchFilings = useCallback(
    async (params: DataTableFetchParams): Promise<PaginatedResponse<EarthStationFiling>> => {
      if (callsign == null) {
        return { data: [], page: 1, pageSize: params.pageSize, totalPages: 0, totalRows: 0 };
      }
      const searchParams: URLSearchParams = new URLSearchParams({
        page: String(params.page),
        pageSize: String(params.pageSize),
      });
      if (params.sort != null) {
        searchParams.set('sort', params.sort);
      }
      if (params.order != null) {
        searchParams.set('order', params.order);
      }

      const response: EarthStationResponse = await apiFetch<EarthStationResponse>(
        `/api/earth-stations/${encodeURIComponent(callsign)}?${searchParams.toString()}`,
      );
      return response.filings;
    },
    [callsign],
  );

  // Memoize columns to avoid unnecessary re-renders
  const columns: Array<ColumnDef<EarthStationFiling, unknown>> = useMemo(() => filingColumns, []);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-on-surface-muted">Loading earth station...</p>
      </div>
    );
  }

  if (error != null || info == null) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error ?? 'Station not found'}</p>
      </div>
    );
  }

  const active: boolean = isActiveStatus(info.mostRecentStatus);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-on-surface">
              Earth Station {info.callsign}
            </h1>
            <Badge variant={active ? 'default' : 'secondary'}>
              {active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-on-surface-muted">
            {info.applicantName ?? 'Unknown applicant'}
          </p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: filings + antennas */}
        <div className="space-y-6 lg:col-span-2">
          {/* Filings table */}
          <section>
            <h2 className="mb-3 text-lg font-medium text-on-surface">Associated Filings</h2>
            <DataTable<EarthStationFiling>
              columns={columns}
              defaultOrder="desc"
              defaultPageSize={10}
              defaultSort="date_filed"
              fetchData={fetchFilings}
              paramPrefix="f_"
              rowTooltip={(row: EarthStationFiling) => row.summary}
            />
          </section>

          {/* Antennas & Frequencies */}
          <section>
            <h2 className="mb-3 text-lg font-medium text-on-surface">Antennas &amp; Frequencies</h2>
            {antennas.length === 0 ? (
              <p className="text-sm text-on-surface-muted">No antenna data available.</p>
            ) : (
              <div className="space-y-4">
                {antennas.map((antenna: EarthStationAntenna) => (
                  <AntennaCard antenna={antenna} key={antenna.antennaKey} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Station Info Card */}
          <div className="rounded-theme border border-border-theme bg-surface-card p-4">
            <h3 className="mb-3 text-sm font-semibold tracking-wider text-on-surface-muted uppercase">
              Station Info
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-on-surface-muted">Callsign</dt>
                <dd className="font-mono text-on-surface">{info.callsign}</dd>
              </div>
              {(info.applicantCity != null || info.applicantState != null) && (
                <div>
                  <dt className="text-on-surface-muted">Location</dt>
                  <dd className="text-on-surface">
                    {[info.applicantCity, info.applicantState].filter(Boolean).join(', ')}
                    {info.applicantCountry != null && info.applicantCountry !== 'US' && (
                      <span className="ml-1 text-on-surface-muted">({info.applicantCountry})</span>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-on-surface-muted">Status</dt>
                <dd className="text-on-surface">{info.mostRecentStatus ?? 'Unknown'}</dd>
              </div>
            </dl>
          </div>

          {/* Quick Stats Card */}
          {stats != null && (
            <div className="rounded-theme border border-border-theme bg-surface-card p-4">
              <h3 className="mb-3 text-sm font-semibold tracking-wider text-on-surface-muted uppercase">
                Quick Stats
              </h3>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-muted">Total Filings</dt>
                  <dd className="font-semibold text-on-surface">{stats.totalFilingCount}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-muted">Antennas</dt>
                  <dd className="font-semibold text-on-surface">{stats.antennaCount}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-muted">Most Recent Filing</dt>
                  <dd className="text-on-surface">
                    {stats.mostRecentFilingDate != null
                      ? new Date(stats.mostRecentFilingDate).toLocaleDateString('en-US', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
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

// ── Antenna Card ─────────────────────────────────────────────────────────────

function AntennaCard({ antenna }: { antenna: EarthStationAntenna }) {
  return (
    <div className="rounded-theme border border-border-theme bg-surface-card">
      {/* Antenna header */}
      <div className="border-b border-border-theme px-4 py-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-on-surface">
            {[antenna.manufacturer, antenna.model].filter(Boolean).join(' ') || 'Unknown Antenna'}
          </h4>
          <span className="text-xs text-on-surface-muted">ID: {antenna.antennaId}</span>
        </div>
        <div className="mt-1 flex gap-4 text-xs text-on-surface-muted">
          {antenna.diameter != null && antenna.diameter > 0 && (
            <span>Diameter: {antenna.diameter}m</span>
          )}
          {antenna.maxInputPower != null && antenna.maxInputPower > 0 && (
            <span>Max Input Power: {antenna.maxInputPower} W</span>
          )}
          {antenna.maxOutputEirp != null && antenna.maxOutputEirp > 0 && (
            <span>Max EIRP: {antenna.maxOutputEirp} dBW</span>
          )}
        </div>
      </div>

      {/* Frequency table */}
      {antenna.frequencies.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Freq Lower</TableHead>
                <TableHead className="text-xs">Freq Upper</TableHead>
                <TableHead className="text-xs">Polarization</TableHead>
                <TableHead className="text-xs">Mode</TableHead>
                <TableHead className="text-xs">EIRP</TableHead>
                <TableHead className="text-xs">EIRP Density</TableHead>
                <TableHead className="text-xs">Emission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {antenna.frequencies.map((freq: AntennaFrequency) => (
                <TableRow key={freq.frequencyKey}>
                  <TableCell className="font-mono text-xs">
                    {formatFrequency(freq.frequencyLower)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatFrequency(freq.frequencyUpper)}
                  </TableCell>
                  <TableCell className="text-xs">{freq.polarizationCode ?? ''}</TableCell>
                  <TableCell className="text-xs">{freq.transMode ?? ''}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {freq.eirp != null && freq.eirp > 0 ? `${freq.eirp} dBW` : ''}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {freq.eirpDensity != null && freq.eirpDensity !== 0
                      ? `${freq.eirpDensity} dBW/Hz`
                      : ''}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{freq.emission ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {antenna.frequencies.length === 0 && (
        <p className="px-4 py-3 text-xs text-on-surface-muted">No frequency data available.</p>
      )}
    </div>
  );
}
