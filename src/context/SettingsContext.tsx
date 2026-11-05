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
  | 'network'
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
  customAccentColor?: string; // Optional custom accent hex (e.g. #52b788, #38bdf8)
  trueOledMode?: boolean; // Forces pure #000000 pitch-black canvas in dark modes
  showCalendarWidget: boolean; // toggles Calendar card on Dashboard
  showWeatherWidget: boolean; // toggles Weather card on Dashboard
  showQuickAppsDock: boolean; // toggles Quick Apps dock on Dashboard
  showSystemSpecs: boolean; // toggles CPU/RAM/Uptime status strip on Dashboard
  showVolumeSlider: boolean; // toggles master volume slider on Dashboard
  visualizerSensitivity: number; // 0.5 to 2.5 multiplier for live audio reactive spectrum

  // Dashboard, Media & Navigation Customization
  enableBrightnessSlider: boolean; // default false (ideal for desktop PCs)
  showMediaTab: boolean; // toggles [ Media ] tab
  showNetworkTab: boolean; // toggles [ Connect ] tab (Wi-Fi, Bluetooth, Hotspot, Battery Saver, Cast)
  showPerformanceTab: boolean; // toggles [ Performance ] tab
  showAppsTab: boolean; // toggles [ Apps ] tab between Performance and Wallpaper
  showWallpaperTab: boolean; // toggles [ Wallpaper ] tab
  showWeatherTab: boolean; // toggles [ Weather ] tab
  showPowerTab: boolean; // toggles [ Power ] tab
  showSettingsTab: boolean; // toggles [ Settings ] tab
  mascotMode: 'bongo' | 'gif' | 'none'; // 'bongo', 'gif', or 'none' (No GIF option)
  customMascotGifUrl: string; // optional custom GIF URL or data URL replacing Bongo Cat
  showTerminalTab: boolean; // toggles [ Developer / Terminal ] tab on/off (off by default)
  showHeaderSearch: boolean; // toggles Quick Search Command Palette icon in top header
  searchPosition?: 'left' | 'right'; // search button placement (opposite batteryPosition)
  batteryPosition: 'left' | 'right'; // battery indicator placement ('left' by default, 'right' optional)
  enableHotspotToggle: boolean; // toggles Hotspot button in Connect tab
  enablePowerSaverToggle: boolean; // toggles Battery Saver button in Connect tab
  enableCastingToggle: boolean; // toggles Wireless Display / Casting button in Connect tab
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
  panelAnchor: 'top-center' | 'top-left' | 'top-right'; // default 'top-center'
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
  showMediaTab: true,
  showNetworkTab: true,
  showPerformanceTab: true,
  showAppsTab: true,
  showWallpaperTab: true,
  customAccentColor: '',
  trueOledMode: false,
  showCalendarWidget: true,
  showWeatherWidget: true,
  showQuickAppsDock: true,
  showSystemSpecs: true,
  showVolumeSlider: true,
  visualizerSensitivity: 1.0,
  showWeatherTab: true,
  showPowerTab: true,
  showSettingsTab: true,
  mascotMode: 'bongo',
  customMascotGifUrl: '',
  showTerminalTab: false,
  showHeaderSearch: false,
  searchPosition: 'right',
  batteryPosition: 'left',
  enableHotspotToggle: true,
  enablePowerSaverToggle: true,
  enableCastingToggle: true,
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
  panelAnchor: 'top-center',
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

/** Pre-1.0 theme names still found in old settings files and host `theme:` commands. */
const LEGACY_THEME_ALIASES: Readonly<Record<string, CanopySettings['themeMode']>> = {
  obsidian: 'dark',
  alabaster: 'light',
};

/** Closed string unions: anything outside the list would leave the UI with no option selected. */
const ENUM_SETTINGS: Readonly<Partial<Record<keyof CanopySettings, readonly string[]>>> = {
  clockFormat: ['12h', '24h'],
  calendarFirstDay: ['sunday', 'monday'],
  temperatureUnit: ['fahrenheit', 'celsius'],
  weatherLocationMode: ['auto', 'manual'],
  themeMode: ['canopy', 'adaptive', 'dark', 'light', 'auto'],
  mascotMode: ['bongo', 'gif', 'none'],
  searchPosition: ['left', 'right'],
  batteryPosition: ['left', 'right'],
  visualizerStyle: ['radial', 'bars', 'wave'],
  panelMonitorMode: ['cursor', 'primary'],
  triggerMonitorScope: ['all', 'primary'],
  panelAnchor: ['top-center', 'top-left', 'top-right'],
};

/** Optional keys whose default is `undefined`, so the default cannot describe their type. */
const OPTIONAL_NUMBER_SETTINGS: Readonly<Record<string, true>> = {
  manualLatitude: true,
  manualLongitude: true,
};

