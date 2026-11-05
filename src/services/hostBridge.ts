export const CANOPY_VERSION = '1.0.8';
export interface ProcessEntry {
  name: string;
  pid: number;
  cpu_usage: number;
  memory_mb: number;
}

export interface SystemStats {
  cpu_usage: number;
  cpu_temp_c: number | null;
  gpu_usage: number | null;
  gpu_temp_c: number | null;
  gpu_name?: string | null;
  cpu_name?: string | null;
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
export interface WifiState {
  enabled: boolean;
  connected: boolean;
  ssid?: string;
  signal?: number; // 0-100
  profiles: string[];
  bssid?: string;
  band?: string;
}

export interface BluetoothDeviceInfo {
  id: string;
  name: string;
  status: string;
  connected: boolean;
  is_audio?: boolean;
}
export interface BluetoothState {
  enabled: boolean;
  devices: BluetoothDeviceInfo[];
  adapter_name?: string;
  version?: string;
  lmp?: string;
  connected_count?: number;
  rx_kbps?: number;
  tx_kbps?: number;
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
export function isWebViewHost(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.__CANOPY_BRIDGE__ || window.__CAELESTIA_BRIDGE__ || window.__TAURI_INTERNALS__)
  );
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
    // Native host bridge is the primary communication channel
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

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

// Missing fields fall back to neutral values, never to demo data: in standalone preview the
// bridge fallback already returns a complete demo snapshot, so demo values only ever reach the
// shell there. Substituting them for a sparse host payload showed fabricated processes/cores.
export async function getSystemStats(): Promise<SystemStats> {
  const raw = await invokeBridge<Partial<SystemStats>>(
    'get_system_stats',
    undefined,
    buildFallbackSystemStats,
  );
  const gpuUsage =
    typeof raw.gpu_usage === 'number' && Number.isFinite(raw.gpu_usage) ? raw.gpu_usage : null;

  return {
    cpu_usage: finiteOr(raw.cpu_usage, 0),
    cpu_temp_c: typeof raw.cpu_temp_c === 'number' && raw.cpu_temp_c > 0 ? raw.cpu_temp_c : null,
    cpu_name: stringOr(raw.cpu_name, 'CPU'),
    gpu_usage: gpuUsage,
    gpu_temp_c:
      typeof raw.gpu_temp_c === 'number' && Number.isFinite(raw.gpu_temp_c) ? raw.gpu_temp_c : null,
    gpu_name: typeof raw.gpu_name === 'string' ? raw.gpu_name : gpuUsage !== null ? 'GPU' : null,
    core_usages: Array.isArray(raw.core_usages) ? raw.core_usages : [],
    top_processes: Array.isArray(raw.top_processes) ? raw.top_processes : [],
    net_down_kbps: finiteOr(raw.net_down_kbps, 0),
    net_up_kbps: finiteOr(raw.net_up_kbps, 0),
    ram_usage: finiteOr(raw.ram_usage, 0),
    ram_used_gb: finiteOr(raw.ram_used_gb, 0),
    ram_total_gb: finiteOr(raw.ram_total_gb, 0),
    disk_usage: finiteOr(raw.disk_usage, 0),
    disk_used_gb: finiteOr(raw.disk_used_gb, 0),
    disk_total_gb: finiteOr(raw.disk_total_gb, 0),
    uptime_formatted: stringOr(raw.uptime_formatted, ''),
    hostname: stringOr(raw.hostname, ''),
    os_name: stringOr(raw.os_name, ''),
    username: stringOr(raw.username, ''),
  };
}

function buildFallbackMediaInfo(): MediaInfo {
  const track = FALLBACK_TRACKS[fallbackTrackIndex % FALLBACK_TRACKS.length];
  const duration = track.duration_secs || 240;
  const elapsed = fallbackIsPlaying
    ? Math.floor((Date.now() - fallbackTrackStartMs) / 1000) % duration
    : fallbackPausedElapsedSecs % duration;
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    position_secs: elapsed,
    duration_secs: duration,
    is_playing: fallbackIsPlaying,
    artwork_url: track.artwork_url,
    source_app: track.source_app,
    sessions: buildFallbackSessions(),
  };
}

