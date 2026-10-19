import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Heart,
  Monitor as MonitorIcon,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import {
  type DesktopWallpaperState,
  getDesktopWallpaperState,
  pickWallpaperFolder,
  setDesktopWallpaper,
  setDesktopWallpaperState,
  setMonitorWallpaper,
  setWallpaperDirectory,
  type WallpaperEntry,
} from '../services/hostBridge';
import {
  applyThemeFromImageSrc,
  applyThemeModeFallback,
  applyThemePalette,
} from '../services/palette';

export interface WallpaperViewProps {
  wallpapers: WallpaperEntry[];
  onApplyWallpaper: (entry: WallpaperEntry, imgEl?: HTMLImageElement | null) => void;
  onRefreshWallpapers: () => void;
  onNavigateToSettings?: () => void;
  onDirectoryChanged?: (newDir: string, entries: WallpaperEntry[]) => void;
  statusText?: string;
}

const FALLBACK_GRADIENTS: string[] = [
  'linear-gradient(135deg, #1e1e2e 0%, #45275d 45%, #cba6f7 100%)',
  'linear-gradient(135deg, #11111b 0%, #1e3a5f 50%, #89dceb 100%)',
  'linear-gradient(135deg, #181825 0%, #3b224c 50%, #f5c2e7 100%)',
  'linear-gradient(135deg, #11111b 0%, #23392d 50%, #a6e3a1 100%)',
  'linear-gradient(135deg, #1e1e2e 0%, #5c2a41 50%, #fab387 100%)',
  'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #89b4fa 100%)',
];

interface ExtractedSwatches {
  dominant: string;
  accent: string;
  surface: string;
}

function formatFriendlyName(rawName: string): string {
  const withoutExt = rawName.replace(/\.[a-zA-Z0-9]+$/, '');
  return withoutExt.replace(/[-_]+/g, ' ').trim() || 'Wallpaper';
}

function extractImageSwatches(imgEl: HTMLImageElement | null): ExtractedSwatches {
  const fallback: ExtractedSwatches = {
    dominant: 'var(--theme-accent, #A29BFE)',
    accent: 'var(--theme-text-primary, #F1F2F6)',
    surface: 'var(--theme-bg, #181824)',
  };

  if (!imgEl || !imgEl.complete || imgEl.naturalWidth <= 0) {
    return fallback;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 32;
    canvas.height = 32;
    if (!ctx) return fallback;

    ctx.drawImage(imgEl, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    let vibR = 162;
    let vibG = 155;
    let vibB = 254;
    let maxSat = -1;

    let secR = 137;
    let secG = 220;
    let secB = 235;
    let secSat = -1;

    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      rSum += r;
      gSum += g;
      bSum += b;
      count++;

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC - minC;
      if (sat > maxSat && maxC > 40 && minC < 235) {
        secR = vibR;
        secG = vibG;
        secB = vibB;
        secSat = maxSat;
        maxSat = sat;
        vibR = r;
        vibG = g;
        vibB = b;
      } else if (sat > secSat && maxC > 40 && minC < 235) {
        secSat = sat;
        secR = r;
        secG = g;
        secB = b;
      }
    }

    if (count === 0) return fallback;

    const avgR = Math.round(rSum / count);
    const avgG = Math.round(gSum / count);
    const avgB = Math.round(bSum / count);

    return {
      dominant: `rgb(${vibR}, ${vibG}, ${vibB})`,
      accent: `rgb(${secR}, ${secG}, ${secB})`,
      surface: `rgb(${avgR}, ${avgG}, ${avgB})`,
    };
  } catch {
    return fallback;
  }
}

