import Markdown from 'react-markdown';
import type { Article, NewspaperContentType } from '../types.ts';
import { DISPLAY_NAME_MAP, TAGLINE_MAP } from '../types.ts';
import ArticleBody from '../ArticleBody.tsx';

type SlotCProps = {
  article: Article;
  classifieds?: Article;
};

export default function SlotC({ article, classifieds }: SlotCProps) {
  const contentType: NewspaperContentType = article.contentType;
  const heading: string = DISPLAY_NAME_MAP[contentType] ?? 'Editorial';
  const tagline: string | undefined = TAGLINE_MAP[contentType];

  return (
    <div className="grid-editorial">
      <h3 className="article-headline-small">{heading}</h3>
      {tagline && <p className="byline">{tagline}</p>}
      <ArticleBody body={article.body} />

      {classifieds && (
        <>
          <h3 className="article-headline-small">
            {classifieds.headline ?? 'The Classifieds'}
          </h3>
          <div className="classifieds-body article-body">
            <Markdown>{classifieds.body}</Markdown>
          </div>
        </>
      )}
    </div>
  );
}