// Same rule as getSystemStats: a host snapshot without artwork (null) or with an empty title must
// not inherit the demo track's cover/title — that hid the real track and blocked the iTunes lookup.
export async function getMediaInfo(): Promise<MediaInfo> {
  const info = await invokeBridge<Partial<MediaInfo>>(
    'get_media_info',
    undefined,
    buildFallbackMediaInfo,
  );

  return {
    title: stringOr(info.title, ''),
    artist: stringOr(info.artist, ''),
    album: stringOr(info.album, ''),
    is_playing: info.is_playing === true,
    position_secs: Math.max(0, finiteOr(info.position_secs, 0)),
    duration_secs: Math.max(0, finiteOr(info.duration_secs, 0)),
    artwork_url: typeof info.artwork_url === 'string' && info.artwork_url ? info.artwork_url : null,
    source_app: stringOr(info.source_app, ''),
    sessions: Array.isArray(info.sessions) ? info.sessions : [],
    is_shuffle: typeof info.is_shuffle === 'boolean' ? info.is_shuffle : false,
    auto_repeat: typeof info.auto_repeat === 'number' ? info.auto_repeat : 0,
  };
}

export async function getMediaSessions(): Promise<MediaSessionItem[]> {
  const sessions = await invokeBridge<MediaSessionItem[]>('get_media_sessions', undefined, () =>
    buildFallbackSessions(),
  );
  if (isWebViewHost()) {
    return Array.isArray(sessions) ? sessions : [];
  }
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
  await invokeBridge<unknown>('select_media_session', { sessionId, session_id: sessionId }, () => {
    if (idx >= 0) {
      fallbackTrackIndex = idx;
      fallbackIsPlaying = true;
      fallbackPausedElapsedSecs = 0;
      fallbackTrackStartMs = Date.now();
    }
  });
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
  await invokeBridge<unknown>('media_seek', { seconds: clamped }, () => {
    fallbackPausedElapsedSecs = clamped;
    fallbackTrackStartMs = Date.now() - clamped * 1000;
  });
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
  panelAnchor?: 'top-center' | 'top-left' | 'top-right';
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

export async function getSettingsJson<T = unknown>(): Promise<T | null> {
  return invokeBridge<T | null>('get_settings_json', undefined, () => null);
}

export async function saveSettingsJson(settings: Record<string, unknown>): Promise<boolean> {
  return invokeBridge<boolean>('save_settings_json', settings, () => true);
}

export async function uploadMascot(
  filename: string,
  dataBase64: string,
): Promise<{ url: string; path: string } | null> {
  return invokeBridge<{ url: string; path: string } | null>(
    'upload_mascot',
    { filename, data_base64: dataBase64 },
    () => null,
  );
}

export interface AudioSessionEntry {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
  is_active: boolean;
  icon_data_url?: string | null;
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

export interface AudioDeviceInfo {
  id: string;
  name: string;
  is_default: boolean;
  flow: 'render' | 'capture';
}

export async function listAudioDevices(
  flow: 'render' | 'capture' = 'render',
): Promise<AudioDeviceInfo[]> {
  return invokeBridge<AudioDeviceInfo[]>('list_audio_devices', { flow }, () => []);
}

export async function setDefaultAudioDevice(deviceId: string): Promise<boolean> {
  return invokeBridge<boolean>('set_default_audio_device', { device_id: deviceId }, () => false);
}

export async function toggleCaffeine(): Promise<{ enabled: boolean }> {
  return invokeBridge<{ enabled: boolean }>('toggle_caffeine', undefined, () => ({
    enabled: false,
  }));
}

export async function getCaffeineStatus(): Promise<{ enabled: boolean }> {
  return invokeBridge<{ enabled: boolean }>('get_caffeine_status', undefined, () => ({
    enabled: false,
  }));
}

export async function triggerScreenSnip(): Promise<boolean> {
  return invokeBridge<boolean>('trigger_screen_snip', undefined, () => false);
}

export async function toggleDnd(): Promise<{ enabled: boolean }> {
  return invokeBridge<{ enabled: boolean }>('toggle_dnd', undefined, () => ({ enabled: false }));
}

export async function getDndStatus(): Promise<{ enabled: boolean }> {
  return invokeBridge<{ enabled: boolean }>('get_dnd_status', undefined, () => ({
    enabled: false,
  }));
}

export async function getAppVersion(): Promise<string> {
  const res = await invokeBridge<{ version?: string }>('get_version', undefined, () => ({
    version: CANOPY_VERSION,
  }));
  return res.version || CANOPY_VERSION;
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
  // The host returns false when Windows rejects the wallpaper: surface it, never assume success.
  const applied = await invokeBridge<boolean>('set_desktop_wallpaper', { path }, () => true);
  return applied === true;
}

export async function pickWallpaperFolder(currentDir?: string): Promise<string | null> {
  return invokeBridge<string | null>(
    'pick_wallpaper_folder',
    { currentDir, current_dir: currentDir },
    () => currentDir ?? null,
  );
}

export async function pickExecutable(initialDir?: string): Promise<string | null> {
  return invokeBridge<string | null>('pick_executable', { initialDir }, () => null);
}

export interface ReminderPayload {
  id: string;
  text: string;
  date: string;
  time?: string;
}

export async function setReminders(reminders: ReminderPayload[]): Promise<boolean> {
  return invokeBridge<boolean>('set_reminders', { reminders }, () => false);
}

export async function testNotification(message?: string, title?: string): Promise<boolean> {
  const accent =
    typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim()
      : undefined;
  const bg =
    typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim()
      : undefined;
  return invokeBridge<boolean>(
    'test_notification',
    { message, title, accentColorHex: accent, bgColorHex: bg },
    () => true,
  );
}

export async function showNotification(
  message: string,
  title?: string,
  accentColorHex?: string,
  bgColorHex?: string,
): Promise<boolean> {
  const accent =
    accentColorHex ||
    (typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim()
      : undefined);
  const bg =
    bgColorHex ||
    (typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim()
      : undefined);
  return invokeBridge<boolean>(
    'show_notification',
    { message, title, accentColorHex: accent, bgColorHex: bg },
    () => true,
  );
}

export async function setWallpaperDirectory(path: string): Promise<WallpaperEntry[]> {
  const list = await invokeBridge<WallpaperEntry[]>('set_wallpaper_directory', { path }, () =>
    fallbackWallpapers.map((item) => ({ ...item })),
  );
  return hydrateWallpaperEntries(list);
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

export async function setWindowSize(width: number, height: number): Promise<void> {
  await invokeBridge<unknown>(
    'set_window_size',
    { width: Math.round(width), height: Math.round(height) },
    () => undefined,
  );
}

export async function setResizing(resizing: boolean): Promise<void> {
  await invokeBridge<unknown>('set_resizing', { resizing }, () => undefined);
}

export async function notifyTabSwitched(): Promise<void> {
  await invokeBridge<unknown>('tab_changed', undefined, () => undefined);
}

export async function openExternalUrl(url: string): Promise<boolean> {
  return invokeBridge<boolean>('open_url', { url }, () => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
      return true;
    }
    return false;
  });
}

export async function applyUpdate(downloadUrl: string): Promise<boolean> {
  return invokeBridge<boolean>('apply_update', { downloadUrl }, () => false);
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  downloadUrl?: string;
  releaseUrl?: string;
  releaseNotes?: string;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubReleaseResponse {
  tag_name?: unknown;
  assets?: unknown;
  html_url?: unknown;
  body?: unknown;
}

const UPDATE_CHECK_TIMEOUT_MS = 10_000;

export async function checkForUpdates(
  currentVersion: string = CANOPY_VERSION,
): Promise<UpdateCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.github.com/repos/Fireball122/canopy/releases/latest', {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload: unknown = await res.json();
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Unexpected release payload');
    }
    const data = payload as GitHubReleaseResponse;
    const tagName = stringOr(data.tag_name, '').replace(/^v/i, '').trim();
    const cleanCurrent = currentVersion.replace(/^v/i, '').trim();

    // Semantic version compare: latest > current
    const latestParts = tagName.split('.').map((n: string) => Number.parseInt(n, 10) || 0);
    const currentParts = cleanCurrent.split('.').map((n: string) => Number.parseInt(n, 10) || 0);

    let isNewer = false;
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) {
        isNewer = true;
        break;
      }
      if (l < c) {
        break;
      }
    }

    let downloadUrl: string | undefined;
    if (Array.isArray(data.assets)) {
      const exeAsset = (data.assets as GitHubReleaseAsset[]).find(
        (a) =>
          typeof a.name === 'string' &&
          a.name.endsWith('.exe') &&
          !a.name.toLowerCase().includes('portable'),
      );
      if (exeAsset && typeof exeAsset.browser_download_url === 'string') {
        downloadUrl = exeAsset.browser_download_url;
      }
    }

    return {
      currentVersion: cleanCurrent,
      latestVersion: tagName,
      updateAvailable: isNewer,
      downloadUrl,
      releaseUrl: typeof data.html_url === 'string' ? data.html_url : undefined,
      releaseNotes: typeof data.body === 'string' ? data.body : undefined,
    };
  } catch (error) {
    console.warn('[hostBridge] Update check failed; reporting no update:', error);
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
    };
  } finally {
    clearTimeout(timer);
  }
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

