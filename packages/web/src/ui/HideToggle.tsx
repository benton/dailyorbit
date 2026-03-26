import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';

type HideToggleProps = {
  contentKey: string;
  contentType: string;
  initialHidden: boolean;
  onToggle?: (nowHidden: boolean) => void;
};

export function HideToggle({ contentKey, contentType, initialHidden, onToggle }: HideToggleProps) {
  const [hidden, setHidden] = useState<boolean>(initialHidden);
  const [loading, setLoading] = useState<boolean>(false);

  const toggle = async (): Promise<void> => {
    setLoading(true);
    try {
      if (hidden) {
        // To unhide, we need to get the hidden item ID first — fetch active hidden items and find match
        const items = await apiFetch<Array<{ content_key: string; id: number }>>(
          `/api/user/hidden-items?content_type=${encodeURIComponent(contentType)}`,
        );
        const match = items.find((item) => item.content_key === contentKey);
        if (match != null) {
          await apiFetch(`/api/user/hidden-items/${match.id}/unhide`, { method: 'POST' });
        }
      } else {
        await apiFetch('/api/user/hidden-items', {
          body: JSON.stringify({ content_key: contentKey, content_type: contentType }),
          method: 'POST',
        });
      }
      setHidden(!hidden);
      onToggle?.(!hidden);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={cn(
        'rounded p-1 hover:bg-on-surface/10',
        hidden ? 'text-on-surface-muted' : 'text-on-surface-muted/50',
      )}
      disabled={loading}
      onClick={(e) => {
        e.stopPropagation();
        void toggle();
      }}
      title={hidden ? 'Unhide' : 'Hide'}
      type="button"
    >
      {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}
