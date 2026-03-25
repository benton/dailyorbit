import { useState } from 'react';
import MastheadFilingVolume from './MastheadFilingVolume.tsx';
import { libraryImageUrl } from './types.ts';

type MastheadProps = {
  editionDate: string;
};

function formatDateLine(dateStr: string): string {
  const date: Date = new Date(dateStr + 'T12:00:00');
  const volume: number = date.getFullYear() - 2025;
  const startOfYear: Date = new Date(date.getFullYear(), 0, 1);
  const dayOfYear: number =
    Math.floor((date.getTime() - startOfYear.getTime()) / 86_400_000) + 1;
  const formatted: string = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `Vol. ${roman(volume)}  ·  No. ${String(dayOfYear)}  ·  Washington, D.C.  ·  ${formatted}  ·  Price: Free Edition`;
}

function roman(n: number): string {
  if (n <= 0) return 'I';
  const vals: Array<[number, string]> = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
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

export default function Masthead({ editionDate }: MastheadProps) {
  const [emblemFailed, setEmblemFailed] = useState<boolean>(false);

  return (
    <header className="masthead">
      <div className="masthead-wing masthead-wing-left" />
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
        <p className="masthead-dateline">{formatDateLine(editionDate)}</p>
      </div>
      <div className="masthead-wing masthead-wing-right">
        <MastheadFilingVolume editionDate={editionDate} />
      </div>
    </header>
  );
}
