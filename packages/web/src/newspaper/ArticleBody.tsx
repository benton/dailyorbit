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

  // Strip leading markdown heading — the layout already renders the section header
  const stripped: string = body.replace(/^#+\s+.*\n+/, '');

  return (
    <div className={classes}>
      {headline && <h2 className="article-headline">{headline}</h2>}
      <Markdown>{stripped}</Markdown>
    </div>
  );
}
