import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';

type NewsListItem = {
  author: string | null;
  extractStatus: string;
  id: number;
  newsSourceId: number;
  publishedAt: string | null;
  sourceName: string | null;
  sourceUrl: string;
  title: string;
};

const newsColumns: Array<ColumnDef<NewsListItem, unknown>> = [
  {
    accessorKey: 'publishedAt',
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return v != null ? new Date(v).toLocaleDateString() : '—';
    },
    header: 'Published',
    size: 110,
  },
  {
    accessorKey: 'title',
    cell: ({ getValue }) => <span className="line-clamp-1">{getValue() as string}</span>,
    header: 'Title',
    size: 450,
  },
  {
    accessorKey: 'sourceName',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Source',
    size: 130,
  },
  {
    accessorKey: 'author',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Author',
    size: 150,
  },
  {
    accessorKey: 'extractStatus',
    header: 'Status',
    size: 100,
  },
];

export default function NewsPage() {
  const navigate = useNavigate();

  const fetchNews = useCallback(
    (params: DataTableFetchParams): Promise<PaginatedResponse<NewsListItem>> => {
      const parts: Array<string> = [
        `page=${String(params.page)}`,
        `pageSize=${String(params.pageSize)}`,
      ];
      if (params.sort != null) {
        parts.push(`sort=${params.sort}`);
      }
      if (params.order != null) {
        parts.push(`order=${params.order}`);
      }
      return apiFetch<PaginatedResponse<NewsListItem>>(`/api/news?${parts.join('&')}`);
    },
    [],
  );

  const onRowClick = useCallback(
    (row: NewsListItem) => {
      void navigate(`/news/${String(row.id)}`);
    },
    [navigate],
  );

  const cols = useMemo(() => newsColumns, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">News</h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Satellite industry news aggregated from RSS feeds.
      </p>
      <DataTable<NewsListItem>
        columns={cols}
        defaultOrder="desc"
        defaultSort="published_at"
        fetchData={fetchNews}
        onRowClick={onRowClick}
      />
    </div>
  );
}
