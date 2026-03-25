import ArticleBody from '../ArticleBody.tsx';
import SectionHeader from '../SectionHeader.tsx';
import type { Article } from '../types.ts';
import { editionImageUrl } from '../types.ts';

type DailyDigestProps = {
  article: Article;
  cartoon: Article | undefined;
  editionDate: string;
  heroImage: Article | undefined;
};

export default function DailyDigest({ article, cartoon, editionDate, heroImage }: DailyDigestProps) {
  return (
    <div className="grid-lead">
      <SectionHeader name="three-miles-up" />
      <h3 className="article-headline-small">3 Miles Up</h3>
      {cartoon?.imagePath && (
        <div className="cartoon-inset">
          <img
            alt={cartoon.headline ?? 'Editorial cartoon'}
            src={editionImageUrl(editionDate, cartoon.imagePath)}
          />
        </div>
      )}
      <ArticleBody body={article.body} dropCap />
      {heroImage?.imagePath && (
        <div className="hero-image">
          <img
            alt="Daily digest illustration"
            src={editionImageUrl(editionDate, heroImage.imagePath)}
          />
          {heroImage.headline && <p className="hero-caption">{heroImage.headline}</p>}
        </div>
      )}
    </div>
  );
}