const DEFAULT_SETTING_VALUES: Readonly<Record<string, unknown>> = { ...DEFAULT_SETTINGS };

/** Maps a legacy theme alias (any case) to its current name; other values pass through. */
function normalizeThemeMode(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const lower = value.toLowerCase();
  return Object.hasOwn(LEGACY_THEME_ALIASES, lower) ? LEGACY_THEME_ALIASES[lower] : lower;
}

function isValidSettingValue(key: string, value: unknown): boolean {
  // Own-key checks only: `constructor`/`__proto__` in untrusted JSON must never match.
  if (Object.hasOwn(OPTIONAL_NUMBER_SETTINGS, key)) {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
  }
  if (!Object.hasOwn(DEFAULT_SETTING_VALUES, key)) return false;
  const allowed = ENUM_SETTINGS[key as keyof CanopySettings];
  if (allowed) return typeof value === 'string' && allowed.includes(value);
  const fallback = DEFAULT_SETTING_VALUES[key];
  if (Array.isArray(fallback)) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
  if (typeof fallback === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (fallback !== null && typeof fallback === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === typeof fallback;
}

function isCustomAppEntry(app: unknown): boolean {
  return (
    app !== null &&
    typeof app === 'object' &&
    'label' in app &&
    typeof app.label === 'string' &&
    'path' in app &&
    typeof app.path === 'string'
  );
}

/**
 * Narrows untrusted settings JSON (host settings.json, localStorage, an imported file) to the keys
 * and value types this build understands. Wrong-typed values — e.g. `pinnedApps: null` from a
 * hand-edited or older file — are dropped so the defaults apply instead of crashing a view.
 */
export function sanitizeSettings(raw: unknown): Partial<CanopySettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(raw)) {
    const value: unknown = key === 'themeMode' ? normalizeThemeMode(rawValue) : rawValue;
    if (!isValidSettingValue(key, value)) continue;
    if (key === 'customApps' && value !== null && typeof value === 'object') {
      clean[key] = Object.fromEntries(
        Object.entries(value).filter(([, app]: [string, unknown]) => isCustomAppEntry(app)),
      );
      continue;
    }
    clean[key] = value;
  }
  return clean as Partial<CanopySettings>;
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
    return {
      ...DEFAULT_SETTINGS,
      ...sanitizeSettings(JSON.parse(raw)),
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
  const pendingSaveRef = useRef<CanopySettings | null>(null);

  // The host copy at %LOCALAPPDATA%\Canopy\settings.json is the durable store; the WebView2
  // localStorage copy is only a fast cache. Read the host file first — writing it before this
  // resolves would overwrite good settings with a stale (or cleared) localStorage copy.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const hostSettings = sanitizeSettings(await getSettingsJson());
        if (active) {
          // Edits made before the host file arrived are re-applied on top of it. Read them here,
          // not inside the updater: updaters must stay pure (StrictMode runs them twice).
          const pending = pendingUpdatesRef.current;
          pendingUpdatesRef.current = {};
          // The settings effect below persists the merged result once hydration flips.
          setSettings((prev) => ({ ...prev, ...hostSettings, ...pending }));
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
      const detail = (e as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const requested =
        ('mode' in detail && detail.mode) || ('theme' in detail && detail.theme) || undefined;
      const nextMode = normalizeThemeMode(requested);
      if (isValidSettingValue('themeMode', nextMode)) {
        const themeMode = nextMode as CanopySettings['themeMode'];
        setSettings((prev) => (prev.themeMode === themeMode ? prev : { ...prev, themeMode }));
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
    pendingSaveRef.current = settings;
    const timer = window.setTimeout(() => {
      pendingSaveRef.current = null;
      void saveSettingsJson(settings as unknown as Record<string, unknown>).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [settings, hydratedFromHost]);

  // A reload (palette "Reload Canopy UI", host reload_ui) inside the 250 ms debounce would drop the
  // last edit from settings.json, and on the next start the stale host file wins over localStorage.
  useEffect(() => {
    const flushPendingSave = () => {
      const pending = pendingSaveRef.current;
      if (!pending) return;
      pendingSaveRef.current = null;
      void saveSettingsJson(pending as unknown as Record<string, unknown>).catch(() => undefined);
    };
    window.addEventListener('pagehide', flushPendingSave);
    return () => window.removeEventListener('pagehide', flushPendingSave);
  }, []);

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
      panelAnchor: settings.panelAnchor,
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
    settings.panelAnchor,
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
        // Enforce strict mutual exclusion: battery indicator and search button can never be on the same side
        if (partial.batteryPosition) {
          next.searchPosition = partial.batteryPosition === 'left' ? 'right' : 'left';
        } else if (partial.searchPosition) {
          next.batteryPosition = partial.searchPosition === 'left' ? 'right' : 'left';
        }
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
