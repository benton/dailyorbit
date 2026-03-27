import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api.ts';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';

type NewspaperImage = {
  createdAt: string;
  generatedBy: string | null;
  id: number;
  imagePath: string;
  imageType: string;
  prompt: string | null;
  tags: Array<string>;
};

export default function PortraitLibrary() {
  const [portraits, setPortraits] = useState<Array<NewspaperImage>>([]);
  const [sectionHeaders, setSectionHeaders] = useState<Array<NewspaperImage>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);

  const fetchLibrary = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([
        apiFetch<Array<NewspaperImage>>('/api/newspaper/library/portraits'),
        apiFetch<Array<NewspaperImage>>('/api/newspaper/library/section-headers'),
      ]);
      setPortraits(p);
      setSectionHeaders(h);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await apiFetch('/api/newspaper/generate-library', { method: 'POST' });
      await fetchLibrary();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Failed to generate library');
    } finally {
      setGenerating(false);
    }
  }, [fetchLibrary]);

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading asset library...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-8">
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
          <h1 className="text-2xl font-semibold text-on-surface">Asset Library</h1>
          <p className="mt-1 text-sm text-on-surface-muted">
            Portraits, section headers, and other generated assets.
          </p>
        </div>
        <Button disabled={generating} onClick={() => void handleGenerate()}>
          {generating ? 'Generating...' : 'Generate Library'}
        </Button>
      </div>

      {/* Portraits */}
      <section>
        <h2 className="mb-4 text-lg font-medium text-on-surface">Portraits ({portraits.length})</h2>
        {portraits.length === 0 ? (
          <p className="text-sm text-on-surface-muted">No portraits generated yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {portraits.map((img) => (
              <ImageCard image={img} key={img.id} />
            ))}
          </div>
        )}
      </section>

      {/* Section Headers */}
      <section>
        <h2 className="mb-4 text-lg font-medium text-on-surface">
          Section Headers ({sectionHeaders.length})
        </h2>
        {sectionHeaders.length === 0 ? (
          <p className="text-sm text-on-surface-muted">No section headers generated yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {sectionHeaders.map((img) => (
              <ImageCard image={img} key={img.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ImageCard({ image }: { image: NewspaperImage }) {
  const libraryMatch: RegExpMatchArray | null = image.imagePath.match(/library\/(.+)$/);
  const src: string = libraryMatch
    ? `/api/newspaper/images/library/${libraryMatch[1]}`
    : `/api/newspaper/images/library/${image.imagePath}`;

  return (
    <div className="overflow-hidden rounded-theme border border-border-theme bg-surface-card">
      <img
        alt={image.tags.join(', ') || image.imageType}
        className="aspect-square w-full object-cover"
        src={src}
      />
      <div className="p-2">
        {image.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {image.tags.map((tag) => (
              <Badge className="text-[10px]" key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
