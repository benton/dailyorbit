import { ReactNode, useEffect, useRef } from 'react';
import { useSettings } from './settings-context.tsx';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const theme: string = settings?.theme ?? 'modern';
  const prevThemeRef = useRef<string>(theme);

  useEffect(() => {
    const el: HTMLElement = document.documentElement;

    // Enable transition animation only on intentional theme switches (not initial load)
    if (prevThemeRef.current !== theme) {
      el.dataset.themeTransition = '';
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        delete el.dataset.themeTransition;
      }, 400);
      prevThemeRef.current = theme;
      el.dataset.theme = theme;
      return () => {
        clearTimeout(timer);
      };
    }

    el.dataset.theme = theme;
    return () => {
      delete el.dataset.theme;
    };
  }, [theme]);

  return <>{children}</>;
}
