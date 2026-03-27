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
import CompanySpotlight from './sections/CompanySpotlight.tsx';
import DailyDigest from './sections/DailyDigest.tsx';
import Editorial from './sections/Editorial.tsx';
import FakeAd from './sections/FakeAd.tsx';
import HouseAd from './sections/HouseAd.tsx';
import OrbitalForecast from './sections/OrbitalForecast.tsx';
import WideBandTransmissions from './sections/WideBandTransmissions.tsx';
import YesterdaysFilings from './sections/YesterdaysFilings.tsx';

function findArticle(
  articles: Array<Article>,
  contentType: NewspaperContentType,
): Article | undefined {
  return articles.find((a) => a.contentType === contentType && a.status === 'generated');
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
  const editorial: Article | undefined = findArticle(edition.articles, 'editorial');
  const cartoon: Article | undefined = findArticle(edition.articles, 'editorial_cartoon');
  const spotlight: Article | undefined = findArticle(edition.articles, 'company_spotlight');
  const forecast: Article | undefined = findArticle(edition.articles, 'orbital_forecast');
  const classifieds: Article | undefined = findArticle(edition.articles, 'classifieds');

  const hasSecondRow: boolean = !!(spotlight || editorial);

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
          {forecast ? <OrbitalForecast article={forecast} /> : <div className="grid-orbital" />}

          {/* Row 2 — Yesterday's Filings */}
          {recentFilings && recentFilings.filings.length > 0 && (
            <YesterdaysFilings dayLabel={recentFilings.dayLabel} filings={recentFilings.filings} />
          )}

          {/* Row 3 — Company Spotlight + News + House Ad (left) | Editorial (right) */}
          {hasSecondRow && (
            <>
              {spotlight ? (
                <CompanySpotlight article={spotlight} newsItems={newsItems}>
                  <HouseAd editionDate={edition.editionDate} />
                </CompanySpotlight>
              ) : (
                <div className="grid-company">
                  {newsItems.length > 0 && <WideBandTransmissions newsItems={newsItems} />}
                  <HouseAd editionDate={edition.editionDate} />
                </div>
              )}
              {editorial ? (
                <Editorial article={editorial} classifieds={classifieds} />
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
