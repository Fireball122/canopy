import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import {
  applyThemeFromImageSrc,
  applyThemeModeFallback,
  applyThemePalette,
} from '../services/palette';
import {
  WallpaperEntry,
  pickWallpaperFolder,
  setDesktopWallpaper,
  setWallpaperDirectory,
} from '../services/tauriBridge';

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
}) => {
  const { settings, updateSettings } = useSettings();
  const imgRefs = useRef<Record<string, HTMLImageElement | null>>({});
  const transitionTimerRef = useRef<number | null>(null);

  const activeWallpaper = wallpapers.find((w) => w.active) || wallpapers[0] || null;
  const [transitioningPath, setTransitioningPath] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState<boolean>(false);
  const [browsingFolder, setBrowsingFolder] = useState<boolean>(false);
  const [swatches, setSwatches] = useState<ExtractedSwatches>({
    dominant: 'var(--theme-accent, #A29BFE)',
    accent: '#89DCEB',
    surface: 'var(--theme-bg, #181824)',
  });

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

  const handleSelectWallpaper = async (entry: WallpaperEntry) => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }
    setTransitioningPath(entry.path);

    const imgEl = imgRefs.current[entry.path] ?? null;
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      applyThemePalette(imgEl, settings.themeMode);
      setSwatches(extractImageSwatches(imgEl));
    } else if (entry.data_url) {
      await applyThemeFromImageSrc(entry.data_url, settings.themeMode);
    } else {
      applyThemeModeFallback(
        settings.themeMode,
        settings.glassOpacity,
        settings.glassBlurStrength
      );
    }

    try {
      await setDesktopWallpaper(entry.path);
    } catch {
      // Handled gracefully
    }

    onApplyWallpaper(entry, imgEl);
    transitionTimerRef.current = window.setTimeout(() => {
      setTransitioningPath(null);
    }, 450);
  };

  const handlePalettePillClick = async (mode: 'auto' | 'dark' | 'light') => {
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
    applyThemeModeFallback(
      mode,
      settings.glassOpacity,
      settings.glassBlurStrength
    );
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

  const palettePills: {
    id: 'auto' | 'dark' | 'light';
    label: string;
    swatchColor: string;
  }[] = [
    {
      id: 'auto',
      label: 'Adaptive',
      swatchColor: swatches.dominant,
    },
    {
      id: 'dark',
      label: 'Obsidian',
      swatchColor: swatches.surface,
    },
    {
      id: 'light',
      label: 'Alabaster',
      swatchColor: swatches.accent,
    },
  ];

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full flex flex-col gap-3 pointer-events-auto select-none overflow-hidden"
    >
      {/* Minimal Top Bar: 3 Dynamic Palette Pills + Minimal Folder / Refresh Controls */}
      <div className="flex items-center justify-between px-1 shrink-0">
        {/* 3 Dynamic Palette Pills */}
        <div className="flex items-center gap-2">
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
                    ? 'var(--theme-track, rgba(255, 255, 255, 0.12))'
                    : 'var(--theme-card, rgba(255, 255, 255, 0.04))',
                  border: isSelected
                    ? '1.5px solid var(--theme-accent, #A29BFE)'
                    : '1px solid var(--theme-border, rgba(255, 255, 255, 0.07))',
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

        {/* Minimal Folder & Rescan Controls */}
        <div className="flex items-center gap-1.5">
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
          {wallpapers.map((entry, idx) => {
            const isActive = Boolean(entry.active);
            const isApplying = transitioningPath === entry.path;
            const friendlyTitle = formatFriendlyName(entry.name);
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
                  transform: 'scale(1)',
                  transition:
                    'transform 200ms ease, box-shadow 250ms ease, opacity 300ms ease',
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
                    className={`w-full h-full object-cover transition-all duration-500 ease-out ${
                      isApplying
                        ? 'scale-105 blur-[2px] brightness-110'
                        : 'scale-100 blur-0 brightness-100'
                    }`}
                  />
                )}

                {/* Smooth luminous crossfade pulse when selected */}
                <div
                  className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${
                    isApplying ? 'opacity-35' : 'opacity-0'
                  }`}
                  style={{
                    background:
                      'radial-gradient(circle at center, var(--theme-accent, #A29BFE) 0%, transparent 75%)',
                  }}
                />

                {/* Subtle bottom scrim & friendly wallpaper name (only shown on hover or when active) */}
                <div
                  className={`absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/75 via-black/35 to-transparent flex items-end justify-between transition-opacity duration-200 pointer-events-none ${
                    isActive
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
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
    </div>
  );
};
