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
    return <p className="text-sm text-on-surface-muted">Loading editions...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">Newspaper Editions</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          Browse generated newspaper editions and their articles.
        </p>
      </div>

      {editions.length === 0 ? (
        <p className="text-sm text-on-surface-muted">
          No editions yet. Run the newspaper pipeline to generate content.
        </p>
      ) : (
        <div className="overflow-hidden rounded-theme border border-border-theme">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-on-surface-muted dark:bg-on-surface dark:text-on-surface-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Generated</th>
                <th className="px-4 py-3 font-medium">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-theme">
              {editions.map((edition) => (
                <tr
                  className="bg-white transition-colors hover:bg-surface dark:hover:bg-on-surface"
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
                  <td className="px-4 py-3 text-on-surface-muted">
                    {formatRelativeTime(edition.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                      to={`/admin/newspaper/${edition.editionDate}/view`}
                    >
                      View
                    </Link>
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
