import { Flag } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';

type FlagToggleProps = {
  contentKey: string;
  contentType: string;
  initialFlagged: boolean;
  onToggle?: (flagged: boolean) => void;
};

export function FlagToggle({ contentKey, contentType, initialFlagged, onToggle }: FlagToggleProps) {
  const [flagged, setFlagged] = useState<boolean>(initialFlagged);
  const [loading, setLoading] = useState<boolean>(false);

  const toggle = async (): Promise<void> => {
    setLoading(true);
    try {
      if (flagged) {
        // To unflag, we need to get the flag ID first — fetch active flags and dismiss
        const flags = await apiFetch<Array<{ content_key: string; id: number; }>>(
          `/api/user/flags?content_type=${encodeURIComponent(contentType)}`,
        );
        const match = flags.find((f) => f.content_key === contentKey);
        if (match != null) {
          await apiFetch(`/api/user/flags/${match.id}/dismiss`, { method: 'POST' });
        }
      } else {
        await apiFetch('/api/user/flags', {
          body: JSON.stringify({ content_key: contentKey, content_type: contentType }),
          method: 'POST',
        });
      }
      setFlagged(!flagged);
      onToggle?.(!flagged);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={cn(
        'rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700',
        flagged ? 'text-amber-500 dark:text-amber-400' : 'text-neutral-300 dark:text-neutral-600',
      )}
      disabled={loading}
      onClick={(e) => {
        e.stopPropagation();
        void toggle();
      }}
      title={flagged ? 'Unflag' : 'Flag for later'}
      type="button"
    >
      <Flag className="h-4 w-4" fill={flagged ? 'currentColor' : 'none'} />
    </button>
  );
}
