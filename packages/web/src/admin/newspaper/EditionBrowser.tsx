import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api.ts';
import { Badge } from '../../ui/badge.tsx';

type EditionStatus = 'pending' | 'generating' | 'complete' | 'failed';
type EditionType = 'daily' | 'weekly';

type EditionSummary = {
  createdAt: string;
  editionDate: string;
  editionType: EditionType;
  heroImagePath: string | null;
  id: number;
  status: EditionStatus;
  updatedAt: string;
};

const STATUS_COLORS: Record<EditionStatus, 'default' | 'secondary' | 'destructive'> = {
  complete: 'default',
  failed: 'destructive',
  generating: 'default',
  pending: 'secondary',
};

function formatRelativeTime(iso: string): string {
  const diff: number = Date.now() - new Date(iso).getTime();
  const mins: number = Math.floor(diff / 60_000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours: number = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days: number = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function EditionBrowser() {
  const [editions, setEditions] = useState<Array<EditionSummary>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEditions = useCallback(async () => {
    try {
      const data: Array<EditionSummary> = await apiFetch(
        '/api/newspaper/editions?limit=50&offset=0',
      );
      setEditions(data);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Failed to load editions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEditions();
  }, [fetchEditions]);

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading editions...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Newspaper Editions
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Browse generated newspaper editions and their articles.
        </p>
      </div>

      {editions.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No editions yet. Run the newspaper pipeline to generate content.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Generated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {editions.map((edition) => (
                <tr
                  className="bg-white transition-colors hover:bg-neutral-50 dark:bg-neutral-950 dark:hover:bg-neutral-900"
                  key={edition.id}
                >
                  <td className="px-4 py-3">
                    <Link
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      to={`/admin/newspaper/${edition.editionDate}`}
                    >
                      {edition.editionDate}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize">{edition.editionType}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_COLORS[edition.status]}>{edition.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {formatRelativeTime(edition.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
