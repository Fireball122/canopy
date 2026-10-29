import {
  AppWindow,
  Battery,
  BatteryCharging,
  BellOff,
  Calculator,
  Check,
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
  MapPin,
  Monitor,
  Music,
  Pause,
  Play,
  Plus,
  Scissors,
  SkipBack,
  SkipForward,
  Sliders,
  Terminal as TerminalIcon,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCard } from '../components/CalendarCard';
import { CanopyMascot } from '../components/CanopyMascot';
import { RadialGauge } from '../components/RadialGauge';
import { VerticalSliders } from '../components/VerticalSliders';
import { useSettings } from '../context/SettingsContext';
import {
  type BatteryStatus,
  isWebViewHost,
  launchApp,
  type MediaInfo,
  type SystemStats,
  toggleCaffeine,
  toggleDnd,
  triggerScreenSnip,
} from '../services/hostBridge';
import type { WeatherData } from '../services/weather';
import { renderWeatherIcon } from './WeatherView';

export interface DashboardViewProps {
  stats: SystemStats;
  weather: WeatherData;
  currentTime: Date;
  battery: BatteryStatus | null;
  caffeineActive: boolean;
  setCaffeineActive: React.Dispatch<React.SetStateAction<boolean>>;
  dndActive: boolean;
  setDndActive: React.Dispatch<React.SetStateAction<boolean>>;
  volume: number;
  onVolumeChange: (val: number) => void;
  brightness: number;
  onBrightnessChange: (val: number) => void;
  micVolume: number;
  onMicLevelChange: (val: number) => void;
  micMuted: boolean;
  onMicMuteToggle: () => void;
  media: MediaInfo;
  resolvedArtwork: string | null;
  isMusicPlaying: boolean;
  spectrumBands: number[];
  effectivePosition: number;
  effectiveDuration: number;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onSelectSession: (sessionId: string) => void;
  onMediaControl: (action: 'play_pause' | 'prev' | 'next') => void;
  onNavigateTab: (tabId: string) => void;
  onToastNotification?: (message: string) => void;
}

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