export const WallpaperView: React.FC<WallpaperViewProps> = ({
  wallpapers,
  onApplyWallpaper,
  onRefreshWallpapers,
  onDirectoryChanged,
  statusText,
}) => {
  const { settings, updateSettings } = useSettings();
  const imgRefs = useRef<Record<string, HTMLImageElement | null>>({});
  const transitionTimerRef = useRef<number | null>(null);
  // Monotonic token guarding async palette extraction against superseded selections.
  const themeRequestRef = useRef<number>(0);

  const activeWallpaper = wallpapers.find((w) => w.active) || wallpapers[0] || null;
  const [transitioningPath, setTransitioningPath] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState<boolean>(false);
  const [browsingFolder, setBrowsingFolder] = useState<boolean>(false);
  const [swatches, setSwatches] = useState<ExtractedSwatches>({
    dominant: 'var(--theme-accent, #A29BFE)',
    accent: '#89DCEB',
    surface: 'var(--theme-bg, #181824)',
  });
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterFavoritesOnly, setFilterFavoritesOnly] = useState<boolean>(false);
  const [showPerMonitor, setShowPerMonitor] = useState<boolean>(false);
  const [desktopState, setDesktopState] = useState<DesktopWallpaperState | null>(null);
  const [busyMonitorId, setBusyMonitorId] = useState<string | null>(null);
  const [slideshowMinutes, setSlideshowMinutes] = useState<number>(30);
  const [pickingMonitorId, setPickingMonitorId] = useState<string | null>(null);
  const isFavorite = (path: string) => settings.wallpaperFavorites?.includes(path) ?? false;

  const toggleFavorite = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const current = settings.wallpaperFavorites || [];
    const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
    updateSettings({ wallpaperFavorites: next });
  };

  const filteredWallpapers = useMemo(() => {
    let list = wallpapers.filter((w) =>
      w.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
    );
    if (filterFavoritesOnly) {
      list = list.filter((w) => isFavorite(w.path));
    } else {
      list = [...list].sort((a, b) => {
        const aFav = isFavorite(a.path) ? 1 : 0;
        const bFav = isFavorite(b.path) ? 1 : 0;
        return bFav - aFav;
      });
    }
    return list;
  }, [wallpapers, searchQuery, filterFavoritesOnly, settings.wallpaperFavorites]);

  const getResolutionBadge = (res?: string): string => {
    if (!res) return 'FHD';
    if (res.includes('3840') || res.includes('4096') || res.includes('7680')) return '4K';
    if (res.includes('3440') || res.includes('5120')) return 'UW';
    if (res.includes('2560')) return 'QHD';
    return 'FHD';
  };

  useEffect(() => {
    if (!activeWallpaper) return;
    const imgEl = imgRefs.current[activeWallpaper.path] ?? null;
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      setSwatches(extractImageSwatches(imgEl));
    }
  }, [activeWallpaper?.path, activeWallpaper?.data_url]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  // Load the host's per-monitor wallpaper/slideshow state once, then keep it fresh
  // whenever the user changes something here.
  useEffect(() => {
    let cancelled = false;
    getDesktopWallpaperState().then((state) => {
      if (cancelled) return;
      setDesktopState(state);
      setSlideshowMinutes(state.slideshow_minutes > 0 ? state.slideshow_minutes : 30);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshDesktopState = async (): Promise<void> => {
    const state = await getDesktopWallpaperState();
    setDesktopState(state);
  };

  const handleSelectWallpaper = async (entry: WallpaperEntry) => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }
    setTransitioningPath(entry.path);

    updateSettings({ activeWallpaperPath: entry.path });
    const targetThemeMode = settings.themeMode;
    const token = ++themeRequestRef.current;
    const imgEl = imgRefs.current[entry.path] ?? null;
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      applyThemePalette(imgEl, targetThemeMode);
      setSwatches(extractImageSwatches(imgEl));
    } else if (entry.data_url) {
      try {
        const decoded = new Image();
        decoded.crossOrigin = 'anonymous';
        decoded.src = entry.data_url;
        await decoded.decode();

        if (themeRequestRef.current !== token) {
          return;
        }

        applyThemePalette(decoded, targetThemeMode);
        setSwatches(extractImageSwatches(decoded));
      } catch {
        if (themeRequestRef.current !== token) {
          return;
        }
        applyThemeModeFallback(targetThemeMode, settings.glassOpacity, settings.glassBlurStrength);
      }
    } else {
      applyThemeModeFallback(settings.themeMode, settings.glassOpacity, settings.glassBlurStrength);
    }

    try {
      await setDesktopWallpaper(entry.path);
    } catch {
      // Handled gracefully
    }

    if (themeRequestRef.current !== token) {
      return; // A newer selection took over while the host applied this one.
    }

    onApplyWallpaper(entry, imgEl);
    transitionTimerRef.current = window.setTimeout(() => {
      setTransitioningPath(null);
    }, 450);
  };

  const handlePalettePillClick = async (mode: 'canopy' | 'adaptive' | 'dark' | 'light') => {
    updateSettings({ themeMode: mode });
    if (activeWallpaper) {
      const imgEl = imgRefs.current[activeWallpaper.path] ?? null;
      if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
        applyThemePalette(imgEl, mode);
        return;
      }
      if (activeWallpaper.data_url) {
        await applyThemeFromImageSrc(activeWallpaper.data_url, mode);
        return;
      }
    }
    applyThemeModeFallback(mode, settings.glassOpacity, settings.glassBlurStrength);
  };

  const handleBrowseFolder = async () => {
    setBrowsingFolder(true);
    try {
      const chosen = await pickWallpaperFolder(settings.wallpaperDirectory);
      if (chosen) {
        updateSettings({ wallpaperDirectory: chosen });
        const entries = await setWallpaperDirectory(chosen);
        onDirectoryChanged?.(chosen, entries);
      }
    } catch {
      // Ignore cancel
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleRescan = () => {
    setRescanning(true);
    onRefreshWallpapers();
    window.setTimeout(() => setRescanning(false), 450);
  };

  const fileNameFromPath = (path: string): string => {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  };

  const entryForPath = (path: string): WallpaperEntry | null => {
    if (!path) return null;
    const normalized = path.replace(/\//g, '\\').toLowerCase();
    return wallpapers.find((w) => w.path.replace(/\//g, '\\').toLowerCase() === normalized) ?? null;
  };

  const handleToggleSlideshow = async (enabled: boolean) => {
    await setDesktopWallpaperState({ slideshow_enabled: enabled });
    await refreshDesktopState();
  };

  const handleToggleShuffle = async () => {
    await setDesktopWallpaperState({ shuffle: !(desktopState?.shuffle ?? false) });
    await refreshDesktopState();
  };

  const commitSlideshowMinutes = async () => {
    const minutes = Math.max(1, Math.min(1440, Math.round(slideshowMinutes || 1)));
    setSlideshowMinutes(minutes);
    await setDesktopWallpaperState({ slideshow_minutes: minutes });
  };

  const palettePills: {
    id: 'canopy' | 'adaptive' | 'dark' | 'light';
    label: string;
    swatchColor: string;
  }[] = [
    {
      id: 'canopy',
      label: 'Canopy',
      swatchColor: '#74a86c',
    },
    {
      id: 'adaptive',
      label: 'Adaptive',
      swatchColor: swatches.dominant || '#74a86c',
    },
    {
      id: 'dark',
      label: 'Obsidian',
      swatchColor: '#121218',
    },
    {
      id: 'light',
      label: 'Alabaster',
      swatchColor: '#f8fafc',
    },
  ];
  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full flex flex-col gap-3 pointer-events-auto select-none overflow-hidden"
    >
      {/* Minimal Top Bar: 3 Dynamic Palette Pills + Minimal Folder / Refresh Controls */}
      <div className="flex items-center justify-between px-1 shrink-0">
        {/* Theme Mode Segmented Track Container */}
        <div className="flex items-center gap-1 bg-[var(--theme-track)] p-0.5 rounded-full border border-[var(--theme-border)]">
          {palettePills.map((pill) => {
            const isSelected = settings.themeMode === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                data-tauri-drag-region="false"
                onClick={() => handlePalettePillClick(pill.id)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200 pointer-events-auto cursor-pointer active:scale-95"
                style={{
                  background: isSelected
                    ? 'var(--theme-card, rgba(255, 255, 255, 0.14))'
                    : 'transparent',
                  border: isSelected
                    ? '1px solid var(--theme-accent, #A29BFE)'
                    : '1px solid transparent',
                  color: isSelected
                    ? 'var(--theme-text-primary, #F1F2F6)'
                    : 'var(--theme-text-secondary, #9E9EA7)',
                  boxShadow: isSelected
                    ? '0 0 12px -2px var(--theme-accent, rgba(162, 155, 254, 0.35))'
                    : 'none',
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-300"
                  style={{
                    background: pill.swatchColor,
                    boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.22)',
                  }}
                />
                <span>{pill.label}</span>
              </button>
            );
          })}
        </div>
        {/* Center: Search Box & Favorites Filter */}
        <div className="flex items-center gap-1.5 flex-1 max-w-[280px] mx-2">
          <div
            className="flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
            style={{
              background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            }}
          >
            <Search className="w-3 h-3 opacity-60 shrink-0" />
            <input
              type="text"
              data-tauri-drag-region="false"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search wallpapers..."
              className="w-full bg-transparent text-[11px] focus:outline-none pointer-events-auto"
              style={{ color: 'var(--theme-text-primary, #F1F2F6)' }}
            />
            {searchQuery && (
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() => setSearchQuery('')}
                className="opacity-60 hover:opacity-100 pointer-events-auto cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={() => setFilterFavoritesOnly((prev) => !prev)}
            className={`p-1.5 rounded-full border transition-all active:scale-95 pointer-events-auto cursor-pointer ${
              filterFavoritesOnly ? 'shadow-sm' : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              background: filterFavoritesOnly ? 'var(--theme-track)' : 'var(--theme-card)',
              borderColor: filterFavoritesOnly ? 'var(--theme-accent)' : 'var(--theme-border)',
              color: filterFavoritesOnly ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
            }}
            title={filterFavoritesOnly ? 'Showing Favorites Only' : 'Show Favorites Only'}
          >
            <Heart className={`w-3.5 h-3.5 ${filterFavoritesOnly ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Minimal Folder & Rescan Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {statusText && (
            <span
              className="text-[11px] truncate max-w-[180px] text-right"
              style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
              title={statusText}
            >
              {statusText}
            </span>
          )}

          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={handleBrowseFolder}
            disabled={browsingFolder}
            title="Change wallpaper folder"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200 hover:opacity-100 opacity-85 active:scale-95 pointer-events-auto cursor-pointer"
            style={{
              background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--theme-border, rgba(255, 255, 255, 0.07))',
              color: 'var(--theme-text-secondary, #9E9EA7)',
            }}
          >
            <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.9} />
            <span>Folder</span>
          </button>

          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={handleRescan}
            title="Refresh wallpapers"
            className="p-1.5 rounded-full transition-all duration-200 hover:opacity-100 opacity-80 active:scale-95 pointer-events-auto cursor-pointer"
            style={{
              background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--theme-border, rgba(255, 255, 255, 0.07))',
              color: 'var(--theme-text-secondary, #9E9EA7)',
            }}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${rescanning ? 'animate-spin' : ''}`}
              strokeWidth={1.9}
            />
          </button>
        </div>
      </div>

      {/* Sleek Borderless 16:9 Thumbnail Grid */}
      <div
        data-tauri-drag-region="false"
        className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-1 pointer-events-auto"
      >
        <div className="grid grid-cols-3 gap-3">
          {filteredWallpapers.map((entry, idx) => {
            const isActive = Boolean(entry.active);
            const isFav = isFavorite(entry.path);
            const isApplying = transitioningPath === entry.path;
            const friendlyTitle = formatFriendlyName(entry.name);
            const resBadge = getResolutionBadge(entry.resolution);
            const fallbackBg = FALLBACK_GRADIENTS[idx % FALLBACK_GRADIENTS.length];
            return (
              <button
                key={entry.path}
                type="button"
                data-tauri-drag-region="false"
                onClick={() => handleSelectWallpaper(entry)}
                className="group relative w-full aspect-video rounded-[13px] overflow-hidden focus:outline-none pointer-events-auto cursor-pointer"
                style={{
                  background: entry.data_url ? undefined : fallbackBg,
                  transform: isApplying ? 'scale(0.97)' : 'scale(1)',
                  transition: 'transform 200ms ease, box-shadow 250ms ease, opacity 300ms ease',
                  boxShadow: isActive
                    ? '0 0 0 2px var(--theme-accent, #A29BFE), 0 0 18px -2px var(--theme-accent, rgba(162, 155, 254, 0.55))'
                    : '0 4px 12px rgba(0, 0, 0, 0.22)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.03)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {entry.data_url && (
                  <img
                    ref={(el) => {
                      imgRefs.current[entry.path] = el;
                    }}
                    src={entry.data_url}
                    alt={friendlyTitle}
                    crossOrigin="anonymous"
                    loading="lazy"
                    onLoad={(e) => {
                      if (isActive) {
                        setSwatches(extractImageSwatches(e.currentTarget));
                      }
                    }}
                    className="w-full h-full object-cover transition-all duration-300 ease-out brightness-100"
                  />
                )}

                {/* Resolution Badge & Active Indicator (Top Left) */}
                <div className="absolute top-2 left-2 flex items-center gap-1 z-10 pointer-events-none">
                  {isActive && (
                    <div
                      className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider backdrop-blur-md shadow-sm flex items-center gap-1"
                      style={{
                        background: 'var(--theme-accent, #A29BFE)',
                        color: '#11111b',
                      }}
                    >
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                      <span>Active</span>
                    </div>
                  )}
                  <div
                    className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider backdrop-blur-md shadow-sm"
                    style={{
                      background: 'rgba(0, 0, 0, 0.65)',
                      color: 'var(--theme-accent, #A29BFE)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                    }}
                  >
                    {resBadge}
                  </div>
                </div>
                {/* Favorite Heart Button (Top Right) */}
                <button
                  type="button"
                  data-tauri-drag-region="false"
                  onClick={(e) => toggleFavorite(e, entry.path)}
                  className={`absolute top-2 right-2 p-1.5 rounded-full backdrop-blur-md transition-all duration-200 z-10 pointer-events-auto cursor-pointer ${
                    isFav ? 'opacity-100 scale-105' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  style={{
                    background: isFav ? 'var(--theme-accent, #A29BFE)' : 'rgba(0, 0, 0, 0.55)',
                    color: isFav ? '#11111b' : '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                  }}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart className={`w-3 h-3 ${isFav ? 'fill-current' : ''}`} />
                </button>
                {/* Subtle bottom scrim & friendly wallpaper name (only shown on hover or when active) */}
                <div
                  className={`absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/75 via-black/35 to-transparent flex items-end justify-between transition-opacity duration-200 pointer-events-none ${
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <span className="text-[11px] font-medium text-white/95 truncate tracking-tight">
                    {friendlyTitle}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* EXPERIMENTAL: per-monitor wallpaper drawer (only rendered when enabled in Settings) */}
      {settings.wallpaperPerMonitor && (
        <div
          data-tauri-drag-region="false"
          className="shrink-0 rounded-[13px] pointer-events-auto relative"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            border: '1px solid var(--theme-border, rgba(255, 255, 255, 0.07))',
          }}
        >
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={() => setShowPerMonitor((prev) => !prev)}
            className="w-full flex items-center justify-between px-3 py-2 pointer-events-auto cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <MonitorIcon
                className="w-3.5 h-3.5"
                strokeWidth={1.9}
                style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
              />
              <span
                className="text-[11px] font-semibold tracking-tight"
                style={{ color: 'var(--theme-text-primary, #F1F2F6)' }}
              >
                Per-Monitor Wallpaper
              </span>
              <span
                className="px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-wider"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.12))',
                  color: 'var(--theme-accent, #A29BFE)',
                }}
              >
                EXPERIMENTAL
              </span>
            </span>
            {showPerMonitor ? (
              <ChevronDown
                className="w-3.5 h-3.5"
                style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
              />
            ) : (
              <ChevronRight
                className="w-3.5 h-3.5"
                style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
              />
            )}
          </button>

          {showPerMonitor && (
            <div className="px-3 pb-3 flex flex-col gap-2">
              {!desktopState ? (
                <span
                  className="text-[11px]"
                  style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
                >
                  Reading display configuration…
                </span>
              ) : !desktopState.per_monitor_supported ? (
                <div
                  className="flex items-start gap-2 rounded-lg px-2.5 py-2"
                  style={{
                    background: 'var(--theme-track, rgba(255, 255, 255, 0.08))',
                    color: 'var(--theme-text-secondary, #9E9EA7)',
                  }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
                  <span className="text-[11px]">
                    Per-monitor wallpaper is not supported on this Windows build.
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    {desktopState.monitors.map((monitor) => {
                      const preview = entryForPath(monitor.path);
                      const busy = busyMonitorId === monitor.id;
                      return (
                        <div
                          key={monitor.id}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                          style={{
                            background: 'var(--theme-card, rgba(255, 255, 255, 0.03))',
                            border: '1px solid var(--theme-border, rgba(255, 255, 255, 0.07))',
                          }}
                        >
                          <div
                            className="w-12 h-7 rounded-md overflow-hidden shrink-0 flex items-center justify-center"
                            style={{
                              background: preview?.data_url
                                ? undefined
                                : 'var(--theme-track, rgba(255, 255, 255, 0.1))',
                              border: '1px solid var(--theme-border, rgba(255, 255, 255, 0.08))',
                            }}
                          >
                            {preview?.data_url ? (
                              <img
                                src={preview.data_url}
                                alt={monitor.label}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <MonitorIcon className="w-3.5 h-3.5 opacity-50" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col">
                            <span
                              className="text-[11px] font-medium truncate"
                              style={{ color: 'var(--theme-text-primary, #F1F2F6)' }}
                            >
                              {monitor.label}
                            </span>
                            <span
                              className="text-[10px] truncate"
                              style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
                            >
                              {preview
                                ? `Current: ${preview.name}`
                                : monitor.path
                                  ? `Current: ${fileNameFromPath(monitor.path)}`
                                  : 'No wallpaper set'}
                            </span>
                          </div>
                          <div className="relative">
                            <button
                              type="button"
                              data-tauri-drag-region="false"
                              disabled={busy}
                              onClick={() =>
                                setPickingMonitorId(
                                  pickingMonitorId === monitor.id ? null : monitor.id,
                                )
                              }
                              title={`Select a specific wallpaper for ${monitor.label}`}
                              className="px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all active:scale-95 pointer-events-auto cursor-pointer"
                              style={{
                                background: 'var(--theme-accent, #74a86c)',
                                color: '#11111b',
                              }}
                            >
                              {busy ? 'Applying…' : 'Select image'}
                            </button>

                            {/* Per-Monitor Image Picker Dropdown */}
                            {pickingMonitorId === monitor.id && (
                              <div
                                data-tauri-drag-region="false"
                                className="absolute right-0 bottom-full mb-1.5 z-50 w-72 max-h-60 overflow-y-auto rounded-xl p-2.5 bento-card shadow-2xl border flex flex-col gap-2 bg-[#18171c]/95 backdrop-blur-xl pointer-events-auto"
                              >
                                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)] pb-1 border-b border-white/10">
                                  <span>Wallpapers for {monitor.label}</span>
                                  <button
                                    type="button"
                                    onClick={() => setPickingMonitorId(null)}
                                    className="hover:text-white p-0.5 text-xs cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                                  {wallpapers.map((wp) => (
                                    <button
                                      key={wp.path}
                                      type="button"
                                      onClick={async () => {
                                        setPickingMonitorId(null);
                                        setBusyMonitorId(monitor.id);
                                        await setMonitorWallpaper(monitor.id, wp.path);
                                        await refreshDesktopState();
                                        setBusyMonitorId(null);
                                      }}
                                      className="flex flex-col rounded-lg overflow-hidden border border-white/10 hover:border-[var(--theme-accent)] transition-all p-1 text-left cursor-pointer group hover:bg-white/[0.04]"
                                    >
                                      <div className="w-full h-14 rounded overflow-hidden bg-black/40">
                                        {wp.data_url ? (
                                          <img
                                            src={wp.data_url}
                                            alt={wp.name}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : null}
                                      </div>
                                      <span className="text-[9px] font-medium truncate mt-1 text-[var(--theme-text-primary)]">
                                        {wp.name}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-0.5">
                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => handleToggleSlideshow(!desktopState.slideshow_enabled)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all active:scale-95 pointer-events-auto cursor-pointer"
                      style={{
                        background: desktopState.slideshow_enabled
                          ? 'var(--theme-accent, #A29BFE)'
                          : 'var(--theme-card, rgba(255, 255, 255, 0.06))',
                        color: desktopState.slideshow_enabled
                          ? '#11111B'
                          : 'var(--theme-text-secondary, #9E9EA7)',
                        border: '1px solid var(--theme-border, rgba(255, 255, 255, 0.07))',
                      }}
                    >
                      {desktopState.slideshow_enabled ? (
                        <Pause className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      <span>{desktopState.slideshow_enabled ? 'Stop' : 'Start'} slideshow</span>
                    </button>

                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={handleToggleShuffle}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all active:scale-95 pointer-events-auto cursor-pointer"
                      style={{
                        background: desktopState.shuffle
                          ? 'var(--theme-track, rgba(255, 255, 255, 0.12))'
                          : 'var(--theme-card, rgba(255, 255, 255, 0.06))',
                        color: desktopState.shuffle
                          ? 'var(--theme-accent, #A29BFE)'
                          : 'var(--theme-text-secondary, #9E9EA7)',
                        border: `1px solid ${
                          desktopState.shuffle
                            ? 'var(--theme-accent, #A29BFE)'
                            : 'var(--theme-border, rgba(255, 255, 255, 0.07))'
                        }`,
                      }}
                    >
                      <Shuffle className="w-3 h-3" />
                      <span>Shuffle</span>
                    </button>

                    <label
                      className="flex items-center gap-1.5 text-[10px]"
                      style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
                    >
                      <span>Every</span>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        data-tauri-drag-region="false"
                        value={slideshowMinutes}
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          setSlideshowMinutes(Number.isFinite(parsed) ? parsed : 1);
                        }}
                        onBlur={commitSlideshowMinutes}
                        className="w-14 px-1.5 py-0.5 rounded-md text-[10px] text-center focus:outline-none pointer-events-auto"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--theme-border, rgba(255, 255, 255, 0.12))',
                          color: 'var(--theme-text-primary, #F1F2F6)',
                        }}
                      />
                      <span>min</span>
                    </label>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
