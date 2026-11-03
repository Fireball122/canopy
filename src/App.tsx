import {
  Activity,
  AppWindow,
  Battery,
  BatteryCharging,
  CloudSun,
  Cpu,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  Lock,
  Mic2,
  Moon,
  Music,
  Play,
  Power as PowerIcon,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sliders,
  Terminal as TerminalIcon,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette, type CommandPaletteItem } from './components/CommandPalette';
import { DropletNotification } from './components/DropletNotification';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsProvider, type TabId, useSettings } from './context/SettingsContext';
import { useAlbumArt } from './hooks/useAlbumArt';
import { usePanelOpen } from './hooks/usePanelOpen';
import { usePlaybackClock } from './hooks/usePlaybackClock';
import {
  applyWallpaper,
  type BatteryStatus,
  executePowerAction,
  getAudioSpectrum,
  getBatteryStatus,
  getBrightness,
  getCaffeineStatus,
  getDesktopMonitorThumbnail,
  getDndStatus,
  getInstalledApps,
  getMasterVolume,
  getMediaInfo,
  getMicState,
  getSystemStats,
  getWallpapers,
  type InstalledAppItem,
  isWebViewHost,
  launchApp,
  type MediaInfo,
  mediaNext,
  mediaPlayPause,
  mediaPrev,
  mediaSeek,
  notifyTabSwitched,
  pickWallpaperFolder,
  reloadUi,
  type SystemStats,
  selectMediaSession,
  setAudioVolume,
  setBrightness,
  setDesktopWallpaper,
  setDropdownOpen,
  setMasterVolume,
  setTopHoverTrigger,
  setWindowSize,
  type WallpaperEntry,
  setMicMute as writeMicMute,
  setMicVolume as writeMicVolume,
} from './services/hostBridge';
import {
  applyThemeFromImageSrc,
  applyThemeModeFallback,
  applyThemePalette,
  initializeSystemThemeWatcher,
} from './services/palette';
import { fetchWeather, type WeatherData } from './services/weather';
import { AppsView } from './views/AppsView';
import { DashboardView } from './views/DashboardView';
import { MediaView } from './views/MediaView';
import { NetworkView } from './views/NetworkView';
import { PerformanceView } from './views/PerformanceView';
import { PowerView } from './views/PowerView';
import { SettingsView } from './views/SettingsView';
import { TerminalView } from './views/TerminalView';
import { WallpaperView } from './views/WallpaperView';
import { WeatherView } from './views/WeatherView';

/**
 * Structural equality for polled bridge payloads. State setters use it to return the previous
 * object when a snapshot is unchanged, so React skips the render entirely.
 */
function samePayload(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => samePayload(item, b[index]));
  }
  // Plain JSON payloads: structural view over keys only, no shape claim is made.
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => samePayload(aRecord[key], bRecord[key]));
}

const DEFAULT_WEATHER: WeatherData = {
  isLive: false,
  updatedAt: 0,
  temp: 0,
  condition: 'Unavailable',
  code: -1,
  feelsLike: 0,
  humidity: 0,
  windSpeed: 0,
  high: 0,
  low: 0,
  locationName: 'Weather unavailable',
  unit: 'celsius',
  unitSymbol: '°C',
  hourly: [],
  daily: [],
};

const QUICK_LAUNCH_SLOTS = 6;

/**
 * Places an app into the fixed six-slot Quick Launch dock: the first empty slot when there is room,
 * otherwise the last occupied slot so the other positions never renumber.
 */
function placeInQuickLaunch(
  pinnedApps: string[],
  appId: string,
): { slots: string[]; replacedId: string } {
  const slots = Array.from({ length: QUICK_LAUNCH_SLOTS }, (_, index) => pinnedApps[index] ?? '');
  const emptyIndex = slots.indexOf('');
  if (emptyIndex !== -1) {
    slots[emptyIndex] = appId;
    return { slots, replacedId: '' };
  }

  const replacedId = slots[QUICK_LAUNCH_SLOTS - 1];
  slots[QUICK_LAUNCH_SLOTS - 1] = appId;
  return { slots, replacedId };
}

