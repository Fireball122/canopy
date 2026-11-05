import { Check, FolderOpen, Heart, Image as ImageIcon, RefreshCw, Search, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import {
  pickWallpaperFolder,
  setWallpaperDirectory,
  type WallpaperEntry,
} from '../services/hostBridge';
import { applyThemeModeFallback } from '../services/palette';

export interface WallpaperViewProps {
  wallpapers: WallpaperEntry[];
  onApplyWallpaper: (
    entry: WallpaperEntry,
    imgEl?: HTMLImageElement | null,
  ) => void | Promise<void>;
  onRefreshWallpapers: () => void;
  onNavigateToSettings?: () => void;
  onDirectoryChanged?: (newDir: string, entries: WallpaperEntry[]) => void;
  statusText?: string;
  onToastNotification: (msg: string) => void;
}

const FALLBACK_GRADIENTS: string[] = [
  'linear-gradient(135deg, #1e1e2e 0%, #45275d 45%, #cba6f7 100%)',
  'linear-gradient(135deg, #11111b 0%, #1e3a5f 50%, #89dceb 100%)',
  'linear-gradient(135deg, #181825 0%, #3b224c 50%, #f5c2e7 100%)',
  'linear-gradient(135deg, #11111b 0%, #23392d 50%, #a6e3a1 100%)',
  'linear-gradient(135deg, #1e1e2e 0%, #5c2a41 50%, #fab387 100%)',
  'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #89b4fa 100%)',
];

function formatFriendlyName(rawName: string): string {
  const withoutExt = rawName.replace(/\.[a-zA-Z0-9]+$/, '');
  return withoutExt.replace(/[-_]+/g, ' ').trim() || 'Wallpaper';
}

export const WallpaperView: React.FC<WallpaperViewProps> = ({
  wallpapers,
  onApplyWallpaper,
  onRefreshWallpapers,
  onDirectoryChanged,
  onToastNotification,
  statusText,
}) => {
  const { settings, updateSettings } = useSettings();
  const imgRefs = useRef<Record<string, HTMLImageElement | null>>({});
  const transitionTimerRef = useRef<number | null>(null);
  // Monotonic token so a superseded selection does not clear the newer one's transition state.
  const themeRequestRef = useRef<number>(0);
  const rescanTimerRef = useRef<number | null>(null);
  const mountedRef = useRef<boolean>(false);

  const [transitioningPath, setTransitioningPath] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState<boolean>(false);
  const [browsingFolder, setBrowsingFolder] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterFavoritesOnly, setFilterFavoritesOnly] = useState<boolean>(false);
  const isFavorite = useCallback(
    (path: string) => settings.wallpaperFavorites?.includes(path) ?? false,
    [settings.wallpaperFavorites],
  );

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
  }, [wallpapers, searchQuery, filterFavoritesOnly, isFavorite]);

  const getResolutionBadge = (res?: string): string => {
    if (!res) return 'FHD';
    if (res.includes('3840') || res.includes('4096') || res.includes('7680')) return '4K';
    if (res.includes('3440') || res.includes('5120')) return 'UW';
    if (res.includes('2560')) return 'QHD';
    return 'FHD';
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      if (rescanTimerRef.current !== null) {
        window.clearTimeout(rescanTimerRef.current);
        rescanTimerRef.current = null;
      }
    };
  }, []);

  const handleSelectWallpaper = async (entry: WallpaperEntry) => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }
    setTransitioningPath(entry.path);

    updateSettings({ activeWallpaperPath: entry.path });
    const token = ++themeRequestRef.current;
    const imgEl = imgRefs.current[entry.path] ?? null;
    if (!entry.data_url && !(imgEl?.complete && imgEl.naturalWidth > 0)) {
      // No pixels to sample: fall back to the selected theme mode, keeping the custom accent.
      applyThemeModeFallback(
        settings.themeMode,
        settings.glassOpacity,
        settings.glassBlurStrength,
        settings.customAccentColor,
        settings.trueOledMode,
      );
    }

    // The shell owns the apply (palette with custom accent / OLED, the single host call and the
    // success/failure status). Applying here too set the desktop wallpaper twice per click.
    try {
      await onApplyWallpaper(entry, imgEl);
    } catch (err) {
      onToastNotification(
        `Could not apply wallpaper: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (themeRequestRef.current === token && mountedRef.current) {
        if (transitionTimerRef.current !== null) {
          window.clearTimeout(transitionTimerRef.current);
        }
        transitionTimerRef.current = window.setTimeout(() => {
          transitionTimerRef.current = null;
          setTransitioningPath(null);
        }, 450);
      }
    }
  };

  const handleBrowseFolder = async () => {
    setBrowsingFolder(true);
    try {
      const chosen = await pickWallpaperFolder(settings.wallpaperDirectory);
      // The picker resolves to null when the user cancels; that is not an error.
      if (!chosen) return;
      const entries = await setWallpaperDirectory(chosen);
      updateSettings({ wallpaperDirectory: chosen });
      onDirectoryChanged?.(chosen, entries);
    } catch (err) {
      onToastNotification(
        `Could not change wallpaper folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleRescan = () => {
    setRescanning(true);
    onRefreshWallpapers();
    if (rescanTimerRef.current !== null) {
      window.clearTimeout(rescanTimerRef.current);
    }
    rescanTimerRef.current = window.setTimeout(() => {
      rescanTimerRef.current = null;
      setRescanning(false);
    }, 450);
  };

  return (
    <div className="w-full h-full flex flex-col gap-3 pointer-events-auto select-none overflow-hidden">
      {/* Minimal Top Bar: 3 Dynamic Palette Pills + Minimal Folder / Refresh Controls */}
      <div className="flex items-center justify-between px-1 shrink-0">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-[var(--theme-accent)]" />
          <span
            className="text-xs font-semibold tracking-tight"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            Wallpaper Gallery
          </span>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-mono border"
            style={{
              borderColor: 'var(--theme-border)',
              background: 'var(--theme-track)',
              color: 'var(--theme-text-secondary)',
            }}
          >
            {filteredWallpapers.length}
          </span>
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search wallpapers..."
              className="w-full bg-transparent text-[11px] focus:outline-none pointer-events-auto"
              style={{ color: 'var(--theme-text-primary, #F1F2F6)' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="opacity-60 hover:opacity-100 pointer-events-auto cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="button"
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-1 pointer-events-auto">
        {filteredWallpapers.length === 0 && (
          <div
            className="h-full flex flex-col items-center justify-center gap-1.5 text-center px-4"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            <ImageIcon className="w-6 h-6 opacity-60" style={{ color: 'var(--theme-accent)' }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
              {wallpapers.length === 0 ? 'No wallpapers found' : 'No wallpapers match'}
            </span>
            <span className="text-[11px]">
              {wallpapers.length === 0
                ? 'Pick a folder with images using the Folder button above.'
                : 'Clear the search or turn off the favorites filter.'}
            </span>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          {filteredWallpapers.map((entry, idx) => {
            const isActive = Boolean(entry.active);
            const isFav = isFavorite(entry.path);
            const isApplying = transitioningPath === entry.path;
            const friendlyTitle = formatFriendlyName(entry.name);
            const resBadge = getResolutionBadge(entry.resolution);
            const fallbackBg = FALLBACK_GRADIENTS[idx % FALLBACK_GRADIENTS.length];
            return (
              // A div (not a button) so the nested favourite button is valid, focusable markup.
              <div
                key={entry.path}
                role="button"
                tabIndex={0}
                aria-label={`Apply wallpaper ${friendlyTitle}`}
                onClick={() => void handleSelectWallpaper(entry)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void handleSelectWallpaper(entry);
                  }
                }}
                className="group relative w-full aspect-video rounded-[13px] overflow-hidden focus:outline-none pointer-events-auto cursor-pointer"
                style={{
                  background: entry.data_url ? undefined : fallbackBg,
                  transform: isApplying ? 'scale(0.97)' : 'scale(1)',
                  transition: 'transform 200ms ease, box-shadow 250ms ease, opacity 300ms ease',
                  boxShadow: isActive
                    ? '0 0 0 2px var(--theme-accent), 0 4px 16px rgba(0, 0, 0, 0.4)'
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
                    className="w-full h-full object-cover transition-all duration-300 ease-out brightness-100"
                  />
                )}

                {/* Resolution Badge & Active Indicator (Top Left) */}
                <div className="absolute top-2 left-2 flex items-center gap-1 z-10 pointer-events-none">
                  {isActive && (
                    <div
                      className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider backdrop-blur-md shadow-sm flex items-center gap-1"
                      style={{
                        background: 'var(--theme-accent)',
                        color: 'var(--theme-on-accent, #111)',
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
                      color: 'var(--theme-accent)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                    }}
                  >
                    {resBadge}
                  </div>
                </div>
                {/* Favorite Heart Button (Top Right) */}
                <button
                  type="button"
                  onClick={(e) => toggleFavorite(e, entry.path)}
                  className={`absolute top-2 right-2 p-1.5 rounded-full backdrop-blur-md transition-all duration-200 z-10 pointer-events-auto cursor-pointer ${
                    isFav
                      ? 'opacity-100 scale-105'
                      : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  }`}
                  style={{
                    background: isFav ? 'var(--theme-accent)' : 'rgba(0, 0, 0, 0.55)',
                    color: isFav ? 'var(--theme-on-accent, #111)' : '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                  }}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
