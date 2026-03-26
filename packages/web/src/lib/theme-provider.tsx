import { ReactNode, useEffect } from 'react';
import { useSettings } from './settings-context.tsx';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const theme: string = settings?.theme ?? 'modern';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  return <>{children}</>;
}
