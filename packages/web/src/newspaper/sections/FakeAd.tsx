import type { Article } from '../types.ts';
import ArticleBody from '../ArticleBody.tsx';

type FakeAdProps = {
  article: Article;
};

export default function FakeAd({ article }: FakeAdProps) {
  return (
    <div className="grid-fakead">
      <div className="fake-ad">
        <ArticleBody body={article.body} />
      </div>
    </div>
  );
}