let fallbackWifiEnabled = true;
let fallbackWifiConnected = true;
let fallbackWifiSsid = 'Canopy-Studio-WiFi6E';
let fallbackBluetoothEnabled = true;

export async function getWifiState(): Promise<WifiState> {
  return invokeBridge<WifiState>('get_wifi_state', undefined, () => ({
    enabled: fallbackWifiEnabled,
    connected: fallbackWifiConnected,
    ssid: fallbackWifiConnected ? fallbackWifiSsid : undefined,
    signal: fallbackWifiConnected ? 95 : 0,
    profiles: ['Canopy-Studio-WiFi6E', 'Ultaria-Home-5G', 'Guest_Access_Protected'],
    bssid: '60:e9:aa:ca:50:2f',
    band: '6 GHz',
  }));
}

export async function setWifiEnabled(enabled: boolean): Promise<boolean> {
  fallbackWifiEnabled = enabled;
  if (!enabled) {
    fallbackWifiConnected = false;
  }
  return invokeBridge<boolean>('set_wifi_enabled', { enabled }, () => true);
}

export async function connectWifi(ssid: string): Promise<boolean> {
  fallbackWifiConnected = true;
  fallbackWifiSsid = ssid;
  return invokeBridge<boolean>('connect_wifi', { ssid }, () => true);
}

