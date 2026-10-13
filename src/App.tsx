import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudSun,
  Wind,
  Droplets,
  Thermometer,
  Terminal as TerminalIcon,
  Clock,
  Activity,
  Music,
  LayoutGrid,
  Image as ImageIcon,
  Send,
  RefreshCw,
  Monitor,
  User,
  Disc,
  MapPin,
  Bell,
  Settings as SettingsIcon,
  AppWindow,
  Sparkles,
} from 'lucide-react';
import {
  SystemStats,
  MediaInfo,
  WallpaperEntry,
  getSystemStats,
  getMediaInfo,
  mediaPlayPause,
  mediaNext,
  mediaPrev,
  mediaSeek,
  getMasterVolume,
  setMasterVolume,
  getBrightness,
  setBrightness,
  setAudioVolume,
  getWallpapers,
  applyWallpaper,
  setDesktopWallpaper,
  selectMediaSession,
  runTerminalCommand,
  setDropdownOpen,
  setTopHoverTrigger,
} from './services/tauriBridge';
import { WeatherData, fetchWeather } from './services/weather';
import { BongoCat } from './components/BongoCat';
import { CalendarCard } from './components/CalendarCard';
import { VerticalSliders } from './components/VerticalSliders';
import { SettingsProvider, useSettings, TabId } from './context/SettingsContext';
import { applyThemePalette, applyThemeFromImageSrc, applyThemeModeFallback } from './services/palette';
import { WallpaperView } from './views/WallpaperView';
import { MediaView } from './views/MediaView';
import { PerformanceView } from './views/PerformanceView';
import { SettingsView } from './views/SettingsView';
import { AppsView } from './views/AppsView';

interface TerminalEntry {
  id: string;
  command: string;
  output: string;
  timestamp: string;
  isFastfetch?: boolean;
}

const WINDOWS_POWERSHELL_UPTIME_CMD =
  '(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime | Select-Object Days, Hours, Minutes, Seconds';

const DEFAULT_WEATHER: WeatherData = {
  temp: 15,
  condition: 'Clear',
  code: 0,
  feelsLike: 14,
  humidity: 42,
  windSpeed: 8,
  uvIndex: 4,
  high: 19,
  low: 9,
  locationName: 'San Francisco, CA',
  unit: 'celsius',
  unitSymbol: '°C',
  hourly: [
    { time: 'Now', temp: 15, condition: 'Clear', code: 0 },
    { time: '1 PM', temp: 17, condition: 'Clear', code: 0 },
    { time: '2 PM', temp: 18, condition: 'Mostly Clear', code: 1 },
    { time: '3 PM', temp: 18, condition: 'Partly Cloudy', code: 2 },
    { time: '4 PM', temp: 16, condition: 'Clear', code: 0 },
    { time: '5 PM', temp: 14, condition: 'Clear', code: 0 },
  ],
  daily: [
    { day: 'Today', tempMax: 19, tempMin: 9, condition: 'Clear', code: 0 },
    { day: 'Tue', tempMax: 18, tempMin: 8, condition: 'Mostly Clear', code: 1 },
    { day: 'Wed', tempMax: 16, tempMin: 7, condition: 'Partly Cloudy', code: 2 },
    { day: 'Thu', tempMax: 16, tempMin: 7, condition: 'Clear', code: 0 },
    { day: 'Fri', tempMax: 17, tempMin: 8, condition: 'Clear', code: 0 },
  ],
};

function renderWeatherIcon(code: number, condition: string, sizeClass = 'w-7 h-7'): React.ReactNode {
  const lower = condition.toLowerCase();
  if (code >= 95 || lower.includes('thunder')) {
    return <CloudLightning className={`${sizeClass} text-[#f9e2af] drop-shadow-[0_0_8px_rgba(249,226,175,0.45)]`} strokeWidth={1.75} />;
  }
  if ((code >= 71 && code <= 86) || lower.includes('snow')) {
    return <CloudSnow className={`${sizeClass} text-[#89dceb] drop-shadow-[0_0_8px_rgba(137,220,235,0.45)]`} strokeWidth={1.75} />;
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || lower.includes('rain') || lower.includes('drizzle')) {
    return <CloudRain className={`${sizeClass} text-[#89b4fa] drop-shadow-[0_0_8px_rgba(137,180,250,0.45)]`} strokeWidth={1.75} />;
  }
  if (code === 1 || code === 2 || lower.includes('partly') || lower.includes('mostly')) {
    return <CloudSun className={`${sizeClass} text-[#fab387] drop-shadow-[0_0_8px_rgba(250,179,135,0.4)]`} strokeWidth={1.75} />;
  }
  if (code === 3 || (code >= 45 && code <= 48) || lower.includes('cloud') || lower.includes('overcast') || lower.includes('fog')) {
    return <Cloud className={`${sizeClass} text-[#bac2de] drop-shadow-[0_0_8px_rgba(186,194,222,0.35)]`} strokeWidth={1.75} />;
  }
  return <Sun className={`${sizeClass} text-[#f9e2af] drop-shadow-[0_0_10px_rgba(249,226,175,0.55)]`} strokeWidth={1.75} />;
}

