import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { RetrievedSource } from '../query/types.ts';
import type { Consultant, Message } from './types.ts';

type Props = {
  consultants: Map<number, Consultant>;
  isStreaming: boolean;
  messages: Array<Message>;
  streamingAnswer: string;
  streamingSources: Array<RetrievedSource>;
};

function SourcesList({ sources }: { sources: Array<RetrievedSource> }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs text-on-surface-muted hover:text-on-surface dark:hover:text-on-surface-muted"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {String(sources.length)} source{sources.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <ul className="mt-1 space-y-1">
          {sources.map((s: RetrievedSource, i: number) => (
            <li className="text-xs text-on-surface-muted" key={`${s.id}-${String(i)}`}>
              <span className="font-medium">[{String(i + 1)}]</span>{' '}
              {s.url != null ? (
                <a
                  className="underline hover:no-underline"
                  href={s.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {s.title}
                </a>
              ) : (
                s.title
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MessageThread({
  consultants,
  isStreaming,
  messages,
  streamingAnswer,
  streamingSources,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingAnswer]);

  // Pre-compute consultant switch divider indices
  const switchIndices: Map<number, Consultant | undefined> = useMemo(() => {
    const result: Map<number, Consultant | undefined> = new Map();
    let prevConsultantId: number | null = null;
    for (let i: number = 0; i < messages.length; i++) {
      const msg: Message = messages[i]!;
      if (msg.role === 'assistant' && msg.consultantId != null) {
        if (prevConsultantId != null && msg.consultantId !== prevConsultantId) {
          result.set(i, consultants.get(msg.consultantId));
        }
        prevConsultantId = msg.consultantId;
      }
    }
    return result;
  }, [messages, consultants]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg: Message, idx: number) => {
          let divider: React.ReactNode = null;

          // Show divider when consultant changes between assistant messages
          const switchedConsultant: Consultant | undefined = switchIndices.get(idx);
          if (switchedConsultant !== undefined) {
            divider = (
              <div className="flex items-center gap-2 py-2 text-xs text-on-surface-muted">
                <div className="flex-1 border-t border-border-theme" />
                <span>
                  Switched to {switchedConsultant.icon ?? ''}{' '}
                  {switchedConsultant.name ?? 'another consultant'}
                </span>
                <div className="flex-1 border-t border-border-theme" />
              </div>
            );
          }

          return (
            <div key={msg.id}>
              {divider}
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm text-white">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="mt-1 flex-shrink-0 text-lg">
                    {msg.consultantId != null
                      ? (consultants.get(msg.consultantId)?.icon ?? '\u{1F916}')
                      : '\u{1F916}'}
                  </div>
                  <div className="max-w-[85%] min-w-0">
                    <div className="rounded-2xl rounded-tl-sm bg-on-surface/10 px-4 py-2 text-sm dark:bg-on-surface/10">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                    {msg.sources != null && <SourcesList sources={msg.sources} />}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Streaming assistant message */}
        {isStreaming && streamingAnswer !== '' && (
          <div className="flex gap-3">
            <div className="mt-1 flex-shrink-0 text-lg">{'\u{1F916}'}</div>
            <div className="max-w-[85%] min-w-0">
              <div className="rounded-2xl rounded-tl-sm bg-on-surface/10 px-4 py-2 text-sm dark:bg-on-surface/10">
                <Markdown>{streamingAnswer}</Markdown>
                <span className="inline-block animate-pulse text-on-surface-muted">{'\u2588'}</span>
              </div>
              {streamingSources.length > 0 && <SourcesList sources={streamingSources} />}
            </div>
          </div>
        )}

        {/* Streaming indicator (before any text arrives) */}
        {isStreaming && streamingAnswer === '' && (
          <div className="flex gap-3">
            <div className="mt-1 flex-shrink-0 text-lg">{'\u{1F916}'}</div>
            <div className="rounded-2xl rounded-tl-sm bg-on-surface/10 px-4 py-2 dark:bg-on-surface/10">
              <span className="animate-pulse text-sm text-on-surface-muted">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
