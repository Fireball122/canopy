import React, { useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Image as ImageIcon,
  Moon,
  Palette,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react';
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

export const WallpaperView: React.FC<WallpaperViewProps> = ({
  wallpapers,
  onApplyWallpaper,
  onRefreshWallpapers,
  onNavigateToSettings,
  onDirectoryChanged,
  statusText,
}) => {
  const { settings, updateSettings } = useSettings();
  const imgRefs = useRef<Record<string, HTMLImageElement | null>>({});
  const heroImgRef = useRef<HTMLImageElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);

  const [applyingPath, setApplyingPath] = useState<string | null>(null);
  const [heroTransitioning, setHeroTransitioning] = useState<boolean>(false);
  const [rescanning, setRescanning] = useState<boolean>(false);
  const [browsingFolder, setBrowsingFolder] = useState<boolean>(false);
  const [folderFeedback, setFolderFeedback] = useState<string | null>(null);

  const activeWallpaper = wallpapers.find((w) => w.active) || wallpapers[0];
  const activeIndex = activeWallpaper
    ? Math.max(
        0,
        wallpapers.findIndex((w) => w.path === activeWallpaper.path)
      )
    : 0;
  const activeFallbackBg =
    FALLBACK_GRADIENTS[activeIndex % FALLBACK_GRADIENTS.length];

  const handleSelectWallpaper = async (entry: WallpaperEntry) => {
    setApplyingPath(entry.path);
    setHeroTransitioning(true);
    const imgEl = imgRefs.current[entry.path] ?? null;

    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      applyThemePalette(imgEl, settings.themeMode);
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
      // Handled gracefully in fallback mode
    }

    onApplyWallpaper(entry, imgEl);
    window.setTimeout(() => {
      setApplyingPath(null);
      setHeroTransitioning(false);
    }, 360);
  };

  const handleBrowseFolder = async () => {
    setBrowsingFolder(true);
    try {
      const chosen = await pickWallpaperFolder(settings.wallpaperDirectory);
      if (chosen) {
        updateSettings({ wallpaperDirectory: chosen });
        const entries = await setWallpaperDirectory(chosen);
        onDirectoryChanged?.(chosen, entries);
        setFolderFeedback(`Loaded ${entries.length} wallpapers`);
        window.setTimeout(() => setFolderFeedback(null), 2800);
      }
    } catch {
      setFolderFeedback('Could not open folder picker');
      window.setTimeout(() => setFolderFeedback(null), 2800);
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleThemeModeChange = async (mode: 'auto' | 'dark' | 'light') => {
    updateSettings({ themeMode: mode });
    if (activeWallpaper) {
      const imgEl =
        heroImgRef.current ?? imgRefs.current[activeWallpaper.path] ?? null;
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

  const handleRescan = () => {
    setRescanning(true);
    onRefreshWallpapers();
    window.setTimeout(() => setRescanning(false), 500);
  };

  const handleScrollCarousel = (direction: 'left' | 'right') => {
    const container = carouselRef.current;
    if (!container) return;
    const scrollAmount = direction === 'left' ? -390 : 390;
    container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  const badgeStatusText = statusText || folderFeedback;

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full flex flex-col gap-2.5 pointer-events-auto select-none overflow-hidden"
    >
      {/* ===================================================================== */}
      {/* TOP SECTION: FEATURED ACTIVE WALLPAPER SHOWCASE CARD                  */}
      {/* ===================================================================== */}
      <div
        className="bento-card p-3 flex items-center justify-between gap-3.5 shrink-0"
        style={{
          background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
          borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
        }}
      >
        {/* Left: Featured Active Wallpaper Preview (w-[220px] h-[118px]) */}
        <div
          className="relative w-[220px] h-[118px] rounded-xl overflow-hidden shrink-0 border"
          style={{
            background: activeWallpaper?.data_url ? undefined : activeFallbackBg,
            borderColor: 'var(--theme-accent, #cba6f7)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.32)',
          }}
        >
          {activeWallpaper?.data_url && (
            <img
              ref={heroImgRef}
              src={activeWallpaper.data_url}
              alt={activeWallpaper.name}
              crossOrigin="anonymous"
              className={`w-full h-full object-cover transition-all duration-300 ${
                heroTransitioning
                  ? 'scale-105 opacity-80'
                  : 'scale-100 opacity-100'
              }`}
              onLoad={(e) => {
                applyThemePalette(e.currentTarget, settings.themeMode);
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

          <div
            className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider flex items-center gap-1 shadow-md"
            style={{
              background: 'var(--theme-accent, #cba6f7)',
              color: '#11111b',
            }}
          >
            <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
            <span>Active Showcase</span>
          </div>

          <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[10px] font-mono text-white/90">
            <span className="truncate font-semibold">
              {activeWallpaper ? activeWallpaper.name : 'Default Theme'}
            </span>
            {wallpapers.length > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-black/55 text-[9px] tabular-nums shrink-0">
                {activeIndex + 1}/{wallpapers.length}
              </span>
            )}
          </div>
        </div>

        {/* Center: Active Wallpaper Title, Directory Path Badge & Adaptive Swatches */}
        <div className="flex-1 min-w-0 h-[118px] flex flex-col justify-between py-0.5">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-mono uppercase tracking-widest font-semibold"
                style={{ color: 'var(--theme-accent, #cba6f7)' }}
              >
                Featured Wallpaper
              </span>
              {badgeStatusText && (
                <span
                  className="px-2 py-0.5 rounded-full text-[9px] font-mono border truncate"
                  style={{
                    background: 'rgba(166, 227, 161, 0.14)',
                    borderColor: 'rgba(166, 227, 161, 0.35)',
                    color: '#a6e3a1',
                  }}
                >
                  {badgeStatusText}
                </span>
              )}
            </div>

            <div
              className="text-base font-bold truncate mt-0.5"
              style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
              title={activeWallpaper?.name || 'No Active Wallpaper'}
            >
              {activeWallpaper?.name || 'No Active Wallpaper'}
            </div>
          </div>

          {/* Directory Path Badge */}
          <div
            className="px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2"
            style={{
              background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <FolderOpen
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: 'var(--theme-accent, #cba6f7)' }}
                strokeWidth={2}
              />
              <span
                className="text-[11px] font-mono truncate"
                style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
                title={settings.wallpaperDirectory || 'Pictures/Wallpapers'}
              >
                {settings.wallpaperDirectory || 'Pictures/Wallpapers'}
              </span>
            </div>
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-mono tabular-nums shrink-0"
              style={{
                background: 'var(--theme-card, rgba(0, 0, 0, 0.25))',
                color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.75))',
              }}
            >
              {wallpapers.length} items
            </span>
          </div>

          {/* Extracted Adaptive Theme Swatches */}
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-mono uppercase tracking-wider flex items-center gap-1 shrink-0"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))' }}
            >
              <Palette
                className="w-3 h-3"
                style={{ color: 'var(--theme-accent, #cba6f7)' }}
                strokeWidth={2}
              />
              <span>Palette:</span>
            </span>

            <div className="flex items-center gap-1.5">
              {(
                [
                  { label: 'Surface', cssVar: 'var(--theme-bg, #121218)' },
                  { label: 'Accent', cssVar: 'var(--theme-accent, #cba6f7)' },
                  { label: 'Primary', cssVar: 'var(--theme-text-primary, #f8fafc)' },
                ] as const
              ).map((swatch) => (
                <div
                  key={swatch.label}
                  className="px-2 py-0.5 rounded-md border flex items-center gap-1.5 text-[9px] font-mono"
                  style={{
                    background: 'var(--theme-track, rgba(255, 255, 255, 0.05))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                    color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))',
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-white/25 shrink-0"
                    style={{ background: swatch.cssVar }}
                  />
                  <span>{swatch.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Quick Action Controls ([ Browse Folder ] + [ Rescan ] & Theme Mode [ Auto | Dark | Light ]) */}
        <div className="h-[118px] flex flex-col justify-between items-end shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={handleBrowseFolder}
              disabled={browsingFolder}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 border transition-all active:scale-95 pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-accent, #cba6f7)',
                borderColor: 'var(--theme-accent, #cba6f7)',
                color: '#11111b',
              }}
              title="Browse for wallpaper directory"
            >
              <FolderOpen className="w-3.5 h-3.5" strokeWidth={2} />
              <span>{browsingFolder ? 'Opening…' : 'Browse Folder'}</span>
            </button>

            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={handleRescan}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 border transition-all active:scale-95 pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                color: 'var(--theme-text-primary, #cdd6f4)',
              }}
              title="Rescan active wallpaper directory"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${rescanning ? 'animate-spin' : ''}`}
                style={{ color: 'var(--theme-accent, #cba6f7)' }}
                strokeWidth={2}
              />
              <span>Rescan</span>
            </button>

            {onNavigateToSettings && (
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={onNavigateToSettings}
                className="p-1.5 rounded-lg border transition-all active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
                title="Open Appearance Settings"
              >
                <Settings
                  className="w-3.5 h-3.5"
                  style={{ color: 'var(--theme-accent, #cba6f7)' }}
                  strokeWidth={2}
                />
              </button>
            )}
          </div>

          {/* Theme Mode Segmented Pill: [ Auto | Dark | Light ] */}
          <div className="flex flex-col items-end gap-1">
            <span
              className="text-[9px] font-mono uppercase tracking-wider"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
            >
              Theme Mode
            </span>
            <div
              className="flex items-center p-0.5 rounded-xl border"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.24))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {(
                [
                  {
                    id: 'auto',
                    label: 'Auto',
                    icon: <Sparkles className="w-3 h-3" strokeWidth={2} />,
                  },
                  {
                    id: 'dark',
                    label: 'Dark',
                    icon: <Moon className="w-3 h-3" strokeWidth={2} />,
                  },
                  {
                    id: 'light',
                    label: 'Light',
                    icon: <Sun className="w-3 h-3" strokeWidth={2} />,
                  },
                ] as const
              ).map((option) => {
                const isSelected = settings.themeMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => handleThemeModeChange(option.id)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-all pointer-events-auto cursor-pointer"
                    style={
                      isSelected
                        ? {
                            background: 'var(--theme-accent, #cba6f7)',
                            color: '#11111b',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.22)',
                          }
                        : {
                            color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                          }
                    }
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* BOTTOM SECTION: SMOOTH HORIZONTAL PREVIEW GALLERY CAROUSEL            */}
      {/* ===================================================================== */}
      <div
        className="bento-card flex-1 min-h-0 px-3.5 py-2.5 flex flex-col justify-between gap-2 overflow-hidden"
        style={{
          background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
          borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
        }}
      >
        {/* Carousel Header & Navigation Controls */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <ImageIcon className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Preview Gallery</span>
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
            >
              Click any 16:9 card to apply desktop wallpaper &amp; adaptive theme
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={() => handleScrollCarousel('left')}
              className="w-6 h-6 rounded-lg border flex items-center justify-center transition-all active:scale-90 pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                color: 'var(--theme-text-primary, #cdd6f4)',
              }}
              title="Scroll Gallery Left"
            >
              <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={() => handleScrollCarousel('right')}
              className="w-6 h-6 rounded-lg border flex items-center justify-center transition-all active:scale-90 pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                color: 'var(--theme-text-primary, #cdd6f4)',
              }}
              title="Scroll Gallery Right"
            >
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {/* Horizontal Carousel Track */}
        {wallpapers.length === 0 ? (
          <div className="w-full flex-1 flex flex-col items-center justify-center text-center gap-2">
            <ImageIcon
              className="w-6 h-6 opacity-50"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            />
            <div
              className="text-xs font-semibold"
              style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
            >
              No wallpapers found in this directory
            </div>
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={handleBrowseFolder}
              className="px-3 py-1 rounded-lg text-xs font-semibold transition-all pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-accent, #cba6f7)',
                color: '#11111b',
              }}
            >
              Browse Wallpaper Folder
            </button>
          </div>
        ) : (
          <div
            ref={carouselRef}
            data-tauri-drag-region="false"
            onWheel={(e) => {
              if (carouselRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                carouselRef.current.scrollLeft += e.deltaY;
              }
            }}
            className="flex items-center gap-3 overflow-x-auto overflow-y-hidden scroll-smooth flex-1 min-h-0 py-1 px-0.5 pointer-events-auto"
          >
            {wallpapers.map((wp, idx) => {
              const isActive = wp.active;
              const isApplying = applyingPath === wp.path;
              const fallbackBg =
                FALLBACK_GRADIENTS[idx % FALLBACK_GRADIENTS.length];

              return (
                <button
                  key={wp.path}
                  type="button"
                  data-tauri-drag-region="false"
                  onClick={() => handleSelectWallpaper(wp)}
                  className={`group relative w-[205px] h-[115px] aspect-video shrink-0 rounded-xl overflow-hidden text-left transition-all duration-300 flex flex-col justify-end p-2.5 pointer-events-auto cursor-pointer ${
                    isApplying
                      ? 'scale-[0.97] opacity-85'
                      : 'hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                  style={{
                    background: wp.data_url ? undefined : fallbackBg,
                    border: isActive
                      ? '2px solid var(--theme-accent, #cba6f7)'
                      : '1px solid var(--theme-border, rgba(255, 255, 255, 0.12))',
                    boxShadow: isActive
                      ? '0 0 18px rgba(203, 166, 247, 0.32)'
                      : '0 4px 14px rgba(0, 0, 0, 0.25)',
                  }}
                >
                  {wp.data_url && (
                    <img
                      ref={(el) => {
                        imgRefs.current[wp.path] = el;
                      }}
                      src={wp.data_url}
                      alt={wp.name}
                      crossOrigin="anonymous"
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onLoad={(e) => {
                        if (isActive) {
                          applyThemePalette(e.currentTarget, settings.themeMode);
                        }
                      }}
                    />
                  )}

                  {/* Scrim overlay for text legibility */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />

                  {/* Active Checkmark Badge in Top-Right Corner */}
                  {isActive && (
                    <div
                      className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold flex items-center gap-1 shadow-md z-10"
                      style={{
                        background: 'var(--theme-accent, #cba6f7)',
                        color: '#11111b',
                      }}
                    >
                      <Check className="w-3 h-3" strokeWidth={2.75} />
                      <span>ACTIVE</span>
                    </div>
                  )}

                  {/* Bottom Metadata */}
                  <div className="relative z-10 w-full">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-white truncate">
                        {wp.name}
                      </span>
                      {isApplying && (
                        <span className="text-[9px] font-mono text-[#a6e3a1] shrink-0">
                          Applying…
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] font-mono text-zinc-300/80 truncate mt-0.5">
                      {wp.path}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
