import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { markRead, markUnread } from '../lib/viewing-history.ts';

type ReadUnreadToggleProps = {
  fileNumber: string;
  initialRead: boolean;
};

export default function ReadUnreadToggle({ fileNumber, initialRead }: ReadUnreadToggleProps) {
  const [isRead, setIsRead] = useState<boolean>(initialRead);

  const toggle = () => {
    const newState: boolean = !isRead;
    setIsRead(newState);
    // Fire-and-forget
    if (newState) {
      void markRead(fileNumber);
    } else {
      void markUnread(fileNumber);
    }
  };

  return (
    <button
      className={`rounded p-1 ${
        isRead
          ? 'text-on-surface-muted hover:text-on-surface-muted dark:text-on-surface-muted dark:hover:text-on-surface-muted'
          : 'text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      title={isRead ? 'Mark as unread' : 'Mark as read'}
      type="button"
    >
      {isRead ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
    </button>
  );
}
