import { useCallback, useState } from 'react';
import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import type { Conversation } from './types.ts';

type Props = {
  activeId: string | null;
  conversations: Conversation[];
  onDelete: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onSelect: (id: string) => void;
};

function relativeTime(dateStr: string): string {
  const now: number = Date.now();
  const then: number = new Date(dateStr).getTime();
  const diffMs: number = now - then;
  const diffMin: number = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr: number = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)}h ago`;
  const diffDay: number = Math.floor(diffHr / 24);
  return `${String(diffDay)}d ago`;
}

export default function ConversationSidebar({
  activeId,
  conversations,
  onDelete,
  onNew,
  onRename,
  onSelect,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  const startRename = useCallback((conv: Conversation) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title ?? '');
  }, []);

  const submitRename = useCallback(() => {
    if (renamingId != null && renameValue.trim() !== '') {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRename]);

  return (
    <div className="flex h-full w-64 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="p-3">
        <Button className="w-full" onClick={onNew} size="sm" variant="outline">
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          New conversation
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv: Conversation) => (
          <div
            className={`group relative cursor-pointer border-b border-neutral-100 px-3 py-2 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800 ${
              conv.id === activeId
                ? 'bg-blue-50 dark:bg-blue-950'
                : ''
            }`}
            key={conv.id}
            onClick={() => onSelect(conv.id)}
          >
            {renamingId === conv.id ? (
              <Input
                autoFocus
                className="h-7 text-sm"
                onBlur={submitRename}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                value={renameValue}
              />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {conv.consultantIcon != null && (
                    <span className="text-sm">{conv.consultantIcon}</span>
                  )}
                  <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    {conv.title ?? 'Untitled'}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {relativeTime(conv.updatedAt)}
                </div>

                {/* Hover actions */}
                <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                  <button
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(conv);
                    }}
                    title="Rename"
                    type="button"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded p-1 text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    title="Delete"
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {conversations.length === 0 && (
          <p className="p-4 text-center text-sm text-neutral-400">
            No conversations yet
          </p>
        )}
      </div>
    </div>
  );
}