const CanopyShellContent: React.FC = () => {
  const { settings } = useSettings();

  const [isOpen, setIsOpen] = useState<boolean>(true);
  // Always initialize to 'dashboard' on startup and clear any legacy stored tab state
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Clock state
  const [now, setNow] = useState<Date>(() => new Date());

  // System stats state (polled every 1500ms)
  const [stats, setStats] = useState<SystemStats>({
    cpu_usage: 14,
    cpu_temp_c: 41,
    gpu_usage: 4,
    gpu_temp_c: 54,
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
    username: 'CEO',
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
      { id: 'Spotify.exe', app_name: 'Spotify', title: 'Bad Apple!!', artist: 'Nomico', is_playing: false, is_current: true },
      { id: 'Feishin.exe', app_name: 'Feishin', title: 'Night of Nights', artist: 'COOL&CREATE', is_playing: false, is_current: false },
      { id: 'chrome.exe', app_name: 'Chrome', title: 'Lofi Hip Hop Radio', artist: 'Lofi Girl', is_playing: false, is_current: false },
    ],
  });

  const [scrubPosition, setScrubPosition] = useState<number>(42);

  // Master Volume & Display Brightness state
  const [volume, setVolume] = useState<number>(68);
  const [brightness, setBrightnessState] = useState<number>(82);

  // Wallpapers state
  const [wallpapers, setWallpapers] = useState<WallpaperEntry[]>([]);
  const [wallpaperStatus, setWallpaperStatus] = useState<string>('');

  // Weather state
  const [weather, setWeather] = useState<WeatherData>(DEFAULT_WEATHER);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);

  // Terminal state
  const [terminalInput, setTerminalInput] = useState<string>('');
  const [terminalBusy, setTerminalBusy] = useState<boolean>(false);
  const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([
    {
      id: 'init-fastfetch',
      command: 'fastfetch',
      output: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isFastfetch: true,
    },
  ]);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  const visibleTabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutGrid className="w-3.5 h-3.5" strokeWidth={1.9} /> },
    { id: 'media', label: 'Media', icon: <Music className="w-3.5 h-3.5" strokeWidth={1.9} /> },
    { id: 'performance', label: 'Performance', icon: <Activity className="w-3.5 h-3.5" strokeWidth={1.9} /> },
    ...(settings.showAppsTab
      ? [{ id: 'apps' as TabId, label: 'Apps', icon: <AppWindow className="w-3.5 h-3.5" strokeWidth={1.9} /> }]
      : []),
    { id: 'wallpaper', label: 'Wallpaper', icon: <ImageIcon className="w-3.5 h-3.5" strokeWidth={1.9} /> },
    { id: 'weather', label: 'Weather', icon: <CloudSun className="w-3.5 h-3.5" strokeWidth={1.9} /> },
    { id: 'terminal', label: 'Terminal', icon: <TerminalIcon className="w-3.5 h-3.5" strokeWidth={1.9} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon className="w-3.5 h-3.5" strokeWidth={1.9} /> },
  ];

  // If the Apps tab is toggled off in Settings while active, return to Dashboard
  useEffect(() => {
    if (!settings.showAppsTab && activeTab === 'apps') {
      setActiveTab('dashboard');
    }
  }, [settings.showAppsTab, activeTab]);

  const handleToastNotification = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 5000);
  }, []);

  // Sync topHoverTrigger setting to native host
  useEffect(() => {
    setTopHoverTrigger(settings.topHoverTrigger).catch(() => {});
  }, [settings.topHoverTrigger]);

  // 1s clock ticker
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Track when the dropdown was last closed so brief mouse-out/mouse-in or duplicate open events
  // never reset the user's active tab while they are interacting with the shell.
  const lastClosedTimestampRef = useRef<number>(0);

  // Listen for native host events ('caelestia:set-open' / 'caelestia:toggle') and Escape key.
  useEffect(() => {
    const onSetOpen = (e: Event) => {
      const custom = e as CustomEvent<{ open?: boolean }>;
      const nextOpen =
        typeof custom.detail?.open === 'boolean'
          ? custom.detail.open
          : typeof custom.detail === 'boolean'
            ? custom.detail
            : null;
      if (nextOpen !== null) {
        setIsOpen((prevOpen) => {
          if (nextOpen && !prevOpen) {
            setActiveTab('dashboard');
          }
          return nextOpen;
        });
      }
    };

    const onToggle = () => {
      setIsOpen((prev) => {
        const next = !prev;
        if (next && !prev) {
          setActiveTab('dashboard');
        }
        return next;
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        lastClosedTimestampRef.current = Date.now();
        setIsOpen(false);
        setDropdownOpen(false).catch(() => {});
      } else if (e.key === '`' && (e.ctrlKey || e.altKey || e.metaKey)) {
        e.preventDefault();
        setIsOpen((prev) => {
          const next = !prev;
          if (next && !prev) {
            setActiveTab('dashboard');
          }
          return next;
        });
      }
    };
    window.addEventListener('caelestia:set-open', onSetOpen);
    window.addEventListener('caelestia:toggle', onToggle);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('caelestia:set-open', onSetOpen);
      window.removeEventListener('caelestia:toggle', onToggle);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Sync open/close state with native host
  useEffect(() => {
    setDropdownOpen(isOpen).catch(() => {});
  }, [isOpen]);

  // Apply dynamic theme palette whenever wallpapers or settings.themeMode change
  const syncThemeWithActiveWallpaper = useCallback(
    async (entries: WallpaperEntry[], mode = settings.themeMode) => {
      const activeEntry = entries.find((w) => w.active) || entries[0];
      if (activeEntry?.data_url) {
        await applyThemeFromImageSrc(activeEntry.data_url, mode);
      } else {
        applyThemeModeFallback(mode, settings.glassOpacity, settings.glassBlurStrength);
      }
    },
    [settings.themeMode, settings.glassOpacity, settings.glassBlurStrength],
  );

  useEffect(() => {
    syncThemeWithActiveWallpaper(wallpapers, settings.themeMode);
  }, [settings.themeMode, wallpapers, syncThemeWithActiveWallpaper]);

  // Poll system stats every 1500ms
  useEffect(() => {
    let active = true;
    const pollStats = async () => {
      try {
        const res = await getSystemStats();
        if (!active) return;
        setStats(res);
      } catch {
        // Keep current snapshot
      }
    };

    pollStats();
    const id = window.setInterval(pollStats, 1500);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // Lock window after user transport actions so background poll never overwrites optimistic toggle
  const mediaActionLockUntilRef = useRef<number>(0);

  const delayMs = (ms: number): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    window.setTimeout(resolve, ms);
    return promise;
  };

  // Poll media info every 800ms
  useEffect(() => {
    let active = true;
    const pollMedia = async () => {
      if (Date.now() < mediaActionLockUntilRef.current) {
        return;
      }
      try {
        const info = await getMediaInfo();
        if (!active || Date.now() < mediaActionLockUntilRef.current) return;
        setMedia(info);
        if (info.position_secs > 0) {
          setScrubPosition(info.position_secs);
        }
      } catch {
        // Keep current media state
      }
    };

    pollMedia();
    const id = window.setInterval(pollMedia, 800);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // Smooth local scrub progression strictly when music is playing
  useEffect(() => {
    if (!media.is_playing) return;
    const id = window.setInterval(() => {
      setScrubPosition((prev) => {
        const dur = media.duration_secs > 1 ? media.duration_secs : 219;
        return prev + 1 >= dur ? 0 : prev + 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [media.is_playing, media.duration_secs]);

  const refreshWallpapersList = useCallback(async () => {
    try {
      const list = await getWallpapers();
      if (list && list.length > 0) {
        setWallpapers(list);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [vol, bri, wpList] = await Promise.all([getMasterVolume(), getBrightness(), getWallpapers()]);
        if (!active) return;
        if (typeof vol === 'number' && !Number.isNaN(vol)) {
          setVolume(Math.round(vol));
        }
        if (typeof bri === 'number' && !Number.isNaN(bri)) {
          setBrightnessState(Math.round(bri));
        }
        if (wpList && wpList.length > 0) {
          setWallpapers(wpList);
        }
      } catch {
        // Defaults remain active
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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

  // Auto-scroll terminal output
  useEffect(() => {
    if (activeTab === 'terminal') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalHistory, activeTab]);

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

  const handlePrev = async () => {
    mediaActionLockUntilRef.current = Date.now() + 750;
    setScrubPosition(0);
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
    setScrubPosition(0);
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
    setScrubPosition(seconds);
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

  // Master Volume handler
  const handleVolumeChange = async (newVol: number) => {
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
  };

  // Brightness handler
  const handleBrightnessChange = async (newBri: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newBri)));
    setBrightnessState(clamped);
    try {
      await setBrightness(clamped);
    } catch {
      // Reflected in local state
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

    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
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
    } catch {
      setWallpaperStatus(`Active: "${entry.name}"`);
    }
    window.setTimeout(() => setWallpaperStatus(''), 2500);
  };

  // Terminal command execution
  const executeCommand = async (rawCmd: string) => {
    const cmd = rawCmd.trim();
    if (!cmd) return;

    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (cmd.toLowerCase() === 'clear' || cmd.toLowerCase() === 'cls') {
      setTerminalHistory([]);
      setTerminalInput('');
      return;
    }

    if (cmd.toLowerCase() === 'fastfetch' || cmd.toLowerCase() === 'neofetch') {
      setTerminalHistory((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          command: cmd,
          output: '',
          timestamp: ts,
          isFastfetch: true,
        },
      ]);
      setTerminalInput('');
      return;
    }

    const actualCommandToRun =
      cmd.toLowerCase() === 'uptime' ? WINDOWS_POWERSHELL_UPTIME_CMD : cmd;

    setTerminalBusy(true);
    setTerminalInput('');
    try {
      const output = await runTerminalCommand(actualCommandToRun);
      setTerminalHistory((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          command: cmd === 'uptime' ? `uptime (${WINDOWS_POWERSHELL_UPTIME_CMD})` : cmd,
          output: output || stats.uptime_formatted || 'Command completed with no output.',
          timestamp: ts,
        },
      ]);
    } catch (err) {
      setTerminalHistory((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          command: cmd,
          output: err instanceof Error ? err.message : 'Execution error',
          timestamp: ts,
        },
      ]);
    } finally {
      setTerminalBusy(false);
    }
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
  const isMusicPlaying = Boolean(media.is_playing);
  const hasLiveTrack = Boolean(
    media.title &&
      media.title.trim() !== '' &&
      media.title.toLowerCase() !== 'no media' &&
      media.title.toLowerCase() !== 'no active media',
  );
  const trackTitle = hasLiveTrack ? media.title : 'Bad Apple!!';
  const trackArtist = hasLiveTrack ? media.artist || 'Alstroemeria Records' : 'Nomico • Touhou';

  const effectiveDuration = media.duration_secs > 0 ? media.duration_secs : 219;
  const effectivePosition =
    media.position_secs > 0 ? Math.min(media.position_secs, effectiveDuration) : Math.min(scrubPosition, effectiveDuration);
  const progressFraction = Math.max(0, Math.min(1, effectivePosition / effectiveDuration));

  const vinylSize = 86;
  const vinylStroke = 3.5;
  const vinylRadius = (vinylSize - vinylStroke * 2) / 2;
  const vinylCircumference = 2 * Math.PI * vinylRadius;
  const vinylDashoffset = vinylCircumference - progressFraction * vinylCircumference;

  const compactUptime = stats.uptime_formatted
    .replace(/^up\s+/i, '')
    .replace(/hours?/i, 'h')
    .replace(/minutes?/i, 'm')
    .replace(/,\s*/g, ' ');

  const uvValue = typeof weather.uvIndex === 'number' ? weather.uvIndex : 4;
  const uvRiskLabel = uvValue >= 8 ? 'Very High' : uvValue >= 6 ? 'High' : uvValue >= 3 ? 'Moderate' : 'Low';

  return (
    <div className="relative w-[850px] h-[430px] overflow-hidden bg-transparent select-none flex flex-col items-center">
      {/* Top-Screen 2px Transparent Trigger Strip (only active when closed so it never intercepts or resets open tabs) */}
      {!isOpen && settings.topHoverTrigger && (
        <div
          data-tauri-drag-region="false"
          className="fixed top-0 left-0 right-0 h-[2px] z-50 bg-transparent pointer-events-auto cursor-pointer"
          onMouseEnter={() => {
            setIsOpen(true);
          }}
          title="Hover top edge to summon Canopy"
        />
      )}

      {/* Reminder Toast Notification Banner */}
      {toastMessage && (
        <div
          data-tauri-drag-region="false"
          className="fixed top-12 z-50 px-3.5 py-2 rounded-full bg-[#1e1e2e]/95 border border-[var(--theme-accent)] shadow-[0_10px_30px_rgba(0,0,0,0.65)] flex items-center gap-2 text-xs text-white pointer-events-auto"
        >
          <Bell className="w-3.5 h-3.5 text-[var(--theme-accent)] animate-bounce" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main 850x430 Canopy Glassmorphism Dropdown Container */}
      <div
        className={`canopy-shell caelestia-shell caelestia-dropdown mt-0 rounded-t-none rounded-b-[24px] flex flex-col justify-between overflow-hidden ${
          isOpen ? 'caelestia-dropdown-open' : 'caelestia-dropdown-closed'
        }`}
      >
        {/* Top Centered Navigation Bar */}
        <header
          className="h-[44px] px-3 flex items-center justify-center shrink-0"
          style={{ borderBottom: '1px solid var(--theme-border)' }}
        >
          <nav
            data-tauri-drag-region="false"
            className="flex items-center gap-1 p-1 rounded-full pointer-events-auto"
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
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-tight transition-all duration-200 pointer-events-auto cursor-pointer ${
                    active ? 'font-semibold shadow-sm' : 'opacity-75 hover:opacity-100'
                  }`}
                  style={{
                    color: active ? 'var(--theme-text-primary)' : 'var(--theme-text-secondary)',
                    background: active ? 'var(--theme-track)' : 'transparent',
                    border: active ? '1px solid var(--theme-accent)' : '1px solid transparent',
                  }}
                >
                  <span style={{ color: active ? 'var(--theme-accent)' : 'var(--theme-text-secondary)' }}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                  {active && (
                    <span
                      className="absolute -bottom-[3px] left-1/2 -translate-x-1/2 w-5 h-[2px] rounded-full"
                      style={{ backgroundColor: 'var(--theme-accent)' }}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </header>

        {/* Main Content Viewport (386px height) with Fade & Slide Tab Transition */}
        <main key={activeTab} className="canopy-tab-transition flex-1 px-2.5 py-2.5 overflow-hidden">
          {/* ================================================================================= */}
          {/* TAB 1: DASHBOARD (4-Zone Bento Grid — Zero Inline Toggles, Zero Slider Overlap)    */}
          {/* ================================================================================= */}
          {activeTab === 'dashboard' && (
            <div className="w-full h-full flex items-stretch gap-2">
              {/* ZONE 1: LEFT COLUMN (165px) — Weather Card (Top) + Clock Card (Bottom) */}
              <div className="w-[165px] shrink-0 flex flex-col gap-2 h-full">
                {/* Weather Card (Top — No inline °C/°F toggle) */}
                <div
                  data-tauri-drag-region="false"
                  onClick={() => setActiveTab('weather')}
                  className="bento-card bento-card-interactive flex-1 p-3 flex flex-col justify-between text-left group relative overflow-hidden pointer-events-auto cursor-pointer"
                  title="Click to open Weather station"
                >
                  <div className="flex items-start justify-between w-full">
                    <div className="min-w-0">
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1"
                        style={{ color: 'var(--theme-text-secondary)' }}
                      >
                        <MapPin className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--theme-accent)' }} />
                        <span className="truncate">{weather.locationName.split(',')[0]}</span>
                      </span>
                      <div className="mt-1.5 flex items-baseline gap-1">
                        <span
                          className="text-3xl font-bold tracking-tight tabular-nums leading-none"
                          style={{ color: 'var(--theme-text-primary)' }}
                        >
                          {weather.temp}
                          {tempUnit}
                        </span>
                      </div>
                    </div>

                    <div
                      className="p-1.5 rounded-xl group-hover:scale-105 transition-transform shrink-0"
                      style={{ background: 'var(--theme-track)', border: '1px solid var(--theme-border)' }}
                    >
                      {renderWeatherIcon(weather.code, weather.condition, 'w-5 h-5')}
                    </div>
                  </div>

                  <div className="mt-1">
                    <div
                      className="text-xs font-semibold tracking-tight truncate"
                      style={{ color: 'var(--theme-accent)' }}
                    >
                      {weather.condition}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <span
                        className="px-1.5 py-0.5 rounded-md text-[9px] font-mono tabular-nums"
                        style={{ background: 'var(--theme-track)', color: 'var(--theme-text-secondary)' }}
                      >
                        H:<strong className="text-[#fab387] ml-0.5">{weather.high}°</strong>
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded-md text-[9px] font-mono tabular-nums"
                        style={{ background: 'var(--theme-track)', color: 'var(--theme-text-secondary)' }}
                      >
                        L:<strong className="text-[#89b4fa] ml-0.5">{weather.low}°</strong>
                      </span>
                    </div>
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

                  {/* Digital Clock Stack */}
                  <div className="my-auto flex flex-col items-center justify-center">
                    <div className="flex items-baseline gap-1 font-mono font-bold tracking-tight tabular-nums">
                      <span className="text-3xl leading-none" style={{ color: 'var(--theme-text-primary)' }}>
                        {formattedHours}
                      </span>
                      <span className="text-2xl leading-none animate-pulse" style={{ color: 'var(--theme-accent)' }}>
                        :
                      </span>
                      <span className="text-3xl leading-none" style={{ color: 'var(--theme-text-primary)' }}>
                        {formattedMinutes}
                      </span>
                      {settings.showSeconds && (
                        <span className="text-xs font-semibold ml-0.5" style={{ color: 'var(--theme-accent)' }}>
                          :{formattedSeconds}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Day & Date Badge Underneath */}
                  <div className="flex items-center justify-between pt-1.5" style={{ borderTop: '1px solid var(--theme-border)' }}>
                    <span
                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-tight"
                      style={{
                        background: 'var(--theme-track)',
                        color: 'var(--theme-accent)',
                      }}
                    >
                      {formattedDayDate}
                    </span>
                    <span className="text-[9px] font-mono tabular-nums" style={{ color: 'var(--theme-text-secondary)' }}>
                      :{formattedSeconds}s
                    </span>
                  </div>
                </div>
              </div>

              {/* ZONE 2: CENTER COLUMN (340px) — System Status Bar (Top) + Interactive Calendar (Bottom) */}
              <div className="w-[340px] shrink-0 flex flex-col gap-2 h-full">
                {/* System Status Bar (Top) */}
                <div className="bento-card h-[44px] shrink-0 px-2.5 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'var(--theme-track)', border: '1px solid var(--theme-accent)' }}
                    >
                      <User className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent)' }} />
                    </div>
                    <span
                      className="canopy-pill px-2 py-1 text-[10px] font-medium flex items-center gap-1 shrink-0"
                      style={{ color: 'var(--theme-text-primary)' }}
                    >
                      <Monitor className="w-3 h-3" style={{ color: 'var(--theme-accent)' }} />
                      <span>Windows 11</span>
                    </span>
                    <span
                      className="canopy-pill px-2 py-1 text-[10px] font-mono truncate max-w-[105px]"
                      style={{ color: 'var(--theme-text-secondary)' }}
                      title={stats.hostname}
                    >
                      {stats.hostname}
                    </span>
                  </div>

                  <div
                    className="canopy-pill px-2 py-1 text-[9px] font-mono flex items-center gap-1 shrink-0"
                    style={{ color: 'var(--theme-accent)' }}
                    title={stats.uptime_formatted}
                  >
                    <Clock className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate max-w-[82px]">up {compactUptime}</span>
                  </div>
                </div>

                {/* Interactive Calendar with Reminders (Bottom) */}
                <CalendarCard className="flex-1 min-h-0" onToastNotification={handleToastNotification} />
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
                />
              </div>

              {/* ZONE 4: RIGHT COLUMN — Vinyl Ring Media Player + Music-Reactive Mascot */}
              <div className="flex-1 min-w-[180px] h-full bento-card p-2.5 flex flex-col justify-between relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span
                    className="text-[9px] font-mono uppercase tracking-widest flex items-center gap-1"
                    style={{ color: 'var(--theme-accent)' }}
                  >
                    <Disc className={`w-3 h-3 ${isMusicPlaying ? 'animate-spin' : ''}`} />
                    <span>{isMusicPlaying ? 'Playing' : 'Paused'}</span>
                  </span>
                  <span
                    className="text-[9px] font-mono truncate max-w-[90px]"
                    style={{ color: 'var(--theme-text-secondary)' }}
                  >
                    {media.source_app || 'System Audio'}
                  </span>
                </div>

                {/* Circular Vinyl Artwork with Circular Progress Ring */}
                <div className="relative flex items-center justify-center my-0.5">
                  <div className="relative flex items-center justify-center" style={{ width: vinylSize, height: vinylSize }}>
                    <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${vinylSize} ${vinylSize}`}>
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
                      data-tauri-drag-region="false"
                      onClick={handlePlayPause}
                      className={`absolute w-[68px] h-[68px] rounded-full overflow-hidden border border-white/15 shadow-lg flex items-center justify-center pointer-events-auto cursor-pointer ${
                        isMusicPlaying ? 'animate-vinyl-spin' : ''
                      }`}
                      style={{
                        background:
                          'radial-gradient(circle at center, #2a2438 0%, #181825 55%, #0d0d14 100%)',
                      }}
                      title="Click vinyl to Play / Pause"
                    >
                      {media.artwork_url ? (
                        <img src={media.artwork_url} alt={trackTitle} className="w-full h-full object-cover" />
                      ) : (
                        <>
                          <div className="absolute inset-2 rounded-full border border-white/[0.07] pointer-events-none" />
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center"
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
                    {isMusicPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
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

                {/* Music-Reactive Mascot Widget at Bottom (animates strictly when music is playing) */}
                <div
                  className="pt-1 flex items-center justify-center h-[62px]"
                  style={{ borderTop: '1px solid var(--theme-border)' }}
                >
                  <BongoCat isPlaying={isMusicPlaying} className="h-full" />
                </div>
              </div>
            </div>
          )}

          {/* ================================================================================= */}
          {/* TAB 2: MEDIA (Vinyl + Radial Visualizer | Transport or Lyrics | Mascot/GIF)       */}
          {/* ================================================================================= */}
          {activeTab === 'media' && (
            <MediaView
              media={{
                ...media,
                position_secs: effectivePosition,
                duration_secs: effectiveDuration,
              }}
              onPlayPause={handlePlayPause}
              onPrev={handlePrev}
              onNext={handleNext}
              onSeek={handleSeek}
              onSelectSession={handleSelectSession}
            />
          )}

          {/* ================================================================================= */}
          {/* TAB 3: PERFORMANCE (3 Concentric Gauges + Network Traffic + Expandable Drawer)    */}
          {/* ================================================================================= */}
          {activeTab === 'performance' && <PerformanceView stats={stats} />}

          {/* ================================================================================= */}
          {/* TAB 4 (OPTIONAL): APPS (Searchable Installed Windows Applications & Shortcuts)    */}
          {/* ================================================================================= */}
          {activeTab === 'apps' && settings.showAppsTab && (
            <AppsView onAppLaunched={() => setIsOpen(false)} />
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
            <div className="w-full h-full grid grid-cols-12 gap-2.5">
              {/* Left 5 Cols: Cohesive, Well-Proportioned Atmospheric Bento Card */}
              <div className="col-span-5 flex flex-col h-full">
                <div className="bento-card flex-1 p-3.5 flex flex-col justify-between relative overflow-hidden">
                  {/* Top Header: Location & Refresh */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span
                        className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-1"
                        style={{ color: 'var(--theme-accent)' }}
                      >
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{weather.locationName}</span>
                      </span>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span
                          className="text-4xl font-bold tracking-tight tabular-nums leading-none"
                          style={{ color: 'var(--theme-text-primary)' }}
                        >
                          {weather.temp}
                          {tempUnit}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{
                            background: 'var(--theme-track)',
                            color: 'var(--theme-accent)',
                            border: '1px solid var(--theme-border)',
                          }}
                        >
                          {weather.condition}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        data-tauri-drag-region="false"
                        onClick={refreshWeather}
                        className="p-1.5 rounded-xl transition-all pointer-events-auto cursor-pointer"
                        style={{
                          background: 'var(--theme-track)',
                          color: 'var(--theme-text-primary)',
                          border: '1px solid var(--theme-border)',
                        }}
                        title="Refresh Open-Meteo Telemetry"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${weatherLoading ? 'animate-spin' : ''}`} />
                      </button>
                      <div
                        className="p-2 rounded-2xl"
                        style={{ background: 'var(--theme-track)', border: '1px solid var(--theme-border)' }}
                      >
                        {renderWeatherIcon(weather.code, weather.condition, 'w-7 h-7')}
                      </div>
                    </div>
                  </div>

                  {/* Daily Range Progress Strip */}
                  <div
                    className="my-2 px-3 py-2 rounded-xl flex items-center justify-between gap-2.5"
                    style={{ background: 'var(--theme-track)', border: '1px solid var(--theme-border)' }}
                  >
                    <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--theme-text-secondary)' }}>
                      Low <strong className="text-[#89b4fa]">{weather.low}{tempUnit}</strong>
                    </span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--theme-border)' }}>
                      <div
                        className="h-full rounded-full w-3/4 mx-auto"
                        style={{ backgroundColor: 'var(--theme-accent)' }}
                      />
                    </div>
                    <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--theme-text-secondary)' }}>
                      High <strong className="text-[#fab387]">{weather.high}{tempUnit}</strong>
                    </span>
                  </div>

                  {/* 2x2 Atmospheric Telemetry Grid: Feels Like, Humidity, Wind Speed, UV Index */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="canopy-pill p-2.5 flex flex-col justify-between">
                      <span className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--theme-text-secondary)' }}>
                        <Thermometer className="w-3 h-3 text-[#fab387]" /> Feels Like
                      </span>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="text-base font-bold tabular-nums" style={{ color: 'var(--theme-text-primary)' }}>
                          {weather.feelsLike}
                          {tempUnit}
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: 'var(--theme-text-secondary)' }}>
                          {Math.abs(weather.feelsLike - weather.temp) <= 2 ? 'Similar' : 'Wind chill'}
                        </span>
                      </div>
                    </div>

                    <div className="canopy-pill p-2.5 flex flex-col justify-between">
                      <span className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--theme-text-secondary)' }}>
                        <Droplets className="w-3 h-3 text-[#89dceb]" /> Humidity
                      </span>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="text-base font-bold tabular-nums" style={{ color: 'var(--theme-text-primary)' }}>
                          {weather.humidity}%
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: 'var(--theme-text-secondary)' }}>
                          {weather.humidity < 35 ? 'Dry' : weather.humidity <= 65 ? 'Comfort' : 'Humid'}
                        </span>
                      </div>
                    </div>

                    <div className="canopy-pill p-2.5 flex flex-col justify-between">
                      <span className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--theme-text-secondary)' }}>
                        <Wind className="w-3 h-3 text-[#a6e3a1]" /> Wind Speed
                      </span>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="text-base font-bold tabular-nums" style={{ color: 'var(--theme-text-primary)' }}>
                          {weather.windSpeed} <span className="text-[10px] font-normal">mph</span>
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: 'var(--theme-text-secondary)' }}>
                          {weather.windSpeed < 12 ? 'Calm' : 'Breezy'}
                        </span>
                      </div>
                    </div>

                    <div className="canopy-pill p-2.5 flex flex-col justify-between">
                      <span className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--theme-text-secondary)' }}>
                        <Sparkles className="w-3 h-3 text-[#f9e2af]" /> UV Index
                      </span>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="text-base font-bold tabular-nums" style={{ color: 'var(--theme-text-primary)' }}>
                          {uvValue}
                        </span>
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                          style={{ background: 'var(--theme-track)', color: 'var(--theme-accent)' }}
                        >
                          {uvRiskLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cohesive Footer Summary Bar */}
                  <div
                    className="pt-2 mt-1 flex items-center justify-between text-[10px] font-mono"
                    style={{ borderTop: '1px solid var(--theme-border)', color: 'var(--theme-text-secondary)' }}
                  >
                    <span>
                      Source: {settings.weatherLocationMode === 'auto' ? 'Auto IP + Open-Meteo' : 'Manual Coords'}
                    </span>
                    <span style={{ color: 'var(--theme-accent)' }}>Unit: {tempUnit}</span>
                  </div>
                </div>
              </div>

              {/* Right 7 Cols: Hourly Forecast Cards + 5-Day Extended Outlook */}
              <div className="col-span-7 flex flex-col gap-2.5 h-full">
                <div className="bento-card p-3.5">
                  <span
                    className="text-[10px] font-mono uppercase tracking-widest block mb-2"
                    style={{ color: 'var(--theme-text-secondary)' }}
                  >
                    Hourly Forecast
                  </span>
                  <div className="grid grid-cols-6 gap-2">
                    {weather.hourly.slice(0, 6).map((item, idx) => (
                      <div key={idx} className="canopy-pill p-2 flex flex-col items-center justify-between gap-1.5">
                        <span className="text-[10px] font-mono" style={{ color: 'var(--theme-text-secondary)' }}>
                          {item.time}
                        </span>
                        {renderWeatherIcon(item.code, item.condition, 'w-5 h-5')}
                        <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--theme-text-primary)' }}>
                          {item.temp}°
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bento-card flex-1 p-3.5 flex flex-col justify-between overflow-hidden">
                  <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: 'var(--theme-text-secondary)' }}>
                    Extended Outlook
                  </span>
                  <div className="space-y-1.5 my-auto">
                    {weather.daily.slice(0, 5).map((day, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-3 py-1.5 rounded-xl"
                        style={{ background: 'var(--theme-track)', border: '1px solid var(--theme-border)' }}
                      >
                        <span className="w-16 text-xs font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
                          {day.day}
                        </span>
                        <div className="flex items-center gap-2 w-32">
                          {renderWeatherIcon(day.code, day.condition, 'w-4 h-4')}
                          <span className="text-[11px] truncate" style={{ color: 'var(--theme-text-secondary)' }}>
                            {day.condition}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 w-36">
                          <span className="text-[11px] font-mono tabular-nums w-8 text-right" style={{ color: 'var(--theme-text-secondary)' }}>
                            {day.tempMin}°
                          </span>
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--theme-border)' }}>
                            <div
                              className="h-full rounded-full w-4/5 mx-auto"
                              style={{ backgroundColor: 'var(--theme-accent)' }}
                            />
                          </div>
                          <span className="text-[11px] font-mono tabular-nums font-semibold w-8" style={{ color: 'var(--theme-text-primary)' }}>
                            {day.tempMax}°
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================================= */}
          {/* TAB 7: TERMINAL (Interactive Canopy PowerShell Console)                           */}
          {/* ================================================================================= */}
          {activeTab === 'terminal' && (
            <div className="w-full h-full bento-card p-3.5 flex flex-col justify-between font-mono overflow-hidden">
              <div
                className="flex items-center justify-between pb-2 shrink-0"
                style={{ borderBottom: '1px solid var(--theme-border)' }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#f38ba8]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#f9e2af]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#a6e3a1]" />
                  <span className="ml-2 text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
                    {stats.username || 'CEO'}@{stats.hostname}:~ (canopy-powershell)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {[
                    { label: 'fastfetch', cmd: 'fastfetch' },
                    { label: 'ipconfig', cmd: 'ipconfig' },
                    { label: 'tasklist', cmd: 'tasklist' },
                    { label: 'uptime', cmd: 'uptime' },
                    { label: 'clear', cmd: 'clear' },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => executeCommand(preset.cmd)}
                      className="px-2 py-0.5 rounded-md text-[10px] transition-all pointer-events-auto cursor-pointer"
                      style={{
                        background: 'var(--theme-track)',
                        border: '1px solid var(--theme-border)',
                        color: 'var(--theme-text-primary)',
                      }}
                      title={preset.label === 'uptime' ? WINDOWS_POWERSHELL_UPTIME_CMD : preset.cmd}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div
                data-tauri-drag-region="false"
                className="flex-1 overflow-y-auto py-2.5 pr-1 space-y-3 text-[11px] leading-relaxed select-text pointer-events-auto"
              >
                {terminalHistory.map((item) => (
                  <div key={item.id} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold" style={{ color: 'var(--theme-accent)' }}>
                        ❯
                      </span>
                      <span className="font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
                        {item.command}
                      </span>
                      <span className="text-[9px] ml-auto" style={{ color: 'var(--theme-text-secondary)' }}>
                        {item.timestamp}
                      </span>
                    </div>

                    {item.isFastfetch ? (
                      <div
                        className="grid grid-cols-12 gap-3 p-2.5 rounded-xl"
                        style={{ background: 'var(--theme-track)', border: '1px solid var(--theme-border)' }}
                      >
                        <pre
                          className="col-span-5 text-[10px] leading-[1.15] font-bold overflow-hidden"
                          style={{ color: 'var(--theme-accent)' }}
                        >
{`       /\\
      /  \\      canopy@win11
     / /\\ \\     ------------
    / /  \\ \\    🌿 Canopy Desktop Shell
   / /    \\ \\   🎨 Adaptive Wallpaper Theme
  / / /\\ \\ \\ \\  ⚡ Win32 + WebView2
 /_/ /  \\ \\_\\_\\`}
                        </pre>
                        <div className="col-span-7 text-[11px] space-y-0.5">
                          <div>
                            <span className="font-semibold" style={{ color: 'var(--theme-accent)' }}>
                              OS:
                            </span>{' '}
                            <span>{stats.os_name || 'Windows 11 Pro x86_64'}</span>
                          </div>
                          <div>
                            <span className="font-semibold" style={{ color: 'var(--theme-accent)' }}>
                              Host:
                            </span>{' '}
                            <span>{stats.hostname}</span>
                          </div>
                          <div>
                            <span className="font-semibold" style={{ color: 'var(--theme-accent)' }}>
                              Uptime:
                            </span>{' '}
                            <span>{stats.uptime_formatted}</span>
                          </div>
                          <div>
                            <span className="font-semibold" style={{ color: 'var(--theme-accent)' }}>
                              CPU / GPU:
                            </span>{' '}
                            <span>
                              {Math.round(stats.cpu_usage)}% ({Math.round(stats.cpu_temp_c)}°C) /{' '}
                              {Math.round(stats.gpu_usage)}% ({Math.round(stats.gpu_temp_c)}°C)
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold" style={{ color: 'var(--theme-accent)' }}>
                              Memory:
                            </span>{' '}
                            <span>
                              {stats.ram_used_gb.toFixed(1)} GiB / {stats.ram_total_gb.toFixed(1)} GiB (
                              {Math.round(stats.ram_usage)}%)
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <pre
                        className="p-2.5 rounded-xl whitespace-pre-wrap break-words font-mono text-[11px]"
                        style={{
                          background: 'var(--theme-track)',
                          border: '1px solid var(--theme-border)',
                          color: 'var(--theme-text-primary)',
                        }}
                      >
                        {item.output}
                      </pre>
                    )}
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  executeCommand(terminalInput);
                }}
                className="pt-2 flex items-center gap-2 shrink-0"
                style={{ borderTop: '1px solid var(--theme-border)' }}
              >
                <span className="font-bold text-sm" style={{ color: 'var(--theme-accent)' }}>
                  ❯
                </span>
                <input
                  type="text"
                  data-tauri-drag-region="false"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  disabled={terminalBusy}
                  placeholder="Run PowerShell command (e.g., fastfetch, uptime, ipconfig, tasklist)..."
                  className="flex-1 bg-transparent text-xs focus:outline-none font-mono pointer-events-auto"
                  style={{ color: 'var(--theme-text-primary)' }}
                />
                <button
                  type="submit"
                  data-tauri-drag-region="false"
                  disabled={terminalBusy || !terminalInput.trim()}
                  className="px-2.5 py-1 rounded-lg disabled:opacity-40 text-[10px] flex items-center gap-1 transition-all pointer-events-auto cursor-pointer"
                  style={{
                    background: 'var(--theme-accent)',
                    color: '#11111b',
                  }}
                >
                  <Send className="w-3 h-3" />
                  <span>{terminalBusy ? 'Running...' : 'Run'}</span>
                </button>
              </form>
            </div>
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
            />
          )}
        </main>
      </div>
    </div>
  );
};

export const App: React.FC = () => (
  <SettingsProvider>
    <CanopyShellContent />
  </SettingsProvider>
);

export default App;
