import ArticleBody from '../ArticleBody.tsx';
import SectionHeader from '../SectionHeader.tsx';
import type { Article } from '../types.ts';

type CompanySpotlightProps = {
  article: Article;
};

export default function CompanySpotlight({ article }: CompanySpotlightProps) {
  return (
    <div className="grid-company">
      <SectionHeader name="company-spotlight" />
      <h3 className="article-headline-small">Company Spotlight</h3>
      <ArticleBody body={article.body} />
    </div>
  );
}
