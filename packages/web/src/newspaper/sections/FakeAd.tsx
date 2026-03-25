import ArticleBody from '../ArticleBody.tsx';
import type { Article } from '../types.ts';

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
