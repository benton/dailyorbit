import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.tsx';

type CompanyAlias = {
  aliasName: string;
  aliasType: string;
  companyId: number;
};

type CompanyListItem = {
  filingCount: number;
  id: number;
  name: string;
  parentName: string | null;
};

type OwnershipEvent = {
  description: string | null;
  effectiveDate: string | null;
  eventId: number;
  eventType: string;
  filingFileNumber: string;
  status: string;
  transfereeCompanyId: number | null;
  transferorCompanyId: number | null;
};

type Company = {
  createdAt: string;
  description: string | null;
  gleifLei: string | null;
  id: number;
  industry: string | null;
  logoUrl: string | null;
  name: string;
  parentCompanyId: number | null;
  stockExchange: string | null;
  stockTicker: string | null;
  updatedAt: string;
  website: string | null;
  wikidataId: string | null;
};

type CompanyDetail = {
  aliases: CompanyAlias[];
  company: Company;
  filingCount: number;
  ownershipEvents: OwnershipEvent[];
  parent: CompanyListItem | null;
  subsidiaries: CompanyListItem[];
};

function formatDate(iso: string | null): string {
  if (iso == null) {
    return '';
  }
  return new Date(iso).toLocaleDateString();
}

// ── Ownership events column definitions ─────────────────────────────

const ownershipEventColumns: Array<ColumnDef<OwnershipEvent, unknown>> = [
  {
    accessorKey: 'filingFileNumber',
    cell: ({ getValue }) => {
      const fn: string = getValue() as string;
      return (
        <Link
          className="text-blue-600 hover:underline dark:text-blue-400"
          onClick={(e) => e.stopPropagation()}
          to={`/filings/${fn}`}
        >
          {fn}
        </Link>
      );
    },
    header: 'Filing',
    size: 240,
  },
  {
    accessorKey: 'eventType',
    cell: ({ getValue }) => {
      const val: string = getValue() as string;
      return val === 'transfer_of_control' ? 'Transfer of Control' : 'Assignment';
    },
    header: 'Type',
    size: 160,
  },
  {
    accessorKey: 'status',
    cell: ({ getValue }) => {
      const status: string = getValue() as string;
      const classes: string =
        status === 'granted'
          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
          : status === 'pending'
            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
            : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
      return (
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${classes}`}>
          {status}
        </span>
      );
    },
    header: 'Status',
    size: 100,
  },
  {
    accessorKey: 'effectiveDate',
    cell: ({ getValue }) => formatDate(getValue() as string | null),
    header: 'Date',
    size: 120,
  },
];

// ── Client-side sortable data table ─────────────────────────────────

type SimpleTableProps<TData> = {
  columns: Array<ColumnDef<TData, unknown>>;
  data: Array<TData>;
  defaultOrder?: 'asc' | 'desc';
  defaultSort?: string;
};

function SimpleTable<TData>({
  columns,
  data,
  defaultOrder = 'asc',
  defaultSort,
}: SimpleTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(
    defaultSort != null ? [{ desc: defaultOrder === 'desc', id: defaultSort }] : [],
  );

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
              <TableRow key={row.id}>
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
  );
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);

  useEffect(() => {
    let cancelled: boolean = false;
    setLoading(true);
    setError(null);
    setNotFound(false);

    apiFetch<CompanyDetail>(`/api/companies/${id}`)
      .then((data: CompanyDetail) => {
        if (cancelled) {
          return;
        }
        setDetail(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else {
          const message: string = error instanceof Error ? error.message : 'Failed to load company';
          setError(message);
        }
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

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-neutral-500 dark:text-neutral-400">
        Loading company data...
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-2">
        <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Company not found
        </span>
      </div>
    );
  }

  if (error != null || detail == null) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-red-600 dark:text-red-400">
        {error ?? 'An unexpected error occurred'}
      </div>
    );
  }

  const { aliases, company, filingCount, ownershipEvents, parent, subsidiaries } = detail;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {company.name}
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500 dark:text-neutral-400">
          {company.stockTicker != null && (
            <span>
              {company.stockExchange ?? ''}: {company.stockTicker}
            </span>
          )}
          {company.industry != null && <span>{company.industry}</span>}
          <span>{filingCount.toLocaleString()} filings</span>
        </div>
        {company.description != null && (
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{company.description}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Subsidiaries */}
          {subsidiaries.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Subsidiaries
              </h2>
              <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700">
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Name
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-neutral-500 dark:text-neutral-400">
                        Filings
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {subsidiaries.map((sub: CompanyListItem) => (
                      <tr
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                        key={sub.id}
                      >
                        <td className="px-4 py-2 font-medium">
                          <Link
                            className="text-blue-600 hover:underline dark:text-blue-400"
                            to={`/companies/${sub.id}`}
                          >
                            {sub.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-right text-neutral-500 dark:text-neutral-400">
                          {sub.filingCount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Ownership Events */}
          {ownershipEvents.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Ownership Events
              </h2>
              <SimpleTable<OwnershipEvent>
                columns={ownershipEventColumns}
                data={ownershipEvents}
                defaultOrder="desc"
                defaultSort="effectiveDate"
              />
            </section>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Company info card */}
          <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="mb-3 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
              Company Details
            </h3>
            <dl className="space-y-3 text-sm">
              {parent != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Parent Company</dt>
                  <dd>
                    <Link
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      to={`/companies/${parent.id}`}
                    >
                      {parent.name}
                    </Link>
                  </dd>
                </div>
              )}
              {company.website != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Website</dt>
                  <dd>
                    <a
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      href={company.website}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {company.website}
                    </a>
                  </dd>
                </div>
              )}
              {company.gleifLei != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">GLEIF LEI</dt>
                  <dd className="font-mono text-xs text-neutral-900 dark:text-neutral-100">
                    {company.gleifLei}
                  </dd>
                </div>
              )}
              {company.wikidataId != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Wikidata</dt>
                  <dd>
                    <a
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      href={`https://www.wikidata.org/wiki/${company.wikidataId}`}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {company.wikidataId}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Aliases card */}
          {aliases.length > 0 && (
            <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <h3 className="mb-3 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
                Known Aliases ({aliases.length})
              </h3>
              <ul className="space-y-1 text-sm">
                {aliases.map((alias: CompanyAlias) => (
                  <li className="text-neutral-700 dark:text-neutral-300" key={alias.aliasName}>
                    {alias.aliasName}
                    <span className="ml-1 text-xs text-neutral-400 dark:text-neutral-500">
                      ({alias.aliasType})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
