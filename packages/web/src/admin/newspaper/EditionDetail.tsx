import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
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

type ArticleStatus = 'pending' | 'generated' | 'failed';
type EditionStatus = 'pending' | 'generating' | 'complete' | 'failed';

type Article = {
  body: string;
  contentType: string;
  createdAt: string;
  displayOrder: number;
  editionId: number;
  generatedBy: string | null;
  headline: string | null;
  id: number;
  imagePath: string | null;
  imagePrompt: string | null;
  slug: string;
  sourceData: string | null;
  status: ArticleStatus;
  updatedAt: string;
};

type EditionWithArticles = {
  articles: Array<Article>;
  createdAt: string;
  editionDate: string;
  editionType: string;
  heroImagePath: string | null;
  id: number;
  publishedAt: string | null;
  status: EditionStatus;
  updatedAt: string;
};

const ARTICLE_STATUS_COLORS: Record<ArticleStatus, 'default' | 'secondary' | 'destructive'> = {
  failed: 'destructive',
  generated: 'default',
  pending: 'secondary',
};

const EDITION_STATUS_COLORS: Record<EditionStatus, 'default' | 'secondary' | 'destructive'> = {
  complete: 'default',
  failed: 'destructive',
  generating: 'default',
  pending: 'secondary',
};

export default function EditionDetail() {
  const { date } = useParams<{ date: string }>();
  const [edition, setEdition] = useState<EditionWithArticles | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [acting, setActing] = useState<boolean>(false);

  const fetchEdition = useCallback(async () => {
    if (!date) {
      return;
    }
    try {
      const data: EditionWithArticles = await apiFetch(`/api/newspaper/edition/${date}`);
      setEdition(data);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Failed to load edition');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void fetchEdition();
  }, [fetchEdition]);

  const handleRegenerate = useCallback(
    async (slug: string) => {
      if (!date) {
        return;
      }
      setRegenerating(slug);
      try {
        await apiFetch(`/api/newspaper/edition/${date}/regenerate/${slug}`, {
          method: 'POST',
        });
        await fetchEdition();
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : 'Failed to regenerate');
      } finally {
        setRegenerating(null);
      }
    },
    [date, fetchEdition],
  );

  const handlePublishToggle = useCallback(async () => {
    if (!date || !edition) {
      return;
    }
    setActing(true);
    try {
      const action: string = edition.publishedAt ? 'unpublish' : 'publish';
      await apiFetch(`/api/admin/newspaper/edition/${date}/${action}`, {
        method: 'POST',
      });
      await fetchEdition();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Action failed');
    } finally {
      setActing(false);
    }
  }, [date, edition, fetchEdition]);

  const handleDelete = useCallback(async () => {
    if (!date) {
      return;
    }
    setActing(true);
    try {
      await apiFetch(`/api/admin/newspaper/edition/${date}`, {
        method: 'DELETE',
      });
      window.location.href = '/admin/maintain/newspaper';
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Delete failed');
      setActing(false);
    }
  }, [date]);

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading edition...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!edition) {
    return <p className="text-sm text-on-surface-muted">Edition not found.</p>;
  }

  const isPublished: boolean = edition.publishedAt != null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          className="text-sm text-on-surface-muted hover:text-on-surface"
          to="/admin/maintain/newspaper"
        >
          &larr; All Editions
        </Link>
        <div className="flex items-center gap-2">
          {edition.articles.some((a) => a.status === 'generated') && (
            <Link
              className="inline-flex items-center rounded-theme border border-border-theme bg-surface-card px-3 py-1.5 text-sm font-medium text-on-surface shadow-sm hover:bg-on-surface/5"
              to={`/admin/maintain/newspaper/${edition.editionDate}/view`}
            >
              View as Newspaper
            </Link>
          )}
          <Button
            disabled={acting || (!isPublished && edition.status !== 'complete')}
            onClick={() => void handlePublishToggle()}
            variant={isPublished ? 'outline' : 'default'}
          >
            {isPublished ? 'Unpublish' : 'Publish'}
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button disabled={acting} variant="destructive">
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete edition {edition.editionDate}?</DialogTitle>
                <DialogDescription>
                  This will permanently delete the edition and all {edition.articles.length}{' '}
                  articles. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button onClick={() => void handleDelete()} variant="destructive">
                    Delete Edition
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-on-surface">{edition.editionDate}</h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-on-surface-muted">
          <Badge variant={EDITION_STATUS_COLORS[edition.status]}>{edition.status}</Badge>
          {isPublished && <Badge variant="default">Published</Badge>}
          <span className="capitalize">{edition.editionType}</span>
          <span>{edition.articles.length} articles</span>
        </div>
      </div>

      {edition.heroImagePath && (
        <div className="overflow-hidden rounded-theme border border-border-theme">
          <img
            alt="Edition hero"
            className="w-full object-cover"
            src={`/api/newspaper/images/${edition.editionDate}/${edition.heroImagePath.split('/').pop()}`}
            style={{ maxHeight: '300px' }}
          />
        </div>
      )}

      <div className="space-y-4">
        {edition.articles
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((article) => (
            <ArticleCard
              article={article}
              editionDate={edition.editionDate}
              key={article.id}
              onRegenerate={handleRegenerate}
              onUpdate={fetchEdition}
              regenerating={regenerating === article.slug}
            />
          ))}
      </div>
    </div>
  );
}

