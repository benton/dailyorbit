import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.ts';
import ArticleBody from '../ArticleBody.tsx';
import SectionHeader from '../SectionHeader.tsx';
import { libraryImageUrl, type Article, type NewsListItem } from '../types.ts';
import WideBandTransmissions from './WideBandTransmissions.tsx';

type PortraitData = {
  imagePath: string;
};

type SpotlightSourceData = {
  ceoName?: string | null;
  companyName?: string;
};

type CompanySpotlightProps = {
  article: Article;
  newsItems?: Array<NewsListItem>;
};

function parseSourceData(raw: string | null): SpotlightSourceData {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as SpotlightSourceData;
  } catch {
    return {};
  }
}

export default function CompanySpotlight({ article, newsItems }: CompanySpotlightProps) {
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const sourceData: SpotlightSourceData = parseSourceData(article.sourceData);
  const companyName: string = sourceData.companyName ?? 'Unknown';
  const ceoName: string | null = sourceData.ceoName ?? null;

  useEffect(() => {
    if (!companyName || companyName === 'Unknown') {
      return;
    }
    const encodedName: string = encodeURIComponent(companyName);
    apiFetch<PortraitData>(`/api/newspaper/library/portraits/${encodedName}`)
      .then((data) => {
        if (data?.imagePath) {
          // Extract the path relative to the library/ directory
          const libraryIdx: number = data.imagePath.indexOf('library/');
          const subpath: string =
            libraryIdx >= 0
              ? data.imagePath.slice(libraryIdx + 'library/'.length)
              : (data.imagePath.split('/').pop() ?? '');
          setPortraitUrl(libraryImageUrl(subpath));
        }
      })
      .catch(() => {
        // No portrait available — that's fine
      });
  }, [companyName]);

  const caption: string = ceoName
    ? `(not) ${companyName} CEO ${ceoName}`
    : `(not) the ${companyName} CEO`;

  return (
    <div className="grid-company">
      <SectionHeader name="company-spotlight" />
      <h3 className="article-headline-small">Company Spotlight</h3>
      <div className="spotlight-body">
        {portraitUrl && (
          <figure className="spotlight-headshot">
            <img alt={caption} src={portraitUrl} />
            <figcaption>{caption}</figcaption>
          </figure>
        )}
        <ArticleBody body={article.body} />
      </div>
      {newsItems && newsItems.length > 0 && <WideBandTransmissions newsItems={newsItems} />}
    </div>
  );
}
