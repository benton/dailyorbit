import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { vg } from '@cosmograph/react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { filingUrl } from '../lib/filing-url.ts';
import { getSubsystem, SUBSYSTEM_CODES, SUBSYSTEM_COLORS } from '../lib/subsystems.ts';
import { useRowTooltip } from '../ui/SummaryTooltip.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.tsx';

type SubsystemCount = { count: number; subsystem_code: string };
type PublicStats = {
  attachment_count: number;
  comment_count: number;
  filing_count: number;
  filings_by_subsystem: Array<SubsystemCount>;
};

type YearlyFilingVolume = {
  count: number;
  subsystem_code: string;
  year: string;
};

type RecentFiling = {
  address_attention: string | null;
  app_type_code: string;
  callsign: string | null;
  company_name: string | null;
  date_filed: string | null;
  file_number: string;
  status_code: string | null;
  subsystem_code: string;
  summary: string | null;
};

type RecentFilingsResponse = {
  date: string;
  dayLabel: string;
  filings: Array<RecentFiling>;
};

type CompanyFilingVolume = {
  company_name: string;
  count: number;
  month: string;
};

// Distinct color palette for the company volume chart legend
const COMPANY_COLORS: Array<string> = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
  '#86bcb6',
];

type NewsListItem = {
  author: string | null;
  companyName: string | null;
  extractStatus: string;
  id: number;
  newsSourceId: number;
  publishedAt: string | null;
  sourceName: string | null;
  sourceUrl: string;
  summary: string | null;
  tags: Array<string>;
  title: string;
};

type PaginatedResponse<T> = {
  data: Array<T>;
  page: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
};

type ActiveFiling = {
  activity_count: number;
  company_name: string | null;
  file_number: string;
};

type TopLineStats = {
  filing_count: number;
  most_active_filings: Array<ActiveFiling>;
  recent_ownership_events: number;
};

// ── Column definitions for recent filings table ─────────────────────

const recentFilingColumns: Array<ColumnDef<RecentFiling, unknown>> = [
  {
    accessorKey: 'file_number',
    cell: ({ row }) => <span className="font-mono">{row.original.file_number}</span>,
    header: 'File Number',
    size: 220,
  },
  { accessorKey: 'subsystem_code', header: 'Subsystem', size: 80 },
  { accessorKey: 'app_type_code', header: 'App Type', size: 80 },
  { accessorKey: 'address_attention', header: 'Applicant', size: 180 },
  {
    accessorKey: 'company_name',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Company',
    size: 180,
  },
  { accessorKey: 'callsign', header: 'Callsign', size: 100 },
  { accessorKey: 'status_code', header: 'Status', size: 100 },
];

const newsColumns: Array<ColumnDef<NewsListItem, unknown>> = [
  {
    accessorKey: 'publishedAt',
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return v != null ? new Date(v).toLocaleDateString() : '—';
    },
    header: 'Date',
    size: 100,
  },
  {
    accessorKey: 'title',
    cell: ({ getValue }) => <span className="line-clamp-1">{getValue() as string}</span>,
    header: 'Title',
    size: 400,
  },
  {
    accessorKey: 'sourceName',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Source',
    size: 120,
  },
  {
    accessorKey: 'companyName',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Company',
    size: 150,
  },
];

// ── Client-side sortable data table (no pagination needed) ──────────

type SimpleDataTableProps<TData> = {
  columns: Array<ColumnDef<TData, unknown>>;
  data: Array<TData>;
  defaultOrder?: 'asc' | 'desc';
  defaultSort?: string;
  onRowClick?: (row: TData) => void;
  rowTooltip?: (row: TData) => string | null;
};

