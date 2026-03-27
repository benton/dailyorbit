import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useSettings } from './settings-context.tsx';
import { THEMES } from './themes.ts';

const STORAGE_KEY = 'do-theme';
const themeIds: Array<string> = THEMES.map((t) => t.id);

type ThemeContextValue = {
  theme: string;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'modern',
  toggleTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, updateSetting } = useSettings();
  const [localTheme, setLocalTheme] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? 'modern',
  );

  const isAuthenticated: boolean = settings != null;
  const theme: string = settings != null ? (settings.theme ?? 'modern') : localTheme;
  const prevThemeRef = useRef<string>(theme);

  const toggleTheme = useCallback(() => {
    const currentIdx: number = themeIds.indexOf(theme);
    const nextTheme: string = themeIds[(currentIdx + 1) % themeIds.length] ?? 'modern';
    if (isAuthenticated) {
      updateSetting('theme', nextTheme);
    } else {
      setLocalTheme(nextTheme);
      localStorage.setItem(STORAGE_KEY, nextTheme);
    }
  }, [theme, isAuthenticated, updateSetting]);

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

  const contextValue: ThemeContextValue = { theme, toggleTheme };

  return <ThemeContext value={contextValue}>{children}</ThemeContext>;
}
