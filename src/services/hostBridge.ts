import { invoke } from '@tauri-apps/api/core';

export interface ProcessEntry {
  name: string;
  pid: number;
  cpu_usage: number;
  memory_mb: number;
}

export interface SystemStats {
  cpu_usage: number;
  cpu_temp_c: number;
  gpu_usage: number | null;
  gpu_temp_c: number | null;
  core_usages: number[];
  top_processes: ProcessEntry[];
  net_down_kbps: number;
  net_up_kbps: number;
  ram_usage: number;
  ram_used_gb: number;
  ram_total_gb: number;
  disk_usage: number;
  disk_used_gb: number;
  disk_total_gb: number;
  uptime_formatted: string;
  hostname: string;
  os_name: string;
  username: string;
}

export interface MediaSessionItem {
  id: string;
  app_name: string;
  title: string;
  artist: string;
  is_playing: boolean;
  is_current: boolean;
}

export interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  is_playing: boolean;
  position_secs: number;
  duration_secs: number;
  artwork_url?: string | null;
  source_app?: string;
  sessions?: MediaSessionItem[];
  is_shuffle?: boolean | null;
  auto_repeat?: number; // 0 = none, 1 = track, 2 = list
}
export interface AudioState {
  volume: number;
  muted: boolean;
}

export interface WallpaperEntry {
  name: string;
  path: string;
  data_url?: string;
  resolution?: string;
  active: boolean;
}

export interface InstalledAppItem {
  id: string;
  name: string;
  category: string;
  path: string;
  description?: string;
  icon_data_url?: string | null;
}

interface CanopyNativeBridge {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    __CANOPY_BRIDGE__?: CanopyNativeBridge;
    __CAELESTIA_BRIDGE__?: CanopyNativeBridge;
    __TAURI_INTERNALS__?: unknown;
  }
}

// Live interactive fallback state when running in browser or before native host attaches
const sessionStartMs = Date.now() - (4 * 3600 + 27 * 60) * 1000;

let fallbackAudioState: AudioState = {
  volume: 68,
  muted: false,
};

let fallbackBrightness = 82;

interface FallbackTrackSpec {
  id: string;
  source_app: string;
  title: string;
  artist: string;
  album: string;
  position_secs: number;
  duration_secs: number;
  artwork_url: string;
}

