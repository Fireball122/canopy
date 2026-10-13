import React, { useRef, useState } from 'react';
import {
  Calendar,
  Clock,
  CloudSun,
  FolderOpen,
  Image as ImageIcon,
  MapPin,
  Monitor,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  Upload,
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { applyThemeModeFallback } from '../services/palette';
import {
  WallpaperEntry,
  pickWallpaperFolder,
  setLaunchOnStartup,
  setTopHoverTrigger,
  setWallpaperDirectory,
} from '../services/tauriBridge';

export interface SettingsViewProps {
  onDirectoryChanged?: (newDir: string, entries: WallpaperEntry[]) => void;
  onThemeChanged?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onDirectoryChanged,
  onThemeChanged,
}) => {
  const { settings, updateSettings, resetSettings } = useSettings();
  const gifFileInputRef = useRef<HTMLInputElement | null>(null);
  const [browsingFolder, setBrowsingFolder] = useState<boolean>(false);
  const [folderFeedback, setFolderFeedback] = useState<string | null>(null);
  const [gifFeedback, setGifFeedback] = useState<string | null>(null);
  const [resetFeedback, setResetFeedback] = useState<boolean>(false);
  const handleBrowseWallpaperDirectory = async () => {
    setBrowsingFolder(true);
    try {
      const chosen = await pickWallpaperFolder(settings.wallpaperDirectory);
      if (chosen) {
        updateSettings({ wallpaperDirectory: chosen });
        const entries = await setWallpaperDirectory(chosen);
        onDirectoryChanged?.(chosen, entries);
        setFolderFeedback(`Loaded ${entries.length} wallpapers`);
        window.setTimeout(() => setFolderFeedback(null), 3000);
      }
    } catch {
      setFolderFeedback('Could not open folder picker');
      window.setTimeout(() => setFolderFeedback(null), 3000);
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleApplyManualDirectory = async (dirPath: string) => {
    const trimmed = dirPath.trim();
    updateSettings({ wallpaperDirectory: trimmed });
    if (!trimmed) return;
    try {
      const entries = await setWallpaperDirectory(trimmed);
      onDirectoryChanged?.(trimmed, entries);
      setFolderFeedback(`Scanned ${entries.length} wallpapers`);
      window.setTimeout(() => setFolderFeedback(null), 2500);
    } catch {
      // Ignore if directory does not exist yet
    }
  };

  const handleThemeModeSelect = (mode: 'auto' | 'dark' | 'light') => {
    updateSettings({ themeMode: mode });
    applyThemeModeFallback(mode, settings.glassOpacity, settings.glassBlurStrength);
    onThemeChanged?.();
  };

  const handleBlurChange = (blurPx: number) => {
    const clamped = Math.min(32, Math.max(16, blurPx));
    updateSettings({ glassBlurStrength: clamped });
    applyThemeModeFallback(settings.themeMode, settings.glassOpacity, clamped);
    onThemeChanged?.();
  };

  const handleOpacityChange = (opacityPercent: number) => {
    const ratio = Number(
      Math.min(0.95, Math.max(0.7, opacityPercent / 100)).toFixed(2)
    );
    updateSettings({ glassOpacity: ratio });
    applyThemeModeFallback(settings.themeMode, ratio, settings.glassBlurStrength);
    onThemeChanged?.();
  };

  const handleToggleStartup = async () => {
    const next = !settings.launchOnStartup;
    updateSettings({ launchOnStartup: next });
    try {
      await setLaunchOnStartup(next);
    } catch {
      // Fallback handled in browser mode
    }
  };

  const handleToggleTopHover = async () => {
    const next = !settings.topHoverTrigger;
    updateSettings({ topHoverTrigger: next });
    try {
      await setTopHoverTrigger(next);
    } catch {
      // Fallback handled in browser mode
    }
  };


  const handleGifFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateSettings({ customMascotGifUrl: reader.result });
        setGifFeedback(`Loaded ${file.name}`);
        window.setTimeout(() => setGifFeedback(null), 2800);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const handleResetAll = () => {
    resetSettings();
    applyThemeModeFallback('auto', 0.86, 24);
    onThemeChanged?.();
    setResetFeedback(true);
    window.setTimeout(() => setResetFeedback(false), 2200);
  };

  const opacityPercent = Math.round((settings.glassOpacity || 0.86) * 100);
  const blurStrength = Math.round(settings.glassBlurStrength || 24);

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full overflow-y-auto pr-1 pointer-events-auto select-none"
    >
      <div className="grid grid-cols-2 gap-2.5 pb-1">
        {/* ===================================================================== */}
        {/* CARD 1: TIME & REGIONAL                                               */}
        {/* ===================================================================== */}
        <div
          className="bento-card p-3.5 flex flex-col justify-between gap-2.5"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <Clock className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Time &amp; Regional</span>
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
            >
              Clock &amp; Calendar
            </span>
          </div>

          {/* Clock Format Segmented Pill Toggle */}
          <div className="space-y-1">
            <label
              className="text-[11px] font-medium block"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
            >
              Clock Format
            </label>
            <div
              className="grid grid-cols-2 p-0.5 rounded-xl border"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {(
                [
                  { id: '12h', label: '12-Hour (07:20 PM)' },
                  { id: '24h', label: '24-Hour (19:20)' },
                ] as const
              ).map((item) => {
                const active = settings.clockFormat === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => updateSettings({ clockFormat: item.id })}
                    className="py-1 px-2 rounded-lg text-[10px] font-semibold transition-all pointer-events-auto cursor-pointer"
                    style={
                      active
                        ? {
                            background: 'var(--theme-accent, #cba6f7)',
                            color: '#11111b',
                          }
                        : {
                            color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                          }
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Show Seconds Toggle Switch */}
          <div className="flex items-center justify-between py-0.5">
            <div>
              <div
                className="text-xs font-medium"
                style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
              >
                Show Seconds
              </div>
              <div
                className="text-[10px]"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Display live seconds ticker on Dashboard clock
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showSeconds}
              data-tauri-drag-region="false"
              onClick={() => updateSettings({ showSeconds: !settings.showSeconds })}
              className="w-10 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0"
              style={{
                background: settings.showSeconds
                  ? 'var(--theme-accent, #cba6f7)'
                  : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
              }}
            >
              <span
                className={`w-4 h-4 rounded-full transition-transform ${
                  settings.showSeconds
                    ? 'translate-x-5 bg-[#11111b]'
                    : 'translate-x-0 bg-white/80'
                }`}
              />
            </button>
          </div>

          {/* Calendar Start Segmented Pill Toggle */}
          <div className="space-y-1">
            <label
              className="text-[11px] font-medium flex items-center gap-1"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
            >
              <Calendar className="w-3 h-3" strokeWidth={2} />
              <span>Calendar First Day of Week</span>
            </label>
            <div
              className="grid grid-cols-2 p-0.5 rounded-xl border"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {(
                [
                  { id: 'sunday', label: 'Sunday' },
                  { id: 'monday', label: 'Monday' },
                ] as const
              ).map((item) => {
                const active = settings.calendarFirstDay === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => updateSettings({ calendarFirstDay: item.id })}
                    className="py-1 px-2 rounded-lg text-[10px] font-semibold transition-all pointer-events-auto cursor-pointer"
                    style={
                      active
                        ? {
                            background: 'var(--theme-accent, #cba6f7)',
                            color: '#11111b',
                          }
                        : {
                            color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                          }
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* CARD 2: WEATHER CONFIGURATION                                         */}
        {/* ===================================================================== */}
        <div
          className="bento-card p-3.5 flex flex-col justify-between gap-2.5"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <CloudSun className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Weather Configuration</span>
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
            >
              Open-Meteo + IP Geo
            </span>
          </div>

          {/* Temperature Unit Segmented Pill Toggle */}
          <div className="space-y-1">
            <label
              className="text-[11px] font-medium block"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
            >
              Temperature Unit
            </label>
            <div
              className="grid grid-cols-2 p-0.5 rounded-xl border"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {(
                [
                  { id: 'fahrenheit', label: 'Fahrenheit (°F)' },
                  { id: 'celsius', label: 'Celsius (°C)' },
                ] as const
              ).map((item) => {
                const active = settings.temperatureUnit === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => updateSettings({ temperatureUnit: item.id })}
                    className="py-1 px-2 rounded-lg text-[10px] font-semibold transition-all pointer-events-auto cursor-pointer"
                    style={
                      active
                        ? {
                            background: 'var(--theme-accent, #cba6f7)',
                            color: '#11111b',
                          }
                        : {
                            color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                          }
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Location Detection Mode Toggle */}
          <div className="space-y-1">
            <label
              className="text-[11px] font-medium flex items-center gap-1"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
            >
              <MapPin className="w-3 h-3" strokeWidth={2} />
              <span>Location Detection</span>
            </label>
            <div
              className="grid grid-cols-2 p-0.5 rounded-xl border"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {(
                [
                  { id: 'auto', label: 'Auto IP Detection' },
                  { id: 'manual', label: 'Manual Coordinates/City' },
                ] as const
              ).map((item) => {
                const active = settings.weatherLocationMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => updateSettings({ weatherLocationMode: item.id })}
                    className="py-1 px-2 rounded-lg text-[10px] font-semibold transition-all pointer-events-auto cursor-pointer"
                    style={
                      active
                        ? {
                            background: 'var(--theme-accent, #cba6f7)',
                            color: '#11111b',
                          }
                        : {
                            color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                          }
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditional Manual Coordinates / City Inputs */}
          {settings.weatherLocationMode === 'manual' ? (
            <div className="grid grid-cols-12 gap-1.5 pt-0.5">
              <div className="col-span-6">
                <label
                  className="text-[9px] font-mono uppercase block mb-0.5"
                  style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
                >
                  City Name
                </label>
                <input
                  type="text"
                  data-tauri-drag-region="false"
                  value={settings.manualCityName ?? ''}
                  onChange={(e) => updateSettings({ manualCityName: e.target.value })}
                  placeholder="Tokyo, JP"
                  className="w-full px-2 py-1 rounded-lg text-[11px] border focus:outline-none pointer-events-auto cursor-pointer"
                  style={{
                    background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                    color: 'var(--theme-text-primary, #cdd6f4)',
                  }}
                />
              </div>
              <div className="col-span-3">
                <label
                  className="text-[9px] font-mono uppercase block mb-0.5"
                  style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
                >
                  Latitude
                </label>
                <input
                  type="number"
                  step="0.01"
                  data-tauri-drag-region="false"
                  value={settings.manualLatitude ?? 37.7749}
                  onChange={(e) =>
                    updateSettings({
                      manualLatitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-2 py-1 rounded-lg text-[11px] font-mono border focus:outline-none pointer-events-auto cursor-pointer"
                  style={{
                    background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                    color: 'var(--theme-text-primary, #cdd6f4)',
                  }}
                />
              </div>
              <div className="col-span-3">
                <label
                  className="text-[9px] font-mono uppercase block mb-0.5"
                  style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
                >
                  Longitude
                </label>
                <input
                  type="number"
                  step="0.01"
                  data-tauri-drag-region="false"
                  value={settings.manualLongitude ?? -122.4194}
                  onChange={(e) =>
                    updateSettings({
                      manualLongitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-2 py-1 rounded-lg text-[11px] font-mono border focus:outline-none pointer-events-auto cursor-pointer"
                  style={{
                    background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                    color: 'var(--theme-text-primary, #cdd6f4)',
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              className="px-2.5 py-1.5 rounded-xl border text-[10px] flex items-center justify-between"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.03))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.06))',
                color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
              }}
            >
              <span>Using automatic IP geolocation (ipapi.co)</span>
              <span className="font-mono text-[#a6e3a1]">Active</span>
            </div>
          )}
        </div>

        {/* ===================================================================== */}
        {/* CARD 3: WALLPAPER & APPEARANCE                                        */}
        {/* ===================================================================== */}
        <div
          className="bento-card p-3.5 flex flex-col justify-between gap-2.5"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <ImageIcon className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Wallpaper &amp; Appearance</span>
            </span>
            {folderFeedback && (
              <span className="text-[10px] font-mono text-[#a6e3a1]">
                {folderFeedback}
              </span>
            )}
          </div>

          {/* Wallpaper Folder Path Readout Input + Browse Button */}
          <div className="space-y-1">
            <label
              className="text-[11px] font-medium block"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
            >
              Wallpaper Folder Path
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                data-tauri-drag-region="false"
                value={settings.wallpaperDirectory}
                onChange={(e) => handleApplyManualDirectory(e.target.value)}
                placeholder="C:\Users\Public\Pictures\Wallpapers"
                className="flex-1 min-w-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border focus:outline-none pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
              />
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={handleBrowseWallpaperDirectory}
                disabled={browsingFolder}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition-all active:scale-95 pointer-events-auto cursor-pointer shrink-0"
                style={{
                  background: 'var(--theme-accent, #cba6f7)',
                  borderColor: 'var(--theme-accent, #cba6f7)',
                  color: '#11111b',
                }}
              >
                <FolderOpen className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{browsingFolder ? 'Opening…' : 'Browse'}</span>
              </button>
            </div>
          </div>

          {/* Theme Mode Override Segmented Pill Toggle */}
          <div className="space-y-1">
            <label
              className="text-[11px] font-medium block"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
            >
              Theme Mode Override
            </label>
            <div
              className="grid grid-cols-3 p-0.5 rounded-xl border"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {(
                [
                  {
                    id: 'auto',
                    label: 'Auto (Adaptive)',
                    icon: <Sparkles className="w-3 h-3" strokeWidth={2} />,
                  },
                  {
                    id: 'dark',
                    label: 'Force Dark',
                    icon: <Moon className="w-3 h-3" strokeWidth={2} />,
                  },
                  {
                    id: 'light',
                    label: 'Force Light',
                    icon: <Sun className="w-3 h-3" strokeWidth={2} />,
                  },
                ] as const
              ).map((item) => {
                const active = settings.themeMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => handleThemeModeSelect(item.id)}
                    className="py-1 px-1.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 transition-all pointer-events-auto cursor-pointer"
                    style={
                      active
                        ? {
                            background: 'var(--theme-accent, #cba6f7)',
                            color: '#11111b',
                          }
                        : {
                            color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                          }
                    }
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Glass Blur (16px to 32px) & Glass Opacity (70% to 95%) Sliders */}
          <div className="grid grid-cols-2 gap-3 pt-0.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span
                  style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.75))' }}
                >
                  Glass Blur
                </span>
                <span style={{ color: 'var(--theme-accent, #cba6f7)' }}>
                  {blurStrength}px
                </span>
              </div>
              <input
                type="range"
                data-tauri-drag-region="false"
                min={16}
                max={32}
                step={1}
                value={blurStrength}
                onChange={(e) => handleBlurChange(Number(e.target.value))}
                className="caelestia-slider w-full h-1.5 rounded-full pointer-events-auto cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span
                  style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.75))' }}
                >
                  Glass Opacity
                </span>
                <span style={{ color: 'var(--theme-accent, #cba6f7)' }}>
                  {opacityPercent}%
                </span>
              </div>
              <input
                type="range"
                data-tauri-drag-region="false"
                min={70}
                max={95}
                step={1}
                value={opacityPercent}
                onChange={(e) => handleOpacityChange(Number(e.target.value))}
                className="caelestia-slider w-full h-1.5 rounded-full pointer-events-auto cursor-pointer"
              />
            </div>
          </div>

          {/* Custom Mascot GIF Configuration (URL Input + File Upload + Reset) */}
          <div
            className="space-y-1.5 pt-1.5 border-t"
            style={{ borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))' }}
          >
            <div className="flex items-center justify-between">
              <label
                className="text-[11px] font-medium flex items-center gap-1"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
              >
                <Sparkles
                  className="w-3 h-3"
                  style={{ color: 'var(--theme-accent, #cba6f7)' }}
                  strokeWidth={2}
                />
                <span>Custom Mascot GIF (Media &amp; Dashboard)</span>
              </label>
              {gifFeedback && (
                <span className="text-[10px] font-mono text-[#a6e3a1]">
                  {gifFeedback}
                </span>
              )}
            </div>
            {/* 3 Mascot Mode Segmented Pills */}
            <div
              className="grid grid-cols-3 p-0.5 rounded-xl border mb-1.5"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {(
                [
                  { id: 'bongo', label: 'Bongo Cat' },
                  { id: 'gif', label: 'Custom GIF' },
                  { id: 'none', label: 'No Mascot' },
                ] as const
              ).map((mode) => {
                const active = (settings.mascotMode || 'bongo') === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => updateSettings({ mascotMode: mode.id })}
                    className="py-1 px-1.5 rounded-lg text-[10px] font-semibold transition-all pointer-events-auto cursor-pointer"
                    style={
                      active
                        ? {
                            background: 'var(--theme-accent, #cba6f7)',
                            color: '#11111b',
                          }
                        : {
                            color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                          }
                    }
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>

            {settings.mascotMode !== 'none' && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                data-tauri-drag-region="false"
                value={
                  settings.customMascotGifUrl.startsWith('data:')
                    ? ''
                    : settings.customMascotGifUrl
                }
                onChange={(e) =>
                  updateSettings({ customMascotGifUrl: e.target.value })
                }
                placeholder={
                  settings.customMascotGifUrl.startsWith('data:')
                    ? 'Custom uploaded image active — paste URL to override'
                    : 'Paste custom GIF/WebP URL or upload file…'
                }
                className="flex-1 min-w-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border focus:outline-none pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
              />

              <input
                ref={gifFileInputRef}
                type="file"
                accept="image/gif,image/webp,image/png"
                data-tauri-drag-region="false"
                onChange={handleGifFileChange}
                className="hidden pointer-events-auto cursor-pointer"
              />

              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() => gifFileInputRef.current?.click()}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition-all active:scale-95 pointer-events-auto cursor-pointer shrink-0"
                style={{
                  background: 'var(--theme-accent, #cba6f7)',
                  borderColor: 'var(--theme-accent, #cba6f7)',
                  color: '#11111b',
                }}
                title="Upload custom GIF, WebP, or PNG mascot"
              >
                <Upload className="w-3 h-3" strokeWidth={2.2} />
                <span>Upload GIF</span>
              </button>

              {Boolean(settings.customMascotGifUrl.trim()) && (
                <button
                  type="button"
                  data-tauri-drag-region="false"
                  onClick={() => {
                    updateSettings({ customMascotGifUrl: '' });
                    setGifFeedback('Restored default Bongo Cat');
                    window.setTimeout(() => setGifFeedback(null), 2200);
                  }}
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all active:scale-95 pointer-events-auto cursor-pointer shrink-0"
                  style={{
                    background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                    color: 'var(--theme-text-primary, #cdd6f4)',
                  }}
                  title="Reset mascot to default Bongo Cat"
                >
                  Default Cat
                </button>
              )}
            </div>
            )}
          </div>
        </div>

        {/* ===================================================================== */}
        {/* CARD 4: SYSTEM & INTEGRATION                                          */}
        {/* ===================================================================== */}
        <div
          className="bento-card p-3.5 flex flex-col justify-between gap-2.5"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <Monitor className="w-3.5 h-3.5" strokeWidth={2} />
              <span>System &amp; Integration</span>
            </span>
            <span
              className="px-2 py-0.5 rounded-md text-[9px] font-mono border"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))',
              }}
            >
              Hotkey: {settings.globalHotkey || 'Win+`'}
            </span>
          </div>

          {/* Launch on Windows Startup Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div
                className="text-xs font-medium"
                style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
              >
                Launch on Windows Startup
              </div>
              <div
                className="text-[10px]"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Auto-register Canopy shell in HKCU\...\Run
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.launchOnStartup}
              data-tauri-drag-region="false"
              onClick={handleToggleStartup}
              className="w-10 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0"
              style={{
                background: settings.launchOnStartup
                  ? 'var(--theme-accent, #cba6f7)'
                  : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
              }}
            >
              <span
                className={`w-4 h-4 rounded-full transition-transform ${
                  settings.launchOnStartup
                    ? 'translate-x-5 bg-[#11111b]'
                    : 'translate-x-0 bg-white/80'
                }`}
              />
            </button>
          </div>

          {/* Top-Edge Hover Dropdown Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div
                className="text-xs font-medium"
                style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
              >
                Top-Edge Hover Dropdown
              </div>
              <div
                className="text-[10px]"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Open shell when cursor dwells at top monitor bezel
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.topHoverTrigger}
              data-tauri-drag-region="false"
              onClick={handleToggleTopHover}
              className="w-10 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0"
              style={{
                background: settings.topHoverTrigger
                  ? 'var(--theme-accent, #cba6f7)'
                  : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
              }}
            >
              <span
                className={`w-4 h-4 rounded-full transition-transform ${
                  settings.topHoverTrigger
                    ? 'translate-x-5 bg-[#11111b]'
                    : 'translate-x-0 bg-white/80'
                }`}
              />
            </button>
          </div>

          {/* Enable Brightness Slider Toggle (Default false for desktop PCs) */}
          <div className="flex items-center justify-between">
            <div>
              <div
                className="text-xs font-medium"
                style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
              >
                Enable Brightness Slider
              </div>
              <div
                className="text-[10px]"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Turn off to hide Brightness slider on desktop PCs, leaving Volume &amp; Mic
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enableBrightnessSlider}
              data-tauri-drag-region="false"
              onClick={() =>
                updateSettings({
                  enableBrightnessSlider: !settings.enableBrightnessSlider,
                })
              }
              className="w-10 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0"
              style={{
                background: settings.enableBrightnessSlider
                  ? 'var(--theme-accent, #cba6f7)'
                  : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
              }}
            >
              <span
                className={`w-4 h-4 rounded-full transition-transform ${
                  settings.enableBrightnessSlider
                    ? 'translate-x-5 bg-[#11111b]'
                    : 'translate-x-0 bg-white/80'
                }`}
              />
            </button>
          </div>

          {/* Show Apps Tab Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div
                className="text-xs font-medium"
                style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
              >
                Show Apps Tab
              </div>
              <div
                className="text-[10px]"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Toggle [ Apps ] launcher tab between Performance and Wallpaper
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showAppsTab}
              data-tauri-drag-region="false"
              onClick={() =>
                updateSettings({ showAppsTab: !settings.showAppsTab })
              }
              className="w-10 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0"
              style={{
                background: settings.showAppsTab
                  ? 'var(--theme-accent, #cba6f7)'
                  : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
              }}
            >
              <span
                className={`w-4 h-4 rounded-full transition-transform ${
                  settings.showAppsTab
                    ? 'translate-x-5 bg-[#11111b]'
                    : 'translate-x-0 bg-white/80'
                }`}
              />
            </button>
          </div>

          {/* Factory Defaults Reset Footer */}
          <div
            className="flex items-center justify-between gap-2 pt-1.5 border-t"
            style={{ borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))' }}
          >
            <span
              className="text-[10px] font-mono"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
            >
              Startup View: Dashboard (Default)
            </span>

            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={handleResetAll}
              className="px-3 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition-all hover:scale-[1.02] active:scale-95 pointer-events-auto cursor-pointer shrink-0"
              style={{
                background: resetFeedback
                  ? 'rgba(166, 227, 161, 0.18)'
                  : 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                borderColor: resetFeedback
                  ? 'rgba(166, 227, 161, 0.45)'
                  : 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                color: resetFeedback
                  ? '#a6e3a1'
                  : 'var(--theme-text-primary, #cdd6f4)',
              }}
              title="Restore all settings to factory defaults"
            >
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
              <span>{resetFeedback ? 'Defaults Restored!' : 'Reset Settings'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
