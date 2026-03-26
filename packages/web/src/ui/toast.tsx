import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';
import { cn } from '../lib/cn.ts';

type ToastVariant = 'default' | 'success' | 'error';

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  toast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId: number = 0;

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: 'border-border-theme bg-surface-card text-on-surface',
  error:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-50',
  success:
    'border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-50',
};

const TOAST_DURATION_MS: number = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<Toast>>([]);

  const addToast = useCallback((message: string, variant: ToastVariant = 'default') => {
    const id: number = nextId++;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext value={{ toast: addToast }}>
      {children}
      <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            className={cn(
              'animate-in slide-in-from-bottom-2 fade-in rounded-theme border px-4 py-3 text-sm shadow-lg',
              VARIANT_CLASSES[t.variant],
            )}
            key={t.id}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx == null) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
