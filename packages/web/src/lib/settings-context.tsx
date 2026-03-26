import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '../user/AuthContext.tsx';
import { apiFetch } from './api.ts';

export type UserSettings = {
  emailDailyOrbit: boolean;
  theme: string;
  userId: string;
  wideView: boolean;
};

type SettingsContextValue = {
  settings: UserSettings | null;
  updateSetting: <K extends keyof Omit<UserSettings, 'userId'>>(
    key: K,
    value: UserSettings[K],
  ) => void;
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: null,
  updateSetting: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      // eslint-disable-next-line react-hooks-js/set-state-in-effect
      setSettings(null);
      return;
    }

    apiFetch<UserSettings>('/api/user/settings')
      .then((data: UserSettings) => setSettings(data))
      .catch(() => {});
  }, [isAuthenticated]);

  const updateSetting = useCallback(
    <K extends keyof Omit<UserSettings, 'userId'>>(key: K, value: UserSettings[K]) => {
      // Optimistic update
      setSettings((prev: UserSettings | null) => (prev != null ? { ...prev, [key]: value } : prev));

      // Fire-and-forget PATCH
      void apiFetch('/api/user/settings', {
        body: JSON.stringify({ [key]: value }),
        method: 'PATCH',
      });
    },
    [],
  );

  const contextValue: SettingsContextValue = {
    settings,
    updateSetting,
  };

  return <SettingsContext value={contextValue}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