const FALLBACK_TRACKS: FallbackTrackSpec[] = [
  {
    id: 'Spotify.exe',
    source_app: 'Spotify',
    title: 'Midnight City',
    artist: 'M83',
    album: "Hurry Up, We're Dreaming",
    position_secs: 84,
    duration_secs: 243,
    artwork_url:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
          <defs>
            <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#cba6f7"/>
              <stop offset="50%" stop-color="#89b4fa"/>
              <stop offset="100%" stop-color="#1e1e2e"/>
            </linearGradient>
          </defs>
          <rect width="200" height="200" rx="28" fill="url(#g1)"/>
          <circle cx="100" cy="100" r="54" fill="rgba(17,17,27,0.55)" stroke="#f5c2e7" stroke-width="3"/>
          <circle cx="100" cy="100" r="14" fill="#cba6f7"/>
        </svg>`,
      ),
  },
  {
    id: 'Feishin.exe',
    source_app: 'Feishin',
    title: 'Resonance',
    artist: 'HOME',
    album: 'Odyssey',
    position_secs: 62,
    duration_secs: 212,
    artwork_url:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
          <defs>
            <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#fab387"/>
              <stop offset="50%" stop-color="#f5c2e7"/>
              <stop offset="100%" stop-color="#313244"/>
            </linearGradient>
          </defs>
          <rect width="200" height="200" rx="28" fill="url(#g2)"/>
          <circle cx="100" cy="96" r="46" fill="#f9e2af" opacity="0.85"/>
          <rect x="30" y="122" width="140" height="48" rx="8" fill="#181825" opacity="0.75"/>
        </svg>`,
      ),
  },
  {
    id: 'chrome.exe',
    source_app: 'Chrome',
    title: 'After Dark',
    artist: 'Mr.Kitty',
    album: 'Time',
    position_secs: 118,
    duration_secs: 257,
    artwork_url:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
          <defs>
            <linearGradient id="g3" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#89dceb"/>
              <stop offset="55%" stop-color="#cba6f7"/>
              <stop offset="100%" stop-color="#11111b"/>
            </linearGradient>
          </defs>
          <rect width="200" height="200" rx="28" fill="url(#g3)"/>
          <polygon points="100,42 152,144 48,144" fill="rgba(17,17,27,0.65)" stroke="#89dceb" stroke-width="3"/>
        </svg>`,
      ),
  },
];

let fallbackTrackIndex = 0;
let fallbackIsPlaying = true;
let fallbackTrackStartMs = Date.now() - 84 * 1000;
let fallbackPausedElapsedSecs = 84;

function buildFallbackSessions(): MediaSessionItem[] {
  return FALLBACK_TRACKS.map((t, idx) => ({
    id: t.id,
    app_name: t.source_app,
    title: t.title,
    artist: t.artist,
    is_playing: idx === fallbackTrackIndex ? fallbackIsPlaying : false,
    is_current: idx === fallbackTrackIndex,
  }));
}

function makeSvgWallpaperDataUrl(c1: string, c2: string, accent: string, title: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
      <radialGradient id="glow" cx="70%" cy="30%" r="60%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="320" height="180" fill="url(#bg)"/>
    <rect width="320" height="180" fill="url(#glow)"/>
    <path d="M0 138 Q 95 98 185 132 T 320 116 L 320 180 L 0 180 Z" fill="rgba(17,17,27,0.28)"/>
    <circle cx="235" cy="54" r="24" fill="${accent}" opacity="0.65"/>
    <text x="16" y="164" fill="rgba(255,255,255,0.75)" font-family="Segoe UI, sans-serif" font-size="11" font-weight="600">${title}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

let fallbackWallpapers: WallpaperEntry[] = [
  {
    name: 'Catppuccin Nebula',
    path: 'C:\\Windows\\Web\\Wallpaper\\Windows\\img19.jpg',
    data_url: makeSvgWallpaperDataUrl('#1e1e2e', '#313244', '#cba6f7', 'Catppuccin Nebula'),
    active: true,
  },
  {
    name: 'Warm Sand Dune',
    path: 'C:\\Windows\\Web\\Wallpaper\\ThemeA\\img100.jpg',
    data_url: makeSvgWallpaperDataUrl('#f4efea', '#e6dcd2', '#b85c4b', 'Warm Sand Dune'),
    active: false,
  },
  {
    name: 'Cyberpunk Aurora',
    path: 'C:\\Windows\\Web\\Wallpaper\\ThemeA\\img101.jpg',
    data_url: makeSvgWallpaperDataUrl('#11111b', '#1e293b', '#89dceb', 'Cyberpunk Aurora'),
    active: false,
  },
  {
    name: 'Sakura Daylight',
    path: 'C:\\Windows\\Web\\Wallpaper\\ThemeA\\img102.jpg',
    data_url: makeSvgWallpaperDataUrl('#f7edf0', '#eadce2', '#d46a84', 'Sakura Daylight'),
    active: false,
  },
  {
    name: 'Sunset Synthwave',
    path: 'C:\\Windows\\Web\\Wallpaper\\ThemeA\\img103.jpg',
    data_url: makeSvgWallpaperDataUrl('#2a1829', '#1f1924', '#fab387', 'Sunset Synthwave'),
    active: false,
  },
  {
    name: 'Emerald Canopy',
    path: 'C:\\Windows\\Web\\Wallpaper\\ThemeA\\img104.jpg',
    data_url: makeSvgWallpaperDataUrl('#0f241d', '#181825', '#a6e3a1', 'Emerald Canopy'),
    active: false,
  },
];

async function invokeBridge<T>(
  cmd: string,
  args: Record<string, unknown> | undefined,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (typeof window !== 'undefined') {
    const bridge = window.__CANOPY_BRIDGE__ || window.__CAELESTIA_BRIDGE__;
    if (bridge?.invoke) {
      try {
        return await bridge.invoke<T>(cmd, args);
      } catch (error) {
        reportBridgeError(cmd, error);
        throw error;
      }
    }
    if (window.__TAURI_INTERNALS__) {
      try {
        return await invoke<T>(cmd, args);
      } catch (error) {
        reportBridgeError(cmd, error);
        throw error;
      }
    }
  }

  // Demo fallbacks are for standalone browser preview only. Native host failures must remain visible.
  return await fallback();
}

function reportBridgeError(cmd: string, error: unknown): void {
  if (typeof window === 'undefined') return;
  const message = error instanceof Error ? error.message : String(error);
  window.dispatchEvent(new CustomEvent('canopy:bridge-error', { detail: { cmd, message } }));
}

function formatFallbackUptime(): string {
  const elapsedSec = Math.max(60, Math.floor((Date.now() - sessionStartMs) / 1000));
  const days = Math.floor(elapsedSec / 86400);
  const hours = Math.floor((elapsedSec % 86400) / 3600);
  const minutes = Math.floor((elapsedSec % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function buildFallbackSystemStats(): SystemStats {
  const t = Date.now() / 1000;
  const cpuWave = 21 + Math.sin(t * 0.65) * 9 + Math.cos(t * 1.4) * 4;
  const cpu_usage = Math.round(Math.min(98, Math.max(4, cpuWave)) * 10) / 10;
  const cpu_temp_c = Math.round((41 + Math.sin(t * 0.35) * 1.8) * 10) / 10;

  const baseCores = [28, 19, 42, 15, 31, 22, 37, 12, 26, 18, 29, 16];
  const core_usages = baseCores.map((base, idx) => {
    const delta = Math.sin(t * (0.6 + idx * 0.07) + idx) * 7;
    return Math.round(Math.min(100, Math.max(2, base + delta)) * 10) / 10;
  });

  const top_processes: ProcessEntry[] = [
    {
      name: 'Code.exe',
      pid: 11684,
      cpu_usage: Math.round((6.8 + Math.sin(t * 0.8) * 1.2) * 10) / 10,
      memory_mb: 742.0,
    },
    {
      name: 'chrome.exe',
      pid: 7316,
      cpu_usage: Math.round((5.1 + Math.cos(t * 0.7) * 1.1) * 10) / 10,
      memory_mb: 628.9,
    },
    {
      name: 'dwm.exe',
      pid: 1420,
      cpu_usage: Math.round((4.2 + Math.sin(t * 0.5) * 0.6) * 10) / 10,
      memory_mb: 198.4,
    },
    {
      name: 'Spotify.exe',
      pid: 9240,
      cpu_usage: Math.round((3.4 + Math.cos(t * 0.9) * 0.7) * 10) / 10,
      memory_mb: 312.5,
    },
    {
      name: 'Canopy Shell.exe',
      pid: 4812,
      cpu_usage: Math.round((1.8 + Math.sin(t * 0.4) * 0.3) * 10) / 10,
      memory_mb: 64.2,
    },
  ];

  const ram_total_gb = 32.0;
  const ram_used_gb = Math.round((13.4 + Math.sin(t * 0.2) * 0.5) * 10) / 10;
  const ram_usage = Math.round((ram_used_gb / ram_total_gb) * 1000) / 10;

  const disk_total_gb = 1000.0;
  const disk_used_gb = 418.5;
  const disk_usage = 41.9;

  return {
    cpu_usage,
    cpu_temp_c,
    gpu_usage: null,
    gpu_temp_c: null,
    core_usages,
    top_processes,
    net_down_kbps: Math.round((245.6 + Math.abs(Math.sin(t * 0.7)) * 1180.0) * 10) / 10,
    net_up_kbps: Math.round((38.4 + Math.abs(Math.cos(t * 0.5)) * 185.0) * 10) / 10,
    ram_usage,
    ram_used_gb,
    ram_total_gb,
    disk_usage,
    disk_used_gb,
    disk_total_gb,
    uptime_formatted: formatFallbackUptime(),
    hostname: 'CANOPY-WIN11',
    os_name: 'Windows 11 Pro (24H2)',
    username: 'user',
  };
}

export async function getSystemStats(): Promise<SystemStats> {
  const fallback = buildFallbackSystemStats();
  const raw = await invokeBridge<Partial<SystemStats>>(
    'get_system_stats',
    undefined,
    () => fallback,
  );

  return {
    cpu_usage: typeof raw.cpu_usage === 'number' ? raw.cpu_usage : fallback.cpu_usage,
    cpu_temp_c:
      typeof raw.cpu_temp_c === 'number' && raw.cpu_temp_c > 0
        ? raw.cpu_temp_c
        : fallback.cpu_temp_c,
    gpu_usage:
      typeof raw.gpu_usage === 'number' && Number.isFinite(raw.gpu_usage) ? raw.gpu_usage : null,
    gpu_temp_c:
      typeof raw.gpu_temp_c === 'number' && Number.isFinite(raw.gpu_temp_c) ? raw.gpu_temp_c : null,
    core_usages:
      Array.isArray(raw.core_usages) && raw.core_usages.length > 0
        ? raw.core_usages
        : fallback.core_usages,
    top_processes:
      Array.isArray(raw.top_processes) && raw.top_processes.length > 0
        ? raw.top_processes
        : fallback.top_processes,
    net_down_kbps:
      typeof raw.net_down_kbps === 'number' && Number.isFinite(raw.net_down_kbps)
        ? raw.net_down_kbps
        : fallback.net_down_kbps,
    net_up_kbps:
      typeof raw.net_up_kbps === 'number' && Number.isFinite(raw.net_up_kbps)
        ? raw.net_up_kbps
        : fallback.net_up_kbps,
    ram_usage: typeof raw.ram_usage === 'number' ? raw.ram_usage : fallback.ram_usage,
    ram_used_gb: typeof raw.ram_used_gb === 'number' ? raw.ram_used_gb : fallback.ram_used_gb,
    ram_total_gb: typeof raw.ram_total_gb === 'number' ? raw.ram_total_gb : fallback.ram_total_gb,
    disk_usage: typeof raw.disk_usage === 'number' ? raw.disk_usage : fallback.disk_usage,
    disk_used_gb: typeof raw.disk_used_gb === 'number' ? raw.disk_used_gb : fallback.disk_used_gb,
    disk_total_gb:
      typeof raw.disk_total_gb === 'number' ? raw.disk_total_gb : fallback.disk_total_gb,
    uptime_formatted: raw.uptime_formatted || fallback.uptime_formatted,
    hostname: raw.hostname || fallback.hostname,
    os_name: raw.os_name || fallback.os_name,
    username: raw.username || fallback.username,
  };
}

export async function getMediaInfo(): Promise<MediaInfo> {
  const fallbackSessions = buildFallbackSessions();
  const activeFallbackTrack = FALLBACK_TRACKS[fallbackTrackIndex % FALLBACK_TRACKS.length];
  const fallbackDuration = activeFallbackTrack.duration_secs || 240;
  const fallbackElapsed = fallbackIsPlaying
    ? Math.floor((Date.now() - fallbackTrackStartMs) / 1000) % fallbackDuration
    : fallbackPausedElapsedSecs % fallbackDuration;

  const info = await invokeBridge<Partial<MediaInfo>>('get_media_info', undefined, () => ({
    title: activeFallbackTrack.title,
    artist: activeFallbackTrack.artist,
    album: activeFallbackTrack.album,
    position_secs: fallbackElapsed,
    duration_secs: fallbackDuration,
    is_playing: fallbackIsPlaying,
    artwork_url: activeFallbackTrack.artwork_url,
    source_app: activeFallbackTrack.source_app,
    sessions: fallbackSessions,
  }));

  const hasValidSessionList = Array.isArray(info.sessions) && info.sessions.length > 0;
  return {
    title: info.title || activeFallbackTrack.title,
    artist: info.artist || activeFallbackTrack.artist,
    album: info.album ?? activeFallbackTrack.album,
    is_playing: typeof info.is_playing === 'boolean' ? info.is_playing : fallbackIsPlaying,
    position_secs: typeof info.position_secs === 'number' ? info.position_secs : fallbackElapsed,
    duration_secs:
      typeof info.duration_secs === 'number' && info.duration_secs > 0
        ? info.duration_secs
        : fallbackDuration,
    artwork_url: info.artwork_url ?? activeFallbackTrack.artwork_url,
    source_app: info.source_app || activeFallbackTrack.source_app,
    sessions: hasValidSessionList ? info.sessions : fallbackSessions,
  };
}

export async function getMediaSessions(): Promise<MediaSessionItem[]> {
  const sessions = await invokeBridge<MediaSessionItem[]>('get_media_sessions', undefined, () =>
    buildFallbackSessions(),
  );
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return buildFallbackSessions();
  }
  return sessions;
}

export async function selectMediaSession(sessionId: string): Promise<void> {
  const idx = FALLBACK_TRACKS.findIndex(
    (t) =>
      t.id.toLowerCase() === sessionId.toLowerCase() ||
      t.source_app.toLowerCase() === sessionId.toLowerCase(),
  );
  if (idx >= 0) {
    fallbackTrackIndex = idx;
    fallbackIsPlaying = true;
    fallbackPausedElapsedSecs = 0;
    fallbackTrackStartMs = Date.now();
  }
  await invokeBridge<unknown>(
    'select_media_session',
    { sessionId, session_id: sessionId },
    () => undefined,
  );
}

export async function mediaPlayPause(): Promise<void> {
  await invokeBridge<unknown>('media_play_pause', undefined, () => {
    if (fallbackIsPlaying) {
      fallbackPausedElapsedSecs = Math.floor((Date.now() - fallbackTrackStartMs) / 1000);
      fallbackIsPlaying = false;
    } else {
      fallbackTrackStartMs = Date.now() - fallbackPausedElapsedSecs * 1000;
      fallbackIsPlaying = true;
    }
  });
}

export async function mediaNext(): Promise<void> {
  await invokeBridge<unknown>('media_next', undefined, () => {
    fallbackTrackIndex = (fallbackTrackIndex + 1) % FALLBACK_TRACKS.length;
    fallbackIsPlaying = true;
    fallbackPausedElapsedSecs = 0;
    fallbackTrackStartMs = Date.now();
  });
}

export async function mediaPrev(): Promise<void> {
  await invokeBridge<unknown>('media_prev', undefined, () => {
    fallbackTrackIndex = (fallbackTrackIndex - 1 + FALLBACK_TRACKS.length) % FALLBACK_TRACKS.length;
    fallbackIsPlaying = true;
    fallbackPausedElapsedSecs = 0;
    fallbackTrackStartMs = Date.now();
  });
}
export async function mediaSeek(seconds: number): Promise<void> {
  const clamped = Math.max(0, Math.round(seconds));
  fallbackPausedElapsedSecs = clamped;
  fallbackTrackStartMs = Date.now() - clamped * 1000;
  await invokeBridge<unknown>('media_seek', { seconds: clamped }, () => undefined);
}

export async function mediaToggleShuffle(): Promise<boolean | null> {
  return invokeBridge<boolean | null>('media_toggle_shuffle', undefined, () => null);
}

export async function mediaCycleRepeat(): Promise<number> {
  return invokeBridge<number>('media_cycle_repeat', undefined, () => 0);
}

export interface HostConfig {
  // Index signature keeps this assignable to the bridge's plain-object argument type.
  [key: string]: unknown;
  triggerWidth?: number;
  triggerHeight?: number;
  triggerDelayMs?: number;
  hideDebounceMs?: number;
  pauseInFullscreen?: boolean;
  pauseInPresentation?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  panelMonitorMode?: 'cursor' | 'primary';
  triggerMonitorScope?: 'all' | 'primary';
  animationsEnabled?: boolean;
  animationDurationMs?: number;
  suspendWhenClosed?: boolean;
  showPanelOnLaunch?: boolean;
  hotkey?: string;
  diagnosticLogging?: boolean;
}

export async function setHostConfig(config: HostConfig): Promise<void> {
  await invokeBridge<unknown>('set_host_config', config, () => undefined);
}

export async function getHostConfig(): Promise<HostConfig> {
  return invokeBridge<HostConfig>('get_host_config', undefined, () => ({}));
}

export interface AudioSessionEntry {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
  is_active: boolean;
}

export async function getAudioSessions(): Promise<AudioSessionEntry[]> {
  return invokeBridge<AudioSessionEntry[]>('get_audio_sessions', undefined, () => []);
}

export async function setAudioSessionVolume(id: string, level: number): Promise<void> {
  await invokeBridge<unknown>(
    'set_session_volume',
    { id, level: Math.round(level) },
    () => undefined,
  );
}

export async function setAudioSessionMute(id: string, muted: boolean): Promise<void> {
  await invokeBridge<unknown>('set_session_mute', { id, muted }, () => undefined);
}

export async function getMicState(): Promise<{ volume: number; muted: boolean }> {
  return invokeBridge<{ volume: number; muted: boolean }>('get_mic_state', undefined, () => ({
    volume: 0,
    muted: false,
  }));
}

export async function setMicVolume(level: number): Promise<void> {
  await invokeBridge<unknown>('set_mic_volume', { level: Math.round(level) }, () => undefined);
}

export async function setMicMute(muted: boolean): Promise<void> {
  await invokeBridge<unknown>('set_mic_mute', { muted }, () => undefined);
}

export interface BatteryStatus {
  has_battery: boolean;
  percent: number;
  charging: boolean;
}

export async function getBatteryStatus(): Promise<BatteryStatus> {
  return invokeBridge<BatteryStatus>('get_battery_status', undefined, () => ({
    has_battery: false,
    percent: 0,
    charging: false,
  }));
}

export interface MonitorWallpaperState {
  id: string;
  label: string;
  path: string;
}

export interface DesktopWallpaperState {
  per_monitor_supported: boolean;
  monitors: MonitorWallpaperState[];
  slideshow_enabled: boolean;
  slideshow_minutes: number;
  shuffle: boolean;
}

export async function getDesktopWallpaperState(): Promise<DesktopWallpaperState> {
  return invokeBridge<DesktopWallpaperState>('get_desktop_wallpaper_state', undefined, () => ({
    per_monitor_supported: false,
    monitors: [],
    slideshow_enabled: false,
    slideshow_minutes: 30,
    shuffle: false,
  }));
}

export async function setDesktopWallpaperState(config: {
  slideshow_enabled?: boolean;
  slideshow_minutes?: number;
  shuffle?: boolean;
}): Promise<void> {
  await invokeBridge<unknown>('set_desktop_wallpaper_state', config, () => undefined);
}

export async function setMonitorWallpaper(monitorId: string, path: string): Promise<void> {
  await invokeBridge<unknown>(
    'set_monitor_wallpaper',
    { monitor_id: monitorId, path },
    () => undefined,
  );
}

export async function openLogFolder(): Promise<void> {
  await invokeBridge<unknown>('open_log_folder', undefined, () => undefined);
}

export async function reloadUi(): Promise<void> {
  await invokeBridge<unknown>('reload_ui', undefined, () => undefined);
}

export async function getAudioSpectrum(): Promise<number[]> {
  const bands = await invokeBridge<number[]>('get_audio_spectrum', undefined, () => {
    if (!fallbackIsPlaying) {
      return new Array(40).fill(0);
    }
    const t = Date.now() / 1000;
    return Array.from({ length: 40 }, (_, i) => {
      const wave = Math.abs(Math.sin(t * 6.5 + i * 0.45) * Math.cos(t * 3.8 - i * 0.25));
      return Math.min(1, Math.max(0.05, wave));
    });
  });
  if (!Array.isArray(bands) || bands.length === 0) {
    return new Array(40).fill(0);
  }
  return bands;
}

export async function getMasterVolume(): Promise<number> {
  const level = await invokeBridge<number>(
    'get_master_volume',
    undefined,
    () => fallbackAudioState.volume,
  );
  const clamped = Math.round(
    Math.min(100, Math.max(0, Number.isFinite(level) ? level : fallbackAudioState.volume)),
  );
  fallbackAudioState = {
    ...fallbackAudioState,
    volume: clamped,
  };
  return clamped;
}

export async function setMasterVolume(level: number): Promise<void> {
  const clamped = Math.round(Math.min(100, Math.max(0, level)));
  fallbackAudioState = {
    volume: clamped,
    muted: clamped === 0,
  };
  await invokeBridge<unknown>('set_master_volume', { level: clamped }, () => undefined);
}

export async function getBrightness(): Promise<number> {
  const level = await invokeBridge<number>('get_brightness', undefined, () => fallbackBrightness);
  const clamped = Math.round(
    Math.min(100, Math.max(0, Number.isFinite(level) ? level : fallbackBrightness)),
  );
  fallbackBrightness = clamped;
  return clamped;
}

export async function setBrightness(level: number): Promise<void> {
  const clamped = Math.round(Math.min(100, Math.max(0, level)));
  fallbackBrightness = clamped;
  await invokeBridge<unknown>('set_brightness', { level: clamped }, () => undefined);
}

export async function setAudioVolume(volume: number): Promise<void> {
  const clamped = Math.round(Math.min(100, Math.max(0, volume)));
  fallbackAudioState = {
    volume: clamped,
    muted: clamped === 0 ? fallbackAudioState.muted : false,
  };
  await invokeBridge<unknown>('set_audio_volume', { volume: clamped }, async () => {
    await setMasterVolume(clamped);
  });
}

function hydrateWallpaperEntries(list: WallpaperEntry[]): WallpaperEntry[] {
  const palette: Array<[string, string, string]> = [
    ['#1e1e2e', '#313244', '#cba6f7'],
    ['#f4efea', '#e6dcd2', '#b85c4b'],
    ['#11111b', '#1e293b', '#89dceb'],
    ['#f7edf0', '#eadce2', '#d46a84'],
    ['#2a1829', '#1f1924', '#fab387'],
    ['#0f241d', '#181825', '#a6e3a1'],
  ];

  return list.map((entry, idx) => {
    if (entry.data_url) {
      return entry;
    }
    const [c1, c2, accent] = palette[idx % palette.length];
    return {
      ...entry,
      data_url: makeSvgWallpaperDataUrl(c1, c2, accent, entry.name),
    };
  });
}

export async function getWallpapers(): Promise<WallpaperEntry[]> {
  const list = await invokeBridge<WallpaperEntry[]>('get_wallpapers', undefined, () =>
    fallbackWallpapers.map((item) => ({ ...item })),
  );
  return hydrateWallpaperEntries(list);
}

export async function setDesktopWallpaper(path: string): Promise<boolean> {
  fallbackWallpapers = fallbackWallpapers.map((w) => ({
    ...w,
    active: w.path === path,
  }));
  await invokeBridge<unknown>('set_desktop_wallpaper', { path }, () => undefined);
  return true;
}

export async function pickWallpaperFolder(currentDir?: string): Promise<string | null> {
  return invokeBridge<string | null>(
    'pick_wallpaper_folder',
    { currentDir, current_dir: currentDir },
    () => currentDir ?? null,
  );
}

export async function setWallpaperDirectory(path: string): Promise<WallpaperEntry[]> {
  const list = await invokeBridge<WallpaperEntry[]>('set_wallpaper_directory', { path }, () =>
    fallbackWallpapers.map((item) => ({ ...item })),
  );
  return hydrateWallpaperEntries(list);
}

export async function applyWallpaper(path: string): Promise<boolean> {
  fallbackWallpapers = fallbackWallpapers.map((w) => ({
    ...w,
    active: w.path === path,
  }));
  await invokeBridge<unknown>('set_desktop_wallpaper', { path }, () => undefined);
  return invokeBridge<boolean>('apply_wallpaper', { path }, () => true);
}

export async function setTopHoverTrigger(enabled: boolean): Promise<void> {
  await invokeBridge<unknown>('set_top_hover_trigger', { enabled }, () => undefined);
}

export async function setLaunchOnStartup(enabled: boolean): Promise<void> {
  await invokeBridge<unknown>('set_launch_on_startup', { enabled }, () => undefined);
}

export async function runTerminalCommand(cmd: string): Promise<string> {
  return invokeBridge<string>('run_terminal_command', { cmd }, () => {
    const clean = cmd.trim().toLowerCase();
    if (!clean) return '';
    if (clean === 'help') {
      return 'Available commands: help, fastfetch, neofetch, uptime, whoami, hostname, date, ps, ip, df';
    }
    if (clean === 'neofetch' || clean === 'fastfetch') {
      return [
        '  ╭─────────────────────────────╮',
        '  │ OS:     Windows 11 24H2     │',
        '  │ Host:   CANOPY-WIN11        │',
        '  │ Shell:  Canopy Shell        │',
        `  │ Uptime: ${formatFallbackUptime().padEnd(19, ' ')}│`,
        '  │ Theme:  Wallpaper Adaptive  │',
        '  ╰─────────────────────────────╯',
      ].join('\n');
    }
    if (clean === 'uptime') {
      return `System uptime: ${formatFallbackUptime()}`;
    }
    if (clean === 'whoami') {
      return 'canopy\\user';
    }
    if (clean === 'hostname') {
      return 'CANOPY-WIN11';
    }
    if (clean === 'date' || clean === 'time') {
      return new Date().toISOString();
    }
    if (clean === 'ip' || clean === 'ipconfig') {
      return 'Ethernet0   192.168.1.42\nWi-Fi       10.0.0.118';
    }
    if (clean === 'ps' || clean === 'top') {
      return 'Name             Id   CPU(%)  Mem(MB)\n----             --   ------  -------\nCode.exe      11684     6.8    742.0\nchrome.exe     7316     5.1    628.9\ndwm.exe        1420     4.2    198.4\nSpotify.exe    9240     3.4    312.5\nCanopy Shell   4812     1.8     64.2';
    }
    if (clean === 'df' || clean === 'disk') {
      return 'Name  Used(GB)  Free(GB)\n----  --------  --------\nC     418.5     581.5';
    }
    return `Executed '${cmd.trim()}'. Try: help, fastfetch, uptime, ps, ip, df`;
  });
}

export async function setDropdownOpen(open: boolean): Promise<void> {
  await invokeBridge<unknown>('set_dropdown_open', { open }, () => undefined);
}

export async function notifyTabSwitched(): Promise<void> {
  await invokeBridge<unknown>('tab_changed', undefined, () => undefined);
}

const FALLBACK_INSTALLED_APPS: InstalledAppItem[] = [
  {
    id: 'brave',
    name: 'Brave',
    category: 'Browser',
    path: 'brave.exe',
    description: 'Default Web Browser (BraveHTML)',
  },
  {
    id: 'wt',
    name: 'Windows Terminal',
    category: 'Developer',
    path: 'wt.exe',
    description: 'Modern tabs & shells',
  },
  {
    id: 'explorer',
    name: 'File Explorer',
    category: 'System',
    path: 'explorer.exe',
    description: 'Browse local drives & files',
  },
  {
    id: 'taskmgr',
    name: 'Task Manager',
    category: 'System',
    path: 'taskmgr.exe',
    description: 'Process & resource monitor',
  },
  {
    id: 'code',
    name: 'Visual Studio Code',
    category: 'Developer',
    path: 'code',
    description: 'Code editor & workspace',
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    category: 'Browser',
    path: 'msedge.exe',
    description: 'Web browser',
  },
  {
    id: 'notepad',
    name: 'Notepad',
    category: 'Productivity',
    path: 'notepad.exe',
    description: 'Quick text & notes',
  },
  {
    id: 'calc',
    name: 'Calculator',
    category: 'Utilities',
    path: 'calc.exe',
    description: 'Standard & scientific calculator',
  },
  {
    id: 'mspaint',
    name: 'Paint',
    category: 'Creative',
    path: 'mspaint.exe',
    description: 'Image canvas & editor',
  },
  {
    id: 'snippingtool',
    name: 'Snipping Tool',
    category: 'Utilities',
    path: 'SnippingTool.exe',
    description: 'Screen capture & recording',
  },
  {
    id: 'settings',
    name: 'Windows Settings',
    category: 'System',
    path: 'ms-settings:',
    description: 'System configuration',
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    category: 'Developer',
    path: 'powershell.exe',
    description: 'Command-line shell',
  },
  {
    id: 'control',
    name: 'Control Panel',
    category: 'System',
    path: 'control.exe',
    description: 'Classic Windows settings',
  },
];

export async function getInstalledApps(force = false): Promise<InstalledAppItem[]> {
  const list = await invokeBridge<InstalledAppItem[]>(
    'get_installed_apps',
    force ? { force: true } : undefined,
    () => FALLBACK_INSTALLED_APPS.map((item) => ({ ...item })),
  );
  if (!Array.isArray(list) || list.length === 0) {
    return FALLBACK_INSTALLED_APPS.map((item) => ({ ...item }));
  }
  return list;
}

export async function launchApp(target: string): Promise<boolean> {
  return invokeBridge<boolean>('launch_app', { target, path: target }, () => true);
}

export async function executePowerAction(
  action: 'sleep' | 'restart' | 'shutdown' | 'lock' | 'signout' | 'hibernate',
): Promise<boolean> {
  return invokeBridge<boolean>('execute_power_action', { action }, () => true);
}
