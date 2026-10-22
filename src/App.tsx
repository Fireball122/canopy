import {
  Activity,
  AppWindow,
  Battery,
  BatteryCharging,
  BellOff,
  Calculator,
  Calendar as CalendarIcon,
  ChevronRight,
  Clock,
  CloudSun,
  Code2,
  Coffee,
  Compass,
  Cpu,
  Disc,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  Lock,
  MapPin,
  Mic2,
  Monitor,
  Moon,
  Music,
  Pause,
  Play,
  Plus,
  Power as PowerIcon,
  RefreshCw,
  Scissors,
  Search,
  Settings as SettingsIcon,
  SkipBack,
  SkipForward,
  Sliders,
  Sun,
  Terminal as TerminalIcon,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCard } from './components/CalendarCard';
import { CanopyMascot } from './components/CanopyMascot';
import { DropletNotification } from './components/DropletNotification';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RadialGauge } from './components/RadialGauge';
import { VerticalSliders } from './components/VerticalSliders';
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
  setReminders,
  setTopHoverTrigger,
  setWindowSize,
  toggleCaffeine,
  toggleDnd,
  triggerScreenSnip,
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
import { WallpaperView } from './views/WallpaperView';

const QUICK_APP_CATALOGUE: Record<string, { label: string; icon: React.ReactNode; path: string }> =
  {
    terminal: { label: 'Terminal', icon: <TerminalIcon className="w-3 h-3" />, path: 'wt.exe' },
    explorer: { label: 'Files', icon: <FolderOpen className="w-3 h-3" />, path: 'explorer.exe' },
    taskmgr: { label: 'TaskMgr', icon: <Cpu className="w-3 h-3" />, path: 'taskmgr.exe' },
    browser: { label: 'Browser', icon: <Compass className="w-3 h-3" />, path: 'msedge.exe' },
    msedge: { label: 'Browser', icon: <Compass className="w-3 h-3" />, path: 'msedge.exe' },
    code: { label: 'VSCode', icon: <Code2 className="w-3 h-3" />, path: 'code' },
    notepad: { label: 'Notepad', icon: <FileText className="w-3 h-3" />, path: 'notepad.exe' },
    calc: { label: 'Calc', icon: <Calculator className="w-3 h-3" />, path: 'calc.exe' },
    spotify: { label: 'Spotify', icon: <Music className="w-3 h-3" />, path: 'spotify.exe' },
  };

import { AppsView } from './views/AppsView';
import { MediaView } from './views/MediaView';
import { PerformanceView } from './views/PerformanceView';
import { PowerView } from './views/PowerView';
import { SettingsView } from './views/SettingsView';
import { TerminalView } from './views/TerminalView';
import { renderWeatherIcon, WeatherView } from './views/WeatherView';

interface CommandPaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  run: () => void;
}

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

