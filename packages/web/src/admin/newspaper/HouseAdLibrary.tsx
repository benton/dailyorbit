import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api.ts';
import { Button } from '../../ui/button.tsx';

type HouseAdListItem = {
  id: number;
  tagline: string;
  slug: string;
  htmlPath: string;
  imagePath: string;
  thumbnailUrl: string;
};

type ListResponse = {
  ads: Array<HouseAdListItem>;
};

export default function HouseAdLibrary() {
  const [ads, setAds] = useState<Array<HouseAdListItem>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled: boolean = false;
    apiFetch<ListResponse>('/api/admin/newspaper/house-ads')
      .then((data: ListResponse) => {
        if (!cancelled) {
          setAds(data.ads);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load house ads');
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
  }, []);

  const origin: string = useMemo(
    () => (typeof window === 'undefined' ? '' : window.location.origin),
    [],
  );

  const allHtmlUrls: string = useMemo(
    () => ads.map((ad: HouseAdListItem) => `${origin}${ad.htmlPath}`).join('\n'),
    [ads, origin],
  );

  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(allHtmlUrls);
    } catch {
      /* clipboard blocked — silently no-op */
    }
  }, [allHtmlUrls]);

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading house ad library…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          className="text-sm text-on-surface-muted hover:text-on-surface"
          to="/admin/maintain/newspaper"
        >
          &larr; Editions
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">House Ad Library</h1>
          <p className="mt-1 text-sm text-on-surface-muted">
            {ads.length} ad{ads.length === 1 ? '' : 's'} — each one is available as a self-contained
            static HTML file plus a webp image at a permanent URL.
          </p>
        </div>
        <Button onClick={() => void handleCopyAll()}>Copy all HTML URLs</Button>
      </div>

      {ads.length === 0 ? (
        <p className="text-sm text-on-surface-muted">No house ads in the library yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ads.map((ad: HouseAdListItem) => (
            <HouseAdCard ad={ad} key={ad.id} origin={origin} />
          ))}
        </div>
      )}
    </div>
  );
}

function HouseAdCard({ ad, origin }: { ad: HouseAdListItem; origin: string }) {
  const absoluteHtmlUrl: string = `${origin}${ad.htmlPath}`;
  const absoluteImageUrl: string = `${origin}${ad.imagePath}`;

  return (
    <div className="overflow-hidden rounded-theme border border-border-theme bg-surface-card p-3">
      <a className="block" href={ad.htmlPath} rel="noreferrer" target="_blank">
        <img alt={ad.tagline} className="aspect-square w-full object-cover" src={ad.thumbnailUrl} />
      </a>
      <p className="mt-2 font-serif text-sm text-on-surface italic" title={ad.tagline}>
        &ldquo;{ad.tagline}&rdquo;
      </p>
      <p className="mt-1 font-mono text-[11px] text-on-surface-muted">
        ad-{ad.id}-{ad.slug}
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        <CopyButton label="Copy HTML URL" primary value={absoluteHtmlUrl} />
        <CopyButton label="Copy image URL" value={absoluteImageUrl} />
        <a
          className="text-center text-xs text-on-surface-muted hover:text-on-surface"
          href={ad.htmlPath}
          rel="noreferrer"
          target="_blank"
        >
          ↗ Open HTML in new tab
        </a>
      </div>
    </div>
  );
}

function CopyButton({
  label,
  primary = false,
  value,
}: {
  label: string;
  primary?: boolean;
  value: string;
}) {
  const [copied, setCopied] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — leave label unchanged */
    }
  }, [value]);

  return (
    <Button onClick={() => void handleClick()} variant={primary ? 'default' : 'secondary'}>
      {copied ? '✓ Copied!' : label}
    </Button>
  );
}
