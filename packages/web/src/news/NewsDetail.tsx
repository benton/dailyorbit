import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../lib/api.ts';

type NewsItem = {
  author: string | null;
  companyId: number | null;
  createdAt: string;
  extractStatus: string;
  fetchedAt: string;
  fullText: string | null;
  id: number;
  newsSourceId: number;
  publishedAt: string | null;
  sourceName: string | null;
  sourceUrl: string;
  summarizedAt: string | null;
  summarizedBy: string | null;
  summary: string | null;
  tags: Array<string>;
  title: string;
};

export default function NewsDetail() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id == null) {
      return;
    }
    let cancelled: boolean = false;
    apiFetch<NewsItem>(`/api/news/${id}`)
      .then((data: NewsItem) => {
        if (!cancelled) {
          setItem(data);
        }
      })
      .catch((error_: unknown) => {
        if (!cancelled) {
          setError(error_ instanceof ApiError ? error_.message : 'Failed to load news item');
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
    return <p className="text-sm text-neutral-500">Loading...</p>;
  }
  if (error != null || item == null) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">{error ?? 'News item not found'}</p>
    );
  }

  const publishedDate: string | null =
    item.publishedAt != null
      ? new Date(item.publishedAt).toLocaleDateString('en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-neutral-400 dark:text-neutral-500">
        <Link className="hover:text-neutral-600 dark:hover:text-neutral-300" to="/">
          Home
        </Link>
        {' / '}
        <Link className="hover:text-neutral-600 dark:hover:text-neutral-300" to="/news">
          News
        </Link>
        {' / '}
        <span className="text-neutral-600 dark:text-neutral-300">
          {item.title.slice(0, 60)}
          {item.title.length > 60 ? '…' : ''}
        </span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{item.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-500 dark:text-neutral-400">
          {publishedDate != null && <span>{publishedDate}</span>}
          {item.author != null && (
            <>
              <span className="text-neutral-300 dark:text-neutral-600">·</span>
              <span>{item.author}</span>
            </>
          )}
          {item.sourceName != null && (
            <>
              <span className="text-neutral-300 dark:text-neutral-600">·</span>
              <span>{item.sourceName}</span>
            </>
          )}
          <span className="text-neutral-300 dark:text-neutral-600">·</span>
          <a
            className="text-blue-600 hover:underline dark:text-blue-400"
            href={item.sourceUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Original article ↗
          </a>
        </div>
        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.map((tag: string) => (
              <span
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      {item.summary != null && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
          <p className="mb-1 text-xs font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
            Summary
          </p>
          <p className="text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
            {item.summary}
          </p>
        </div>
      )}

      {/* Full Text */}
      {item.fullText != null && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            Full Text
          </h2>
          <div className="prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap text-neutral-700 dark:text-neutral-300 dark:prose-invert">
            {item.fullText}
          </div>
        </div>
      )}

      {item.fullText == null && item.summary == null && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No content extracted yet (status: {item.extractStatus}).
        </p>
      )}
    </div>
  );
}
