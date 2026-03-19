import { Trash2, ArrowDownToLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/button.tsx';

export type LogLine = {
  level: 'info' | 'error' | 'progress';
  message: string;
  stage: string;
  timestamp: string;
};

type LogPanelProps = {
  lines: Array<LogLine>;
  onClear: () => void;
};

const LEVEL_CLASSES: Record<string, string> = {
  error: 'text-red-400',
  info: 'text-neutral-200',
  progress: 'text-neutral-500',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function LogPanel({ lines, onClear }: LogPanelProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [pinToBottom, setPinToBottom] = useState<boolean>(true);

  // Auto-scroll when pinned and new lines arrive
  useEffect(() => {
    if (pinToBottom && preRef.current != null) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines, pinToBottom]);

  // Detect manual scroll to un-pin
  const handleScroll = useCallback(() => {
    const el = preRef.current;
    if (el == null) {
      return;
    }
    const atBottom: boolean = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    setPinToBottom(atBottom);
  }, []);

  return (
    <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <span className="text-xs font-medium text-neutral-400">
          Log Output ({String(lines.length)} lines)
        </span>
        <div className="flex items-center gap-1">
          <Button
            className={pinToBottom ? 'text-blue-400' : 'text-neutral-500'}
            onClick={() => {
              setPinToBottom(true);
              if (preRef.current != null) {
                preRef.current.scrollTop = preRef.current.scrollHeight;
              }
            }}
            size="sm"
            title="Pin to bottom"
            type="button"
            variant="ghost"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </Button>
          <Button onClick={onClear} size="sm" title="Clear log" type="button" variant="ghost">
            <Trash2 className="h-3.5 w-3.5 text-neutral-500" />
          </Button>
        </div>
      </div>

      {/* Log content */}
      <pre
        className="h-64 overflow-auto p-3 font-mono text-xs leading-relaxed"
        onScroll={handleScroll}
        ref={preRef}
      >
        {lines.length === 0 && (
          <span className="text-neutral-600">No log output yet. Run a stage to see logs here.</span>
        )}
        {lines.map((line: LogLine, i: number) => (
          <div className={LEVEL_CLASSES[line.level] ?? 'text-neutral-200'} key={i}>
            <span className="text-neutral-600">{formatTime(line.timestamp)}</span>{' '}
            <span className="text-neutral-400">[{line.stage}]</span> {line.message}
          </div>
        ))}
      </pre>
    </div>
  );
}
