import Markdown from 'react-markdown';

type ArticleBodyProps = {
  body: string;
  className?: string;
  dropCap?: boolean;
  headline?: string;
};

export default function ArticleBody({ body, className, dropCap, headline }: ArticleBodyProps) {
  const classes: string = ['article-body', dropCap ? 'drop-cap' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {headline && <h2 className="article-headline">{headline}</h2>}
      <Markdown>{body}</Markdown>
    </div>
  );
}
