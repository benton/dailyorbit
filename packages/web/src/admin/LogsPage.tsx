import { type ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Button } from '../ui/button.tsx';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';

type QueryInfo = {
  defaultHours: number;
  description: string;
  name: string;
  needsArg: boolean;
};

type LogsResult = {
  columns: Array<string>;
  data: Array<Record<string, string>>;
  hours: number;
  query: string;
};

const HOURS_OPTIONS: Array<number> = [1, 6, 12, 24, 48, 72];
const REFRESH_OPTIONS: Array<{ label: string; value: number }> = [
  { label: 'Off', value: 0 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: '120s', value: 120 },
];

/** Columns that hold duration values — right-align them */
const DURATION_COLUMNS: Set<string> = new Set([
  'dur',
  'durationMs',
  'avg_ms',
  'max_ms',
  'cnt',
  'requests',
  'status',
  'lvl',
]);

/** Columns that hold timestamps — give them more width */
const WIDE_COLUMNS: Set<string> = new Set(['ts', '@timestamp']);

function formatTimestamp(value: string, useUtc: boolean): string {
  const date: Date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  if (useUtc) {
    return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
  }
  return date.toLocaleString();
}

function buildColumns(
  columnNames: Array<string>,
  useUtc: boolean,
): Array<ColumnDef<Record<string, string>, unknown>> {
  return columnNames.map((name: string) => {
    const isNumeric: boolean = DURATION_COLUMNS.has(name);
    const isWide: boolean = WIDE_COLUMNS.has(name);
    const isTimestamp: boolean = isWide; // timestamp columns are the wide ones
    return {
      accessorKey: name,
      cell: ({ getValue }) => {
        const val: unknown = getValue();
        if (val == null) {
          return <span />;
        }
        const str: string = String(val);
        const display: string = isTimestamp ? formatTimestamp(str, useUtc) : str;
        return <span className={isNumeric ? 'tabular-nums' : ''}>{display}</span>;
      },
      header: name,
      size: isWide ? 220 : isNumeric ? 100 : 160,
    } satisfies ColumnDef<Record<string, string>, unknown>;
  });
}