const CanopyShellContent: React.FC = () => {
  const { settings, updateSettings } = useSettings();

  // Panel visibility sourced straight from the host events so every poll can stand down.
  const panelOpen = usePanelOpen();
  const [pageVisible, setPageVisible] = useState<boolean>(
    () => document.visibilityState !== 'hidden',
  );
  const shellActive = panelOpen && pageVisible;

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Always initialize to 'dashboard' on startup and clear any legacy stored tab state
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Clock state
  const [now, setNow] = useState<Date>(() => new Date());

  // System stats state (polled every 1500ms)
  const [stats, setStats] = useState<SystemStats>({
    cpu_usage: 14,
    cpu_temp_c: null,
    gpu_usage: null,
    gpu_temp_c: null,
    core_usages: [18, 12, 24, 9, 15, 11, 21, 8, 14, 10, 16, 7],
    top_processes: [
      { name: 'Canopy.exe', pid: 30416, cpu_usage: 1.4, memory_mb: 58.2 },
      { name: 'dwm.exe', pid: 1104, cpu_usage: 2.8, memory_mb: 184.0 },
      { name: 'msedgewebview2.exe', pid: 9240, cpu_usage: 1.9, memory_mb: 126.4 },
      { name: 'explorer.exe', pid: 4820, cpu_usage: 0.9, memory_mb: 112.5 },
      { name: 'audiodg.exe', pid: 2688, cpu_usage: 0.5, memory_mb: 24.1 },
    ],
    net_down_kbps: 23.3,
    net_up_kbps: 14.2,
    ram_usage: 46,
    ram_used_gb: 5.4,
    ram_total_gb: 16.0,
    disk_usage: 55,
    disk_used_gb: 230,
    disk_total_gb: 512,
    uptime_formatted: 'up 3 hours, 18 minutes',
    hostname: 'CANOPY-WIN11',
    os_name: 'Windows 11',
    username: 'user',
  });

  // Media state (polled every 800ms)
  const [media, setMedia] = useState<MediaInfo>({
    title: 'Bad Apple!!',
    artist: 'Nomico • Alstroemeria Records',
    album: 'Lovelight',
    is_playing: false,
    position_secs: 42,
    duration_secs: 219,
    artwork_url: null,
    source_app: 'Spotify',
    sessions: [
      {
        id: 'Spotify.exe',
        app_name: 'Spotify',
        title: 'Bad Apple!!',
        artist: 'Nomico',
        is_playing: false,
        is_current: true,
      },
      {
        id: 'Feishin.exe',
        app_name: 'Feishin',
        title: 'Night of Nights',
        artist: 'COOL&CREATE',
        is_playing: false,
        is_current: false,
      },
      {
        id: 'chrome.exe',
        app_name: 'Chrome',
        title: 'Lofi Hip Hop Radio',
        artist: 'Lofi Girl',
        is_playing: false,
        is_current: false,
      },
    ],
  });

  // Master Volume & Display Brightness state
  const [volume, setVolume] = useState<number>(68);
  const [brightness, setBrightnessState] = useState<number>(82);

  // Wallpapers state
  const [wallpapers, setWallpapers] = useState<WallpaperEntry[]>([]);
  const [wallpaperStatus, setWallpaperStatus] = useState<string>('');

  // Weather state
  const [weather, setWeather] = useState<WeatherData>(DEFAULT_WEATHER);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);

  const [appPickerMode, setAppPickerMode] = useState<boolean>(false);

  // Microphone slider (host-backed) + battery chip state
  const [micVolume, setMicVolume] = useState<number>(75);
  const [micMuted, setMicMuted] = useState<boolean>(false);
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [installedApps, setInstalledApps] = useState<InstalledAppItem[]>([]);

  // Load installed apps for Command Palette launching
  useEffect(() => {
    let mounted = true;
    getInstalledApps()
      .then((apps) => {
        if (mounted && Array.isArray(apps)) setInstalledApps(apps);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const isMusicPlaying = Boolean(media.is_playing);
  const resolvedArtwork = useAlbumArt(media.title, media.artist, media.artwork_url);
  const [spectrumBands, setSpectrumBands] = useState<number[]>(() => new Array(40).fill(0));

  const spectrumInFlightRef = useRef<boolean>(false);
  useEffect(() => {
    if (!panelOpen || activeTab !== 'dashboard') return;
    let active = true;
    const poll = async () => {
      if (spectrumInFlightRef.current) return;
      spectrumInFlightRef.current = true;
      try {
        const bands = await getAudioSpectrum();
        if (active && Array.isArray(bands) && bands.length > 0) {
          setSpectrumBands(bands);
        }
      } catch {
      } finally {
        spectrumInFlightRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 40);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [panelOpen, activeTab]);

  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [paletteQuery, setPaletteQuery] = useState<string>('');
  const [caffeineActive, setCaffeineActive] = useState<boolean>(false);
  const [dndActive, setDndActive] = useState<boolean>(false);
  const [mediaSubView, setMediaSubView] = useState<'main' | 'lyrics' | 'mixer'>('main');
  const [performanceDetails, setPerformanceDetails] = useState<boolean>(false);

  useEffect(() => {
    void getCaffeineStatus()
      .then((s) => setCaffeineActive(s.enabled))
      .catch(() => undefined);
    void getDndStatus()
      .then((s) => setDndActive(s.enabled))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleNavigateTab = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (
        detail &&
        typeof detail === 'object' &&
        'tab' in detail &&
        typeof detail.tab === 'string'
      ) {
        setActiveTab(detail.tab as TabId);
      }
    };
    window.addEventListener('canopy:navigate_tab', handleNavigateTab);

    const handleThemeChanged = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (
        detail &&
        typeof detail === 'object' &&
        'theme' in detail &&
        typeof detail.theme === 'string'
      ) {
        const raw = detail.theme.toLowerCase();
        const valid = ['canopy', 'adaptive', 'dark', 'light', 'auto'].includes(raw)
          ? (raw as 'canopy' | 'adaptive' | 'dark' | 'light' | 'auto')
          : 'canopy';
        updateSettings({ themeMode: valid });
      }
    };
    window.addEventListener('canopy:theme-changed', handleThemeChanged);

    return () => {
      window.removeEventListener('canopy:navigate_tab', handleNavigateTab);
      window.removeEventListener('canopy:theme-changed', handleThemeChanged);
    };
  }, [updateSettings]);

  const visibleTabs = useMemo<{ id: TabId; label: string; icon: React.ReactNode }[]>(
    () => [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: <LayoutGrid className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
      {
        id: 'media' as TabId,
        label: 'Media',
        icon: <Music className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
      ...(settings.showPerformanceTab
        ? [
            {
              id: 'performance' as TabId,
              label: 'Performance',
              icon: <Activity className="w-3.5 h-3.5" strokeWidth={1.9} />,
            },
          ]
        : []),
      ...(settings.showAppsTab
        ? [
            {
              id: 'apps' as TabId,
              label: 'Apps',
              icon: <AppWindow className="w-3.5 h-3.5" strokeWidth={1.9} />,
            },
          ]
        : []),
      ...(settings.showWallpaperTab
        ? [
            {
              id: 'wallpaper' as TabId,
              label: 'Wallpaper',
              icon: <ImageIcon className="w-3.5 h-3.5" strokeWidth={1.9} />,
            },
          ]
        : []),
      ...(settings.showWeatherTab
        ? [
            {
              id: 'weather' as TabId,
              label: 'Weather',
              icon: <CloudSun className="w-3.5 h-3.5" strokeWidth={1.9} />,
            },
          ]
        : []),
      ...(settings.showTerminalTab
        ? [
            {
              id: 'terminal' as TabId,
              label: 'Developer',
              icon: <TerminalIcon className="w-3.5 h-3.5" strokeWidth={1.9} />,
            },
          ]
        : []),
      ...(settings.showNetworkTab
        ? [
            {
              id: 'network' as TabId,
              label: 'Connect',
              icon: <Wifi className="w-3.5 h-3.5" strokeWidth={1.9} />,
            },
          ]
        : []),
      {
        id: 'power' as TabId,
        label: 'Power',
        icon: <PowerIcon className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
      {
        id: 'settings' as TabId,
        label: 'Settings',
        icon: <SettingsIcon className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
    ],
    [
      settings.showNetworkTab,
      settings.showPerformanceTab,
      settings.showAppsTab,
      settings.showWallpaperTab,
      settings.showWeatherTab,
      settings.showTerminalTab,
    ],
  );

  // If active tab is disabled in Settings while active, return to Dashboard.
  // (Keep Apps tab mounted while appPickerMode is active so picker does not abruptly close)
  useEffect(() => {
    const isVisible = visibleTabs.some((t) => t.id === activeTab);
    if (!isVisible && activeTab !== 'dashboard') {
      if (activeTab === 'apps' && appPickerMode) {
        return;
      }
      setActiveTab('dashboard');
    }
  }, [visibleTabs, activeTab, appPickerMode]);

  const toastTimerRef = useRef<number | null>(null);
  const lastToastTimeRef = useRef<number>(0);
  const lastToastMsgRef = useRef<string>('');

  const handleToastNotification = useCallback((msg: string) => {
    const now = Date.now();
    if (msg === lastToastMsgRef.current && now - lastToastTimeRef.current < 3000) {
      return;
    }
    if (now - lastToastTimeRef.current < 900) {
      return;
    }
    lastToastTimeRef.current = now;
    lastToastMsgRef.current = msg;

    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4500);
  }, []);

  // Per-monitor background color sampling: captures whatever is actively rendered on the current monitor
  // (including Wallpaper Engine dynamic/video backgrounds or custom per-monitor wallpapers) with 0 idle drain.
  useEffect(() => {
    if (!panelOpen) return;
    if (settings.themeMode === 'adaptive' || settings.themeMode === 'auto') {
      void getDesktopMonitorThumbnail().then((thumb) => {
        if (thumb?.data_url) {
          void applyThemeFromImageSrc(thumb.data_url);
        }
      });
    }
  }, [panelOpen, settings.themeMode]);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  // Restore custom window dimensions if configured
  useEffect(() => {
    const scale = settings.appScale || 1.0;
    const w = Math.round(850 * scale);
    const h = Math.round(430 * scale);
    if (w !== 850 || h !== 430) {
      setWindowSize(w, h).catch(() => {});
    }
  }, [settings.appScale]);

  useEffect(() => {
    const onBridgeError = (event: Event) => {
      const detail = (event as CustomEvent<{ cmd?: string; message?: string }>).detail;
      const cmd = detail?.cmd || '';
      // Never spam user toast notifications for background polling operations
      if (
        cmd.startsWith('get_') ||
        cmd === 'tab_changed' ||
        cmd === 'set_resizing' ||
        cmd === 'set_dropdown_open'
      ) {
        return;
      }
      const action = cmd.replaceAll('_', ' ') || 'native action';
      const reason = detail?.message?.trim();
      handleToastNotification(`Canopy couldn't complete ${action}${reason ? `: ${reason}` : '.'}`);
    };
    window.addEventListener('canopy:bridge-error', onBridgeError);
    return () => window.removeEventListener('canopy:bridge-error', onBridgeError);
  }, [handleToastNotification]);

  // Handle native host notifications (e.g. reminders that fired when panel was closed)
  useEffect(() => {
    const onNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; title?: string }>).detail;
      if (detail?.message) {
        handleToastNotification(detail.message);
      }
    };
    window.addEventListener('canopy:notification', onNotification);
    return () => window.removeEventListener('canopy:notification', onNotification);
  }, [handleToastNotification]);

  // Sync topHoverTrigger setting to native host
  useEffect(() => {
    setTopHoverTrigger(settings.topHoverTrigger).catch(() => {});
  }, [settings.topHoverTrigger]);

  // 1s clock ticker — runs only while the panel is expanded and the document is visible.
  // Re-opening refetches immediately so the clock is never stale.
  useEffect(() => {
    if (!shellActive) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [shellActive]);

  // Listen for native host open/close events ('canopy:set-open', 'caelestia:set-open',
  // 'toggle-dropdown') plus the Escape and Ctrl/Alt/Meta-` hotkeys.
  useEffect(() => {
    const onSetOpen = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      let nextOpen: boolean | null = null;
      if (typeof detail === 'boolean') {
        nextOpen = detail;
      } else if (
        detail &&
        typeof detail === 'object' &&
        'open' in detail &&
        typeof detail.open === 'boolean'
      ) {
        nextOpen = detail.open;
      }
      if (nextOpen === null) {
        return;
      }
      if (nextOpen) {
        setActiveTab('dashboard');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The palette owns Escape while it is on screen.
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        void setDropdownOpen(false);
      } else if (e.key === '`' && (e.ctrlKey || e.altKey || e.metaKey)) {
        e.preventDefault();
        void setDropdownOpen(!panelOpen);
      }
    };
    window.addEventListener('canopy:set-open', onSetOpen);
    window.addEventListener('toggle-dropdown', onSetOpen);
    window.addEventListener('caelestia:set-open', onSetOpen);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('canopy:set-open', onSetOpen);
      window.removeEventListener('toggle-dropdown', onSetOpen);
      window.removeEventListener('caelestia:set-open', onSetOpen);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [paletteOpen, panelOpen]);

  // Apply dynamic theme palette whenever wallpapers or settings.themeMode change
  const syncThemeWithActiveWallpaper = useCallback(
    async (entries: WallpaperEntry[], mode = settings.themeMode) => {
      if (mode === 'canopy') {
        applyThemeModeFallback(
          'canopy',
          settings.glassOpacity,
          settings.glassBlurStrength,
          settings.customAccentColor,
          settings.trueOledMode,
        );
        return;
      }
      if (mode === 'dark' || (mode as string) === 'obsidian') {
        applyThemeModeFallback(
          'dark',
          settings.glassOpacity,
          settings.glassBlurStrength,
          settings.customAccentColor,
          settings.trueOledMode,
        );
        return;
      }
      if (mode === 'light' || (mode as string) === 'alabaster') {
        applyThemeModeFallback(
          'light',
          settings.glassOpacity,
          settings.glassBlurStrength,
          settings.customAccentColor,
          settings.trueOledMode,
        );
        return;
      }
      if (mode === 'auto') {
        applyThemeModeFallback(
          'auto',
          settings.glassOpacity,
          settings.glassBlurStrength,
          settings.customAccentColor,
          settings.trueOledMode,
        );
        return;
      }
      const activeEntry = entries.find((w) => w.active) || entries[0];
      if (activeEntry?.data_url) {
        await applyThemeFromImageSrc(
          activeEntry.data_url,
          mode,
          settings.customAccentColor,
          settings.trueOledMode,
        );
      } else {
        applyThemeModeFallback(
          'canopy',
          settings.glassOpacity,
          settings.glassBlurStrength,
          settings.customAccentColor,
          settings.trueOledMode,
        );
      }
    },
    [
      settings.themeMode,
      settings.glassOpacity,
      settings.glassBlurStrength,
      settings.customAccentColor,
      settings.trueOledMode,
    ],
  );
  useEffect(() => {
    syncThemeWithActiveWallpaper(wallpapers, settings.themeMode);
  }, [settings.themeMode, wallpapers, syncThemeWithActiveWallpaper]);
  useEffect(() => {
    if (settings.themeMode === 'auto') {
      return initializeSystemThemeWatcher(() => {
        void syncThemeWithActiveWallpaper(wallpapers, 'auto');
      });
    }
    return undefined;
  }, [settings.themeMode, wallpapers, syncThemeWithActiveWallpaper]);

  // Poll system stats every 1500ms — only while the panel is open and visible; a fresh poll
  // fires on re-open. Identical snapshots keep their previous identity so React skips the render.
  useEffect(() => {
    if (!shellActive) return;
    let active = true;
    const pollStats = async () => {
      try {
        const res = await getSystemStats();
        if (!active) return;
        setStats((prev) => (samePayload(prev, res) ? prev : res));
      } catch {
        // Keep current snapshot
      }
    };

    void pollStats();
    const id = window.setInterval(pollStats, 1500);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [shellActive]);

  // Lock window after user transport actions so background poll never overwrites optimistic toggle
  const mediaActionLockUntilRef = useRef<number>(0);

  const delayMs = (ms: number): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    window.setTimeout(resolve, ms);
    return promise;
  };

  // Poll media info every 800ms — only while the panel is open and visible; a fresh poll fires
  // on re-open. Identical snapshots keep their previous identity so React skips the render.
  useEffect(() => {
    if (!shellActive) return;
    let active = true;
    const pollMedia = async () => {
      if (Date.now() < mediaActionLockUntilRef.current) {
        return;
      }
      try {
        const info = await getMediaInfo();
        if (!active || Date.now() < mediaActionLockUntilRef.current) return;
        setMedia((prev) => (samePayload(prev, info) ? prev : info));
      } catch {
        // Keep current media state
      }
    };

    void pollMedia();
    const id = window.setInterval(pollMedia, 800);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [shellActive]);

  // One shared playhead for the whole panel: anchored on the host's reported position and advanced
  // locally between the 800 ms polls (see usePlaybackClock). The synced lyrics read the same clock.
  const mediaClock = usePlaybackClock(media, { enabled: shellActive });
  const scrubPosition = mediaClock.position;
  // Wallpaper lists arrive as fresh arrays on every fetch; keep the old identity when the
  // contents are unchanged so the shell (and the theme sync) does not re-render for nothing.
  const applyWallpapers = useCallback((next: WallpaperEntry[]) => {
    setWallpapers((prev) => (samePayload(prev, next) ? prev : next));
  }, []);

  const refreshWallpapersList = useCallback(async () => {
    try {
      const list = await getWallpapers();
      if (list && list.length > 0) {
        applyWallpapers(list);
      }
    } catch {
      // Ignore
    }
  }, [applyWallpapers]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [vol, bri, wpList] = await Promise.all([
          getMasterVolume(),
          getBrightness(),
          getWallpapers(),
        ]);
        if (!active) return;
        if (typeof vol === 'number' && !Number.isNaN(vol)) {
          setVolume(Math.round(vol));
        }
        if (typeof bri === 'number' && !Number.isNaN(bri)) {
          setBrightnessState(Math.round(bri));
        }
        if (wpList && wpList.length > 0) {
          applyWallpapers(wpList);
        }
      } catch {
        // Defaults remain active
      }
    })();
    return () => {
      active = false;
    };
  }, [applyWallpapers]);

  // Microphone state (host-backed) — fetched while the slider is enabled and re-read on re-open.
  useEffect(() => {
    if (!settings.showMicSlider || !shellActive) return;
    let active = true;
    (async () => {
      try {
        const state = await getMicState();
        if (!active) return;
        setMicVolume(Math.max(0, Math.min(100, Math.round(state.volume))));
        setMicMuted(Boolean(state.muted));
      } catch {
        // Keep current microphone snapshot
      }
    })();
    return () => {
      active = false;
    };
  }, [settings.showMicSlider, shellActive]);

  const handleMicLevelChange = useCallback(
    (level: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(level)));
      setMicVolume(clamped);
      if (clamped > 0 && micMuted) {
        setMicMuted(false);
        writeMicMute(false).catch(() => {});
      }
      writeMicVolume(clamped).catch(() => {});
    },
    [micMuted],
  );

  const handleMicMuteToggle = useCallback(() => {
    setMicMuted((prev) => {
      const next = !prev;
      writeMicMute(next).catch(() => {});
      return next;
    });
  }, []);

  // Host-pushed volume / microphone changes keep the sliders in sync without polling.
  useEffect(() => {
    const onVolumeChanged = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      if ('level' in detail && typeof detail.level === 'number' && !Number.isNaN(detail.level)) {
        setVolume(Math.max(0, Math.min(100, Math.round(detail.level))));
      }
      if ('muted' in detail && detail.muted === true) {
        setVolume(0);
      }
    };

    const onMicChanged = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      if ('level' in detail && typeof detail.level === 'number' && !Number.isNaN(detail.level)) {
        setMicVolume(Math.max(0, Math.min(100, Math.round(detail.level))));
      }
      if ('muted' in detail && typeof detail.muted === 'boolean') {
        setMicMuted(detail.muted);
      }
    };

    window.addEventListener('volume-changed', onVolumeChanged);
    window.addEventListener('mic-changed', onMicChanged);
    return () => {
      window.removeEventListener('volume-changed', onVolumeChanged);
      window.removeEventListener('mic-changed', onMicChanged);
    };
  }, []);

  // The host cannot always register the configured global hotkey (another app may own it).
  useEffect(() => {
    const onHotkeyFailed = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      const hotkey =
        detail &&
        typeof detail === 'object' &&
        'hotkey' in detail &&
        typeof detail.hotkey === 'string'
          ? detail.hotkey
          : 'the configured hotkey';
      handleToastNotification(`Hotkey ${hotkey} is taken by another app`);
    };
    window.addEventListener('hotkey-failed', onHotkeyFailed);
    return () => window.removeEventListener('hotkey-failed', onHotkeyFailed);
  }, [handleToastNotification]);

  // Synchronize top hover trigger when toggled from the notification tray context menu
  useEffect(() => {
    const onTopTriggerChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled === 'boolean') {
        updateSettings({ topHoverTrigger: detail.enabled });
      }
    };
    window.addEventListener('top-hover-trigger-changed', onTopTriggerChanged);
    return () => window.removeEventListener('top-hover-trigger-changed', onTopTriggerChanged);
  }, [updateSettings]);
  // Battery chip: refreshed on panel open and whenever the host reports a change.
  useEffect(() => {
    if (!settings.showBatteryChip || !panelOpen) return;
    let active = true;
    const onBatteryChanged = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (
        !detail ||
        typeof detail !== 'object' ||
        !('has_battery' in detail) ||
        typeof detail.has_battery !== 'boolean'
      ) {
        return;
      }
      const next: BatteryStatus = {
        has_battery: detail.has_battery,
        percent: 'percent' in detail && typeof detail.percent === 'number' ? detail.percent : 0,
        charging: 'charging' in detail && detail.charging === true,
      };
      setBattery((prev) => (samePayload(prev, next) ? prev : next));
    };

    (async () => {
      try {
        const status = await getBatteryStatus();
        if (!active) return;
        setBattery((prev) => (samePayload(prev, status) ? prev : status));
      } catch {
        // Keep current battery snapshot
      }
    })();

    window.addEventListener('battery-changed', onBatteryChanged);
    return () => {
      active = false;
      window.removeEventListener('battery-changed', onBatteryChanged);
    };
  }, [settings.showBatteryChip, panelOpen]);

  // Command palette: jump to any visible tab, open Settings, open the wallpaper folder, reload UI.
  const paletteCommands = useMemo<CommandPaletteItem[]>(() => {
    const tabCommands: CommandPaletteItem[] = visibleTabs.map((tab) => ({
      id: `tab:${tab.id}`,
      label: `Go to ${tab.label}`,
      hint: 'Tab',
      icon: tab.icon,
      run: () => {
        setActiveTab(tab.id);
        void notifyTabSwitched();
      },
    }));
    return [
      ...tabCommands,
      {
        id: 'subview:lyrics',
        label: 'View Synced Lyrics',
        hint: 'Media',
        icon: <Mic2 className="w-3.5 h-3.5" strokeWidth={1.9} />,
        run: () => {
          setMediaSubView('lyrics');
          setActiveTab('media');
          void notifyTabSwitched();
        },
      },
      {
        id: 'subview:mixer',
        label: 'Open Volume Mixer',
        hint: 'Media',
        icon: <Sliders className="w-3.5 h-3.5" strokeWidth={1.9} />,
        run: () => {
          setMediaSubView('mixer');
          setActiveTab('media');
          void notifyTabSwitched();
        },
      },
      {
        id: 'subview:cores',
        label: 'View Cores & System Details',
        hint: 'Performance',
        icon: <Cpu className="w-3.5 h-3.5" strokeWidth={1.9} />,
        run: () => {
          setPerformanceDetails(true);
          setActiveTab('performance');
          void notifyTabSwitched();
        },
      },
      {
        id: 'action:wallpaper-folder',
        label: 'Open Wallpaper Folder',
        hint: 'Wallpaper',
        icon: <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.9} />,
        run: () => {
          void pickWallpaperFolder()
            .then((dir) => {
              if (dir) {
                void refreshWallpapersList();
              }
            })
            .catch(() => {});
        },
      },
      {
        id: 'action:lock',
        label: 'Lock Workstation',
        hint: 'Power',
        icon: <Lock className="w-3.5 h-3.5" strokeWidth={1.9} />,
        run: () => {
          void executePowerAction('lock');
        },
      },
      {
        id: 'action:sleep',
        label: 'Sleep PC',
        hint: 'Power',
        icon: <Moon className="w-3.5 h-3.5" strokeWidth={1.9} />,
        run: () => {
          void executePowerAction('sleep');
        },
      },
      {
        id: 'action:reload-ui',
        label: 'Reload Canopy UI',
        hint: 'Action',
        icon: <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.9} />,
        run: () => {
          void reloadUi().catch(() => window.location.reload());
        },
      },
      ...installedApps.slice(0, 25).map((app) => ({
        id: `app:${app.id || app.name}`,
        label: `Launch ${app.name}`,
        hint: app.category || 'App',
        icon: <Play className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />,
        run: () => {
          void launchApp(app.path || app.name);
        },
      })),
    ];
  }, [visibleTabs, installedApps, refreshWallpapersList]);

  // Master Volume handler
  const handleVolumeChange = useCallback(async (newVol: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newVol)));
    setVolume(clamped);
    try {
      await setMasterVolume(clamped);
    } catch {
      try {
        await setAudioVolume(clamped);
      } catch {
        // Reflected in local state
      }
    }
  }, []);

  // Brightness handler
  const handleBrightnessChange = useCallback(async (newBri: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newBri)));
    setBrightnessState(clamped);
    try {
      await setBrightness(clamped);
    } catch {
      // Reflected in local state
    }
  }, []);

  // Typing a printable key while the panel is expanded summons the palette; collapsing the panel
  // dismisses it. Escape / Ctrl-` handling stays in the host-event listener above.
  useEffect(() => {
    if (!panelOpen) {
      setPaletteOpen(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="button"]',
        )
      ) {
        return;
      }
      e.preventDefault();
      setPaletteQuery(e.key);
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelOpen]);

  // Weather fetch (reactive to settings.temperatureUnit and settings.weatherLocationMode)
  const refreshWeather = useCallback(async () => {
    setWeatherLoading(true);
    try {
      const data = await fetchWeather({
        unit: settings.temperatureUnit,
        locationMode: settings.weatherLocationMode,
        manualLatitude: settings.manualLatitude,
        manualLongitude: settings.manualLongitude,
        manualCityName: settings.manualCityName,
      });
      setWeather(data);
    } catch {
      // Keep fallback weather
    } finally {
      setWeatherLoading(false);
    }
  }, [
    settings.temperatureUnit,
    settings.weatherLocationMode,
    settings.manualLatitude,
    settings.manualLongitude,
    settings.manualCityName,
  ]);

  useEffect(() => {
    refreshWeather();
    const id = window.setInterval(refreshWeather, 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refreshWeather]);

  // Media transport handlers
  const handlePlayPause = async () => {
    mediaActionLockUntilRef.current = Date.now() + 750;
    setMedia((prev) => ({ ...prev, is_playing: !prev.is_playing }));
    try {
      await mediaPlayPause();
      await delayMs(240);
      const updated = await getMediaInfo();
      if (updated) setMedia(updated);
    } catch {
      // Optimistic state kept
    }
  };

  const handleMediaControl = (action: 'play_pause' | 'prev' | 'next') => {
    if (action === 'play_pause') {
      void handlePlayPause();
    } else if (action === 'prev') {
      void handlePrev();
    } else if (action === 'next') {
      void handleNext();
    }
  };

  const handlePrev = async () => {
    mediaActionLockUntilRef.current = Date.now() + 750;
    mediaClock.seek(0);
    try {
      await mediaPrev();
      await delayMs(240);
      const updated = await getMediaInfo();
      if (updated) setMedia(updated);
    } catch {
      // Fallback
    }
  };

  const handleNext = async () => {
    mediaActionLockUntilRef.current = Date.now() + 750;
    mediaClock.seek(0);
    try {
      await mediaNext();
      await delayMs(240);
      const updated = await getMediaInfo();
      if (updated) setMedia(updated);
    } catch {
      // Fallback
    }
  };

  const handleSeek = async (seconds: number) => {
    mediaActionLockUntilRef.current = Date.now() + 600;
    mediaClock.seek(seconds);
    setMedia((prev) => ({ ...prev, position_secs: seconds }));
    try {
      await mediaSeek(seconds);
    } catch {
      // Ignore
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    try {
      await selectMediaSession(sessionId);
      const updated = await getMediaInfo();
      if (updated) setMedia(updated);
    } catch {
      // Ignore
    }
  };

  // Wallpaper apply + immediate dynamic palette extraction
  const handleApplyWallpaper = async (entry: WallpaperEntry, imgEl?: HTMLImageElement | null) => {
    setWallpapers((prev) =>
      prev.map((wp) => ({
        ...wp,
        active: wp.path === entry.path,
      })),
    );
    setWallpaperStatus(`Applying ${entry.name}...`);

    if (imgEl?.complete && imgEl.naturalWidth > 0) {
      applyThemePalette(
        imgEl,
        settings.themeMode,
        settings.customAccentColor,
        settings.trueOledMode,
      );
    } else if (entry.data_url) {
      await applyThemeFromImageSrc(
        entry.data_url,
        settings.themeMode,
        settings.customAccentColor,
        settings.trueOledMode,
      );
    }

    try {
      const ok = await setDesktopWallpaper(entry.path);
      if (!ok) {
        await applyWallpaper(entry.path);
      }
      setWallpaperStatus(`Applied "${entry.name}"`);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'The Windows wallpaper service returned an error.';
      setWallpaperStatus(`Couldn't apply "${entry.name}": ${reason}`);
    }
    window.setTimeout(() => setWallpaperStatus(''), 2500);
  };

  const effectiveDuration = media.duration_secs > 2 ? media.duration_secs : 219;
  const effectivePosition = Math.min(effectiveDuration, Math.max(0, scrubPosition));
  const tempUnit = settings.temperatureUnit === 'fahrenheit' ? '°F' : '°C';

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-transparent select-none flex flex-col items-center${
        settings.animationsEnabled ? '' : ' no-motion'
      }`}
    >
      {/* Top-Screen 2px Transparent Trigger Strip (only active when closed so it never intercepts or resets open tabs) */}
      {!panelOpen && settings.topHoverTrigger && !isWebViewHost() && (
        <div
          className="fixed top-0 left-0 right-0 h-[2px] z-50 bg-transparent pointer-events-auto cursor-pointer"
          onMouseEnter={() => {
            void setDropdownOpen(true);
          }}
          title="Hover top edge to summon Canopy"
        />
      )}

      {/* Dynamic Expanding Droplet Notification Banner */}
      <DropletNotification message={toastMessage} onDismiss={() => setToastMessage(null)} />

      {/* Main 850x430 Canopy Glassmorphism Dropdown Container */}
      {/* Main 850x430 Canopy Glassmorphism Dropdown Container — Always 100% visible inside window */}
      <div className="canopy-shell canopy-dropdown canopy-dropdown-open w-full h-full mt-0 rounded-t-none rounded-b-[24px] flex flex-col justify-between overflow-hidden">
        {/* Top Centered Navigation Bar */}
        <header
          className="w-full shrink-0 flex items-center justify-between px-2.5 py-1.5 select-none relative"
          style={{ borderBottom: '1px solid var(--theme-border)' }}
        >
          {/* Left Wing: Battery (Default) or Search Button */}
          <div className="shrink-0 flex items-center justify-start pointer-events-auto min-w-[32px]">
            {settings.batteryPosition === 'left' &&
            settings.showBatteryChip &&
            battery?.has_battery ? (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1 shadow-sm select-none"
                style={{
                  background: 'var(--theme-card)',
                  border: '1px solid var(--theme-border)',
                  color: battery.charging ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                }}
                title={
                  battery.charging
                    ? `Charging — ${Math.round(battery.percent)}%`
                    : `On battery — ${Math.round(battery.percent)}%`
                }
              >
                {battery.charging ? (
                  <BatteryCharging className="w-3 h-3 shrink-0" />
                ) : (
                  <Battery className="w-3 h-3 shrink-0" />
                )}
                <span>{Math.round(battery.percent)}%</span>
              </span>
            ) : settings.showHeaderSearch &&
              (settings.searchPosition ||
                (settings.batteryPosition === 'left' ? 'right' : 'left')) === 'left' ? (
              <button
                type="button"
                onClick={() => {
                  setPaletteQuery('');
                  setPaletteOpen(true);
                }}
                className="p-1.5 rounded-full text-xs transition-all duration-150 cursor-pointer flex items-center justify-center opacity-75 hover:opacity-100 shadow-sm"
                style={{
                  background: 'var(--theme-card)',
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-accent)',
                }}
                title="Quick Search / Command Palette (` or Ctrl+P)"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>

          {/* Center: Tabs sized much bigger, dividing the whole remaining width equally */}
          <nav
            className="flex-1 min-w-0 mx-2 flex items-center p-1 rounded-full pointer-events-auto h-9"
            style={{
              background: 'var(--theme-card)',
              border: '1px solid var(--theme-border)',
            }}
          >
            {visibleTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    void notifyTabSwitched();
                  }}
                  className={`relative flex-1 min-w-0 h-[29px] flex items-center justify-center gap-1 px-1 rounded-full tracking-tight transition-all duration-200 pointer-events-auto cursor-pointer ${
                    active ? 'font-semibold shadow-sm' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    color: active ? 'var(--theme-text-primary)' : 'var(--theme-text-secondary)',
                    background: active ? 'var(--theme-track)' : 'transparent',
                    border: active ? '1px solid var(--theme-accent)' : '1px solid transparent',
                  }}
                >
                  <span
                    className="w-3.5 h-3.5 flex items-center justify-center shrink-0"
                    style={{
                      color: active ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                    }}
                  >
                    {tab.icon}
                  </span>
                  <span className="truncate text-[9.5px] font-semibold tracking-tighter leading-none">
                    {tab.label}
                  </span>
                  {active && (
                    <span
                      className="absolute -bottom-[2px] left-1/2 -translate-x-1/2 w-4 h-[2px] rounded-full"
                      style={{ backgroundColor: 'var(--theme-accent)' }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Wing: Battery status (if on right) or Search Button (if battery is on left) */}
          <div className="shrink-0 flex items-center justify-end pointer-events-auto min-w-[32px]">
            {settings.batteryPosition === 'right' &&
            settings.showBatteryChip &&
            battery?.has_battery ? (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1 shadow-sm select-none"
                style={{
                  background: 'var(--theme-card)',
                  border: '1px solid var(--theme-border)',
                  color: battery.charging ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                }}
                title={
                  battery.charging
                    ? `Charging — ${Math.round(battery.percent)}%`
                    : `On battery — ${Math.round(battery.percent)}%`
                }
              >
                {battery.charging ? (
                  <BatteryCharging className="w-3 h-3 shrink-0" />
                ) : (
                  <Battery className="w-3 h-3 shrink-0" />
                )}
                <span>{Math.round(battery.percent)}%</span>
              </span>
            ) : settings.showHeaderSearch &&
              (settings.searchPosition ||
                (settings.batteryPosition === 'left' ? 'right' : 'left')) === 'right' ? (
              <button
                type="button"
                onClick={() => {
                  setPaletteQuery('');
                  setPaletteOpen(true);
                }}
                className="p-1.5 rounded-full text-xs transition-all duration-150 cursor-pointer flex items-center justify-center opacity-75 hover:opacity-100 shadow-sm"
                style={{
                  background: 'var(--theme-card)',
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-accent)',
                }}
                title="Quick Search / Command Palette (` or Ctrl+P)"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>
        </header>

        {/* Main Content Viewport (386px height) with Fade & Slide Tab Transition */}
        <main
          key={activeTab}
          className="canopy-tab-transition flex-1 px-2.5 py-2.5 overflow-hidden"
        >
          {/* ================================================================================= */}
          {/* TAB 1: DASHBOARD (4-Zone Bento Grid — Zero Inline Toggles, Zero Slider Overlap)    */}
          {/* ================================================================================= */}
          {activeTab === 'dashboard' && (
            <DashboardView
              stats={stats}
              weather={weather}
              currentTime={now}
              battery={battery}
              caffeineActive={caffeineActive}
              setCaffeineActive={setCaffeineActive}
              dndActive={dndActive}
              setDndActive={setDndActive}
              volume={volume}
              onVolumeChange={handleVolumeChange}
              brightness={brightness}
              onBrightnessChange={handleBrightnessChange}
              micVolume={micVolume}
              onMicLevelChange={handleMicLevelChange}
              micMuted={micMuted}
              onMicMuteToggle={handleMicMuteToggle}
              media={media}
              resolvedArtwork={resolvedArtwork}
              isMusicPlaying={isMusicPlaying}
              spectrumBands={spectrumBands}
              effectivePosition={effectivePosition}
              effectiveDuration={effectiveDuration}
              onPlayPause={handlePlayPause}
              onPrev={handlePrev}
              onNext={handleNext}
              onSeek={handleSeek}
              onSelectSession={handleSelectSession}
              onMediaControl={handleMediaControl}
              onNavigateTab={(tab) => {
                setActiveTab(tab as TabId);
                void notifyTabSwitched();
              }}
              onToastNotification={handleToastNotification}
            />
          )}

          {/* ================================================================================= */}
          {/* TAB 2: MEDIA (Vinyl + Radial Visualizer | Transport or Lyrics | Mascot/GIF)       */}
          {/* ================================================================================= */}
          {activeTab === 'media' && (
            <ErrorBoundary fallbackTitle="Media Player">
              <MediaView
                media={{
                  ...media,
                  artwork_url: resolvedArtwork ?? media.artwork_url,
                  position_secs: effectivePosition,
                  duration_secs: effectiveDuration,
                }}
                onPlayPause={handlePlayPause}
                onPrev={handlePrev}
                onNext={handleNext}
                onSeek={handleSeek}
                onSelectSession={handleSelectSession}
                initialSubView={mediaSubView}
              />
            </ErrorBoundary>
          )}

          {/* ================================================================================= */}
          {/* TAB: CONNECT (Wi-Fi Networks, Bluetooth Devices, Hotspot, Power Saver, Casting)  */}
          {/* ================================================================================= */}
          {activeTab === 'network' && (
            <ErrorBoundary fallbackTitle="Connections Hub">
              <NetworkView stats={stats} onToastNotification={handleToastNotification} />
            </ErrorBoundary>
          )}

          {/* ================================================================================= */}
          {/* TAB 3: PERFORMANCE (3 Concentric Gauges + Network Traffic + Expandable Drawer)    */}
          {/* ================================================================================= */}
          {activeTab === 'performance' && (
            <PerformanceView stats={stats} initialDetailsOpen={performanceDetails} />
          )}

          {/* ================================================================================= */}
          {/* TAB 4 (OPTIONAL): APPS (Searchable Installed Windows Applications & Shortcuts)    */}
          {/* ================================================================================= */}
          {activeTab === 'apps' && (settings.showAppsTab || appPickerMode) && (
            <ErrorBoundary fallbackTitle="Apps View">
              <AppsView
                isPickerMode={appPickerMode}
                onPickApp={(app) => {
                  const current = settings.pinnedApps || [];
                  const currentCustom = settings.customApps || {};

                  if (current.includes(app.id)) {
                    handleToastNotification(`${app.name} is already in Quick Launch!`);
                    setAppPickerMode(false);
                    setActiveTab('settings');
                    return;
                  }

                  const { slots, replacedId } = placeInQuickLaunch(current, app.id);
                  if (replacedId) {
                    const replacedLabel = currentCustom[replacedId]?.label || replacedId;
                    handleToastNotification(`Added ${app.name} (replaced ${replacedLabel})!`);
                  } else {
                    handleToastNotification(`Added ${app.name} to Dashboard Quick Launch!`);
                  }

                  updateSettings({
                    pinnedApps: slots,
                    customApps: {
                      ...currentCustom,
                      [app.id]: { label: app.name, path: app.path },
                    },
                  });
                  setAppPickerMode(false);
                  setActiveTab('settings');
                }}
                onPinApp={(app) => {
                  const current = settings.pinnedApps || [];
                  const currentCustom = settings.customApps || {};

                  if (current.includes(app.id)) {
                    handleToastNotification(`${app.name} is already pinned!`);
                    return;
                  }

                  const { slots, replacedId } = placeInQuickLaunch(current, app.id);
                  if (replacedId) {
                    const replacedLabel = currentCustom[replacedId]?.label || replacedId;
                    handleToastNotification(`Pinned ${app.name} (replaced ${replacedLabel})!`);
                  } else {
                    handleToastNotification(`Pinned ${app.name} to Dashboard Quick Launch!`);
                  }

                  updateSettings({
                    pinnedApps: slots,
                    customApps: {
                      ...currentCustom,
                      [app.id]: { label: app.name, path: app.path },
                    },
                  });
                }}
                onCancelPicker={() => {
                  setAppPickerMode(false);
                  setActiveTab('settings');
                }}
                onAppLaunched={() => void setDropdownOpen(false)}
              />
            </ErrorBoundary>
          )}

          {/* ================================================================================= */}
          {/* TAB 5: WALLPAPER (Featured Active Wallpaper Showcase + Horizontal Carousel)       */}
          {/* ================================================================================= */}
          {activeTab === 'wallpaper' && (
            <WallpaperView
              wallpapers={wallpapers}
              onApplyWallpaper={handleApplyWallpaper}
              onRefreshWallpapers={refreshWallpapersList}
              onNavigateToSettings={() => setActiveTab('settings')}
              onDirectoryChanged={(_newDir, entries) => {
                if (entries && entries.length > 0) {
                  setWallpapers(entries);
                } else {
                  refreshWallpapersList();
                }
              }}
              statusText={wallpaperStatus}
            />
          )}

          {/* ================================================================================= */}
          {/* TAB 6: WEATHER (Balanced Left Cohesive Card + Right Hourly & Extended Outlook)    */}
          {/* ================================================================================= */}
          {activeTab === 'weather' && (
            <WeatherView
              weather={weather}
              tempUnit={tempUnit}
              weatherLoading={weatherLoading}
              onRefreshWeather={refreshWeather}
              locationMode={settings.weatherLocationMode}
            />
          )}

          {/* ================================================================================= */}
          {/* TAB 7: TERMINAL (Interactive Canopy PowerShell Console)                           */}
          {/* ================================================================================= */}
          {activeTab === 'terminal' && <TerminalView stats={stats} />}

          {/* ================================================================================= */}
          {/* TAB 8: POWER (Sleep, Restart, Shut Down, Lock, Sign Out, Hibernate)               */}
          {/* ================================================================================= */}
          {activeTab === 'power' && (
            <PowerView
              stats={stats}
              onActionTriggered={(act) => {
                if (act !== 'lock') {
                  void setDropdownOpen(false);
                }
              }}
            />
          )}

          {/* ================================================================================= */}
          {/* TAB 8: SETTINGS (Global Settings Engine & Bento Configuration Cards)              */}
          {/* ================================================================================= */}
          {activeTab === 'settings' && (
            <SettingsView
              onDirectoryChanged={(_newDir, entries) => {
                if (entries && entries.length > 0) {
                  setWallpapers(entries);
                } else {
                  refreshWallpapersList();
                }
              }}
              onThemeChanged={() => {
                syncThemeWithActiveWallpaper(wallpapers, settings.themeMode);
              }}
              onStartAddQuickLaunch={() => {
                setAppPickerMode(true);
                setActiveTab('apps');
              }}
            />
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
        onVolumeChange={handleVolumeChange}
        onBrightnessChange={handleBrightnessChange}
        initialQuery={paletteQuery}
      />
    </div>
  );
};

export const App: React.FC = () => (
  <SettingsProvider>
    <CanopyShellContent />
  </SettingsProvider>
);

export default App;
