import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ThemeContext,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  normalizeThemePreference,
} from '../context/ThemeContext';

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function getSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? 'dark' : 'light';
}

function readStoredThemePreference() {
  if (typeof window === 'undefined') return 'system';

  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function writeStoredThemePreference(themePreference) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  } catch {
    // Storage may be unavailable in private contexts; theme still works in memory.
  }
}

const ThemeProvider = ({ children }) => {
  const [themePreference, setThemePreferenceState] = useState(readStoredThemePreference);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const effectiveTheme = themePreference === 'system' ? systemTheme : themePreference;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const handleChange = (event) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }

    return undefined;
  }, []);

  useEffect(() => {
    writeStoredThemePreference(themePreference);
  }, [themePreference]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    root.dataset.theme = effectiveTheme;
    root.dataset.themePreference = themePreference;
    root.style.colorScheme = effectiveTheme;
  }, [effectiveTheme, themePreference]);

  const setThemePreference = useCallback((nextPreference) => {
    setThemePreferenceState((currentPreference) => {
      const nextValue =
        typeof nextPreference === 'function' ? nextPreference(currentPreference) : nextPreference;
      return normalizeThemePreference(nextValue);
    });
  }, []);

  const cycleThemePreference = useCallback(() => {
    setThemePreference((currentPreference) => {
      const currentIndex = THEME_PREFERENCES.indexOf(currentPreference);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % THEME_PREFERENCES.length;
      return THEME_PREFERENCES[nextIndex];
    });
  }, [setThemePreference]);

  const value = useMemo(
    () => ({
      themePreference,
      effectiveTheme,
      setThemePreference,
      cycleThemePreference,
    }),
    [cycleThemePreference, effectiveTheme, setThemePreference, themePreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export default ThemeProvider;
