import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.ts';

type HouseAdProps = {
  editionDate: string;
};

type HouseAdData = {
  tagline: string;
  imageUrl: string | null;
  features: string[];
};

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

  return (
    <div className="grid-house-ad">
      <div className="house-ad">
        {ad.imageUrl && (
          <div className="house-ad-image">
            <img src={ad.imageUrl} alt="" width={300} height={250} />
          </div>
        )}
        <p className="house-ad-tagline">&ldquo;{ad.tagline}&rdquo;</p>
        <p className="house-ad-cta">
          Subscribe to <em>The Daily Orbit</em> today!
        </p>
        <ul className="house-ad-features">
          {ad.features.map((feature: string) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <div className="house-ad-label">&#x2550;&#x2550; An Advertisement &#x2550;&#x2550;</div>
      </div>
    </div>
  );
}
