import ArticleBody from '../ArticleBody.tsx';
import SectionHeader from '../SectionHeader.tsx';
import type { Article } from '../types.ts';

type EditorialProps = {
  article: Article;
};

export default function Editorial({ article }: EditorialProps) {
  return (
    <div className="grid-editorial">
      <SectionHeader name="over-the-horizon" />
      <h3 className="article-headline-small">Over the Horizon</h3>
      <p className="byline">By the Editors</p>
      <ArticleBody body={article.body} />
    </div>
  );
}
