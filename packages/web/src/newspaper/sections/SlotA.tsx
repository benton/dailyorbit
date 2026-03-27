import type { Article, NewspaperContentType } from '../types.ts';
import { DISPLAY_NAME_MAP, TAGLINE_MAP } from '../types.ts';
import ArticleBody from '../ArticleBody.tsx';

type SlotAProps = {
  article: Article;
};

export default function SlotA({ article }: SlotAProps) {
  const contentType: NewspaperContentType = article.contentType;
  const heading: string = DISPLAY_NAME_MAP[contentType] ?? 'Orbital Forecast';
  const tagline: string | undefined = TAGLINE_MAP[contentType];

  return (
    <div className="grid-orbital">
      <h3 className="article-headline-small">{heading}</h3>
      {tagline && <p className="byline">{tagline}</p>}
      <ArticleBody body={article.body} />
    </div>
  );
}
