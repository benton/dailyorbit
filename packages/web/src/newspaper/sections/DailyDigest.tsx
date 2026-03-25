import ArticleBody from '../ArticleBody.tsx';
import SectionHeader from '../SectionHeader.tsx';
import type { Article } from '../types.ts';
import { editionImageUrl } from '../types.ts';

type DailyDigestProps = {
  article: Article;
  editionDate: string;
  heroImage: Article | undefined;
};

export default function DailyDigest({ article, editionDate, heroImage }: DailyDigestProps) {
  return (
    <div className="grid-lead">
      <SectionHeader name="three-miles-up" />
      <h3 className="article-headline-small">3 Miles Up</h3>
      {heroImage?.imagePath && (
        <div className="hero-image">
          <img
            alt="Daily digest illustration"
            src={editionImageUrl(editionDate, heroImage.imagePath)}
          />
          {heroImage.headline && <p className="hero-caption">{heroImage.headline}</p>}
        </div>
      )}
      <ArticleBody body={article.body} dropCap />
    </div>
  );
}
