import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api.ts';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../ui/dialog.tsx';

type EditionStatus = 'pending' | 'generating' | 'complete' | 'failed';
type EditionType = 'daily' | 'weekly';

type EditionSummary = {
  createdAt: string;
  editionDate: string;
  editionType: EditionType;
  heroImagePath: string | null;
  id: number;
  publishedAt: string | null;
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
  const [acting, setActing] = useState<string | null>(null);

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

  const handlePublishToggle = useCallback(
    async (date: string, isPublished: boolean) => {
      setActing(date);
      try {
        const action: string = isPublished ? 'unpublish' : 'publish';
        await apiFetch(`/api/admin/newspaper/edition/${date}/${action}`, {
          method: 'POST',
        });
        await fetchEditions();
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : 'Action failed');
      } finally {
        setActing(null);
      }
    },
    [fetchEditions],
  );

  const handleDelete = useCallback(
    async (date: string) => {
      setActing(date);
      try {
        await apiFetch(`/api/admin/newspaper/edition/${date}`, {
          method: 'DELETE',
        });
        await fetchEditions();
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : 'Delete failed');
      } finally {
        setActing(null);
      }
    },
    [fetchEditions],
  );

  // Generate for date
  const [generateDate, setGenerateDate] = useState<string>('');
  const [generating, setGenerating] = useState<boolean>(false);

  const handleGenerate = useCallback(async () => {
    if (!generateDate) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/newspaper/generate/${generateDate}`, {
        method: 'POST',
      });
      await fetchEditions();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [generateDate, fetchEditions]);

  // Regenerate existing edition
  const handleRegenerate = useCallback(
    async (date: string) => {
      setActing(date);
      try {
        await apiFetch(`/api/admin/newspaper/regenerate/${date}`, {
          method: 'POST',
        });
        await fetchEditions();
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : 'Regeneration failed');
      } finally {
        setActing(null);
      }
    },
    [fetchEditions],
  );

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading editions...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">Edition Manager</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          Manage newspaper editions: publish, unpublish, edit, or delete.
        </p>
      </div>

      <div className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-on-surface" htmlFor="generate-date">
            Generate Edition
          </label>
          <input
            className="rounded-theme border border-border-theme bg-surface px-3 py-1.5 text-sm text-on-surface"
            id="generate-date"
            onChange={(e) => setGenerateDate(e.target.value)}
            type="date"
            value={generateDate}
          />
        </div>
        <Button disabled={!generateDate || generating} onClick={() => void handleGenerate()}>
          {generating ? 'Generating...' : 'Generate'}
        </Button>
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
                <th className="px-4 py-3 font-medium">Published</th>
                <th className="px-4 py-3 font-medium">Generated</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-theme">
              {editions.map((edition) => {
                const isPublished: boolean = edition.publishedAt != null;
                const isBusy: boolean = acting === edition.editionDate;

                return (
                  <tr
                    className="bg-white transition-colors hover:bg-surface dark:hover:bg-on-surface"
                    key={edition.id}
                  >
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                        to={`/admin/maintain/newspaper/${edition.editionDate}`}
                      >
                        {edition.editionDate}
                      </Link>
                    </td>
                    <td className="px-4 py-3 capitalize">{edition.editionType}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_COLORS[edition.status]}>{edition.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${isPublished ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        title={isPublished ? `Published ${edition.publishedAt}` : 'Not published'}
                      />
                    </td>
                    <td className="px-4 py-3 text-on-surface-muted">
                      {formatRelativeTime(edition.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Button
                          disabled={isBusy || (!isPublished && edition.status !== 'complete')}
                          onClick={() => void handlePublishToggle(edition.editionDate, isPublished)}
                          size="sm"
                          variant="outline"
                        >
                          {isPublished ? 'Unpublish' : 'Publish'}
                        </Button>
                        <RegenerateEditionDialog
                          date={edition.editionDate}
                          disabled={isBusy}
                          onConfirm={() => void handleRegenerate(edition.editionDate)}
                        />
                        <DeleteEditionDialog
                          articleCount={0}
                          date={edition.editionDate}
                          disabled={isBusy}
                          onConfirm={() => void handleDelete(edition.editionDate)}
                        />
                        <Link
                          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                          to={`/admin/maintain/newspaper/${edition.editionDate}/view`}
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type RegenerateEditionDialogProps = {
  date: string;
  disabled: boolean;
  onConfirm: () => void;
};

function RegenerateEditionDialog({ date, disabled, onConfirm }: RegenerateEditionDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={disabled} size="sm" variant="outline">
          Regenerate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate edition {date}?</DialogTitle>
          <DialogDescription>
            This will delete the existing edition and all its articles, then regenerate everything
            from scratch. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onConfirm} variant="destructive">
              Regenerate
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DeleteEditionDialogProps = {
  articleCount: number;
  date: string;
  disabled: boolean;
  onConfirm: () => void;
};

function DeleteEditionDialog({ date, disabled, onConfirm }: DeleteEditionDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={disabled} size="sm" variant="destructive">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete edition {date}?</DialogTitle>
          <DialogDescription>
            This will permanently delete the edition and all its articles. This action cannot be
            undone. The edition can be regenerated later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onConfirm} variant="destructive">
              Delete Edition
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