function SimpleDataTable<TData>({
  columns,
  data,
  defaultOrder = 'asc',
  defaultSort,
  onRowClick,
  rowTooltip,
}: SimpleDataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(
    defaultSort != null ? [{ desc: defaultOrder === 'desc', id: defaultSort }] : [],
  );
  const { getRowTooltipProps, tooltipPortal } = useRowTooltip<TData>(rowTooltip);

  // eslint-disable-next-line react-hooks-js/incompatible-library
  const table = useReactTable<TData>({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-700">
      <Table className="min-w-full">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort: boolean = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead
                    className="select-none"
                    key={header.id}
                    style={{ width: header.getSize() }}
                  >
                    <div
                      className={cn(
                        'flex items-center gap-1',
                        canSort &&
                          'cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100',
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && (
                        <span className="text-xs">
                          {sorted === 'asc' ? '\u25B2' : sorted === 'desc' ? '\u25BC' : '\u25B2'}
                        </span>
                      )}
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                className="h-24 text-center text-neutral-500 dark:text-neutral-400"
                colSpan={columns.length}
              >
                No results.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                className={cn(onRowClick && 'cursor-pointer')}
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                {...getRowTooltipProps(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {tooltipPortal}
    </div>
  );
}

const cardClass: string =
  'rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 p-4';

function CollapsibleCard({
  children,
  defaultOpen = true,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  subtitle?: string;
  title: string;
}) {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  return (
    <div className={cardClass}>
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
        )}
        <div>
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{title}</p>
          {subtitle != null && (
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{subtitle}</p>
          )}
        </div>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const volumeRef = useRef<HTMLDivElement>(null);
  const [volumeLoading, setVolumeLoading] = useState<boolean>(true);
  const [volumeCodes, setVolumeCodes] = useState<Array<string>>([]);

  const companyVolumeRef = useRef<HTMLDivElement>(null);
  const [companyVolumeLoading, setCompanyVolumeLoading] = useState<boolean>(true);
  const [companyNames, setCompanyNames] = useState<Array<string>>([]);

  const [recentFilings, setRecentFilings] = useState<Array<RecentFiling>>([]);
  const [recentDayLabel, setRecentDayLabel] = useState<string>('Yesterday');
  const [recentLoading, setRecentLoading] = useState<boolean>(true);

  const [topLine, setTopLine] = useState<TopLineStats | null>(null);

  const [newsItems, setNewsItems] = useState<Array<NewsListItem>>([]);
  const [newsLoading, setNewsLoading] = useState<boolean>(true);

  const fetchStats = useCallback(async () => {
    try {
      const data: PublicStats = await apiFetch<PublicStats>('/api/stats');
      setStats(data);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Recent filings
  useEffect(() => {
    let cancelled: boolean = false;
    apiFetch<RecentFilingsResponse>('/api/stats/recent-filings')
      .then((data: RecentFilingsResponse) => {
        if (!cancelled) {
          setRecentFilings(data.filings);
          setRecentDayLabel(`${data.dayLabel}'s Filings`);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setRecentLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Top-line stats
  useEffect(() => {
    let cancelled: boolean = false;
    apiFetch<TopLineStats>('/api/stats/top-line-stats')
      .then((data: TopLineStats) => {
        if (!cancelled) {
          setTopLine(data);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Recent news
  useEffect(() => {
    let cancelled: boolean = false;
    apiFetch<PaginatedResponse<NewsListItem>>('/api/news?pageSize=10&sort=published_at&order=desc')
      .then((data: PaginatedResponse<NewsListItem>) => {
        if (!cancelled) {
          setNewsItems(data.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setNewsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Company volume chart (last 3 months)
  useEffect(() => {
    let cancelled: boolean = false;

    async function renderCompanyVolume(): Promise<void> {
      try {
        const data: Array<CompanyFilingVolume> = await apiFetch<Array<CompanyFilingVolume>>(
          '/api/stats/recent-volume-by-company',
        );
        if (cancelled || companyVolumeRef.current == null) {
          return;
        }

        // Pick top N companies by total volume, group rest as "Other"
        const totals: Map<string, number> = new Map();
        for (const d of data) {
          totals.set(d.company_name, (totals.get(d.company_name) ?? 0) + d.count);
        }
        const sorted: Array<[string, number]> = [...totals.entries()].sort((a, b) => b[1] - a[1]);
        const topN: number = 10;
        const topSet: Set<string> = new Set(sorted.slice(0, topN).map(([name]) => name));

        const chartData: Array<{ company: string; count: number; month: string }> = [];
        const otherMap: Map<string, number> = new Map();

        for (const d of data) {
          if (topSet.has(d.company_name)) {
            chartData.push({ company: d.company_name, count: d.count, month: d.month });
          } else {
            otherMap.set(d.month, (otherMap.get(d.month) ?? 0) + d.count);
          }
        }
        for (const [month, count] of otherMap.entries()) {
          chartData.push({ company: 'Other', count, month });
        }

        const names: Array<string> = [...topSet];
        if (otherMap.size > 0) {
          names.push('Other');
        }

        const colors: Array<string> = names.map(
          (_: string, i: number) => COMPANY_COLORS[i % COMPANY_COLORS.length],
        );

        const chart = vg.plot(
          vg.barY(chartData, {
            fill: 'company',
            tip: true,
            x: 'month',
            y: 'count',
          }),
          vg.colorDomain(names),
          vg.colorRange(colors),
          vg.height(400),
          vg.width(800),
          vg.xLabel('Month'),
          vg.yGrid(true),
          vg.yLabel('Filings'),
        );

        if (!cancelled && companyVolumeRef.current != null) {
          companyVolumeRef.current.replaceChildren(chart);
          setCompanyNames(names);
          setCompanyVolumeLoading(false);
        }
      } catch {
        if (!cancelled) {
          setCompanyVolumeLoading(false);
        }
      }
    }

    void renderCompanyVolume();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filing volume chart (historical yearly)
  useEffect(() => {
    let cancelled: boolean = false;

    async function renderVolume(): Promise<void> {
      try {
        const data: Array<YearlyFilingVolume> = await apiFetch<Array<YearlyFilingVolume>>(
          '/api/stats/filing-volume',
        );
        if (cancelled || volumeRef.current == null) {
          return;
        }

        const chart = vg.plot(
          vg.barY(data, {
            fill: 'subsystem_code',
            tip: true,
            x: 'year',
            y: 'count',
          }),
          vg.colorDomain(SUBSYSTEM_CODES),
          vg.colorRange(SUBSYSTEM_COLORS),
          vg.height(260),
          vg.width(800),
          vg.xLabel('Year'),
          vg.xTickSpacing(120),
          vg.xTickRotate(-45),
          vg.yGrid(true),
          vg.yLabel('Filings'),
        );

        if (!cancelled && volumeRef.current != null) {
          volumeRef.current.replaceChildren(chart);
          const codes: Array<string> = [...new Set(data.map((d) => d.subsystem_code))];
          codes.sort();
          setVolumeCodes(codes);
          setVolumeLoading(false);
        }
      } catch {
        if (!cancelled) {
          setVolumeLoading(false);
        }
      }
    }

    void renderVolume();
    return () => {
      cancelled = true;
    };
  }, []);

  // Row click handler for recent filings
  const onRecentFilingClick = useCallback(
    (row: RecentFiling) => {
      void navigate(filingUrl(row.file_number));
    },
    [navigate],
  );

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading...</p>;
  }

  if (error != null || stats == null) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error ?? 'No data available'}</p>;
  }

  const maxSubsystemCount: number = Math.max(
    ...stats.filings_by_subsystem.map((s: SubsystemCount) => s.count),
    1,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          The Daily Orbit
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Satellite Communications Industry Assistant
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Total Filings */}
        <div className={cardClass}>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Total Filings</p>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
              {stats.filing_count.toLocaleString()}
            </p>
            <Link
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              to="/search"
            >
              <Search className="h-3.5 w-3.5" />
              Search
            </Link>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-neutral-500 dark:text-neutral-400">
            <span>{stats.comment_count.toLocaleString()} comments</span>
            <span>{stats.attachment_count.toLocaleString()} attachments</span>
          </div>
        </div>

        {/* M&A Activity */}
        {topLine != null && (
          <Link className="block" to="/ownership-events">
            <div
              className={`${cardClass} transition-colors hover:border-blue-300 dark:hover:border-blue-700`}
            >
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                M&amp;A Activity (Last Quarter)
              </p>
              <p className="mt-1 text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
                {topLine.recent_ownership_events.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                ownership events
              </p>
            </div>
          </Link>
        )}

        {/* Most Active Filings This Week */}
        {topLine != null && topLine.most_active_filings.length > 0 && (
          <div className={cardClass}>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Most Active This Week</p>
            <ul className="mt-2 space-y-1">
              {topLine.most_active_filings.slice(0, 3).map((f: ActiveFiling) => (
                <li className="flex items-center justify-between text-xs" key={f.file_number}>
                  <button
                    className="truncate font-mono text-blue-600 hover:underline dark:text-blue-400"
                    onClick={() => navigate(filingUrl(f.file_number))}
                    type="button"
                  >
                    {f.file_number}
                  </button>
                  <span className="ml-2 shrink-0 text-neutral-500 dark:text-neutral-400">
                    {f.activity_count} pleadings
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Recent Business Day Filings */}
      <div className={cardClass}>
        <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
          {recentDayLabel}
        </p>
        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          Filings recorded on the most recent business day.
        </p>
        <div className="mt-3">
          {recentLoading ? (
            <p className="text-sm text-neutral-500">Loading recent filings...</p>
          ) : recentFilings.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No filings recorded on the last business day.
            </p>
          ) : (
            <SimpleDataTable<RecentFiling>
              columns={recentFilingColumns}
              data={recentFilings}
              defaultOrder="asc"
              defaultSort="file_number"
              onRowClick={onRecentFilingClick}
              rowTooltip={(row: RecentFiling) => row.summary}
            />
          )}
        </div>
      </div>

      {/* Recent News */}
      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              Recent News
            </p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Latest satellite industry news from RSS feeds.
            </p>
          </div>
          <Link className="text-xs text-blue-600 hover:underline dark:text-blue-400" to="/news">
            View all →
          </Link>
        </div>
        <div className="mt-3">
          {newsLoading ? (
            <p className="text-sm text-neutral-500">Loading news...</p>
          ) : newsItems.length === 0 ? (
            <p className="text-sm text-neutral-500">No news articles available.</p>
          ) : (
            <SimpleDataTable<NewsListItem>
              columns={newsColumns}
              data={newsItems}
              defaultOrder="desc"
              defaultSort="publishedAt"
              onRowClick={(row: NewsListItem) => navigate(`/news/${String(row.id)}`)}
              rowTooltip={(row: NewsListItem) => row.summary}
            />
          )}
        </div>
      </div>

      {/* Last 6 Months Filing Volume by Company */}
      <CollapsibleCard
        subtitle="Monthly filing counts by company over the last 6 months."
        title="Last 6 Months Filing Volume by Company"
      >
        {companyVolumeLoading && (
          <p className="text-sm text-neutral-500">Loading company volume chart...</p>
        )}
        <div ref={companyVolumeRef} />
        {companyNames.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            {companyNames.map((name: string, i: number) => (
              <div className="flex items-center gap-1.5" key={name}>
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: COMPANY_COLORS[i % COMPANY_COLORS.length] }}
                />
                <span className="text-xs text-neutral-600 dark:text-neutral-400">{name}</span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* Total Filings by Subsystem */}
      <CollapsibleCard title="Total Filings by Subsystem">
        <div className="space-y-1.5">
          {stats.filings_by_subsystem.map((sub: SubsystemCount) => {
            const info = getSubsystem(sub.subsystem_code);
            const pct: number = (sub.count / maxSubsystemCount) * 100;
            return (
              <div className="flex items-center gap-2" key={sub.subsystem_code}>
                <span className="w-8 shrink-0 text-right font-mono text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  {sub.subsystem_code}
                </span>
                <span className="w-36 shrink-0 truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {info.label}
                </span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      backgroundColor: info.hex,
                      width: `${String(Math.max(pct, 0.5))}%`,
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-xs text-neutral-700 dark:text-neutral-300">
                  {sub.count.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleCard>

      {/* Historical Filing Volume by Year */}
      <CollapsibleCard
        subtitle="Stacked bar chart of filing counts per subsystem, grouped by year."
        title="Historical Filing Volume by Year"
      >
        {volumeLoading && (
          <p className="text-sm text-neutral-500">Loading filing volume chart...</p>
        )}
        <div ref={volumeRef} />
        {volumeCodes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            {volumeCodes.map((code: string) => {
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
      </CollapsibleCard>
    </div>
  );
}