function filterPaletteCommands(
  commands: CommandPaletteItem[],
  query: string,
): CommandPaletteItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return commands;
  }
  return commands.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) || command.hint.toLowerCase().includes(needle),
  );
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

  useEffect(() => {
    if (!panelOpen) return;
    let active = true;
    const poll = async () => {
      try {
        const bands = await getAudioSpectrum();
        if (active && Array.isArray(bands) && bands.length > 0) {
          setSpectrumBands(bands);
        }
      } catch {}
    };
    void poll();
    const timer = window.setInterval(poll, 40);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [panelOpen]);

  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [paletteQuery, setPaletteQuery] = useState<string>('');
  const [paletteIndex, setPaletteIndex] = useState<number>(0);
  const [caffeineActive, setCaffeineActive] = useState<boolean>(false);
  const [dndActive, setDndActive] = useState<boolean>(settings.quietHoursEnabled);

  useEffect(() => {
    void getCaffeineStatus()
      .then((s) => setCaffeineActive(s.enabled))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setDndActive(settings.quietHoursEnabled);
  }, [settings.quietHoursEnabled]);

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
      { id: 'media', label: 'Media', icon: <Music className="w-3.5 h-3.5" strokeWidth={1.9} /> },
      {
        id: 'performance',
        label: 'Performance',
        icon: <Activity className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
      ...(settings.showAppsTab
        ? [
            {
              id: 'apps' as TabId,
              label: 'Apps',
              icon: <AppWindow className="w-3.5 h-3.5" strokeWidth={1.9} />,
            },
          ]
        : []),
      {
        id: 'wallpaper',
        label: 'Wallpaper',
        icon: <ImageIcon className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
      {
        id: 'weather',
        label: 'Weather',
        icon: <CloudSun className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
      ...(settings.showTerminalTab
        ? [
            {
              id: 'terminal' as TabId,
              label: 'Developer',
              icon: <TerminalIcon className="w-3.5 h-3.5" strokeWidth={1.9} />,
            },
          ]
        : []),
      {
        id: 'power' as TabId,
        label: 'Power',
        icon: <PowerIcon className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: <SettingsIcon className="w-3.5 h-3.5" strokeWidth={1.9} />,
      },
    ],
    [settings.showAppsTab, settings.showTerminalTab],
  );

  // If the Apps tab is toggled off in Settings while active, return to Dashboard.
  // The Quick Launch "Add App" picker also lives on the Apps tab, so keep it mounted while
  // appPickerMode is on — otherwise the picker closes the moment it opens for users with the
  // Apps tab hidden.
  useEffect(() => {
    if (!settings.showAppsTab && activeTab === 'apps' && !appPickerMode) {
      setActiveTab('dashboard');
    }
  }, [settings.showAppsTab, activeTab, appPickerMode]);
  // If the Terminal tab is toggled off in Settings while active, return to Dashboard
  useEffect(() => {
    if (!settings.showTerminalTab && activeTab === 'terminal') {
      setActiveTab('dashboard');
    }
  }, [settings.showTerminalTab, activeTab]);

  const toastTimerRef = useRef<number | null>(null);

  const handleToastNotification = useCallback((msg: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 7000);
  }, []);

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
        applyThemeModeFallback('canopy', settings.glassOpacity, settings.glassBlurStrength);
        return;
      }
      if (mode === 'dark' || (mode as string) === 'obsidian') {
        applyThemeModeFallback('dark', settings.glassOpacity, settings.glassBlurStrength);
        return;
      }
      if (mode === 'light' || (mode as string) === 'alabaster') {
        applyThemeModeFallback('light', settings.glassOpacity, settings.glassBlurStrength);
        return;
      }
      if (mode === 'auto') {
        // palette.ts resolves 'auto' against the OS preference, so light/dark lives in one place.
        applyThemeModeFallback('auto', settings.glassOpacity, settings.glassBlurStrength);
        return;
      }
      const activeEntry = entries.find((w) => w.active) || entries[0];
      if (activeEntry?.data_url) {
        await applyThemeFromImageSrc(activeEntry.data_url, mode);
      } else {
        applyThemeModeFallback('canopy', settings.glassOpacity, settings.glassBlurStrength);
      }
    },
    [settings.themeMode, settings.glassOpacity, settings.glassBlurStrength],
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
  const paletteMatches = useMemo(() => {
    const dynamicCommands: CommandPaletteItem[] = [];
    const trimmed = paletteQuery.trim();

    // 1. Math calculation (= 120 * 1.08)
    if (trimmed.startsWith('=')) {
      const expr = trimmed.slice(1).trim();
      if (expr.length > 0) {
        try {
          // Only permit safe math tokens
          if (/^[0-9+\-*/().\s%^]+$/.test(expr)) {
            // eslint-disable-next-line no-eval
            const result = Function(`'use strict'; return (${expr})`)();
            if (typeof result === 'number' && Number.isFinite(result)) {
              dynamicCommands.push({
                id: 'calc:result',
                label: `${expr} = ${result}`,
                hint: 'Copy Calculation',
                icon: <Calculator className="w-3.5 h-3.5 text-amber-400" />,
                run: () => {
                  void navigator.clipboard.writeText(String(result));
                },
              });
            }
          }
        } catch {
          // Invalid expression while typing
        }
      }
    }

    // 2. Volume command (vol 75, volume 50)
    const volMatch = trimmed.match(/^(?:vol|volume)\s+(\d{1,3})$/i);
    if (volMatch) {
      const targetVol = Math.max(0, Math.min(100, parseInt(volMatch[1], 10)));
      dynamicCommands.push({
        id: 'action:set-vol',
        label: `Set Volume to ${targetVol}%`,
        hint: 'Audio',
        icon: <Volume2 className="w-3.5 h-3.5 text-sky-400" />,
        run: () => {
          void handleVolumeChange(targetVol);
        },
      });
    }

    // 3. Brightness command (bri 80, brightness 60)
    const briMatch = trimmed.match(/^(?:bri|brightness)\s+(\d{1,3})$/i);
    if (briMatch) {
      const targetBri = Math.max(0, Math.min(100, parseInt(briMatch[1], 10)));
      dynamicCommands.push({
        id: 'action:set-bri',
        label: `Set Brightness to ${targetBri}%`,
        hint: 'Display',
        icon: <Sun className="w-3.5 h-3.5 text-yellow-400" />,
        run: () => {
          void handleBrightnessChange(targetBri);
        },
      });
    }

    // 4. Quick reminder (remind Take a stretch, reminder Check email)
    const remindMatch = trimmed.match(/^(?:remind|reminder)\s+(.+)$/i);
    if (remindMatch && remindMatch[1].trim().length > 0) {
      const reminderText = remindMatch[1].trim();
      dynamicCommands.push({
        id: 'action:add-reminder',
        label: `Add Reminder: "${reminderText}"`,
        hint: 'Calendar',
        icon: <CalendarIcon className="w-3.5 h-3.5 text-emerald-400" />,
        run: () => {
          const now = new Date();
          const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
          const hh = String(nextHour.getHours()).padStart(2, '0');
          const mm = String(nextHour.getMinutes()).padStart(2, '0');
          const yyyy = nextHour.getFullYear();
          const mon = String(nextHour.getMonth() + 1).padStart(2, '0');
          const dd = String(nextHour.getDate()).padStart(2, '0');
          const newReminder = {
            id: `rem_${Date.now()}`,
            text: reminderText,
            date: `${yyyy}-${mon}-${dd}`,
            time: `${hh}:${mm}`,
          };
          try {
            const raw = window.localStorage.getItem('shell_calendar_events');
            const existing = raw ? JSON.parse(raw) : [];
            const updated = Array.isArray(existing) ? [...existing, newReminder] : [newReminder];
            window.localStorage.setItem('shell_calendar_events', JSON.stringify(updated));
            window.dispatchEvent(new CustomEvent('calendar-events-updated', { detail: updated }));
            void setReminders(updated);
          } catch {
            // Ignore
          }
        },
      });
    }

    if (dynamicCommands.length > 0) {
      return dynamicCommands;
    }

    return filterPaletteCommands(paletteCommands, paletteQuery);
  }, [paletteCommands, paletteQuery, handleVolumeChange, handleBrightnessChange]);

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
      setPaletteIndex(0);
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
      applyThemePalette(imgEl, settings.themeMode);
    } else if (entry.data_url) {
      await applyThemeFromImageSrc(entry.data_url, settings.themeMode);
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

  // Clock formatting driven exclusively by Settings
  const use24Hour = settings.clockFormat === '24h';
  const rawHours = now.getHours();
  const displayHours = use24Hour ? rawHours : rawHours % 12 || 12;
  const formattedHours = String(displayHours).padStart(2, '0');
  const formattedMinutes = String(now.getMinutes()).padStart(2, '0');
  const formattedSeconds = String(now.getSeconds()).padStart(2, '0');
  const amPm = rawHours >= 12 ? 'PM' : 'AM';
  const weekdayShort = now.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNumber = now.getDate();
  const formattedDayDate = `${weekdayShort}, ${dayNumber}`;

  const tempUnit = settings.temperatureUnit === 'fahrenheit' ? '°F' : '°C';

  // Media display helpers (strictly music-reactive)
  const hasLiveTrack = Boolean(
    media.title &&
      media.title.trim() !== '' &&
      media.title.toLowerCase() !== 'no media' &&
      media.title.toLowerCase() !== 'no active media',
  );
  const trackTitle = hasLiveTrack ? media.title : 'Bad Apple!!';
  const trackArtist = hasLiveTrack ? media.artist || 'Alstroemeria Records' : 'Nomico • Touhou';

  const effectiveDuration = media.duration_secs > 2 ? media.duration_secs : 219;
  const effectivePosition = Math.min(effectiveDuration, Math.max(0, scrubPosition));
  const progressFraction = Math.max(0, Math.min(1, effectivePosition / effectiveDuration));

  const vinylSize = 76;
  const vinylStroke = 3.5;
  const vinylRadius = (vinylSize - vinylStroke * 2) / 2;
  const vinylCircumference = 2 * Math.PI * vinylRadius;
  const vinylDashoffset = vinylCircumference - progressFraction * vinylCircumference;

  const compactUptime = stats.uptime_formatted
    .replace(/^up\s+/i, '')
    .replace(/hours?/i, 'h')
    .replace(/minutes?/i, 'm')
    .replace(/,\s*/g, ' ');

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-transparent select-none flex flex-col items-center${
        settings.animationsEnabled ? '' : ' no-motion'
      }`}
    >
      {/* Top-Screen 2px Transparent Trigger Strip (only active when closed so it never intercepts or resets open tabs) */}
      {!panelOpen && settings.topHoverTrigger && !isWebViewHost() && (
        <div
          data-tauri-drag-region="false"
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
      <div
        data-tauri-drag-region="false"
        className="canopy-shell canopy-dropdown canopy-dropdown-open w-full h-full mt-0 rounded-t-none rounded-b-[24px] flex flex-col justify-between overflow-hidden"
      >
        {/* Top Centered Navigation Bar */}
        <header
          data-tauri-drag-region="false"
          className="w-full shrink-0 flex items-center justify-between px-3 py-1 select-none relative"
          style={{ borderBottom: '1px solid var(--theme-border)' }}
        >
          {/* Left Wing: Quick Search Icon Button (centered halfway between window start and tabs) */}
          <div className="flex-1 flex items-center justify-center pointer-events-auto">
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={() => {
                setPaletteQuery('');
                setPaletteIndex(0);
                setPaletteOpen(true);
              }}
              className="p-1 rounded-full text-xs transition-all duration-150 cursor-pointer flex items-center justify-center opacity-75 hover:opacity-100 shadow-sm"
              style={{
                background: 'var(--theme-card)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-accent)',
              }}
              title="Quick Search / Command Palette (` or Ctrl+P)"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Center: Tabs sized to fit comfortably without scrolling */}
          <nav
            data-tauri-drag-region="false"
            className="flex items-center gap-0.5 p-0.5 rounded-full pointer-events-auto flex-nowrap justify-center shrink-0"
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
                  data-tauri-drag-region="false"
                  onClick={() => {
                    setActiveTab(tab.id);
                    void notifyTabSwitched();
                  }}
                  className={`relative flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium tracking-tight transition-all duration-200 pointer-events-auto cursor-pointer shrink-0 ${
                    active ? 'font-semibold shadow-sm' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    color: active ? 'var(--theme-text-primary)' : 'var(--theme-text-secondary)',
                    background: active ? 'var(--theme-track)' : 'transparent',
                    border: active ? '1px solid var(--theme-accent)' : '1px solid transparent',
                  }}
                >
                  <span
                    style={{
                      color: active ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                    }}
                  >
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
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

          {/* Right Wing: Battery status centered halfway between the tabs and the window edge */}
          <div className="flex-1 flex items-center justify-center pointer-events-auto">
            {settings.showBatteryChip && battery?.has_battery && (
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
            )}
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
            <div className="w-full h-full flex items-stretch gap-2">
              {/* ZONE 1: LEFT COLUMN (165px) — Weather Card (Top) + Clock Card (Bottom) */}
              <div className="w-[165px] shrink-0 flex flex-col gap-2 h-full">
                {/* Weather Card (Top — No inline °C/°F toggle) */}
                <div
                  role="button"
                  tabIndex={0}
                  data-tauri-drag-region="false"
                  onClick={() => setActiveTab('weather')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveTab('weather');
                    }
                  }}
                  className="bento-card bento-card-interactive flex-1 p-3 flex flex-col justify-between text-left group relative overflow-hidden pointer-events-auto cursor-pointer"
                  title="Click to open Weather station"
                >
                  <div className="flex items-start justify-between w-full">
                    <div className="min-w-0">
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1"
                        style={{ color: 'var(--theme-text-secondary)' }}
                      >
                        <MapPin
                          className="w-2.5 h-2.5 shrink-0"
                          style={{ color: 'var(--theme-accent)' }}
                        />
                        <span className="truncate">
                          {weather.isLive ? weather.locationName.split(',')[0] : 'Weather offline'}
                        </span>
                      </span>
                      <div className="mt-1.5 flex items-baseline gap-1">
                        <span
                          className="text-2xl font-bold tracking-tight tabular-nums leading-none"
                          style={{ color: 'var(--theme-text-primary)' }}
                        >
                          {weather.isLive ? `${weather.temp}${tempUnit}` : 'Offline'}
                        </span>
                      </div>
                    </div>

                    <div
                      className="p-1.5 rounded-xl group-hover:scale-105 transition-transform shrink-0"
                      style={{
                        background: 'var(--theme-track)',
                        border: '1px solid var(--theme-border)',
                      }}
                    >
                      {weather.isLive ? (
                        renderWeatherIcon(weather.code, weather.condition, 'w-5 h-5')
                      ) : (
                        <CloudSun
                          className="w-5 h-5"
                          style={{ color: 'var(--theme-text-secondary)' }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="mt-1">
                    <div
                      className="text-xs font-semibold tracking-tight truncate"
                      style={{ color: 'var(--theme-accent)' }}
                    >
                      {weather.isLive ? weather.condition : 'Click to configure'}
                    </div>
                    {weather.isLive ? (
                      <div className="mt-1.5 flex items-center gap-1">
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[9px] font-mono tabular-nums"
                          style={{
                            background: 'var(--theme-track)',
                            color: 'var(--theme-text-secondary)',
                          }}
                        >
                          H:<strong className="text-[#fab387] ml-0.5">{weather.high}°</strong>
                        </span>
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[9px] font-mono tabular-nums"
                          style={{
                            background: 'var(--theme-track)',
                            color: 'var(--theme-text-secondary)',
                          }}
                        >
                          L:<strong className="text-[#89b4fa] ml-0.5">{weather.low}°</strong>
                        </span>
                      </div>
                    ) : (
                      <div className="mt-1.5 flex items-center gap-1">
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[9px] font-mono tabular-nums"
                          style={{
                            background: 'var(--theme-track)',
                            color: 'var(--theme-text-secondary)',
                          }}
                        >
                          Tap to connect
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Clock Card (Bottom — No inline 24H toggle) */}
                <div className="bento-card h-[164px] shrink-0 p-3 flex flex-col justify-between relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[9px] font-mono uppercase tracking-widest flex items-center gap-1"
                      style={{ color: 'var(--theme-text-secondary)' }}
                    >
                      <Clock className="w-2.5 h-2.5" style={{ color: 'var(--theme-accent)' }} />
                      <span>Time</span>
                    </span>
                    <div className="flex items-center gap-1">
                      {settings.showBatteryChip && battery?.has_battery && (
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[9px] font-mono flex items-center gap-1"
                          style={{
                            background: 'var(--theme-track)',
                            color: battery.charging
                              ? 'var(--theme-accent)'
                              : 'var(--theme-text-secondary)',
                          }}
                          title={
                            battery.charging
                              ? `Charging — ${Math.round(battery.percent)}%`
                              : `On battery — ${Math.round(battery.percent)}%`
                          }
                        >
                          {battery.charging ? (
                            <BatteryCharging className="w-2.5 h-2.5 shrink-0" />
                          ) : (
                            <Battery className="w-2.5 h-2.5 shrink-0" />
                          )}
                          <span>{Math.round(battery.percent)}%</span>
                        </span>
                      )}
                      {!use24Hour && (
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[9px] font-mono"
                          style={{
                            background: 'var(--theme-track)',
                            color: 'var(--theme-accent)',
                          }}
                        >
                          {amPm}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Digital Clock Stack */}
                  <div className="my-auto flex flex-col items-center justify-center">
                    <div className="flex items-baseline gap-1 font-mono font-bold tracking-tight tabular-nums">
                      <span
                        className="text-3xl leading-none"
                        style={{ color: 'var(--theme-text-primary)' }}
                      >
                        {formattedHours}
                      </span>
                      <span
                        className="text-2xl leading-none animate-pulse"
                        style={{ color: 'var(--theme-accent)' }}
                      >
                        :
                      </span>
                      <span
                        className="text-3xl leading-none"
                        style={{ color: 'var(--theme-text-primary)' }}
                      >
                        {formattedMinutes}
                      </span>
                      {settings.showSeconds && (
                        <span
                          className="text-xs font-semibold ml-0.5"
                          style={{ color: 'var(--theme-accent)' }}
                        >
                          :{formattedSeconds}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Day & Date Badge Underneath */}
                  <div
                    className="flex items-center justify-between pt-1.5"
                    style={{ borderTop: '1px solid var(--theme-border)' }}
                  >
                    <span
                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-tight"
                      style={{
                        background: 'var(--theme-track)',
                        color: 'var(--theme-accent)',
                      }}
                    >
                      {formattedDayDate}
                    </span>
                    <span
                      className="text-[9px] font-mono tabular-nums flex items-center gap-1"
                      style={{ color: 'var(--theme-text-secondary)' }}
                      title={`Uptime: ${stats.uptime_formatted}`}
                    >
                      <Clock className="w-2.5 h-2.5 opacity-70" />
                      <span>up {compactUptime}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* ZONE 2: CENTER COLUMN (340px) — System Status Bar (Top) + Interactive Calendar (Bottom) */}
              <div className="w-[340px] shrink-0 flex flex-col gap-2 h-full">
                {/* System Status Bar (Top) */}
                <div className="bento-card h-[44px] shrink-0 px-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        background: 'var(--theme-track)',
                        border: '1px solid var(--theme-accent)',
                      }}
                      title={`Host: ${stats.hostname || 'Windows'}`}
                    >
                      <Monitor className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent)' }} />
                    </div>
                    <span
                      className="text-xs font-semibold tracking-tight truncate"
                      style={{ color: 'var(--theme-text-primary)' }}
                      title={stats.hostname}
                    >
                      {stats.hostname || 'Windows 11'}
                    </span>
                  </div>

                  {/* Dashboard Quick Utility Actions (Awake, DND, Snip) */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={async () => {
                        const res = await toggleCaffeine();
                        setCaffeineActive(res.enabled);
                      }}
                      className="canopy-pill px-2 py-1 flex items-center gap-1 text-[10px] font-medium transition-all hover:scale-105 active:scale-95 cursor-pointer pointer-events-auto"
                      style={{
                        background: caffeineActive ? 'var(--theme-accent)' : 'var(--theme-track)',
                        color: caffeineActive
                          ? 'var(--theme-on-accent, #111913)'
                          : 'var(--theme-text-secondary)',
                        border: '1px solid var(--theme-border)',
                      }}
                      title={
                        caffeineActive
                          ? 'Caffeine active: system will not sleep'
                          : 'Caffeine: click to keep system awake'
                      }
                    >
                      <Coffee className="w-3 h-3" />
                      <span>Awake</span>
                    </button>

                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={async () => {
                        const next = !dndActive;
                        setDndActive(next);
                        updateSettings({ quietHoursEnabled: next });
                        void toggleDnd().catch(() => {});
                      }}
                      className="canopy-pill px-2 py-1 flex items-center gap-1 text-[10px] font-medium transition-all hover:scale-105 active:scale-95 cursor-pointer pointer-events-auto"
                      style={{
                        background: dndActive ? 'var(--theme-accent)' : 'var(--theme-track)',
                        color: dndActive
                          ? 'var(--theme-on-accent, #111913)'
                          : 'var(--theme-text-secondary)',
                        border: '1px solid var(--theme-border)',
                      }}
                      title={
                        dndActive
                          ? 'Do Not Disturb active: hover & notifications silenced'
                          : 'Do Not Disturb: click to silence hover and alerts'
                      }
                    >
                      <BellOff className="w-3 h-3" />
                      <span>DND</span>
                    </button>

                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => void triggerScreenSnip()}
                      className="canopy-pill px-2 py-1 flex items-center gap-1 text-[10px] font-medium transition-all hover:scale-105 active:scale-95 cursor-pointer pointer-events-auto"
                      style={{
                        background: 'var(--theme-track)',
                        color: 'var(--theme-text-secondary)',
                        border: '1px solid var(--theme-border)',
                      }}
                      title="Screen Snip: capture region and collapse Canopy"
                    >
                      <Scissors className="w-3 h-3" />
                      <span>Snip</span>
                    </button>
                  </div>
                </div>

                {/* Pinned Quick-Launch App Dock */}
                <div
                  className="bento-card h-[34px] shrink-0 px-2.5 flex items-center justify-between gap-1"
                  style={{
                    background: 'var(--theme-card)',
                    border: '1px solid var(--theme-border)',
                  }}
                >
                  <span
                    className="text-[9px] font-mono uppercase tracking-wider"
                    style={{ color: 'var(--theme-text-secondary)' }}
                  >
                    Quick Launch
                  </span>
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: 6 }).map((_, slotIdx) => {
                      const appId = (settings.pinnedApps || [
                        'terminal',
                        'explorer',
                        'taskmgr',
                        'msedge',
                        'code',
                      ])[slotIdx];
                      if (!appId || appId.trim().length === 0) {
                        return (
                          <button
                            key={`empty-${slotIdx}`}
                            type="button"
                            data-tauri-drag-region="false"
                            onClick={() => setActiveTab('settings')}
                            className="w-6 h-6 rounded-md border border-dashed border-white/20 flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/40 transition-all pointer-events-auto cursor-pointer"
                            title={`Slot ${slotIdx + 1} Empty — Click to configure in Settings`}
                          >
                            <Plus className="w-2.5 h-2.5" />
                          </button>
                        );
                      }
                      const custom = settings.customApps?.[appId];
                      const app = QUICK_APP_CATALOGUE[appId] || {
                        label: custom?.label || appId,
                        icon: custom?.icon_data_url ? (
                          <img
                            src={custom.icon_data_url}
                            alt={custom.label}
                            className="w-3.5 h-3.5 object-contain"
                          />
                        ) : (
                          <AppWindow className="w-3.5 h-3.5" />
                        ),
                        path: custom?.path || appId,
                      };
                      return (
                        <button
                          key={`${appId}-${slotIdx}`}
                          type="button"
                          data-tauri-drag-region="false"
                          onClick={() => void launchApp(app.path)}
                          className="w-6 h-6 rounded-md flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 pointer-events-auto cursor-pointer"
                          style={{
                            background: 'var(--theme-track)',
                            border: '1px solid var(--theme-border)',
                            color: 'var(--theme-text-primary)',
                          }}
                          title={`Launch ${app.label}`}
                        >
                          {app.icon}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Interactive Calendar with Reminders (Bottom) */}
                <CalendarCard
                  className="flex-1 min-h-0"
                  onToastNotification={handleToastNotification}
                />
              </div>

              {/* ZONE 3: VERTICAL SLIDER DECK (Self-contained Bento Card, respects enableBrightnessSlider) */}
              <div
                className={`${
                  settings.enableBrightnessSlider ? 'w-[114px]' : 'w-[92px]'
                } shrink-0 h-full transition-[width] duration-200`}
              >
                <VerticalSliders
                  volume={volume}
                  onVolumeChange={handleVolumeChange}
                  brightness={brightness}
                  onBrightnessChange={handleBrightnessChange}
                  showBrightness={settings.enableBrightnessSlider}
                  showMic={settings.showMicSlider}
                  micLevel={settings.showMicSlider ? micVolume : undefined}
                  onMicLevelChange={settings.showMicSlider ? handleMicLevelChange : undefined}
                  micMuted={settings.showMicSlider ? micMuted : undefined}
                  onMicMuteToggle={settings.showMicSlider ? handleMicMuteToggle : undefined}
                />
              </div>

              {/* ZONE 4: RIGHT COLUMN — Vinyl Ring Media Player + Small Music-Reactive Mascot */}
              <div className="flex-1 min-w-[185px] h-full bento-card p-2.5 flex flex-col justify-between relative overflow-hidden">
                <div className="flex items-center justify-between shrink-0">
                  <span
                    className="text-[9px] font-mono uppercase tracking-widest flex items-center gap-1"
                    style={{ color: 'var(--theme-accent)' }}
                  >
                    <Disc className={`w-3 h-3 ${isMusicPlaying ? 'animate-spin' : ''}`} />
                    <span>{isMusicPlaying ? 'Playing' : 'Paused'}</span>
                  </span>
                  {media.sessions && media.sessions.length > 1 ? (
                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => {
                        const sessions = media.sessions;
                        if (!sessions || sessions.length <= 1) return;
                        const currentIdx = sessions.findIndex((s) => s.is_current);
                        const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % sessions.length : 0;
                        void handleSelectSession(sessions[nextIdx].id);
                      }}
                      title="Click to cycle media source (Spotify, Chrome, etc.)"
                      className="text-[9px] font-mono truncate max-w-[100px] px-1.5 py-0.5 rounded border flex items-center gap-1 transition-colors cursor-pointer hover:border-[var(--theme-accent)]"
                      style={{
                        color: 'var(--theme-text-primary)',
                        background: 'var(--theme-card, rgba(255, 255, 255, 0.05))',
                        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                      }}
                    >
                      <span className="truncate">{media.source_app || 'Audio'}</span>
                      <ChevronRight className="w-2.5 h-2.5 shrink-0 opacity-70" />
                    </button>
                  ) : (
                    <span
                      className="text-[9px] font-mono truncate max-w-[90px]"
                      style={{ color: 'var(--theme-text-secondary)' }}
                    >
                      {media.source_app || 'System Audio'}
                    </span>
                  )}
                </div>

                {/* Circular Vinyl Artwork with Circular Progress Ring */}
                <div className="relative flex items-center justify-center my-0.5">
                  <div
                    className="relative flex items-center justify-center"
                    style={{ width: vinylSize, height: vinylSize }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none scale-125">
                      <RadialGauge
                        bands={spectrumBands}
                        active={isMusicPlaying || spectrumBands.some((b) => b > 0.02)}
                        size={110}
                        accentColor="var(--theme-accent)"
                        secondaryColor="#89dceb"
                      />
                    </div>
                    <svg
                      className="w-full h-full -rotate-90"
                      viewBox={`0 0 ${vinylSize} ${vinylSize}`}
                    >
                      <circle
                        cx={vinylSize / 2}
                        cy={vinylSize / 2}
                        r={vinylRadius}
                        strokeWidth={vinylStroke}
                        stroke="var(--theme-track)"
                        fill="transparent"
                      />
                      <circle
                        cx={vinylSize / 2}
                        cy={vinylSize / 2}
                        r={vinylRadius}
                        strokeWidth={vinylStroke}
                        stroke="var(--theme-accent)"
                        strokeDasharray={vinylCircumference}
                        strokeDashoffset={vinylDashoffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-500 ease-out"
                      />
                    </svg>

                    <div
                      role="button"
                      tabIndex={0}
                      data-tauri-drag-region="false"
                      onClick={() => handleMediaControl('play_pause')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleMediaControl('play_pause');
                        }
                      }}
                      onWheel={(e) => {
                        e.stopPropagation();
                        const delta = e.deltaY < 0 ? 5 : -5;
                        const duration = media.duration_secs || 300;
                        const newPos = Math.max(0, Math.min(duration, media.position_secs + delta));
                        void handleSeek(newPos);
                      }}
                      className={`absolute w-[56px] h-[56px] rounded-full overflow-hidden border border-white/15 shadow-lg flex items-center justify-center pointer-events-auto cursor-pointer ${
                        isMusicPlaying ? 'animate-vinyl-spin' : ''
                      }`}
                      style={{
                        background:
                          'radial-gradient(circle at center, #2a2438 0%, #181825 55%, #0d0d14 100%)',
                      }}
                      title="Click vinyl to Play / Pause • Scroll wheel to seek ±5s"
                    >
                      {resolvedArtwork ? (
                        <img
                          src={resolvedArtwork}
                          alt={trackTitle}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <>
                          <div className="absolute inset-2 rounded-full border border-white/[0.07] pointer-events-none" />
                          <div
                            className="w-4 h-4 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: 'var(--theme-accent)' }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-[#11111b]" />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Track Title & Artist */}
                <div className="text-center px-1 min-w-0">
                  <div
                    className="text-xs font-bold truncate leading-tight"
                    style={{ color: 'var(--theme-text-primary)' }}
                    title={trackTitle}
                  >
                    {trackTitle}
                  </div>
                  <div
                    className="text-[10px] truncate mt-0.5"
                    style={{ color: 'var(--theme-text-secondary)' }}
                    title={trackArtist}
                  >
                    {trackArtist}
                  </div>
                </div>
                {/* Dashboard Audio Visualizer Bar */}
                <div className="w-full h-3.5 flex items-end justify-center gap-0.5 px-2 my-0.5 overflow-hidden">
                  {Array.from({ length: 18 }, (_, i) => {
                    const rawAmp = spectrumBands[i * 2] || 0;
                    const amp = rawAmp > 0.005 ? Math.min(1, rawAmp * 2.5) : 0;
                    const heightPercent = Math.max(10, Math.min(100, Math.round(amp * 100)));
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm transition-all duration-75"
                        style={{
                          height: `${heightPercent}%`,
                          background:
                            'linear-gradient(180deg, var(--theme-accent), var(--theme-border))',
                          opacity: amp > 0.04 ? 0.95 : 0.25,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Playback Transport Controls */}
                <div className="flex items-center justify-center gap-2 my-0.5">
                  <button
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={handlePrev}
                    className="p-1.5 rounded-full transition-all active:scale-90 pointer-events-auto cursor-pointer"
                    style={{ background: 'var(--theme-track)', color: 'var(--theme-text-primary)' }}
                    title="Previous Track"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={handlePlayPause}
                    className="p-2 rounded-full transition-all active:scale-95 pointer-events-auto cursor-pointer shadow-md"
                    style={{
                      background: 'var(--theme-accent)',
                      color: '#11111b',
                    }}
                    title={isMusicPlaying ? 'Pause' : 'Play'}
                  >
                    {isMusicPlaying ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5 ml-0.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={handleNext}
                    className="p-1.5 rounded-full transition-all active:scale-90 pointer-events-auto cursor-pointer"
                    style={{ background: 'var(--theme-track)', color: 'var(--theme-text-primary)' }}
                    title="Next Track"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Mascot */}
                {settings.mascotMode !== 'none' && (
                  <div className="pt-0.5 pb-0.5 flex items-center justify-center h-[90px] shrink-0">
                    <CanopyMascot
                      isPlaying={isMusicPlaying}
                      showSleepZzz={false}
                      showAmbientGlow={false}
                      className="h-full max-h-[88px] w-auto drop-shadow-sm select-none"
                    />
                  </div>
                )}
              </div>
            </div>
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
              />
            </ErrorBoundary>
          )}

          {/* ================================================================================= */}
          {/* TAB 3: PERFORMANCE (3 Concentric Gauges + Network Traffic + Expandable Drawer)    */}
          {/* ================================================================================= */}
          {activeTab === 'performance' && <PerformanceView stats={stats} />}

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

      {/* Search / Command Palette Overlay (printable key opens, Esc closes, Enter runs) */}
      {paletteOpen && (
        <div
          data-tauri-drag-region="false"
          className="absolute inset-0 z-[70] flex items-start justify-center pt-12 px-4 bg-[#0b0b12]/55 backdrop-blur-[3px] pointer-events-auto"
          onMouseDown={() => setPaletteOpen(false)}
        >
          <div
            data-tauri-drag-region="false"
            className="w-[520px] rounded-2xl overflow-hidden pointer-events-auto"
            style={{
              background: 'var(--theme-bg)',
              border: '1px solid var(--theme-border)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ borderBottom: '1px solid var(--theme-border)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--theme-accent)' }} />
              <input
                autoFocus
                type="text"
                data-tauri-drag-region="false"
                value={paletteQuery}
                placeholder="Type a command…"
                onChange={(e) => {
                  setPaletteQuery(e.target.value);
                  setPaletteIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setPaletteOpen(false);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setPaletteIndex((prev) =>
                      paletteMatches.length === 0 ? 0 : (prev + 1) % paletteMatches.length,
                    );
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPaletteIndex((prev) =>
                      paletteMatches.length === 0
                        ? 0
                        : (prev - 1 + paletteMatches.length) % paletteMatches.length,
                    );
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const command = paletteMatches[paletteIndex];
                    if (command) {
                      setPaletteOpen(false);
                      command.run();
                    }
                  }
                }}
                className="flex-1 bg-transparent text-xs focus:outline-none pointer-events-auto"
                style={{ color: 'var(--theme-text-primary)' }}
              />
              <span
                className="px-1.5 py-0.5 rounded-md text-[9px] font-mono shrink-0"
                style={{ background: 'var(--theme-track)', color: 'var(--theme-text-secondary)' }}
              >
                Esc
              </span>
            </div>

            <div className="max-h-[230px] overflow-y-auto py-1">
              {paletteMatches.length === 0 ? (
                <div
                  className="px-3 py-3 text-[11px]"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  No matching commands
                </div>
              ) : (
                paletteMatches.map((command, index) => {
                  const highlighted = index === paletteIndex;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      data-tauri-drag-region="false"
                      onMouseEnter={() => setPaletteIndex(index)}
                      onClick={() => {
                        setPaletteOpen(false);
                        command.run();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors duration-150 pointer-events-auto cursor-pointer"
                      style={{
                        background: highlighted ? 'var(--theme-track)' : 'transparent',
                        color: 'var(--theme-text-primary)',
                      }}
                    >
                      <span
                        className="shrink-0"
                        style={{
                          color: highlighted
                            ? 'var(--theme-accent)'
                            : 'var(--theme-text-secondary)',
                        }}
                      >
                        {command.icon}
                      </span>
                      <span className="flex-1 truncate">{command.label}</span>
                      <span
                        className="text-[9px] font-mono shrink-0"
                        style={{ color: 'var(--theme-text-secondary)' }}
                      >
                        {command.hint}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const App: React.FC = () => (
  <SettingsProvider>
    <CanopyShellContent />
  </SettingsProvider>
);

export default App;
