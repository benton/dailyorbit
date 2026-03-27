import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type {
  Article,
  EditionWithArticles,
  NewsListItem,
  NewspaperContentType,
  PaginatedNewsResponse,
  RecentFilingsResponse,
} from './types.ts';
import { apiFetch } from '../lib/api.ts';
import './newspaper.css';
import Masthead from './Masthead.tsx';
import DailyDigest from './sections/DailyDigest.tsx';
import FakeAd from './sections/FakeAd.tsx';
import HouseAd from './sections/HouseAd.tsx';
import SlotA from './sections/SlotA.tsx';
import SlotB from './sections/SlotB.tsx';
import SlotC from './sections/SlotC.tsx';
import WideBandTransmissions from './sections/WideBandTransmissions.tsx';
import YesterdaysFilings from './sections/YesterdaysFilings.tsx';

// ── Slot content type groups ────────────────────────────────────

const SLOT_A_TYPES: ReadonlyArray<NewspaperContentType> = [
  'orbital_forecast',
  'the_docket',
  'spectrum_watch',
  'competitive_intel',
];

const SLOT_B_TYPES: ReadonlyArray<NewspaperContentType> = [
  'company_spotlight',
  'filing_in_focus',
  'the_applicant',
  'tech_spotlight',
  'from_the_archives',
];

const SLOT_C_TYPES: ReadonlyArray<NewspaperContentType> = [
  'editorial',
  'counsels_brief',
  'letters_to_editor',
  'market_signals',
  'press_gallery',
];

function findArticle(
  articles: Array<Article>,
  contentType: NewspaperContentType,
): Article | undefined {
  return articles.find((a) => a.contentType === contentType && a.status === 'generated');
}

function findSlotArticle(
  articles: Array<Article>,
  types: ReadonlyArray<NewspaperContentType>,
): Article | undefined {
  return articles.find((a) => types.includes(a.contentType) && a.status === 'generated');
}

export default function NewspaperView() {
  const { date } = useParams<{ date: string }>();
  const [edition, setEdition] = useState<EditionWithArticles | null>(null);
  const [recentFilings, setRecentFilings] = useState<RecentFilingsResponse | null>(null);
  const [newsItems, setNewsItems] = useState<Array<NewsListItem>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEdition = useCallback(async () => {
    if (!date) {
      return;
    }
    try {
      const [data, filings, news] = await Promise.all([
        apiFetch<EditionWithArticles>(`/api/newspaper/edition/${date}`),
        apiFetch<RecentFilingsResponse>('/api/stats/recent-filings'),
        apiFetch<PaginatedNewsResponse>('/api/news?pageSize=5&sort=published_at&order=desc'),
      ]);
      setEdition(data);
      setRecentFilings(filings);
      setNewsItems(news.data);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load edition');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void fetchEdition();
  }, [fetchEdition]);

  if (loading) {
    return (
      <div className="newspaper-wrapper">
        <div className="newspaper-loading">Loading edition...</div>
      </div>
    );
  }

  if (error || !edition) {
    return (
      <div className="newspaper-wrapper">
        <div className="newspaper-error">{error ?? 'Edition not found.'}</div>
      </div>
    );
  }

  const dailyDigest: Article | undefined = findArticle(edition.articles, 'daily_digest');
  const heroImage: Article | undefined = findArticle(edition.articles, 'hero_image');
  const fakeAd: Article | undefined = findArticle(edition.articles, 'fake_ad');
  const cartoon: Article | undefined = findArticle(edition.articles, 'editorial_cartoon');
  const classifieds: Article | undefined = findArticle(edition.articles, 'classifieds');

  const slotAArticle: Article | undefined = findSlotArticle(edition.articles, SLOT_A_TYPES);
  const slotBArticle: Article | undefined = findSlotArticle(edition.articles, SLOT_B_TYPES);
  const slotCArticle: Article | undefined = findSlotArticle(edition.articles, SLOT_C_TYPES);

  const hasSecondRow: boolean = !!(slotBArticle || slotCArticle);

  return (
    <div className="newspaper-wrapper">
      <Link className="newspaper-back" to={`/admin/maintain/newspaper/${date}`}>
        &larr; Back to Admin
      </Link>
      <article className="newspaper">
        <Masthead editionDate={edition.editionDate} />
        <div className="newspaper-grid">
          {/* Row 1 */}
          {fakeAd ? <FakeAd article={fakeAd} /> : <div className="grid-fakead" />}
          {dailyDigest ? (
            <DailyDigest
              article={dailyDigest}
              cartoon={cartoon}
              editionDate={edition.editionDate}
              heroImage={heroImage}
            />
          ) : (
            <div className="grid-lead" />
          )}
          {slotAArticle ? <SlotA article={slotAArticle} /> : <div className="grid-orbital" />}

          {/* Row 2 — Yesterday's Filings */}
          {recentFilings && recentFilings.filings.length > 0 && (
            <YesterdaysFilings dayLabel={recentFilings.dayLabel} filings={recentFilings.filings} />
          )}

          {/* Row 3 — Slot B (left) | Slot C (right) */}
          {hasSecondRow && (
            <>
              {slotBArticle ? (
                <SlotB
                  article={slotBArticle}
                  editionDate={edition.editionDate}
                  newsItems={newsItems}
                />
              ) : (
                <div className="grid-company">
                  {newsItems.length > 0 && <WideBandTransmissions newsItems={newsItems} />}
                  <HouseAd editionDate={edition.editionDate} />
                </div>
              )}
              {slotCArticle ? (
                <SlotC article={slotCArticle} classifieds={classifieds} />
              ) : (
                <div className="grid-editorial" />
              )}
            </>
          )}
        </div>
      </article>
    </div>
  );
}