export async function disconnectWifi(): Promise<boolean> {
  fallbackWifiConnected = false;
  return invokeBridge<boolean>('disconnect_wifi', undefined, () => true);
}

export async function deleteWifiProfile(name: string): Promise<boolean> {
  return invokeBridge<boolean>('delete_wifi_profile', { name }, () => true);
}
export async function getBluetoothState(): Promise<BluetoothState> {
  return invokeBridge<BluetoothState>('get_bluetooth_state', undefined, () => ({
    enabled: fallbackBluetoothEnabled,
    devices: [
      { id: 'bt-1', name: 'Sony WH-1000XM5', status: 'OK', connected: true },
      { id: 'bt-2', name: 'Xbox Wireless Controller', status: 'OK', connected: true },
      { id: 'bt-3', name: 'MX Master 3S', status: 'OK', connected: false },
      { id: 'bt-4', name: 'Pixel 8 Pro', status: 'OK', connected: false },
    ],
    adapter_name: 'Bluetooth Radio Adapter',
    version: 'Bluetooth 5.2',
    lmp: 'LMP 11.8710',
    connected_count: 2,
    rx_kbps: 1.2,
    tx_kbps: 3.4,
  }));
}

export async function setBluetoothEnabled(enabled: boolean): Promise<boolean> {
  fallbackBluetoothEnabled = enabled;
  return invokeBridge<boolean>('set_bluetooth_enabled', { enabled }, () => true);
}

