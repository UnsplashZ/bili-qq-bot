import { createContext } from 'react';

export const THEME_STORAGE_KEY = 'bili-qq-bot.dashboard.theme';
export const THEME_PREFERENCES = ['system', 'light', 'dark'];

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : 'system';
}

export const ThemeContext = createContext(null);
