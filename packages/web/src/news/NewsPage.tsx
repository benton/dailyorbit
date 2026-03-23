import type { ColumnDef } from '@tanstack/react-table';
import { Eye, EyeOff } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';
import { HideToggle } from '../ui/HideToggle.tsx';
import { useAuth } from '../user/AuthContext.tsx';

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
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState<boolean>(false);

  const checkHiddenKeys = useCallback(async (keys: Array<string>): Promise<void> => {
    if (keys.length === 0) {
      return;
    }
    try {
      const result = await apiFetch<{ hidden: Array<string> }>(
        '/api/user/hidden-items/bulk-check',
        {
          body: JSON.stringify({ content_keys: keys, content_type: 'news' }),
          method: 'POST',
        },
      );
      setHiddenKeys(new Set(result.hidden));
    } catch {
      // Silently ignore — hidden state is non-critical
    }
  }, []);

  const fetchNews = useCallback(
    async (params: DataTableFetchParams): Promise<PaginatedResponse<NewsListItem>> => {
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
      if (showHidden) {
        parts.push('show_hidden=true');
      }
      const result = await apiFetch<PaginatedResponse<NewsListItem>>(
        `/api/news?${parts.join('&')}`,
      );
      const keys: Array<string> = result.data.map((r: NewsListItem) => String(r.id));
      if (isAuthenticated) {
        void checkHiddenKeys(keys);
      }
      return result;
    },
    [checkHiddenKeys, showHidden],
  );

  const onRowClick = useCallback(
    (row: NewsListItem) => {
      void navigate(`/news/${String(row.id)}`);
    },
    [navigate],
  );

  const cols = useMemo((): Array<ColumnDef<NewsListItem, unknown>> => {
    const hideCol: ColumnDef<NewsListItem, unknown> = {
      cell: ({ row }) => {
        const isHidden: boolean = hiddenKeys.has(String(row.original.id));
        return (
          <div className="flex items-center gap-1">
            <HideToggle
              contentKey={String(row.original.id)}
              contentType="news"
              initialHidden={isHidden}
              onToggle={(nowHidden: boolean) => {
                setHiddenKeys((prev: Set<string>) => {
                  const next: Set<string> = new Set(prev);
                  if (nowHidden) {
                    next.add(String(row.original.id));
                  } else {
                    next.delete(String(row.original.id));
                  }
                  return next;
                });
              }}
            />
            {showHidden && isHidden && (
              <span className="rounded bg-neutral-200 px-1 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                Hidden
              </span>
            )}
          </div>
        );
      },
      header: () => <EyeOff className="h-4 w-4 text-neutral-400" />,
      id: 'hide',
      size: 80,
    };
    return isAuthenticated ? [...newsColumns, hideCol] : newsColumns;
  }, [hiddenKeys, showHidden, isAuthenticated]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">News</h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Satellite industry news aggregated from RSS feeds.
      </p>
      {isAuthenticated && (
        <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-400">
          <input
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            type="checkbox"
          />
          <Eye className="h-3.5 w-3.5" />
          Show hidden items
        </label>
      )}
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
