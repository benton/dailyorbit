import Markdown from 'react-markdown';
import type { Article } from '../types.ts';
import ArticleBody from '../ArticleBody.tsx';

type EditorialProps = {
  article: Article;
  classifieds?: Article;
};

export default function Editorial({ article, classifieds }: EditorialProps) {
  return (
    <div className="grid-editorial">
      <h3 className="article-headline-small">Over the Horizon</h3>
      <p className="byline">By the Editors</p>
      <ArticleBody body={article.body} />

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
