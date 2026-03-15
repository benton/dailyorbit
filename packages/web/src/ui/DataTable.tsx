import {
  type ColumnDef,
  type ColumnResizeMode,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { cn } from '../lib/cn.ts';
import { Button } from './button.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.tsx';

/** Matches the server-side PaginatedResponse envelope */
export type PaginatedResponse<T> = {
  data: T[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
};

/** Sort direction, matching server-side SortOrder */
export type SortOrder = 'asc' | 'desc';

/** Parameters passed to the fetch function */
export type DataTableFetchParams = {
  page: number;
  pageSize: number;
  sort?: string;
  order?: SortOrder;
};

/** Props for the DataTable component */
export type DataTableProps<TData> = {
  /** TanStack column definitions */
  columns: Array<ColumnDef<TData, unknown>>;
  /** Server-side data fetch function */
  fetchData: (params: DataTableFetchParams) => Promise<PaginatedResponse<TData>>;
  /** Default column to sort by */
  defaultSort?: string;
  /** Default sort direction */
  defaultOrder?: SortOrder;
  /** Default page size */
  defaultPageSize?: number;
  /** Available page size options */
  pageSizeOptions?: Array<number>;
  /** Optional callback when a row is clicked (e.g. for navigation) */
  onRowClick?: (row: TData) => void;
  /** Optional CSS class for the container */
  className?: string;
  /** Optional prefix for URL query params to avoid collisions between multiple tables */
  paramPrefix?: string;
};

const DEFAULT_PAGE_SIZE_OPTIONS: Array<number> = [10, 25, 50, 100];

/**
 * A reusable server-side paginated data table built on TanStack Table.
 *
 * Features:
 * - Server-side pagination with URL query param state
 * - Sortable columns (click header to toggle asc/desc)
 * - Resizable columns (drag handles on column borders)
 * - Loading and empty states
 * - Clickable rows (optional)
 */
export function DataTable<TData>({
  columns,
  fetchData,
  defaultSort,
  defaultOrder = 'asc',
  defaultPageSize = 25,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onRowClick,
  className,
  paramPrefix = '',
}: DataTableProps<TData>) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive pagination/sort state from URL query params
  const prefix: string = paramPrefix;
  const pageParam: number = Math.max(1, Number(searchParams.get(`${prefix}page`)) || 1);
  const pageSizeParam: number = Number(searchParams.get(`${prefix}pageSize`)) || defaultPageSize;
  const sortParam: string | undefined = searchParams.get(`${prefix}sort`) ?? defaultSort;
  const orderParam: SortOrder =
    searchParams.get(`${prefix}order`) === 'desc'
      ? 'desc'
      : searchParams.get(`${prefix}order`) === 'asc'
        ? 'asc'
        : defaultOrder;

  // Data state
  const [data, setData] = useState<Array<TData>>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Column resize mode
  const columnResizeMode: ColumnResizeMode = 'onChange';

  // Build TanStack sorting state from URL params
  const sorting: SortingState = useMemo((): SortingState => {
    if (sortParam == null) return [];
    return [{ id: sortParam, desc: orderParam === 'desc' }];
  }, [sortParam, orderParam]);

  // Update URL search params without replacing other params
  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      setSearchParams((prev: URLSearchParams) => {
        const next: URLSearchParams = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value == null) {
            next.delete(`${prefix}${key}`);
          } else {
            next.set(`${prefix}${key}`, value);
          }
        }
        return next;
      });
    },
    [setSearchParams, prefix],
  );

  // Fetch data whenever pagination/sort params change
  useEffect(() => {
    let cancelled: boolean = false;
    setLoading(true);
    setError(null);

    const params: DataTableFetchParams = {
      page: pageParam,
      pageSize: pageSizeParam,
      sort: sortParam,
      order: orderParam,
    };

    fetchData(params)
      .then((response: PaginatedResponse<TData>) => {
        if (cancelled) return;
        setData(response.data);
        setTotalRows(response.totalRows);
        setTotalPages(response.totalPages);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message: string = err instanceof Error ? err.message : 'Failed to fetch data';
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchData, pageParam, pageSizeParam, sortParam, orderParam]);

  // Handle column sort toggle
  const handleSort = useCallback(
    (columnId: string) => {
      const isCurrentSort: boolean = sortParam === columnId;
      const nextOrder: SortOrder =
        isCurrentSort && orderParam === 'asc'
          ? 'desc'
          : isCurrentSort && orderParam === 'desc'
            ? 'asc'
            : 'asc';
      updateParams({ sort: columnId, order: nextOrder, page: '1' });
    },
    [sortParam, orderParam, updateParams],
  );

  // Handle page change
  const goToPage = useCallback(
    (page: number) => {
      updateParams({ page: String(page) });
    },
    [updateParams],
  );

  // Handle page size change
  const changePageSize = useCallback(
    (size: number) => {
      updateParams({ pageSize: String(size), page: '1' });
    },
    [updateParams],
  );

  const table = useReactTable<TData>({
    data,
    columns,
    columnResizeMode,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount: totalPages,
    state: {
      sorting,
      pagination: { pageIndex: pageParam - 1, pageSize: pageSizeParam },
    },
  });

  return (
    <div className={cn('space-y-4', className)}>
      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-700">
        <Table style={{ width: table.getCenterTotalSize() }} className="min-w-full">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort: boolean = header.column.getCanSort();
                  const isSorted: false | 'asc' | 'desc' =
                    sortParam === header.column.id
                      ? orderParam === 'desc'
                        ? 'desc'
                        : 'asc'
                      : false;

                  return (
                    <TableHead
                      key={header.id}
                      className="relative select-none"
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          className={cn(
                            'flex items-center gap-1',
                            canSort &&
                              'cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100',
                          )}
                          onClick={canSort ? () => handleSort(header.column.id) : undefined}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && <SortIndicator direction={isSorted} />}
                        </div>
                      )}
                      {/* Column resize handle */}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            'absolute top-0 right-0 h-full w-1 cursor-col-resize select-none touch-none',
                            'bg-transparent hover:bg-neutral-300 dark:hover:bg-neutral-600',
                            header.column.getIsResizing() && 'bg-blue-500 dark:bg-blue-400',
                          )}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-neutral-500 dark:text-neutral-400"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-red-600 dark:text-red-400"
                >
                  {error}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-neutral-500 dark:text-neutral-400"
                >
                  No results found.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
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
      </div>

      {/* Pagination controls */}
      <div className="flex items-center justify-between text-sm text-neutral-600 dark:text-neutral-400">
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select
            value={pageSizeParam}
            onChange={(e) => changePageSize(Number(e.target.value))}
            className="rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          >
            {pageSizeOptions.map((size: number) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span>
            {totalRows === 0
              ? 'No results'
              : `Page ${pageParam} of ${totalPages} (${totalRows} total)`}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(1)}
              disabled={pageParam <= 1}
            >
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(pageParam - 1)}
              disabled={pageParam <= 1}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(pageParam + 1)}
              disabled={pageParam >= totalPages}
            >
              Next
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(totalPages)}
              disabled={pageParam >= totalPages}
            >
              Last
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sort direction indicator arrows */
function SortIndicator({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (direction === 'asc') {
    return (
      <span className="text-xs" aria-label="sorted ascending">
        {'\u25B2'}
      </span>
    );
  }
  if (direction === 'desc') {
    return (
      <span className="text-xs" aria-label="sorted descending">
        {'\u25BC'}
      </span>
    );
  }
  return <span className="text-xs text-neutral-300 dark:text-neutral-600">{'\u25B2'}</span>;
}
