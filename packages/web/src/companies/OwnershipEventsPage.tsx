import type { ColumnDef } from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { filingUrl } from '../lib/filing-url.ts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.tsx';

type OwnershipEventItem = {
  description: string | null;
  effectiveDate: string | null;
  eventId: number;
  eventType: string;
  filingFileNumber: string;
  status: string;
  transfereeName: string | null;
  transferorName: string | null;
};

const columns: Array<ColumnDef<OwnershipEventItem, unknown>> = [
  {
    accessorKey: 'effectiveDate',
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return v != null ? new Date(v).toLocaleDateString() : '';
    },
    header: 'Date',
    size: 120,
  },
  {
    accessorKey: 'eventType',
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return v === 'transfer_of_control' ? 'Transfer of Control' : 'Assignment';
    },
    header: 'Type',
    size: 160,
  },
  {
    accessorKey: 'transferorName',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Transferor',
    size: 220,
  },
  {
    accessorKey: 'transfereeName',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Transferee',
    size: 220,
  },
  {
    accessorKey: 'filingFileNumber',
    cell: ({ row }) => (
      <Link
        className="font-mono text-blue-600 hover:underline dark:text-blue-400"
        to={filingUrl(row.original.filingFileNumber)}
      >
        {row.original.filingFileNumber}
      </Link>
    ),
    header: 'Filing',
    size: 240,
  },
  {
    accessorKey: 'status',
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return v.charAt(0).toUpperCase() + v.slice(1);
    },
    header: 'Status',
    size: 100,
  },
];

export default function OwnershipEventsPage() {
  const [events, setEvents] = useState<Array<OwnershipEventItem>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sorting, setSorting] = useState<SortingState>([{ desc: true, id: 'effectiveDate' }]);

  useEffect(() => {
    apiFetch<Array<OwnershipEventItem>>('/api/companies/ownership-events/recent?limit=100')
      .then((data: Array<OwnershipEventItem>) => {
        setEvents(data);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const cols = useMemo(() => columns, []);

  // eslint-disable-next-line react-hooks-js/incompatible-library
  const table = useReactTable<OwnershipEventItem>({
    columns: cols,
    data: events,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">M&amp;A Activity</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          Recent ownership events from FCC Transfer of Control and Assignment filings
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-on-surface-muted">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-on-surface-muted">No ownership events found.</p>
      ) : (
        <div className="rounded-md border border-border-theme bg-white dark:border-border-theme dark:bg-surface-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      className="cursor-pointer select-none"
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{ width: header.getSize() }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: ' \u25B2', desc: ' \u25BC' }[header.column.getIsSorted() as string] ??
                        ''}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