export const DashboardView: React.FC<DashboardViewProps> = ({
  stats,
  weather,
  currentTime,
  battery,
  caffeineActive,
  setCaffeineActive,
  dndActive,
  setDndActive,
  volume,
  onVolumeChange,
  brightness,
  onBrightnessChange,
  micVolume,
  onMicLevelChange,
  micMuted,
  onMicMuteToggle,
  media,
  resolvedArtwork,
  isMusicPlaying,
  spectrumBands,
  effectivePosition,
  effectiveDuration,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onSelectSession,
  onMediaControl,
  onNavigateTab,
  onToastNotification,
}) => {
  const { settings } = useSettings();
  const tempUnit = settings.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
  const use24Hour = settings.clockFormat === '24h';

  // Clock formatters
  const hours = currentTime.getHours();
  const minutes = currentTime.getMinutes();
  const seconds = currentTime.getSeconds();
  const amPm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = use24Hour ? hours : hours % 12 === 0 ? 12 : hours % 12;
  const formattedHours = String(displayHours).padStart(2, '0');
  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(seconds).padStart(2, '0');
  const dayName = currentTime.toLocaleDateString('en-US', { weekday: 'short' });
  const monthName = currentTime.toLocaleDateString('en-US', { month: 'short' });
  const dateNum = currentTime.getDate();

  const compactUptime = useMemo(() => {
    const raw = stats.uptime_formatted || '';
    const cleaned = raw
      .replace(/^up\s+/i, '')
      .replace(/\s*days?/gi, 'd')
      .replace(/\s*hours?/gi, 'h')
      .replace(/\s*minutes?/gi, 'm')
      .replace(/\s*mins?/gi, 'm')
      .replace(/,\s*/g, ' ')
      .trim();
    return cleaned || '0m';
  }, [stats.uptime_formatted]);

  // Track & Title fallback: in WebView2 host mode, display Idle when no media is playing
  const hasLiveTrack = useMemo(() => {
    return Boolean(
      media.title &&
        media.title.trim() !== '' &&
        (media.is_playing ||
          media.position_secs > 0 ||
          (media.sessions && media.sessions.length > 0)),
    );
  }, [media.title, media.is_playing, media.position_secs, media.sessions]);

  const isHost = isWebViewHost();
  const trackTitle = hasLiveTrack ? media.title : isHost ? 'No Media Playing' : 'Bad Apple!!';
  const trackArtist = hasLiveTrack
    ? media.artist || 'Unknown Artist'
    : isHost
      ? 'Idle'
      : 'Nomico • Touhou';

  // Vinyl circular scrubber geometry
  const vinylSize = 82;
  const vinylStroke = 3;
  const vinylRadius = (vinylSize - vinylStroke) / 2;
  const vinylCircumference = 2 * Math.PI * vinylRadius;

  // Interactive circular ring scrubbing (hold position visually while dragging, seek only on release)
  const [scrubPreviewSecs, setScrubPreviewSecs] = useState<number | null>(null);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const sessionDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sessionDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [sessionDropdownOpen]);

  const displayedPosition = scrubPreviewSecs ?? effectivePosition;
  const progressRatio =
    effectiveDuration > 0 ? Math.min(1, Math.max(0, displayedPosition / effectiveDuration)) : 0;
  const vinylDashoffset = vinylCircumference * (1 - progressRatio);

  const calcScrubSecs = useCallback(
    (e: React.PointerEvent<SVGSVGElement>): number => {
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;

      // Top (12 o'clock) corresponds to 0 radian in circular scrubber
      let angle = Math.atan2(dy, dx) + Math.PI / 2;
      if (angle < 0) angle += 2 * Math.PI;

      const frac = Math.max(0, Math.min(1, angle / (2 * Math.PI)));
      return Math.round(frac * (effectiveDuration || 300));
    },
    [effectiveDuration],
  );

  const handleRingPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const secs = calcScrubSecs(e);
      setScrubPreviewSecs(secs);
    },
    [calcScrubSecs],
  );

  const handleRingPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (scrubPreviewSecs !== null || e.buttons === 1) {
        const secs = calcScrubSecs(e);
        setScrubPreviewSecs(secs);
      }
    },
    [calcScrubSecs, scrubPreviewSecs],
  );

  const handleRingPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }
      const secs = scrubPreviewSecs ?? calcScrubSecs(e);
      setScrubPreviewSecs(null);
      onSeek(secs);
    },
    [calcScrubSecs, onSeek, scrubPreviewSecs],
  );

  return (
    <div className="w-full h-full flex items-stretch gap-2">
      {/* ZONE 1: LEFT COLUMN (165px) — Weather Card (Top) + Clock Card (Bottom) */}
      <div className="w-[165px] shrink-0 flex flex-col gap-2 h-full">
        {/* Weather Card (Top) */}
        <div
          role={settings.showWeatherTab ? 'button' : undefined}
          tabIndex={settings.showWeatherTab ? 0 : undefined}
          onClick={settings.showWeatherTab ? () => onNavigateTab('weather') : undefined}
          onKeyDown={
            settings.showWeatherTab
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigateTab('weather');
                  }
                }
              : undefined
          }
          className={`bento-card flex-1 p-3 flex flex-col justify-between text-left group relative overflow-hidden pointer-events-auto ${
            settings.showWeatherTab ? 'bento-card-interactive cursor-pointer' : 'cursor-default'
          }`}
          title={settings.showWeatherTab ? 'Click to open Weather station' : 'Weather station'}
        >
          <div className="flex items-start justify-between w-full">
            <div className="min-w-0">
              <span
                className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <MapPin className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--theme-accent)' }} />
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
                <CloudSun className="w-5 h-5" style={{ color: 'var(--theme-text-secondary)' }} />
              )}
            </div>
          </div>

          <div
            className="flex items-center justify-between pt-1.5 mt-auto text-[10px]"
            style={{ borderTop: '1px solid var(--theme-border)' }}
          >
            <span
              className="truncate font-medium capitalize"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {weather.isLive ? weather.condition : 'No station data'}
            </span>
            {weather.isLive && (
              <span
                className="tabular-nums font-mono text-[9px] shrink-0"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                {weather.low}°/{weather.high}°
              </span>
            )}
          </div>
        </div>

        {/* Clock Card (Bottom) */}
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
                    color: battery.charging ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
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
            className="flex items-center justify-between pt-1.5 gap-1 select-none"
            style={{ borderTop: '1px solid var(--theme-border)' }}
          >
            <span
              className="text-[11px] font-medium shrink-0 whitespace-nowrap"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              {dayName}, {monthName} {dateNum}
            </span>
            <span
              className="text-[9px] font-mono flex items-center gap-1 shrink-0 whitespace-nowrap tabular-nums"
              style={{ color: 'var(--theme-text-secondary)' }}
              title={`System Uptime: ${stats.uptime_formatted || compactUptime}`}
            >
              <Clock className="w-2.5 h-2.5 opacity-70 shrink-0" />
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
              onClick={async () => {
                try {
                  const res = await toggleDnd();
                  setDndActive(res.enabled);
                } catch {
                  setDndActive((prev) => !prev);
                }
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
              onClick={() => void triggerScreenSnip()}
              className="canopy-pill px-2 py-1 flex items-center gap-1 text-[10px] font-medium transition-all hover:scale-105 active:scale-95 cursor-pointer pointer-events-auto"
              style={{
                background: 'var(--theme-track)',
                color: 'var(--theme-text-secondary)',
                border: '1px solid var(--theme-border)',
              }}
              title="Screen Snipping Tool (Win+Shift+S)"
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
                    onClick={() => onNavigateTab('settings')}
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

        {/* Interactive Calendar with Reminders */}
        <CalendarCard className="flex-1 min-h-0" onToastNotification={onToastNotification} />
      </div>

      {/* ZONE 3: VERTICAL SLIDER DECK */}
      <div
        className={`${
          settings.enableBrightnessSlider ? 'w-[114px]' : 'w-[92px]'
        } shrink-0 h-full transition-[width] duration-200`}
      >
        <VerticalSliders
          volume={volume}
          onVolumeChange={onVolumeChange}
          brightness={brightness}
          onBrightnessChange={onBrightnessChange}
          showBrightness={settings.enableBrightnessSlider}
          showMic={settings.showMicSlider}
          micLevel={settings.showMicSlider ? micVolume : undefined}
          onMicLevelChange={settings.showMicSlider ? onMicLevelChange : undefined}
          micMuted={settings.showMicSlider ? micMuted : undefined}
          onMicMuteToggle={settings.showMicSlider ? onMicMuteToggle : undefined}
        />
      </div>

      {/* ZONE 4: RIGHT COLUMN — Vinyl Ring Media Player + Capi Mascot */}
      <div className="flex-1 min-w-[185px] h-full bento-card p-2.5 flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center justify-between shrink-0">
          <span
            className="text-[9px] font-mono uppercase tracking-widest flex items-center gap-1"
            style={{ color: 'var(--theme-accent)' }}
          >
            <Disc className={`w-3 h-3 ${isMusicPlaying ? 'animate-spin' : ''}`} />
            <span>{isMusicPlaying ? 'Playing' : 'Paused'}</span>
          </span>
          <div ref={sessionDropdownRef}>
            <button
              type="button"
              onClick={() => {
                if (media.sessions && media.sessions.length > 1) {
                  setSessionDropdownOpen((prev) => !prev);
                } else {
                  onNavigateTab('media');
                }
              }}
              title={
                media.sessions && media.sessions.length > 1
                  ? 'Click to switch active media source'
                  : 'Click to open Media Hub & Mixer'
              }
              className="text-[9px] font-mono truncate max-w-[110px] px-1.5 py-0.5 rounded border flex items-center gap-1 transition-all cursor-pointer hover:border-[var(--theme-accent)] select-none active:scale-95"
              style={{
                color: 'var(--theme-text-primary)',
                background: 'var(--theme-card, rgba(255, 255, 255, 0.05))',
                borderColor: sessionDropdownOpen
                  ? 'var(--theme-accent)'
                  : 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              <span className="truncate">{media.source_app || 'System Audio'}</span>
              <ChevronRight
                className={`w-2.5 h-2.5 shrink-0 opacity-70 transition-transform duration-200 ${sessionDropdownOpen ? 'rotate-90' : ''}`}
              />
            </button>

            {/* Floating Audio Source Dropdown Popover */}
            {sessionDropdownOpen && media.sessions && media.sessions.length > 0 && (
              <div
                className="absolute inset-x-1.5 top-7 z-40 max-h-[160px] p-1.5 rounded-xl border shadow-2xl backdrop-blur-2xl flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-150"
                style={{
                  background: 'var(--theme-bg, #11111b)',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.15))',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65)',
                }}
              >
                <div className="flex items-center justify-between px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)] border-b border-[var(--theme-border)]">
                  <span>Audio Sources</span>
                  <span className="tabular-nums">{media.sessions.length} active</span>
                </div>

                <div className="flex flex-col gap-0.5 max-h-[140px] overflow-y-auto canopy-scroll">
                  {media.sessions.map((sess) => {
                    const isCur = sess.is_current;
                    return (
                      <button
                        key={sess.id}
                        type="button"
                        onClick={() => {
                          setSessionDropdownOpen(false);
                          void onSelectSession(sess.id);
                        }}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-left transition-colors pointer-events-auto cursor-pointer hover:bg-white/10 group"
                        style={{
                          background: isCur ? 'var(--theme-track)' : 'transparent',
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-[10px] font-semibold truncate flex items-center gap-1"
                            style={{ color: 'var(--theme-text-primary)' }}
                          >
                            <span className="truncate">{sess.app_name || 'App'}</span>
                            {isCur && (
                              <Check className="w-2.5 h-2.5 text-[var(--theme-accent)] shrink-0" />
                            )}
                          </div>
                          <div
                            className="text-[9px] truncate text-[var(--theme-text-secondary)]"
                            title={sess.title || 'Idle'}
                          >
                            {sess.title || 'No track title'}
                          </div>
                        </div>
                        {sess.is_playing ? (
                          <Play className="w-2.5 h-2.5 text-[var(--theme-accent)] shrink-0 fill-current" />
                        ) : (
                          <Pause className="w-2.5 h-2.5 text-[var(--theme-text-secondary)] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSessionDropdownOpen(false);
                    onNavigateTab('media');
                  }}
                  className="w-full mt-0.5 pt-1 border-t border-[var(--theme-border)] px-2 py-1 rounded-md text-[9px] font-mono flex items-center justify-between text-[var(--theme-accent)] hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1">
                    <Sliders className="w-2.5 h-2.5" />
                    <span>Open Media Mixer</span>
                  </span>
                  <ChevronRight className="w-2.5 h-2.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Circular Vinyl Artwork with Interactive Circular Progress Ring */}
        <div className="relative flex items-center justify-center my-0.5">
          <div
            className="relative flex items-center justify-center select-none"
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

            {/* Click & Drag Scrubbing SVG Progress Ring */}
            <svg
              className="w-full h-full -rotate-90 pointer-events-auto cursor-pointer"
              viewBox={`0 0 ${vinylSize} ${vinylSize}`}
              onPointerDown={handleRingPointerDown}
              onPointerMove={handleRingPointerMove}
              onPointerUp={handleRingPointerUp}
              onPointerCancel={() => setScrubPreviewSecs(null)}
              style={{
                transition: scrubPreviewSecs !== null ? 'none' : undefined,
              }}
            >
              <title>Click or drag ring to seek anywhere in track</title>
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
                className="transition-all duration-300 ease-out"
              />
            </svg>

            <div
              role="button"
              tabIndex={0}
              onClick={() => onMediaControl('play_pause')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onMediaControl('play_pause');
                }
              }}
              onWheel={(e) => {
                e.stopPropagation();
                const delta = e.deltaY < 0 ? 5 : -5;
                const duration = effectiveDuration || 300;
                const newPos = Math.max(0, Math.min(duration, effectivePosition + delta));
                void onSeek(newPos);
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

        {/* Audio Spectrum Bar EQ */}
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
                  background: 'linear-gradient(180deg, var(--theme-accent), var(--theme-border))',
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
            onClick={onPrev}
            className="p-1.5 rounded-full transition-all active:scale-90 pointer-events-auto cursor-pointer"
            style={{ background: 'var(--theme-track)', color: 'var(--theme-text-primary)' }}
            title="Previous Track"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onPlayPause}
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
            onClick={onNext}
            className="p-1.5 rounded-full transition-all active:scale-90 pointer-events-auto cursor-pointer"
            style={{ background: 'var(--theme-track)', color: 'var(--theme-text-primary)' }}
            title="Next Track"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Mascot Slot */}
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
  );
};
