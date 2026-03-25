import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.ts';
import { libraryImageUrl } from '../types.ts';

type HouseAdProps = {
  editionDate: string;
};

type HouseAdData = {
  tagline: string;
  imageSubpath: string | null;
  features: string[];
};

/** Render *text* as <em>text</em>, plain text otherwise */
function renderFeature(text: string): React.ReactNode {
  const parts: string[] = text.split(/\*([^*]+)\*/);
  if (parts.length === 1) return text;
  return parts.map((part: string, i: number) =>
    i % 2 === 1 ? <em key={i}>{part}</em> : part,
  );
}

export default function HouseAd({ editionDate }: HouseAdProps) {
  const [ad, setAd] = useState<HouseAdData | null>(null);

  const fetchAd = useCallback(async () => {
    try {
      const data = await apiFetch<HouseAdData>(`/api/newspaper/house-ad/${editionDate}`);
      setAd(data);
    } catch {
      // Silently fall back to no ad
    }
  }, [editionDate]);

  useEffect(() => {
    void fetchAd();
  }, [fetchAd]);

  if (!ad) return null;

  const imageUrl: string | null = ad.imageSubpath ? libraryImageUrl(ad.imageSubpath) : null;

  return (
    <div className="house-ad">
        {imageUrl && (
          <div className="house-ad-image">
            <img src={imageUrl} alt="" width={320} height={320} />
          </div>
        )}
        <p className="house-ad-tagline">&ldquo;{ad.tagline}&rdquo;</p>
        <p className="house-ad-cta">
          Subscribe to <em>The Daily Orbit</em> today!
        </p>
        <ul className="house-ad-features">
          {ad.features.map((feature: string) => (
            <li key={feature}>{renderFeature(feature)}</li>
          ))}
        </ul>
        <div className="house-ad-label">&#x2550;&#x2550; An Advertisement &#x2550;&#x2550;</div>
    </div>
  );
}
