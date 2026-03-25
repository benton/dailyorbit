import Markdown from 'react-markdown';

import SectionHeader from '../SectionHeader.tsx';
import type { Article } from '../types.ts';

type ClassifiedsProps = {
  article: Article;
};

export default function Classifieds({ article }: ClassifiedsProps) {
  return (
    <div className="grid-classifieds">
      <SectionHeader name="the-classifieds" />
      <h3 className="article-headline-small">{article.headline ?? 'The Classifieds'}</h3>
      <div className="classifieds-body article-body">
        <Markdown>{article.body}</Markdown>
      </div>
    </div>
  );
}
