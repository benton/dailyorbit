import type { Article } from '../types.ts';
import ArticleBody from '../ArticleBody.tsx';

type OrbitalForecastProps = {
  article: Article;
};

export default function OrbitalForecast({ article }: OrbitalForecastProps) {
  return (
    <div className="grid-orbital">
      <h3 className="article-headline-small">Orbital Forecast</h3>
      <p className="byline">FCC Filings</p>
      <ArticleBody body={article.body} />
    </div>
  );
}
