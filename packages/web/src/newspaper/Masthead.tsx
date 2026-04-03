import { useState } from 'react';
import { useNavigate } from 'react-router';
import MastheadFilingVolume from './MastheadFilingVolume.tsx';
import MastheadWeather from './MastheadWeather.tsx';
import { libraryImageUrl } from './types.ts';

type MastheadProps = {
  editionDate: string;
  nextDate?: string | null;
  prevDate?: string | null;
};

function formatDateLine(dateStr: string): string {
  const date: Date = new Date(dateStr + 'T12:00:00');
  const volume: number = date.getFullYear() - 2025;
  const startOfYear: Date = new Date(date.getFullYear(), 0, 1);
  const dayOfYear: number = Math.floor((date.getTime() - startOfYear.getTime()) / 86_400_000) + 1;
  const formatted: string = date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  });
  return `Vol. ${roman(volume)}  ·  No. ${String(dayOfYear)}  ·  Washington, D.C.  ·  ${formatted}  ·  Price: Free Edition`;
}

function roman(n: number): string {
  if (n <= 0) {
    return 'I';
  }
  const vals: Array<[number, string]> = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let result: string = '';
  let remaining: number = n;
  for (const [value, numeral] of vals) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
}

export default function Masthead({ editionDate, prevDate, nextDate }: MastheadProps) {
  const navigate = useNavigate();
  const [emblemFailed, setEmblemFailed] = useState<boolean>(false);

  return (
    <header className="masthead">
      <div className="masthead-wing masthead-wing-left">
        <MastheadWeather editionDate={editionDate} />
      </div>
      <div className="masthead-center">
        <h1 className="masthead-title">The Daily Orbit</h1>
        {!emblemFailed && (
          <img
            alt=""
            className="masthead-emblem"
            onError={() => setEmblemFailed(true)}
            src={libraryImageUrl('masthead.webp')}
          />
        )}
        <p className="masthead-tagline">AI-Powered SatCom Industry Coverage</p>
        <div className="masthead-dateline">
          <button
            aria-label="Previous edition"
            className="masthead-edition-nav masthead-edition-nav--prev"
            disabled={!prevDate}
            onClick={() => prevDate && void navigate(`/newspaper/${prevDate}`)}
            title="Previous edition"
            type="button"
          >
            ← Prev
          </button>
          <span>{formatDateLine(editionDate)}</span>
          <button
            aria-label="Next edition"
            className="masthead-edition-nav masthead-edition-nav--next"
            disabled={!nextDate}
            onClick={() => nextDate && void navigate(`/newspaper/${nextDate}`)}
            title="Next edition"
            type="button"
          >
            Next →
          </button>
        </div>
      </div>
      <div className="masthead-wing masthead-wing-right">
        <MastheadFilingVolume editionDate={editionDate} />
      </div>
    </header>
  );
}
