import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_THEME, THEMES, type Theme, type ThemeId } from './themes';

const STORAGE_KEY = 'splitify.theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    // On the web, ?theme=receipt (etc.) opens a specific theme: handy for sharing and testing.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const fromUrl = new URLSearchParams(window.location.search).get('theme');
      if (fromUrl && fromUrl in THEMES) {
        setId(fromUrl as ThemeId);
        return;
      }
    }
    // The saved choice is a convenience; any storage failure just keeps the default.
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved && saved in THEMES) setId(saved as ThemeId);
      })
      .catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: THEMES[id],
      setTheme: (next) => {
        setId(next);
        AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      },
    }),
    [id],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
