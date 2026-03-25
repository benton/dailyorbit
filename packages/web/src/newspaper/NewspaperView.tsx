import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import Masthead from './Masthead.tsx';
import './newspaper.css';
import Classifieds from './sections/Classifieds.tsx';
import CompanySpotlight from './sections/CompanySpotlight.tsx';
import DailyDigest from './sections/DailyDigest.tsx';
import Editorial from './sections/Editorial.tsx';
import EditorialCartoon from './sections/EditorialCartoon.tsx';
import FakeAd from './sections/FakeAd.tsx';
import OrbitalForecast from './sections/OrbitalForecast.tsx';
import type { Article, EditionWithArticles, NewspaperContentType } from './types.ts';

function findArticle(
  articles: Array<Article>,
  contentType: NewspaperContentType,
): Article | undefined {
  return articles.find((a) => a.contentType === contentType && a.status === 'generated');
}

export default function NewspaperView() {
  const { date } = useParams<{ date: string }>();
  const [edition, setEdition] = useState<EditionWithArticles | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEdition = useCallback(async () => {
    if (!date) return;
    try {
      const data: EditionWithArticles = await apiFetch(`/api/newspaper/edition/${date}`);
      setEdition(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load edition');
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

  const hasSecondRow: boolean = !!(spotlight || editorial || cartoon || classifieds);

  return (
    <div className="newspaper-wrapper">
      <Link className="newspaper-back" to={`/admin/newspaper/${date}`}>
        &larr; Back to Admin
      </Link>
      <article className="newspaper">
        <Masthead editionDate={edition.editionDate} />
        <div className="newspaper-grid">
          {/* Row 1 */}
          {fakeAd ? (
            <FakeAd article={fakeAd} />
          ) : (
            <div className="grid-fakead" />
          )}
          {dailyDigest ? (
            <DailyDigest
              article={dailyDigest}
              editionDate={edition.editionDate}
              heroImage={heroImage}
            />
          ) : (
            <div className="grid-lead" />
          )}
          {forecast ? (
            <OrbitalForecast article={forecast} />
          ) : (
            <div className="grid-orbital" />
          )}

          {/* Row 2 — only if any second-row content exists */}
          {hasSecondRow && (
            <>
              {spotlight ? (
                <CompanySpotlight article={spotlight} />
              ) : (
                <div className="grid-company" />
              )}
              {editorial ? (
                <Editorial article={editorial} />
              ) : (
                <div className="grid-editorial" />
              )}
              {cartoon ? (
                <EditorialCartoon article={cartoon} editionDate={edition.editionDate} />
              ) : (
                <div className="grid-cartoon" />
              )}
              {classifieds ? (
                <Classifieds article={classifieds} />
              ) : (
                <div className="grid-classifieds" />
              )}
            </>
          )}
        </div>
      </article>
    </div>
  );
}
