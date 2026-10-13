import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type TabId =
  | 'dashboard'
  | 'media'
  | 'performance'
  | 'apps'
  | 'wallpaper'
  | 'weather'
  | 'terminal'
  | 'settings';

export interface CanopySettings {
  // Clock & Date Settings
  clockFormat: '12h' | '24h';
  showSeconds: boolean;
  calendarFirstDay: 'sunday' | 'monday';

  // Weather Settings
  temperatureUnit: 'fahrenheit' | 'celsius';
  weatherLocationMode: 'auto' | 'manual';
  manualLatitude?: number;
  manualLongitude?: number;
  manualCityName?: string;

  // Wallpaper & Theming Settings
  wallpaperDirectory: string;
  themeMode: 'auto' | 'dark' | 'light';
  glassBlurStrength: number; // 16 to 32 (default 24)
  glassOpacity: number; // 0.70 to 0.95 (default 0.86)

  // Dashboard, Media & Navigation Customization
  enableBrightnessSlider: boolean; // default false (ideal for desktop PCs)
  showAppsTab: boolean; // toggles [ Apps ] tab between Performance and Wallpaper
  customMascotGifUrl: string; // optional custom GIF URL or data URL replacing Bongo Cat

  // Window & System Mechanics
  launchOnStartup: boolean;
  topHoverTrigger: boolean;
  globalHotkey: string; // default "Win+`"
  defaultTab: 'dashboard';
}

export interface SettingsContextValue {
  settings: CanopySettings;
  updateSettings: (partial: Partial<CanopySettings>) => void;
  resetSettings: () => void;
}

const STORAGE_KEY = 'canopy_user_settings';
const LEGACY_TAB_KEYS = ['canopy_active_tab', 'caelestia_active_tab', 'activeTab'];

export const DEFAULT_SETTINGS: CanopySettings = {
  clockFormat: '24h',
  showSeconds: false,
  calendarFirstDay: 'monday',
  temperatureUnit: 'celsius',
  weatherLocationMode: 'auto',
  manualCityName: 'San Francisco',
  manualLatitude: 37.7749,
  manualLongitude: -122.4194,
  wallpaperDirectory: 'C:\\Users\\CEO\\Pictures\\Wallpapers',
  themeMode: 'auto',
  glassBlurStrength: 24,
  glassOpacity: 0.86,
  enableBrightnessSlider: false,
  showAppsTab: true,
  customMascotGifUrl: '',
  launchOnStartup: false,
  topHoverTrigger: true,
  globalHotkey: 'Win+`',
  defaultTab: 'dashboard',
};

function applyGlassCssVariables(blurStrength: number, opacity: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--glass-blur', `${blurStrength}px`);
  root.style.setProperty('--glass-opacity', `${opacity}`);
}

function clearPersistentActiveTabState(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of LEGACY_TAB_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors
  }
}

function loadStoredSettings(): CanopySettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }
  clearPersistentActiveTabState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<CanopySettings>;
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Always enforce 'dashboard' as startup default tab
      defaultTab: 'dashboard',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => undefined,
  resetSettings: () => undefined,
});

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<CanopySettings>(() => {
    const initial = loadStoredSettings();
    applyGlassCssVariables(initial.glassBlurStrength, initial.glassOpacity);
    return initial;
  });

  useEffect(() => {
    applyGlassCssVariables(settings.glassBlurStrength, settings.glassOpacity);
    try {
      if (typeof window !== 'undefined') {
        const normalized: CanopySettings = { ...settings, defaultTab: 'dashboard' };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      }
    } catch {
      // Ignore storage quota errors
    }
  }, [settings]);

  const updateSettings = useCallback((partial: Partial<CanopySettings>) => {
    setSettings((prev) => {
      const next: CanopySettings = {
        ...prev,
        ...partial,
        defaultTab: 'dashboard',
      };
      applyGlassCssVariables(next.glassBlurStrength, next.glassOpacity);
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    const fresh: CanopySettings = { ...DEFAULT_SETTINGS };
    setSettings(fresh);
    applyGlassCssVariables(fresh.glassBlurStrength, fresh.glassOpacity);
    try {
      if (typeof window !== 'undefined') {
        clearPersistentActiveTabState();
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const contextValue = useMemo<SettingsContextValue>(
    () => ({
      settings,
      updateSettings,
      resetSettings,
    }),
    [settings, updateSettings, resetSettings],
  );

  return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
};

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
