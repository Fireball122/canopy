import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getSettingsJson, saveSettingsJson, setHostConfig } from '../services/hostBridge';

export type TabId =
  | 'dashboard'
  | 'media'
  | 'performance'
  | 'apps'
  | 'wallpaper'
  | 'weather'
  | 'terminal'
  | 'power'
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
  themeMode: 'canopy' | 'adaptive' | 'dark' | 'light' | 'auto';
  activeWallpaperPath?: string;
  glassBlurStrength: number; // 16 to 32 (default 24)
  glassOpacity: number; // 0.70 to 0.95 (default 0.86)

  // Dashboard, Media & Navigation Customization
  enableBrightnessSlider: boolean; // default false (ideal for desktop PCs)
  showAppsTab: boolean; // toggles [ Apps ] tab between Performance and Wallpaper
  mascotMode: 'bongo' | 'gif' | 'none'; // 'bongo', 'gif', or 'none' (No GIF option)
  customMascotGifUrl: string; // optional custom GIF URL or data URL replacing Bongo Cat
  showTerminalTab: boolean; // toggles [ Terminal ] tab on/off
  pinnedApps: string[]; // App IDs pinned to Dashboard dock
  customApps?: Record<string, { label: string; path: string; icon_data_url?: string | null }>; // Metadata for custom pinned apps
  visualizerStyle: 'radial' | 'bars' | 'wave'; // Audio visualizer mode
  wallpaperFavorites: string[]; // List of favorite wallpaper paths
  favoriteApps: string[]; // List of favorite app IDs that float to the top of Apps view

  // Panel Motion
  animationsEnabled: boolean; // default true
  animationDurationMs: number; // 120 to 600 (default 280)

  // Fullscreen & Quiet Hours Suppression
  pauseTriggerInFullscreen: boolean; // default true
  pauseTriggerDuringPresentations: boolean; // default true
  quietHoursEnabled: boolean; // default false
  quietHoursStart: string; // "HH:mm", default "22:00"
  quietHoursEnd: string; // "HH:mm", default "07:00"

  // Panel Placement
  panelMonitorMode: 'cursor' | 'primary'; // default 'cursor'
  triggerMonitorScope: 'all' | 'primary'; // default 'all'
  showPanelOnLaunch: boolean; // default true

  // Performance
  suspendWebViewWhenClosed: boolean; // default true

  // Audio
  showMicSlider: boolean; // default true
  lyricOffsetMs: number; // -2000 to 2000, default 0. Applied to synced-lyric highlighting.

  // Wallpaper (experimental)
  wallpaperPerMonitor: boolean; // default false
  wallpaperSlideshowEnabled: boolean; // default false
  wallpaperSlideshowMinutes: number; // 5 to 1440 (default 30)
  wallpaperShuffle: boolean; // default false

  // Diagnostics & Telemetry
  diagnosticLogging: boolean; // default false
  showBatteryChip: boolean; // default true
  enableCornerResizeTabs: boolean; // default false (resizable corner grips)
  appScale: number; // 0.75 to 1.35 (default 1.0, scales both width and height proportionately)
  appWidth: number; // 700 to 1400 (default 850)
  appHeight: number; // 360 to 750 (default 430)

  // Window & System Mechanics
  launchOnStartup: boolean;
  topHoverTrigger: boolean;
  triggerWidth: number; // 100 to 1920 (default 950)
  triggerHeight: number; // 1 to 30 (default 8)
  triggerDelayMs: number; // 0 to 1000 (default 0)
  hideDebounceMs: number; // 100 to 2000 (default 300)
  globalHotkey: string; // default "Win+`"
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
  manualCityName: '',
  manualLatitude: undefined,
  manualLongitude: undefined,
  wallpaperDirectory: '',
  themeMode: 'canopy',
  activeWallpaperPath: '',
  glassBlurStrength: 24,
  glassOpacity: 0.86,
  enableBrightnessSlider: false,
  showAppsTab: true,
  mascotMode: 'bongo',
  customMascotGifUrl: '',
  showTerminalTab: false,
  pinnedApps: ['terminal', 'explorer', 'taskmgr', 'msedge', 'code'],
  customApps: {},
  visualizerStyle: 'radial',
  wallpaperFavorites: [],
  favoriteApps: [],
  animationsEnabled: true,
  animationDurationMs: 280,
  pauseTriggerInFullscreen: true,
  pauseTriggerDuringPresentations: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  panelMonitorMode: 'cursor',
  triggerMonitorScope: 'all',
  showPanelOnLaunch: true,
  suspendWebViewWhenClosed: true,
  showMicSlider: true,
  lyricOffsetMs: 0,
  wallpaperPerMonitor: false,
  wallpaperSlideshowEnabled: false,
  wallpaperSlideshowMinutes: 30,
  wallpaperShuffle: false,
  diagnosticLogging: false,
  showBatteryChip: true,
  launchOnStartup: false,
  topHoverTrigger: true,
  triggerWidth: 950,
  triggerHeight: 8,
  triggerDelayMs: 0,
  hideDebounceMs: 200,
  globalHotkey: 'Win+`',
  enableCornerResizeTabs: false,
  appScale: 1.0,
  appWidth: 850,
  appHeight: 430,
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
  const [hydratedFromHost, setHydratedFromHost] = useState(false);
  const pendingUpdatesRef = useRef<Partial<CanopySettings>>({});

  // The host copy at %LOCALAPPDATA%\Canopy\settings.json is the durable store; the WebView2
  // localStorage copy is only a fast cache. Read the host file first — writing it before this
  // resolves would overwrite good settings with a stale (or cleared) localStorage copy.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const hostSettings = await getSettingsJson<Partial<CanopySettings>>();
        if (active) {
          setSettings((prev) => {
            const merged: CanopySettings = {
              ...prev,
              ...(hostSettings && typeof hostSettings === 'object' ? hostSettings : {}),
              ...pendingUpdatesRef.current,
            };
            pendingUpdatesRef.current = {};
            applyGlassCssVariables(merged.glassBlurStrength, merged.glassOpacity);
            void saveSettingsJson(merged as unknown as Record<string, unknown>).catch(
              () => undefined,
            );
            return merged;
          });
          setHydratedFromHost(true);
        }
      } catch {
        // Unreadable host file (first run, permissions): keep the localStorage copy.
      } finally {
        if (active) setHydratedFromHost(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const handleLoggingChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      if (detail && typeof detail.enabled === 'boolean') {
        setSettings((prev) => {
          if (prev.diagnosticLogging === detail.enabled) return prev;
          return { ...prev, diagnosticLogging: detail.enabled };
        });
      }
    };

    const handleTopHoverTriggerChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      if (detail && typeof detail.enabled === 'boolean') {
        setSettings((prev) => {
          if (prev.topHoverTrigger === detail.enabled) return prev;
          return { ...prev, topHoverTrigger: detail.enabled };
        });
      }
    };

    const handleHotkeyFallback = (e: Event) => {
      const detail = (e as CustomEvent<{ hotkey: string }>).detail;
      if (detail && typeof detail.hotkey === 'string') {
        setSettings((prev) => {
          if (prev.globalHotkey === detail.hotkey) return prev;
          return { ...prev, globalHotkey: detail.hotkey };
        });
      }
    };

    const handleThemeChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ mode: string }>).detail;
      if (detail && typeof detail.mode === 'string') {
        const validModes: Array<CanopySettings['themeMode']> = [
          'canopy',
          'adaptive',
          'dark',
          'light',
          'auto',
        ];
        if (validModes.includes(detail.mode as CanopySettings['themeMode'])) {
          const nextMode = detail.mode as CanopySettings['themeMode'];
          setSettings((prev) => {
            if (prev.themeMode === nextMode) return prev;
            return { ...prev, themeMode: nextMode };
          });
        }
      }
    };

    window.addEventListener('diagnostic-logging-changed', handleLoggingChanged);
    window.addEventListener('top-hover-trigger-changed', handleTopHoverTriggerChanged);
    window.addEventListener('hotkey-fallback', handleHotkeyFallback);
    window.addEventListener('canopy:theme-changed', handleThemeChanged);

    return () => {
      window.removeEventListener('diagnostic-logging-changed', handleLoggingChanged);
      window.removeEventListener('top-hover-trigger-changed', handleTopHoverTriggerChanged);
      window.removeEventListener('hotkey-fallback', handleHotkeyFallback);
      window.removeEventListener('canopy:theme-changed', handleThemeChanged);
    };
  }, []);

  useEffect(() => {
    applyGlassCssVariables(settings.glassBlurStrength, settings.glassOpacity);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      }
    } catch {
      // Ignore storage quota errors
    }
    if (!hydratedFromHost) return;
    const timer = window.setTimeout(() => {
      void saveSettingsJson(settings as unknown as Record<string, unknown>).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [settings, hydratedFromHost]);

  // Push every host-relevant setting to the native host in one message.
  useEffect(() => {
    void setHostConfig({
      triggerWidth: settings.triggerWidth,
      triggerHeight: settings.triggerHeight,
      triggerDelayMs: settings.triggerDelayMs,
      hideDebounceMs: settings.hideDebounceMs,
      topHoverTrigger: settings.topHoverTrigger,
      appWidth: settings.appWidth,
      appHeight: settings.appHeight,
      appScale: settings.appScale,
      pauseInFullscreen: settings.pauseTriggerInFullscreen,
      pauseInPresentation: settings.pauseTriggerDuringPresentations,
      quietHoursEnabled: settings.quietHoursEnabled,
      quietHoursStart: settings.quietHoursStart,
      quietHoursEnd: settings.quietHoursEnd,
      panelMonitorMode: settings.panelMonitorMode,
      triggerMonitorScope: settings.triggerMonitorScope,
      animationsEnabled: settings.animationsEnabled,
      animationDurationMs: settings.animationDurationMs,
      suspendWhenClosed: settings.suspendWebViewWhenClosed,
      showPanelOnLaunch: settings.showPanelOnLaunch,
      hotkey: settings.globalHotkey,
      diagnosticLogging: settings.diagnosticLogging,
    }).catch(() => undefined);
  }, [
    settings.triggerWidth,
    settings.triggerHeight,
    settings.triggerDelayMs,
    settings.hideDebounceMs,
    settings.topHoverTrigger,
    settings.appWidth,
    settings.appHeight,
    settings.appScale,
    settings.pauseTriggerInFullscreen,
    settings.pauseTriggerDuringPresentations,
    settings.quietHoursEnabled,
    settings.quietHoursStart,
    settings.quietHoursEnd,
    settings.panelMonitorMode,
    settings.triggerMonitorScope,
    settings.animationsEnabled,
    settings.animationDurationMs,
    settings.suspendWebViewWhenClosed,
    settings.showPanelOnLaunch,
    settings.globalHotkey,
    settings.diagnosticLogging,
  ]);

  const updateSettings = useCallback(
    (partial: Partial<CanopySettings>) => {
      if (!hydratedFromHost) {
        pendingUpdatesRef.current = {
          ...pendingUpdatesRef.current,
          ...partial,
        };
      }
      setSettings((prev) => {
        const next: CanopySettings = {
          ...prev,
          ...partial,
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
    },
    [hydratedFromHost],
  );

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
    void saveSettingsJson(DEFAULT_SETTINGS as unknown as Record<string, unknown>).catch(
      () => undefined,
    );
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