export async function connectBluetoothDevice(
  id: string,
): Promise<{ success: boolean; message?: string }> {
  return invokeBridge<{ success: boolean; message?: string }>(
    'connect_bluetooth_device',
    { id },
    () => ({
      success: true,
    }),
  );
}

export async function disconnectBluetoothDevice(
  id: string,
): Promise<{ success: boolean; message?: string }> {
  return invokeBridge<{ success: boolean; message?: string }>(
    'disconnect_bluetooth_device',
    { id },
    () => ({
      success: true,
    }),
  );
}
export interface HotspotState {
  enabled: boolean;
  supported: boolean;
  ssid: string;
  passphrase: string;
  clients: number;
  band: string;
}

export async function getHotspotState(): Promise<HotspotState> {
  return invokeBridge<HotspotState>('get_hotspot_state', undefined, () => ({
    enabled: false,
    supported: true,
    ssid: 'Hotspot',
    passphrase: '',
    clients: 0,
    band: '5.0 GHz',
  }));
}

export async function toggleHotspot(): Promise<{ enabled: boolean; success: boolean }> {
  return invokeBridge<{ enabled: boolean; success: boolean }>('toggle_hotspot', undefined, () => ({
    enabled: true,
    success: true,
  }));
}

export async function setHotspotConfig(
  ssid: string,
  passphrase: string,
): Promise<{ success: boolean; reason?: string; ssid?: string }> {
  return invokeBridge<{ success: boolean; reason?: string; ssid?: string }>(
    'set_hotspot_config',
    { ssid, passphrase },
    () => ({ success: true, ssid }),
  );
}

export interface PowerModeState {
  is_power_saver: boolean;
  active_scheme: string;
  has_battery: boolean;
}

export async function getPowerMode(): Promise<PowerModeState> {
  return invokeBridge<PowerModeState>('get_power_mode', undefined, () => ({
    is_power_saver: false,
    active_scheme: 'Balanced',
    has_battery: false,
  }));
}

export async function togglePowerSaver(): Promise<{ is_power_saver: boolean; success: boolean }> {
  return invokeBridge<{ is_power_saver: boolean; success: boolean }>(
    'toggle_power_saver',
    undefined,
    () => ({ is_power_saver: true, success: true }),
  );
}

export async function getDesktopMonitorThumbnail(): Promise<{ data_url: string | null }> {
  return invokeBridge<{ data_url: string | null }>(
    'get_desktop_monitor_thumbnail',
    undefined,
    () => ({
      data_url: null,
    }),
  );
}

export interface NetworkAdapterInfo {
  id: string;
  name: string;
  description: string;
  type: 'ethernet' | 'wifi';
  status: string;
  speed_mbps: number;
  ip_address: string;
  is_connected: boolean;
}

export async function getNetworkAdapters(): Promise<NetworkAdapterInfo[]> {
  return invokeBridge<NetworkAdapterInfo[]>('get_network_adapters', undefined, () => [
    {
      id: 'eth-1',
      name: 'Ethernet',
      description: 'Gigabit Ethernet Adapter',
      type: 'ethernet',
      status: 'up',
      speed_mbps: 1000,
      ip_address: '192.168.1.189',
      is_connected: true,
    },
  ]);
}

export async function addAndConnectWifi(
  ssid: string,
  password: string,
): Promise<{ success: boolean; message: string }> {
  return invokeBridge<{ success: boolean; message: string }>(
    'add_and_connect_wifi',
    { ssid, password },
    () => ({ success: true, message: `Connected to ${ssid}` }),
  );
}
