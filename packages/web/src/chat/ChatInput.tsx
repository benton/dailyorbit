import { Send, StopCircle } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { Consultant } from './types.ts';
import { Button } from '../ui/button.tsx';
import ConsultantSelector from './ConsultantSelector.tsx';

type Props = {
  consultants: Consultant[];
  disabled?: boolean;
  isStreaming: boolean;
  onCancel: () => void;
  onSelectConsultant: (consultant: Consultant) => void;
  onSend: (content: string) => void;
  selectedConsultant: Consultant | null;
};

export default function ChatInput({
  consultants,
  disabled = false,
  isStreaming,
  onCancel,
  onSelectConsultant,
  onSend,
  selectedConsultant,
}: Props) {
  const [value, setValue] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed: string = value.trim();
    if (trimmed === '' || isStreaming || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current != null) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isStreaming, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Auto-resize textarea
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const ta: HTMLTextAreaElement = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${String(Math.min(ta.scrollHeight, 200))}px`;
  }, []);

  return (
    <div className="border-t border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2">
          <ConsultantSelector
            compact
            consultants={consultants}
            onSelect={onSelectConsultant}
            selected={selectedConsultant}
          />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            disabled={disabled}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question... (Cmd+Enter to send)"
            ref={textareaRef}
            rows={1}
            value={value}
          />
          {isStreaming ? (
            <Button onClick={onCancel} size="icon" variant="outline">
              <StopCircle className="h-4 w-4 text-red-500" />
            </Button>
          ) : (
            <Button disabled={value.trim() === '' || disabled} onClick={handleSubmit} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
