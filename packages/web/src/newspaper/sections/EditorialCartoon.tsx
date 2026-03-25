import type { Article } from '../types.ts';
import SectionHeader from '../SectionHeader.tsx';
import { editionImageUrl } from '../types.ts';

type EditorialCartoonProps = {
  article: Article;
  editionDate: string;
};

export default function EditorialCartoon({ article, editionDate }: EditorialCartoonProps) {
  const caption: string = article.headline ?? article.body ?? '';

  return (
    <div className="grid-cartoon">
      <SectionHeader name="editorial-cartoon" />
      {article.imagePath && (
        <img
          alt={caption || 'Editorial cartoon'}
          className="cartoon-image"
          src={editionImageUrl(editionDate, article.imagePath)}
        />
      )}
      {caption && <p className="cartoon-caption">{caption}</p>}
    </div>
  );
}