type ArticleCardProps = {
  article: Article;
  editionDate: string;
  onRegenerate: (slug: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  regenerating: boolean;
};

function ArticleCard({
  article,
  editionDate,
  onRegenerate,
  onUpdate,
  regenerating,
}: ArticleCardProps) {
  const [sourceOpen, setSourceOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [editHeadline, setEditHeadline] = useState<string>(article.headline ?? '');
  const [editBody, setEditBody] = useState<string>(article.body);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const patch: { body?: string; headline?: string } = {};
      if (editHeadline !== (article.headline ?? '')) {
        patch.headline = editHeadline;
      }
      if (editBody !== article.body) {
        patch.body = editBody;
      }
      if (Object.keys(patch).length > 0) {
        await apiFetch(`/api/admin/newspaper/edition/${editionDate}/article/${article.slug}`, {
          body: JSON.stringify(patch),
          method: 'PUT',
        });
        await onUpdate();
      }
      setEditing(false);
    } catch (error_) {
      const msg: string = error_ instanceof Error ? error_.message : 'Failed to save';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [editHeadline, editBody, article, editionDate, onUpdate]);

  const handleCancel = useCallback(() => {
    setEditHeadline(article.headline ?? '');
    setEditBody(article.body);
    setEditing(false);
  }, [article]);

  const bodyPreview: string =
    article.body.length > 200 ? article.body.slice(0, 200) + '...' : article.body;

  const wasEdited: boolean =
    article.updatedAt !== article.createdAt && article.status === 'generated';

  return (
    <div className="rounded-theme border border-border-theme bg-white p-5 dark:border-border-theme dark:bg-on-surface">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              className="w-full rounded border border-border-theme bg-surface px-2 py-1 text-base font-medium text-on-surface"
              onChange={(e) => setEditHeadline(e.target.value)}
              type="text"
              value={editHeadline}
            />
          ) : (
            <h3 className="font-medium text-on-surface">
              {article.headline ?? article.contentType}
            </h3>
          )}
          <div className="mt-1 flex items-center gap-2 text-xs text-on-surface-muted">
            <Badge variant={ARTICLE_STATUS_COLORS[article.status]}>{article.status}</Badge>
            <span className="font-mono">{article.slug}</span>
            {article.generatedBy && <span>by {article.generatedBy}</span>}
            {wasEdited && <Badge variant="secondary">Edited</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {editing ? (
            <>
              <Button
                disabled={saving}
                onClick={() => void handleSave()}
                size="sm"
                variant="default"
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button disabled={saving} onClick={handleCancel} size="sm" variant="outline">
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setEditing(true)} size="sm" variant="outline">
                Edit
              </Button>
              <Button
                disabled={regenerating}
                onClick={() => void onRegenerate(article.slug)}
                size="sm"
                variant="outline"
              >
                {regenerating ? 'Regenerating...' : 'Regenerate'}
              </Button>
            </>
          )}
        </div>
      </div>

      {article.imagePath && (
        <div className="mb-3 overflow-hidden rounded border border-border-theme">
          <img
            alt={article.headline ?? article.slug}
            className="max-h-48 w-auto"
            src={`/api/newspaper/images/${editionDate}/${article.imagePath.split('/').pop()}`}
          />
        </div>
      )}

      {editing ? (
        <textarea
          className="mb-3 w-full rounded border border-border-theme bg-surface p-3 font-mono text-sm text-on-surface"
          onChange={(e) => setEditBody(e.target.value)}
          rows={10}
          value={editBody}
        />
      ) : (
        <div className="mb-3 text-sm text-on-surface">{bodyPreview}</div>
      )}

      {saveError && <p className="mb-3 text-sm text-red-600">{saveError}</p>}

      {article.sourceData && !editing && (
        <details
          onToggle={(e) => setSourceOpen((e.target as HTMLDetailsElement).open)}
          open={sourceOpen}
        >
          <summary className="cursor-pointer text-xs text-on-surface-muted hover:text-on-surface dark:hover:text-on-surface-muted">
            Source Data
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-surface p-3 text-xs dark:bg-on-surface/10">
            {JSON.stringify(JSON.parse(article.sourceData), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