export default function LogsPage() {
  const [queriesInfo, setQueriesInfo] = useState<Array<QueryInfo>>([]);
  const [selectedQuery, setSelectedQuery] = useState<string>('');
  const [hours, setHours] = useState<number>(24);
  const [arg, setArg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LogsResult | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<number>(30);
  const [autoRefreshActive, setAutoRefreshActive] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [useUtc, setUseUtc] = useState<boolean>(true);

  // Fetch available queries on mount
  useEffect(() => {
    apiFetch<Array<QueryInfo>>('/api/admin/logs/queries').then((data: Array<QueryInfo>) => {
      setQueriesInfo(data);
      if (data.length > 0 && selectedQuery === '') {
        setSelectedQuery(data[0]!.name);
        setHours(data[0]!.defaultHours);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedInfo: QueryInfo | undefined = queriesInfo.find(
    (q: QueryInfo) => q.name === selectedQuery,
  );

  // Update default hours when query selection changes
  const handleQueryChange = useCallback(
    (name: string) => {
      setSelectedQuery(name);
      const info: QueryInfo | undefined = queriesInfo.find((q: QueryInfo) => q.name === name);
      if (info != null) {
        setHours(info.defaultHours);
      }
      setArg('');
      setAutoRefreshActive(false);
    },
    [queriesInfo],
  );

  // Use ref so the interval callback always sees current params
  const runQueryRef = useRef<() => Promise<void>>(async () => {});

  const runQuery = useCallback(async () => {
    if (selectedQuery === '') {
      return;
    }
    setLoading(true);
    setError(null);

    const params: URLSearchParams = new URLSearchParams();
    params.set('query', selectedQuery);
    params.set('hours', String(hours));
    if (selectedInfo?.needsArg && arg.trim() !== '') {
      params.set('arg', arg.trim());
    }

    try {
      const data: LogsResult = await apiFetch<LogsResult>(`/api/admin/logs?${params.toString()}`);
      setResult(data);
      setLastRefreshed(new Date());
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : 'Query failed';
      setError(msg);
      setAutoRefreshActive(false);
    } finally {
      setLoading(false);
    }
  }, [selectedQuery, hours, arg, selectedInfo]);

  runQueryRef.current = runQuery;

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefreshActive || refreshInterval === 0) {
      return;
    }
    const id: ReturnType<typeof setInterval> = setInterval(() => {
      void runQueryRef.current?.();
    }, refreshInterval * 1000);
    return () => {
      clearInterval(id);
    };
  }, [autoRefreshActive, refreshInterval]);

  // Build dynamic columns from result
  const columns: Array<ColumnDef<Record<string, string>, unknown>> = useMemo(
    () => (result != null ? buildColumns(result.columns, useUtc) : []),
    [result, useUtc],
  );

  // Client-side pagination adapter — sort and paginate locally
  // Use ref to avoid re-creating fetchData on every render
  const cachedDataRef = useRef<Array<Record<string, string>>>([]);
  cachedDataRef.current = result?.data ?? [];

  const fetchData = useCallback(
    async (params: DataTableFetchParams): Promise<PaginatedResponse<Record<string, string>>> => {
      const sorted: Array<Record<string, string>> = [...cachedDataRef.current];

      if (params.sort != null) {
        const key: string = params.sort;
        const dir: number = params.order === 'desc' ? -1 : 1;
        sorted.sort((a: Record<string, string>, b: Record<string, string>) => {
          const aVal: string = a[key] ?? '';
          const bVal: string = b[key] ?? '';
          // Try numeric comparison first
          const aNum: number = Number(aVal);
          const bNum: number = Number(bVal);
          if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
            return (aNum - bNum) * dir;
          }
          return aVal.localeCompare(bVal) * dir;
        });
      }

      const start: number = (params.page - 1) * params.pageSize;
      const pageData: Array<Record<string, string>> = sorted.slice(start, start + params.pageSize);
      const totalRows: number = sorted.length;
      const totalPages: number = Math.max(1, Math.ceil(totalRows / params.pageSize));

      return {
        data: pageData,
        page: params.page,
        pageSize: params.pageSize,
        totalPages,
        totalRows,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cachedDataRef is stable
    [result],
  );

  const handleRunAndWatch = useCallback(() => {
    void runQuery();
    if (refreshInterval > 0) {
      setAutoRefreshActive(true);
    }
  }, [runQuery, refreshInterval]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-on-surface">Logs</h1>

      {/* Query selector */}
      <div className="space-y-4 rounded-theme border border-border-theme bg-surface-card p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-on-surface">Query</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {queriesInfo.map((q: QueryInfo) => (
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-theme border p-3 text-sm ${
                  selectedQuery === q.name
                    ? 'border-accent-theme bg-accent-theme/10'
                    : 'border-border-theme hover:bg-on-surface/5'
                }`}
                key={q.name}
              >
                <input
                  checked={selectedQuery === q.name}
                  className="mt-0.5"
                  name="query"
                  onChange={() => handleQueryChange(q.name)}
                  type="radio"
                  value={q.name}
                />
                <div>
                  <div className="font-medium text-on-surface">{q.name}</div>
                  <div className="text-on-surface-muted">{q.description}</div>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Arg input for parameterized queries */}
        <div className="flex flex-wrap items-end gap-4">
          {selectedInfo?.needsArg && (
            <div>
              <label className="mb-1 block text-sm font-medium text-on-surface" htmlFor="logs-arg">
                Argument
              </label>
              <input
                className="rounded-theme border border-border-theme bg-transparent px-3 py-1.5 text-sm text-on-surface"
                id="logs-arg"
                onChange={(e) => setArg(e.target.value)}
                placeholder={selectedQuery === 'path' ? '/api/filings' : 'search text...'}
                type="text"
                value={arg}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-on-surface" htmlFor="logs-hours">
              Time range
            </label>
            <select
              className="rounded-theme border border-border-theme bg-transparent px-3 py-1.5 text-sm text-on-surface"
              id="logs-hours"
              onChange={(e) => setHours(Number(e.target.value))}
              value={hours}
            >
              {HOURS_OPTIONS.map((h: number) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="mb-1 block text-sm font-medium text-on-surface"
              htmlFor="logs-refresh"
            >
              Auto-refresh
            </label>
            <select
              className="rounded-theme border border-border-theme bg-transparent px-3 py-1.5 text-sm text-on-surface"
              id="logs-refresh"
              onChange={(e) => {
                const val: number = Number(e.target.value);
                setRefreshInterval(val);
                if (val === 0) {
                  setAutoRefreshActive(false);
                }
              }}
              value={refreshInterval}
            >
              {REFRESH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-on-surface" htmlFor="logs-tz">
              Timestamps
            </label>
            <select
              className="rounded-theme border border-border-theme bg-transparent px-3 py-1.5 text-sm text-on-surface"
              id="logs-tz"
              onChange={(e) => setUseUtc(e.target.value === 'utc')}
              value={useUtc ? 'utc' : 'local'}
            >
              <option value="utc">UTC</option>
              <option value="local">Local</option>
            </select>
          </div>

          <Button
            disabled={
              loading ||
              selectedQuery === '' ||
              (selectedInfo?.needsArg === true && arg.trim() === '')
            }
            onClick={handleRunAndWatch}
          >
            {loading ? 'Running...' : 'Run Query'}
          </Button>

          {autoRefreshActive && (
            <Button onClick={() => setAutoRefreshActive(false)} variant="outline">
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error != null && (
        <div className="rounded-theme border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {result != null && columns.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-on-surface-muted">
            {result.data.length} rows &middot; {result.query} &middot; last {result.hours}h
            {lastRefreshed != null && <> &middot; refreshed {lastRefreshed.toLocaleTimeString()}</>}
            {autoRefreshActive && <> &middot; next in {refreshInterval}s</>}
          </p>
          <DataTable<Record<string, string>>
            columns={columns}
            defaultPageSize={50}
            fetchData={fetchData}
            pageSizeOptions={[25, 50, 100, 200]}
          />
        </div>
      )}

      {result != null && result.data.length === 0 && (
        <p className="text-sm text-on-surface-muted">
          No results found for this query and time range.
        </p>
      )}
    </div>
  );
}
