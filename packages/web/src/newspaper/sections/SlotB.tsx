import type { Article, NewspaperContentType, NewsListItem } from '../types.ts';
import ArticleBody from '../ArticleBody.tsx';
import { DISPLAY_NAME_MAP, TAGLINE_MAP, editionImageUrl } from '../types.ts';
import CompanySpotlight from './CompanySpotlight.tsx';
import HouseAd from './HouseAd.tsx';
import WideBandTransmissions from './WideBandTransmissions.tsx';

type SlotBProps = {
  article: Article;
  editionDate: string;
  newsItems: Array<NewsListItem>;
};

export default function SlotB({ article, editionDate, newsItems }: SlotBProps) {
  const contentType: NewspaperContentType = article.contentType;

  // Delegate to existing CompanySpotlight for that type (it has portrait-fetching logic)
  if (contentType === 'company_spotlight') {
    return (
      <CompanySpotlight article={article} newsItems={newsItems}>
        <HouseAd editionDate={editionDate} />
      </CompanySpotlight>
    );
  }

  const heading: string = DISPLAY_NAME_MAP[contentType] ?? 'Feature';
  const tagline: string | undefined = TAGLINE_MAP[contentType];

  return (
    <div className="grid-company">
      <h3 className="article-headline-small">{heading}</h3>
      {tagline && <p className="byline">{tagline}</p>}
      <div className="spotlight-body">
        {article.imagePath && (
          <figure className="spotlight-headshot">
            <img alt={heading} src={editionImageUrl(editionDate, article.imagePath)} />
          </figure>
        )}
        <ArticleBody body={article.body} />
      </div>
      {newsItems.length > 0 && <WideBandTransmissions newsItems={newsItems} />}
      <HouseAd editionDate={editionDate} />
    </div>
  );
}
