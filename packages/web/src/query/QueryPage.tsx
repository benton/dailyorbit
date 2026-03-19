import {
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Newspaper,
  Paperclip,
  Search,
  Square,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import { Button } from '../ui/button.tsx';
import { buildCitationMap, resolveSourceUrl } from './citation-links.ts';
import type { QueryUsage, RetrievedSource } from './types.ts';
import { type QueryStreamState, useQueryStream } from './useQueryStream.ts';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QuestionInput({
  disabled,
  onCancel,
  onSubmit,
}: {
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (question: string) => void;
}) {
  const [text, setText] = useState<string>('');

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed: string = text.trim();
      if (trimmed !== '') {
        onSubmit(trimmed);
      }
    },
    [text, onSubmit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const trimmed: string = text.trim();
        if (trimmed !== '') {
          onSubmit(trimmed);
        }
      }
    },
    [text, onSubmit],
  );

  return (
    <form className="flex gap-2" onSubmit={handleSubmit}>
      <textarea
        className="flex-1 resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm leading-relaxed placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask a question about FCC filings, companies, or regulatory actions..."
        rows={3}
        value={text}
      />
      {disabled ? (
        <Button
          className="self-end"
          onClick={(e) => {
            e.preventDefault();
            onCancel();
          }}
          type="button"
          variant="outline"
        >
          <Square className="mr-1 h-4 w-4" />
          Stop
        </Button>
      ) : (
        <Button className="self-end" disabled={text.trim() === ''} type="submit">
          <Search className="mr-1 h-4 w-4" />
          Ask
        </Button>
      )}
    </form>
  );
}

function StatusBar({ message, status }: { message: string; status: QueryStreamState['status'] }) {
  const isActive: boolean =
    status === 'rewriting' || status === 'retrieving' || status === 'generating';

  if (!isActive) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
      <Loader2 className="h-4 w-4 animate-spin" />
      {message}
    </div>
  );
}

/** Icon for a source type. */
function SourceIcon({ type }: { type: RetrievedSource['type'] }): ReactNode {
  switch (type) {
    case 'filing':
      return <FileText className="h-4 w-4 text-neutral-400" />;
    case 'attachment':
    case 'pleading':
      return <Paperclip className="h-4 w-4 text-neutral-400" />;
    case 'news':
      return <Newspaper className="h-4 w-4 text-neutral-400" />;
  }
}

function SourcesList({ sources }: { sources: RetrievedSource[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="border-b border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
        Sources ({sources.length})
      </h3>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {sources.map((s: RetrievedSource, i: number) => {
          const url: string = resolveSourceUrl(s);
          const isExternal: boolean = url.startsWith('http');
          return (
            <li key={`${s.type}-${s.id}-${i}`}>
              {isExternal ? (
                <a
                  className="flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  href={url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <SourceIcon type={s.type} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">
                      {s.title}
                    </div>
                    <div className="truncate text-xs text-neutral-500">{s.snippet}</div>
                  </div>
                  <span className="whitespace-nowrap text-xs text-neutral-400">
                    {s.type}
                  </span>
                </a>
              ) : (
                <Link
                  className="flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  to={url}
                >
                  <SourceIcon type={s.type} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">
                      {s.title}
                    </div>
                    <div className="truncate text-xs text-neutral-500">{s.snippet}</div>
                  </div>
                  <span className="whitespace-nowrap text-xs text-neutral-400">
                    {s.type}
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Render streamed markdown answer with citation links. */
function AnswerDisplay({
  answer,
  sources,
}: {
  answer: string;
  sources: RetrievedSource[];
}) {
  const citationMap = useMemo(() => buildCitationMap(sources), [sources]);

  if (answer === '') return null;

  // Replace [citation] patterns with markdown links
  const processed: string = answer.replace(
    /\[([^\]]+)\]/g,
    (_match: string, inner: string) => {
      const source: RetrievedSource | undefined = citationMap.get(inner);
      if (source != null) {
        const url: string = resolveSourceUrl(source);
        return `[${inner}](${url})`;
      }
      return `[${inner}]`;
    },
  );

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert prose-a:text-pink-700 dark:prose-a:text-pink-400">
        <Markdown>{processed}</Markdown>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function UsageFooter({ usage }: { usage: QueryUsage }) {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <button
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Usage &middot; {(usage.totalMs / 1000).toFixed(1)}s total
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500 sm:grid-cols-4 dark:border-neutral-800">
          <div>
            <span className="font-medium text-neutral-700 dark:text-neutral-300">Rewrite</span>
            <br />
            {formatTokens(usage.rewriteTokens.input)} in / {formatTokens(usage.rewriteTokens.output)}{' '}
            out
          </div>
          <div>
            <span className="font-medium text-neutral-700 dark:text-neutral-300">Generate</span>
            <br />
            {formatTokens(usage.generateTokens.input)} in /{' '}
            {formatTokens(usage.generateTokens.output)} out
          </div>
          <div>
            <span className="font-medium text-neutral-700 dark:text-neutral-300">Retrieval</span>
            <br />
            {(usage.retrievalMs / 1000).toFixed(1)}s
          </div>
          <div>
            <span className="font-medium text-neutral-700 dark:text-neutral-300">Total</span>
            <br />
            {(usage.totalMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function QueryPage() {
  const { cancel, state, submit } = useQueryStream();
  const isStreaming: boolean =
    state.status === 'rewriting' ||
    state.status === 'retrieving' ||
    state.status === 'generating';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Ask a Question
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Search across FCC filings, attachments, and news using natural language.
        </p>
      </div>

      <QuestionInput disabled={isStreaming} onCancel={cancel} onSubmit={submit} />

      <StatusBar message={state.statusMessage} status={state.status} />

      {state.error != null && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      )}

      <AnswerDisplay answer={state.answer} sources={state.sources} />

      <SourcesList sources={state.sources} />

      {state.usage != null && <UsageFooter usage={state.usage} />}
    </div>
  );
}
