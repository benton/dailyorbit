import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { RetrievedSource } from '../query/types.ts';
import type { Consultant, Message } from './types.ts';

type Props = {
  consultants: Map<number, Consultant>;
  isStreaming: boolean;
  messages: Message[];
  streamingAnswer: string;
  streamingSources: RetrievedSource[];
};

function SourcesList({ sources }: { sources: RetrievedSource[] }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  if (sources.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {String(sources.length)} source{sources.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <ul className="mt-1 space-y-1">
          {sources.map((s: RetrievedSource, i: number) => (
            <li className="text-xs text-neutral-500" key={`${s.id}-${String(i)}`}>
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

  // Detect consultant switches for dividers
  let lastConsultantId: number | null = null;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg: Message) => {
          let divider: React.ReactNode = null;

          // Show divider when consultant changes between assistant messages
          if (msg.role === 'assistant' && msg.consultantId != null) {
            if (lastConsultantId != null && msg.consultantId !== lastConsultantId) {
              const consultant: Consultant | undefined = consultants.get(msg.consultantId);
              divider = (
                <div className="flex items-center gap-2 py-2 text-xs text-neutral-400">
                  <div className="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
                  <span>
                    Switched to {consultant?.icon ?? ''} {consultant?.name ?? 'another consultant'}
                  </span>
                  <div className="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
                </div>
              );
            }
            lastConsultantId = msg.consultantId;
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
                    <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2 text-sm dark:bg-neutral-800">
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
              <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2 text-sm dark:bg-neutral-800">
                <Markdown>{streamingAnswer}</Markdown>
                <span className="inline-block animate-pulse text-neutral-400">{'\u2588'}</span>
              </div>
              {streamingSources.length > 0 && <SourcesList sources={streamingSources} />}
            </div>
          </div>
        )}

        {/* Streaming indicator (before any text arrives) */}
        {isStreaming && streamingAnswer === '' && (
          <div className="flex gap-3">
            <div className="mt-1 flex-shrink-0 text-lg">{'\u{1F916}'}</div>
            <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2 dark:bg-neutral-800">
              <span className="animate-pulse text-sm text-neutral-400">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
