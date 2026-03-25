import SectionHeader from '../SectionHeader.tsx';
import type { NewsListItem } from '../types.ts';

type WideBandTransmissionsProps = {
  newsItems: Array<NewsListItem>;
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d: Date = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WideBandTransmissions({ newsItems }: WideBandTransmissionsProps) {
  if (newsItems.length === 0) return null;

  const MAX_ITEMS: number = 5;
  const capped: Array<NewsListItem> = newsItems.slice(0, MAX_ITEMS);

  return (
    <div className="news-section">
      <SectionHeader name="wide-band-transmissions" />
      <h3 className="filings-heading">Wide Band Transmissions</h3>
      <div className="news-briefs">
        {capped.map((item: NewsListItem) => (
          <div className="news-brief" key={item.id}>
            <a
              className="news-brief-title"
              href={item.sourceUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {item.title}
            </a>
            <div className="news-brief-meta">
              {item.sourceName && <span>{item.sourceName}</span>}
              {item.sourceName && item.publishedAt && <span> · </span>}
              {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
            </div>
            {item.companyName && (
              <span className="news-brief-company">{item.companyName}</span>
            )}
            {item.summary && (
              <p className="news-brief-summary">{item.summary}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
