import Markdown from 'react-markdown';
import type { Article } from '../types.ts';
import ArticleBody from '../ArticleBody.tsx';
import { DISPLAY_NAME_MAP, TAGLINE_MAP } from '../types.ts';

type SlotCProps = {
  article?: Article;
  classifieds?: Article;
};

export default function SlotC({ article, classifieds }: SlotCProps) {
  return (
    <div className="grid-editorial">
      {article && (
        <>
          <h3 className="article-headline-small">
            {DISPLAY_NAME_MAP[article.contentType] ?? 'Editorial'}
          </h3>
          {TAGLINE_MAP[article.contentType] && (
            <p className="byline">{TAGLINE_MAP[article.contentType]}</p>
          )}
          <ArticleBody body={article.body} />
        </>
      )}

      {classifieds && (
        <>
          <h3 className="article-headline-small">{classifieds.headline ?? 'The Classifieds'}</h3>
          <div className="classifieds-body article-body">
            <Markdown>{classifieds.body}</Markdown>
          </div>
        </>
      )}
    </div>
  );
}
