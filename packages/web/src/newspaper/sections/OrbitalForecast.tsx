import type { Article } from '../types.ts';
import ArticleBody from '../ArticleBody.tsx';
import SectionHeader from '../SectionHeader.tsx';

type OrbitalForecastProps = {
  article: Article;
};

export default function OrbitalForecast({ article }: OrbitalForecastProps) {
  return (
    <div className="grid-orbital">
      <SectionHeader name="orbital-forecast" />
      <h3 className="article-headline-small">Orbital Forecast</h3>
      <ArticleBody body={article.body} />
    </div>
  );
}
