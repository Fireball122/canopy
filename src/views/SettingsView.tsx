import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Clock,
  CloudSun,
  Download,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Keyboard,
  MapPin,
  Monitor,
  Moon,
  Music,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Upload,
  Plus,
  X,
  Calculator,
  Search,
  AppWindow,
} from 'lucide-react';
import { CanopySettings, DEFAULT_SETTINGS, useSettings } from '../context/SettingsContext';
import { applyThemeModeFallback } from '../services/palette';
import {
  WallpaperEntry,
  pickWallpaperFolder,
  setLaunchOnStartup,
  setTopHoverTrigger,
  setWallpaperDirectory,
  getInstalledApps,
  openLogFolder,
  InstalledAppItem,
} from '../services/hostBridge';

const DEFAULT_PINNED_APPS = ['terminal', 'explorer', 'taskmgr', 'msedge', 'code'];

/**
 * Dock slots are positional: index === slot number and `''` marks an empty slot.
 * Always normalized to 6 dense entries so slot assignment never renumbers siblings.
 */
function toDockSlots(list: string[] | undefined): string[] {
  const slots = (list ?? DEFAULT_PINNED_APPS).slice(0, 6);
  while (slots.length < 6) slots.push('');
  return slots;
}

/** Rejects characters Windows forbids in a path, and `:` anywhere but a drive letter. */
function isValidDirectoryPath(path: string): boolean {
  if (!path.trim()) return false;
  if (/[<>"|?*\u0000-\u001f]/.test(path)) return false;
  const colonIndex = path.indexOf(':');
  if (colonIndex !== -1 && !/^[a-zA-Z]:[\\/]/.test(path)) return false;
  return true;
}

const HOTKEY_MODIFIERS: Record<string, true> = {
  ctrl: true,
  control: true,
  shift: true,
  alt: true,
  win: true,
  super: true,
  meta: true,
  cmd: true,
  command: true,
};

/** Prototype-safe membership check (hotkey text is arbitrary user input). */
const isHotkeyModifier = (part: string): boolean => HOTKEY_MODIFIERS[part.toLowerCase()] === true;

/** Requires at least one modifier plus exactly one key, e.g. ``Win+` `` or `Ctrl+Shift+Space`. */
function normalizeHotkey(raw: string): { value: string } | { error: string } {
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { error: 'Use a modifier plus a key, e.g. Win+`' };
  }
  const modifiers = parts.filter(isHotkeyModifier);
  const keys = parts.filter((p) => !isHotkeyModifier(p));
  if (modifiers.length === 0) {
    return { error: 'Include at least one modifier: Ctrl, Shift, Alt or Win' };
  }
  if (keys.length === 0) {
    return { error: 'Include one key, e.g. Space, K or `' };
  }
  if (keys.length > 1) {
    return { error: 'Only one non-modifier key is allowed' };
  }
  return { value: [...modifiers, ...keys].join('+') };
}

/** Mirrors the existing inline toggle switch exactly (same classes, tokens and aria contract). */
const ToggleSwitch: React.FC<{
  checked: boolean;
  label: string;
  onToggle: () => void;
}> = ({ checked, label, onToggle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    data-tauri-drag-region="false"
    onClick={onToggle}
    className="w-9 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0"
    style={{
      background: checked
        ? 'var(--theme-accent, #74a86c)'
        : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
    }}
  >
    <span
      className={`w-4 h-4 rounded-full transition-transform ${
        checked ? 'translate-x-4 bg-[#11111b]' : 'translate-x-0 bg-white/80'
      }`}
    />
  </button>
);

const SettingToggleRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ title, description, checked, onToggle }) => (
  <div className="flex items-center justify-between gap-3 py-1">
    <div className="min-w-0 pr-1">
      <div className="text-xs font-medium truncate" style={{ color: 'var(--theme-text-primary, #f5efe6)' }}>
        {title}
      </div>
      <div
        className="text-[10px] leading-tight"
        style={{ color: 'var(--theme-text-secondary, #9eb09a)' }}
      >
        {description}
      </div>
    </div>
    <ToggleSwitch checked={checked} label={title} onToggle={onToggle} />
  </div>
);

const SegmentedChoice: React.FC<{
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
}> = ({ label, value, options, onSelect }) => (
  <div className="flex items-center justify-between gap-2 py-1">
    <span
      className="text-xs font-medium shrink-0"
      style={{ color: 'var(--theme-text-primary, #f5efe6)' }}
    >
      {label}
    </span>
    <div
      className="inline-flex p-0.5 rounded-lg border shrink-0"
      style={{
        background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
      }}
    >
      {options.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-tauri-drag-region="false"
            onClick={() => onSelect(item.id)}
            className="py-0.5 px-2.5 rounded-md text-[10px] font-semibold transition-all pointer-events-auto cursor-pointer"
            style={
              active
                ? { background: 'var(--theme-accent, #74a86c)', color: '#11111b' }
                : { color: 'var(--theme-text-secondary, #9eb09a)' }
            }
          >
            {item.label}
          </button>
        );
      })}
    </div>
  </div>
);

const SettingSliderRow: React.FC<{
  title: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ title, valueLabel, min, max, step, value, disabled = false, onChange }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between text-[10px] font-mono">
      <span style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.75))' }}>
        {title}
      </span>
      <span style={{ color: 'var(--theme-accent, #cba6f7)' }}>{valueLabel}</span>
    </div>
    <input
      type="range"
      data-tauri-drag-region="false"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="caelestia-slider w-full h-1.5 rounded-full pointer-events-auto cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    />
  </div>
);

/** Signed millisecond readout used by the lyric offset slider. */
function formatSignedMs(value: number): string {
  if (value === 0) return '0 ms';
  return `${value > 0 ? '+' : '-'}${Math.abs(value)} ms`;
}

export interface SettingsViewProps {
  onDirectoryChanged?: (newDir: string, entries: WallpaperEntry[]) => void;
  onThemeChanged?: () => void;
  onStartAddQuickLaunch?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onDirectoryChanged,
  onThemeChanged,
  onStartAddQuickLaunch,
}) => {
  const { settings, updateSettings, resetSettings } = useSettings();
  const gifFileInputRef = useRef<HTMLInputElement | null>(null);
  const [browsingFolder, setBrowsingFolder] = useState<boolean>(false);
  const [folderFeedback, setFolderFeedback] = useState<{
    text: string;
    kind: 'ok' | 'error';
  } | null>(null);
  const [gifFeedback, setGifFeedback] = useState<string | null>(null);
  const [resetFeedback, setResetFeedback] = useState<boolean>(false);
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);
  const [availableApps, setAvailableApps] = useState<InstalledAppItem[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState<string>('');
  const [loadingApps, setLoadingApps] = useState<boolean>(false);
  const [directoryText, setDirectoryText] = useState<string>(settings.wallpaperDirectory ?? '');
  const [latitudeText, setLatitudeText] = useState<string>('');
  const [longitudeText, setLongitudeText] = useState<string>('');
  const [coordinateFeedback, setCoordinateFeedback] = useState<string | null>(null);
  const [hotkeyText, setHotkeyText] = useState<string>(settings.globalHotkey ?? '');
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [logFeedback, setLogFeedback] = useState<{
    text: string;
    kind: 'ok' | 'error';
  } | null>(null);
  const [importFeedback, setImportFeedback] = useState<{
    kind: 'ok' | 'error';
    message: string;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [activeCategory, setActiveCategory] = useState<'all' | 'general' | 'appearance' | 'controls' | 'audio' | 'advanced'>('all');
  // Local text mirrors of host-facing values. These fields commit on blur/Enter only, so a
  // half-typed path, coordinate or hotkey never reaches the host.
  useEffect(() => {
    setDirectoryText(settings.wallpaperDirectory ?? '');
  }, [settings.wallpaperDirectory]);

  useEffect(() => {
    setLatitudeText(settings.manualLatitude === undefined ? '' : String(settings.manualLatitude));
  }, [settings.manualLatitude]);

  useEffect(() => {
    setLongitudeText(
      settings.manualLongitude === undefined ? '' : String(settings.manualLongitude)
    );
  }, [settings.manualLongitude]);

  useEffect(() => {
    setHotkeyText(settings.globalHotkey ?? '');
    setHotkeyError(null);
  }, [settings.globalHotkey]);

  const openAppPickerForSlot = async (slotIdx: number) => {
    setPickerSlotIndex(slotIdx);
    setAppSearchQuery('');
    if (availableApps.length === 0) {
      setLoadingApps(true);
      try {
        const apps = await getInstalledApps();
        setAvailableApps(apps);
      } finally {
        setLoadingApps(false);
      }
    }
  };

  const assignAppToSlot = (
    slotIdx: number,
    app: { id: string; name: string; path: string; icon_data_url?: string | null }
  ) => {
    const slots = toDockSlots(settings.pinnedApps);
    slots[slotIdx] = app.id;
    updateSettings({
      pinnedApps: slots,
      customApps: {
        ...(settings.customApps || {}),
        [app.id]: { label: app.name, path: app.path, icon_data_url: app.icon_data_url },
      },
    });
    setPickerSlotIndex(null);
  };

  const clearSlot = (slotIdx: number) => {
    const slots = toDockSlots(settings.pinnedApps);
    slots[slotIdx] = '';
    updateSettings({ pinnedApps: slots });
  };

  /** Wallpaper-card status line; errors are tinted rather than reported as success. */
  const flashFolderFeedback = (text: string, kind: 'ok' | 'error' = 'ok', ms = 2500) => {
    setFolderFeedback({ text, kind });
    window.setTimeout(() => setFolderFeedback(null), ms);
  };

  const applyWallpaperDirectory = async (dirPath: string, verb: string) => {
    try {
      const entries = await setWallpaperDirectory(dirPath);
      onDirectoryChanged?.(dirPath, entries);
      flashFolderFeedback(`${verb} ${entries.length} wallpapers`);
    } catch {
      // Host unavailable (browser mode) or the folder does not exist yet
    }
  };

  const handleBrowseWallpaperDirectory = async () => {
    setBrowsingFolder(true);
    try {
      const chosen = await pickWallpaperFolder(directoryText || settings.wallpaperDirectory);
      if (chosen) {
        updateSettings({ wallpaperDirectory: chosen });
        setDirectoryText(chosen);
        await applyWallpaperDirectory(chosen, 'Loaded');
      }
    } catch {
      flashFolderFeedback('Could not open folder picker', 'error', 3000);
    } finally {
      setBrowsingFolder(false);
    }
  };

  /** Blur/Enter only — the host reseeds samples and restarts its watcher per call. */
  const commitWallpaperDirectory = async () => {
    const trimmed = directoryText.trim();
    if (!trimmed) {
      // Empty field: skip the host entirely and show the value actually in effect.
      setDirectoryText(settings.wallpaperDirectory ?? '');
      flashFolderFeedback('Enter a wallpaper folder path', 'error');
      return;
    }
    if (!isValidDirectoryPath(trimmed)) {
      flashFolderFeedback('Path has invalid characters (< > " | ? *)', 'error', 3000);
      return;
    }
    if (trimmed === (settings.wallpaperDirectory ?? '').trim()) return;
    updateSettings({ wallpaperDirectory: trimmed });
    setDirectoryText(trimmed);
    await applyWallpaperDirectory(trimmed, 'Scanned');
  };

  const handleWallpaperDirectoryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitWallpaperDirectory();
    } else if (e.key === 'Escape') {
      setDirectoryText(settings.wallpaperDirectory ?? '');
    }
  };

  const handleThemeModeSelect = (mode: 'canopy' | 'adaptive' | 'dark' | 'light') => {
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

  /** Blur/Enter only, so "-" and "37." stay typeable instead of snapping the field to 0. */
  const commitCoordinate = (axis: 'latitude' | 'longitude') => {
    const raw = (axis === 'latitude' ? latitudeText : longitudeText).trim();
    const label = axis === 'latitude' ? 'Latitude' : 'Longitude';
    const limit = axis === 'latitude' ? 90 : 180;

    if (!raw) {
      // An empty field clears the manual override (weather falls back to its default point).
      updateSettings(
        axis === 'latitude' ? { manualLatitude: undefined } : { manualLongitude: undefined }
      );
      setCoordinateFeedback(null);
      return;
    }

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setCoordinateFeedback(`${label} must be a number`);
      return;
    }
    if (value < -limit || value > limit) {
      setCoordinateFeedback(`${label} must be between -${limit} and ${limit}`);
      return;
    }
    setCoordinateFeedback(null);
    updateSettings(axis === 'latitude' ? { manualLatitude: value } : { manualLongitude: value });
  };

  const handleCoordinateKeyDown =
    (axis: 'latitude' | 'longitude') => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCoordinate(axis);
      }
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
  const handleOpenLogFolder = async () => {
    try {
      await openLogFolder();
      setLogFeedback({ text: 'Opened log folder', kind: 'ok' });
    } catch {
      setLogFeedback({ text: 'Could not open log folder', kind: 'error' });
    }
    window.setTimeout(() => setLogFeedback(null), 2500);
  };

  /** Blur/Enter only; an invalid combination leaves the committed hotkey untouched. */
  const commitHotkey = () => {
    const raw = hotkeyText.trim();
    if (raw === (settings.globalHotkey ?? '')) {
      setHotkeyError(null);
      return;
    }
    const result = normalizeHotkey(raw);
    if ('error' in result) {
      setHotkeyError(result.error);
      return;
    }
    setHotkeyError(null);
    setHotkeyText(result.value);
    updateSettings({ globalHotkey: result.value });
  };

  const handleExportSettings = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'canopy-settings.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportSettingsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Settings payload must be a JSON object');
        }
        updateSettings(parsed as Partial<CanopySettings>);
        setImportFeedback({ kind: 'ok', message: `Imported ${file.name}` });
      } catch {
        setImportFeedback({
          kind: 'error',
          message: 'Invalid settings file: expected a JSON object',
        });
      }
      window.setTimeout(() => setImportFeedback(null), 4000);
    };
    reader.onerror = () => {
      setImportFeedback({ kind: 'error', message: 'Could not read that file' });
      window.setTimeout(() => setImportFeedback(null), 4000);
    };
    reader.readAsText(file);
  };

  const handleResetAll = () => {
    resetSettings();
    applyThemeModeFallback('auto', 0.86, 24);
    onThemeChanged?.();
    // A frontend-only reset would leave the host pointing at the old wallpaper folder and
    // with its autostart Run entry still registered, so push the host back to defaults too.
    void setLaunchOnStartup(false).catch(() => undefined);
    void applyWallpaperDirectory(DEFAULT_SETTINGS.wallpaperDirectory, 'Scanned');
    setDirectoryText(DEFAULT_SETTINGS.wallpaperDirectory);
    setLatitudeText(String(DEFAULT_SETTINGS.manualLatitude ?? ''));
    setLongitudeText(String(DEFAULT_SETTINGS.manualLongitude ?? ''));
    setHotkeyText(DEFAULT_SETTINGS.globalHotkey);
    setHotkeyError(null);
    setCoordinateFeedback(null);
    setResetFeedback(true);
    window.setTimeout(() => setResetFeedback(false), 2200);
  };

  const opacityPercent = Math.round((settings.glassOpacity || 0.86) * 100);
  const blurStrength = Math.round(settings.glassBlurStrength || 24);
  const pinnedSlots = toDockSlots(settings.pinnedApps);
  const pinnedCount = pinnedSlots.filter(Boolean).length;

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full overflow-y-auto pr-1 pointer-events-auto select-none flex flex-col"
    >
      {/* Category Navigation Pills */}
      <div className="flex items-center gap-1.5 pb-2.5 shrink-0 overflow-x-auto">
        {(
          [
            { id: 'all', label: 'All Settings' },
            { id: 'general', label: 'General & Time' },
            { id: 'appearance', label: 'Appearance & Theme' },
            { id: 'controls', label: 'Panel & Controls' },
            { id: 'audio', label: 'Audio & Media' },
            { id: 'advanced', label: 'Advanced & Experimental' },
          ] as const
        ).map((cat) => {
          const isSelected = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              data-tauri-drag-region="false"
              onClick={() => setActiveCategory(cat.id)}
              className="px-3 py-1 rounded-full text-[10px] font-semibold transition-all duration-150 cursor-pointer pointer-events-auto shrink-0"
              style={{
                background: isSelected
                  ? 'var(--theme-accent, #74a86c)'
                  : 'var(--theme-card, rgba(255, 255, 255, 0.04))',
                color: isSelected ? '#11111b' : 'var(--theme-text-secondary, #9eb09a)',
                border: isSelected
                  ? '1px solid var(--theme-accent, #74a86c)'
                  : '1px solid var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2.5 pb-1 items-start flex-1">
        {/* ===================================================================== */}
        {/* CARD 1: TIME & REGIONAL                                               */}
        {/* ===================================================================== */}
        {(activeCategory === 'all' || activeCategory === 'general') && (
        <div
          className="bento-card p-3.5 flex flex-col gap-2.5"
          style={{
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

          <SegmentedChoice
            label="Clock Format"
            value={settings.clockFormat}
            options={[
              { id: '12h', label: '12-Hour (07:20 PM)' },
              { id: '24h', label: '24-Hour (19:20)' },
            ]}
            onSelect={(id) => updateSettings({ clockFormat: id as '12h' | '24h' })}
          />

          <SettingToggleRow
            title="Show Seconds"
            description="Display live seconds ticker on Dashboard clock"
            checked={settings.showSeconds}
            onToggle={() => updateSettings({ showSeconds: !settings.showSeconds })}
          />

          <SegmentedChoice
            label="Calendar First Day of Week"
            value={settings.calendarFirstDay}
            options={[
              { id: 'sunday', label: 'Sunday' },
              { id: 'monday', label: 'Monday' },
            ]}
            onSelect={(id) => updateSettings({ calendarFirstDay: id as 'sunday' | 'monday' })}
          />
        </div>
        )}

        {/* ===================================================================== */}
        {/* CARD 2: WEATHER CONFIGURATION                                         */}
        {/* ===================================================================== */}
        {(activeCategory === 'all' || activeCategory === 'general') && (
        <div
          className="bento-card p-3.5 flex flex-col gap-2.5"
          style={{
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

          <SegmentedChoice
            label="Temperature Unit"
            value={settings.temperatureUnit}
            options={[
              { id: 'fahrenheit', label: 'Fahrenheit (°F)' },
              { id: 'celsius', label: 'Celsius (°C)' },
            ]}
            onSelect={(id) => updateSettings({ temperatureUnit: id as 'fahrenheit' | 'celsius' })}
          />

          <SegmentedChoice
            label="Location Detection"
            value={settings.weatherLocationMode}
            options={[
              { id: 'auto', label: 'Auto IP Detection' },
              { id: 'manual', label: 'Manual Coordinates/City' },
            ]}
            onSelect={(id) => updateSettings({ weatherLocationMode: id as 'auto' | 'manual' })}
          />
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
                  type="text"
                  inputMode="decimal"
                  data-tauri-drag-region="false"
                  value={latitudeText}
                  onChange={(e) => {
                    setLatitudeText(e.target.value);
                    setCoordinateFeedback(null);
                  }}
                  onBlur={() => commitCoordinate('latitude')}
                  onKeyDown={handleCoordinateKeyDown('latitude')}
                  placeholder="37.7749"
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
                  type="text"
                  inputMode="decimal"
                  data-tauri-drag-region="false"
                  value={longitudeText}
                  onChange={(e) => {
                    setLongitudeText(e.target.value);
                    setCoordinateFeedback(null);
                  }}
                  onBlur={() => commitCoordinate('longitude')}
                  onKeyDown={handleCoordinateKeyDown('longitude')}
                  placeholder="-122.4194"
                  className="w-full px-2 py-1 rounded-lg text-[11px] font-mono border focus:outline-none pointer-events-auto cursor-pointer"
                  style={{
                    background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                    color: 'var(--theme-text-primary, #cdd6f4)',
                  }}
                />
              </div>
              <div className="col-span-12">
                <span
                  className="text-[9px] font-mono"
                  style={{
                    color: coordinateFeedback
                      ? '#f38ba8'
                      : 'var(--theme-text-secondary, rgba(205, 214, 244, 0.55))',
                  }}
                >
                  {coordinateFeedback ??
                    'Blur or Enter to apply — latitude -90..90, longitude -180..180'}
                </span>
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
        )}

        {/* ===================================================================== */}
        {/* CARD 3: WALLPAPER & APPEARANCE                                        */}
        {/* ===================================================================== */}
        {(activeCategory === 'all' || activeCategory === 'appearance') && (
        <div
          className="bento-card p-3.5 flex flex-col gap-2.5"
          style={{
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
              <span
                className="text-[10px] font-mono"
                style={{ color: folderFeedback.kind === 'error' ? '#f38ba8' : '#a6e3a1' }}
              >
                {folderFeedback.text}
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
                value={directoryText}
                onChange={(e) => setDirectoryText(e.target.value)}
                onBlur={() => void commitWallpaperDirectory()}
                onKeyDown={handleWallpaperDirectoryKeyDown}
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
              className="grid grid-cols-4 p-0.5 rounded-xl border"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              }}
            >
              {(
                [
                  {
                    id: 'canopy',
                    label: 'Canopy',
                    icon: <Sparkles className="w-3 h-3" strokeWidth={2} />,
                  },
                  {
                    id: 'adaptive',
                    label: 'Adaptive',
                    icon: <ImageIcon className="w-3 h-3" strokeWidth={2} />,
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
                  { id: 'bongo', label: 'Capi (Mushroom)' },
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
                    setGifFeedback('Restored default Capi');
                    window.setTimeout(() => setGifFeedback(null), 2200);
                  }}
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all active:scale-95 pointer-events-auto cursor-pointer shrink-0"
                  style={{
                    background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                    color: 'var(--theme-text-primary, #cdd6f4)',
                  }}
                  title="Reset mascot to default Capi"
                >
                  Default Capi
                </button>
              )}
            </div>
            )}
          </div>
        </div>
        )}

        {/* ===================================================================== */}
        {/* CARD 4: SYSTEM & INTEGRATION                                          */}
        {/* ===================================================================== */}
        {(activeCategory === 'all' || activeCategory === 'controls') && (
        <div
          className="bento-card p-3.5 flex flex-col gap-2.5"
          style={{
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

          {/* Global Hotkey Editor (validated before commit) */}
          <div className="space-y-1">
            <label
              className="text-[11px] font-medium flex items-center gap-1"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
            >
              <Keyboard className="w-3 h-3" strokeWidth={2} />
              <span>Global Hotkey</span>
            </label>
            <input
              type="text"
              data-tauri-drag-region="false"
              value={hotkeyText}
              spellCheck={false}
              aria-invalid={hotkeyError !== null}
              onChange={(e) => {
                setHotkeyText(e.target.value);
                setHotkeyError(null);
              }}
              onBlur={commitHotkey}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitHotkey();
                } else if (e.key === 'Escape') {
                  setHotkeyText(settings.globalHotkey ?? '');
                  setHotkeyError(null);
                }
              }}
              placeholder="Win+`"
              className="w-full px-2.5 py-1 rounded-lg text-[11px] font-mono border focus:outline-none pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                borderColor: hotkeyError
                  ? 'rgba(243, 139, 168, 0.65)'
                  : 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                color: 'var(--theme-text-primary, #cdd6f4)',
              }}
            />
            {hotkeyError ? (
              <div className="text-[10px] font-mono" style={{ color: '#f38ba8' }}>
                {hotkeyError}
              </div>
            ) : (
              <div
                className="text-[10px]"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                One modifier plus one key, e.g. Win+` or Ctrl+Shift+Space. Enter applies.
              </div>
            )}
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
          {/* Trigger Zone Geometry Sliders (Only if trigger is enabled) */}
          {settings.topHoverTrigger && (
            <div
              className="p-2.5 rounded-xl border flex flex-col gap-2"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.03))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.07))',
              }}
            >
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span style={{ color: 'var(--theme-text-secondary)' }}>Trigger Width</span>
                <span className="font-bold" style={{ color: 'var(--theme-accent)' }}>
                  {settings.triggerWidth || 950}px
                </span>
              </div>
              <input
                type="range"
                min={200}
                max={1600}
                step={50}
                value={settings.triggerWidth || 950}
                onChange={(e) => updateSettings({ triggerWidth: Number(e.target.value) })}
                className="w-full accent-[var(--theme-accent)] h-1 rounded-full cursor-pointer"
              />

              <div className="flex items-center justify-between text-[11px] font-mono mt-1">
                <span style={{ color: 'var(--theme-text-secondary)' }}>Sensitivity Height</span>
                <span className="font-bold" style={{ color: 'var(--theme-accent)' }}>
                  {settings.triggerHeight || 8}px
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={20}
                step={1}
                value={settings.triggerHeight || 8}
                onChange={(e) => updateSettings({ triggerHeight: Number(e.target.value) })}
                className="w-full accent-[var(--theme-accent)] h-1 rounded-full cursor-pointer"
              />

              <div className="flex items-center justify-between text-[11px] font-mono mt-1">
                <span style={{ color: 'var(--theme-text-secondary)' }}>Hover Dwell Delay</span>
                <span className="font-bold" style={{ color: 'var(--theme-accent)' }}>
                  {settings.triggerDelayMs || 0}ms
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={600}
                step={50}
                value={settings.triggerDelayMs || 0}
                onChange={(e) => updateSettings({ triggerDelayMs: Number(e.target.value) })}
                className="w-full accent-[var(--theme-accent)] h-1 rounded-full cursor-pointer"
              />
            </div>
          )}

          {/* Audio Visualizer Mode Selector */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                Audio Visualizer Mode
              </div>
              <div className="text-[10px]" style={{ color: 'var(--theme-text-secondary)' }}>
                Visualizer archetype in Media view
              </div>
            </div>
            <div className="flex items-center gap-1">
              {[
                { id: 'radial' as const, label: 'Radial' },
                { id: 'bars' as const, label: 'Bars' },
                { id: 'wave' as const, label: 'Wave' },
              ].map((m) => {
                const isSel = (settings.visualizerStyle || 'radial') === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => updateSettings({ visualizerStyle: m.id })}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all pointer-events-auto cursor-pointer ${
                      isSel ? 'font-bold shadow-sm' : 'opacity-65 hover:opacity-100'
                    }`}
                    style={{
                      background: isSel ? 'var(--theme-track)' : 'transparent',
                      border: isSel ? '1px solid var(--theme-accent)' : '1px solid var(--theme-border)',
                      color: isSel ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Dashboard Quick Launch Dock Assignment (Up to 6 Apps) */}
          <div
            className="p-2.5 rounded-xl border flex flex-col gap-2"
            style={{
              background: 'var(--theme-track, rgba(255, 255, 255, 0.03))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.07))',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                  Dashboard Quick Launch Dock
                </div>
                <div className="text-[10px]" style={{ color: 'var(--theme-text-secondary)' }}>
                  Assign up to 6 quick launch applications ({pinnedCount}/6 assigned)
                </div>
              </div>

              {onStartAddQuickLaunch && (
                <button
                  type="button"
                  data-tauri-drag-region="false"
                  onClick={onStartAddQuickLaunch}
                  disabled={pinnedCount >= 6}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-semibold border flex items-center gap-1 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-40 disabled:pointer-events-none pointer-events-auto cursor-pointer"
                  style={{
                    background: 'var(--theme-accent, #cba6f7)',
                    color: '#11111b',
                    borderColor: 'var(--theme-accent, #cba6f7)',
                  }}
                  title="Browse installed applications and pick one to add to Dashboard"
                >
                  <Plus className="w-3 h-3 stroke-[2.5]" />
                  <span>Choose from Apps</span>
                </button>
              )}
            </div>
            {/* 6 Interactive Quick Launch Slot Containers */}
            <div className="grid grid-cols-6 gap-2 pt-1">
              {Array.from({ length: 6 }).map((_, slotIdx) => {
                const appId = pinnedSlots[slotIdx];
                const custom = settings.customApps?.[appId];
                const label = custom?.label || appId;
                const isOccupied = Boolean(appId && appId.trim().length > 0);

                return (
                  <div
                    key={slotIdx}
                    data-tauri-drag-region="false"
                    onClick={() => openAppPickerForSlot(slotIdx)}
                    className="relative flex flex-col items-center justify-between p-2 rounded-xl border text-center transition-all cursor-pointer group hover:border-[var(--theme-accent)] hover:bg-white/[0.04] pointer-events-auto"
                    style={{
                      background: isOccupied ? 'var(--theme-card)' : 'transparent',
                      borderColor: isOccupied ? 'var(--theme-border)' : 'rgba(255, 255, 255, 0.1)',
                      borderStyle: isOccupied ? 'solid' : 'dashed',
                      minHeight: '80px',
                    }}
                    title={isOccupied ? `Slot ${slotIdx + 1}: ${label} (Click to change)` : `Slot ${slotIdx + 1} Empty (Click to assign)`}
                  >
                    <div className="w-full flex items-center justify-between">
                      <span className="text-[9px] font-mono text-white/40">#{slotIdx + 1}</span>
                      {isOccupied && (
                        <button
                          type="button"
                          data-tauri-drag-region="false"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearSlot(slotIdx);
                          }}
                          className="p-0.5 rounded text-white/40 hover:text-red-400 hover:bg-white/10 transition-all pointer-events-auto cursor-pointer"
                          title="Remove app from this slot"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>

                    {isOccupied ? (
                      <div className="flex flex-col items-center gap-1 w-full my-auto">
                        <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[var(--theme-accent)]">
                          {custom?.icon_data_url ? (
                            <img src={custom.icon_data_url} alt={label} className="w-4 h-4 object-contain" />
                          ) : (
                            <AppWindow className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <span className="text-[10px] font-medium truncate max-w-full px-0.5" style={{ color: 'var(--theme-text-primary)' }}>
                          {label}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1 my-auto text-white/40 group-hover:text-[var(--theme-accent)] transition-colors">
                        <Plus className="w-4 h-4 stroke-[2]" />
                        <span className="text-[9px] font-medium">Assign</span>
                      </div>
                    )}

                    <span className="text-[8px] font-mono text-white/30 group-hover:text-[var(--theme-accent)] transition-colors">
                      {isOccupied ? 'Change' : 'Empty'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* In-Place App Selector Modal when Slot is Clicked */}
            {pickerSlotIndex !== null && (
              <div
                className="p-3 rounded-xl border flex flex-col gap-2 mt-2"
                style={{
                  background: 'var(--theme-card, rgba(20, 20, 30, 0.95))',
                  borderColor: 'var(--theme-accent, #cba6f7)',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
                      Choose Application for Slot #{pickerSlotIndex + 1}
                    </span>
                    <span className="text-[10px] text-white/40">Click any app to set it</span>
                  </div>
                  <button
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => setPickerSlotIndex(null)}
                    className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10 pointer-events-auto cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Search Input Box */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-white/5 border-white/10">
                  <Search className="w-3.5 h-3.5 text-[var(--theme-accent)]" />
                  <input
                    type="text"
                    data-tauri-drag-region="false"
                    value={appSearchQuery}
                    onChange={(e) => setAppSearchQuery(e.target.value)}
                    placeholder="Search apps (Discord, Steam, Brave, VSCode, Spotify, Calc...)"
                    className="w-full bg-transparent text-xs focus:outline-none pointer-events-auto"
                    style={{ color: 'var(--theme-text-primary)' }}
                    autoFocus
                  />
                  {appSearchQuery && (
                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => setAppSearchQuery('')}
                      className="p-0.5 text-white/50 hover:text-white pointer-events-auto cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Available Apps Choices Grid */}
                <div className="max-h-48 overflow-y-auto grid grid-cols-3 gap-1.5 pr-0.5">
                  {loadingApps ? (
                    <div className="col-span-3 py-6 text-center text-xs text-white/50">
                      Scanning installed Windows apps...
                    </div>
                  ) : (
                    [
                      { id: 'terminal', name: 'Terminal', path: 'wt.exe', category: 'Developer' },
                      { id: 'explorer', name: 'Files', path: 'explorer.exe', category: 'System' },
                      { id: 'taskmgr', name: 'Task Manager', path: 'taskmgr.exe', category: 'System' },
                      { id: 'msedge', name: 'Edge Browser', path: 'msedge.exe', category: 'Browser' },
                      { id: 'code', name: 'VS Code', path: 'code', category: 'Developer' },
                      { id: 'notepad', name: 'Notepad', path: 'notepad.exe', category: 'Productivity' },
                      { id: 'calc', name: 'Calculator', path: 'calc.exe', category: 'Utilities' },
                      { id: 'spotify', name: 'Spotify', path: 'spotify.exe', category: 'Media' },
                      ...availableApps.filter(
                        (a) =>
                          !['terminal', 'explorer', 'taskmgr', 'msedge', 'code', 'notepad', 'calc', 'spotify'].includes(
                            a.id
                          )
                      ),
                    ]
                      .filter((app) => {
                        const q = appSearchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          app.name.toLowerCase().includes(q) ||
                          app.id.toLowerCase().includes(q) ||
                          (app.path && app.path.toLowerCase().includes(q))
                        );
                      })
                      .map((app) => (
                        <button
                          key={app.id}
                          type="button"
                          data-tauri-drag-region="false"
                          onClick={() => assignAppToSlot(pickerSlotIndex, app)}
                          className="p-1.5 rounded-lg border flex items-center gap-2 text-left hover:bg-white/10 hover:border-[var(--theme-accent)] transition-all pointer-events-auto cursor-pointer group"
                          style={{
                            background: 'var(--theme-card)',
                            borderColor: 'var(--theme-border)',
                          }}
                        >
                          <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[var(--theme-accent)]">
                            {'icon_data_url' in app && app.icon_data_url ? (
                              <img src={app.icon_data_url} alt={app.name} className="w-4 h-4 object-contain" />
                            ) : (
                              <AppWindow className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-[11px] font-medium truncate group-hover:text-[var(--theme-accent)]"
                              style={{ color: 'var(--theme-text-primary)' }}
                            >
                              {app.name}
                            </div>
                            <div className="text-[9px] text-white/40 truncate">
                              {app.category || app.path}
                            </div>
                          </div>
                        </button>
                      ))
                  )}
                </div>
              </div>
            )}
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

          {/* Show Terminal Tab Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div
                className="text-xs font-medium"
                style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
              >
                Show Terminal Tab
              </div>
              <div
                className="text-[10px]"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Toggle [ Terminal ] tab in the top navigation bar
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showTerminalTab}
              data-tauri-drag-region="false"
              onClick={() =>
                updateSettings({ showTerminalTab: !settings.showTerminalTab })
              }
              className="w-10 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0"
              style={{
                background: settings.showTerminalTab
                  ? 'var(--theme-accent, #cba6f7)'
                  : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
              }}
            >
              <span
                className={`w-4 h-4 rounded-full transition-transform ${
                  settings.showTerminalTab
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
        )}

        {/* ===================================================================== */}
        {/* CARD 5: PANEL BEHAVIOUR                                               */}
        {/* ===================================================================== */}
        {(activeCategory === 'all' || activeCategory === 'controls') && (
        <div
          className="bento-card p-3.5 flex flex-col gap-2.5"
          style={{
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Panel Behaviour</span>
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
            >
              Trigger &amp; Motion
            </span>
          </div>

          <SegmentedChoice
            label="Panel Monitor"
            value={settings.panelMonitorMode}
            options={[
              { id: 'cursor', label: "Cursor's Monitor" },
              { id: 'primary', label: 'Primary Monitor' },
            ]}
            onSelect={(id) =>
              updateSettings({ panelMonitorMode: id as CanopySettings['panelMonitorMode'] })
            }
          />

          <SegmentedChoice
            label="Trigger Monitor Scope"
            value={settings.triggerMonitorScope}
            options={[
              { id: 'all', label: 'All Monitors' },
              { id: 'primary', label: 'Primary Only' },
            ]}
            onSelect={(id) =>
              updateSettings({ triggerMonitorScope: id as CanopySettings['triggerMonitorScope'] })
            }
          />

          <SettingToggleRow
            title="Pause Trigger in Fullscreen"
            description="Ignore the hover trigger while a fullscreen app is focused"
            checked={settings.pauseTriggerInFullscreen}
            onToggle={() =>
              updateSettings({ pauseTriggerInFullscreen: !settings.pauseTriggerInFullscreen })
            }
          />

          <SettingToggleRow
            title="Pause Trigger During Presentations"
            description="Stay hidden while screen sharing or presenting"
            checked={settings.pauseTriggerDuringPresentations}
            onToggle={() =>
              updateSettings({
                pauseTriggerDuringPresentations: !settings.pauseTriggerDuringPresentations,
              })
            }
          />

          {/* Quiet Hours (toggle + window) */}
          <SettingToggleRow
            title="Quiet Hours"
            description="Suppress the trigger between the start and end time"
            checked={settings.quietHoursEnabled}
            onToggle={() => updateSettings({ quietHoursEnabled: !settings.quietHoursEnabled })}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-0.5">
              <label
                className="text-[9px] font-mono uppercase block"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Quiet From
              </label>
              <input
                type="time"
                data-tauri-drag-region="false"
                value={settings.quietHoursStart}
                disabled={!settings.quietHoursEnabled}
                onChange={(e) => updateSettings({ quietHoursStart: e.target.value })}
                className="w-full px-2 py-1 rounded-lg text-[11px] font-mono border focus:outline-none pointer-events-auto cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
              />
            </div>
            <div className="space-y-0.5">
              <label
                className="text-[9px] font-mono uppercase block"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Quiet Until
              </label>
              <input
                type="time"
                data-tauri-drag-region="false"
                value={settings.quietHoursEnd}
                disabled={!settings.quietHoursEnabled}
                onChange={(e) => updateSettings({ quietHoursEnd: e.target.value })}
                className="w-full px-2 py-1 rounded-lg text-[11px] font-mono border focus:outline-none pointer-events-auto cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--theme-track, rgba(0, 0, 0, 0.25))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
              />
            </div>
          </div>

          <SettingToggleRow
            title="Animations"
            description="Animate panel open, close and tab switches"
            checked={settings.animationsEnabled}
            onToggle={() => updateSettings({ animationsEnabled: !settings.animationsEnabled })}
          />

          <SettingSliderRow
            title="Animation Duration"
            valueLabel={`${settings.animationDurationMs}ms`}
            min={120}
            max={600}
            step={10}
            value={settings.animationDurationMs}
            disabled={!settings.animationsEnabled}
            onChange={(value) => updateSettings({ animationDurationMs: value })}
          />

          <SettingToggleRow
            title="Show Panel on Launch"
            description="Reveal the panel once the shell boots"
            checked={settings.showPanelOnLaunch}
            onToggle={() => updateSettings({ showPanelOnLaunch: !settings.showPanelOnLaunch })}
          />

          <SettingToggleRow
            title="Suspend WebView When Closed"
            description="Free memory by pausing the WebView while the panel is collapsed"
            checked={settings.suspendWebViewWhenClosed}
            onToggle={() =>
              updateSettings({ suspendWebViewWhenClosed: !settings.suspendWebViewWhenClosed })
            }
          />
        </div>
        )}

        {/* ===================================================================== */}
        {/* CARD 6: AUDIO                                                         */}
        {/* ===================================================================== */}
        {(activeCategory === 'all' || activeCategory === 'audio') && (
        <div
          className="bento-card p-3.5 flex flex-col gap-2.5"
          style={{
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <Music className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Audio</span>
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
            >
              Media Panel
            </span>
          </div>

          <SettingToggleRow
            title="Show Mic Slider"
            description="Show the microphone volume slider in the Media panel"
            checked={settings.showMicSlider}
            onToggle={() => updateSettings({ showMicSlider: !settings.showMicSlider })}
          />

          {/* Synced-lyrics timing correction */}
          <div
            className="space-y-1 pt-1.5 border-t"
            style={{ borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))' }}
          >
            <SettingSliderRow
              title="Lyric Offset"
              valueLabel={formatSignedMs(settings.lyricOffsetMs ?? 0)}
              min={-2000}
              max={2000}
              step={50}
              value={settings.lyricOffsetMs ?? 0}
              onChange={(value) => updateSettings({ lyricOffsetMs: value })}
            />
            <div className="flex items-center justify-between gap-2">
              <span
                className="text-[10px]"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))' }}
              >
                Corrects the gap between the reported playback position and the real audio.
              </span>
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() => updateSettings({ lyricOffsetMs: 0 })}
                disabled={(settings.lyricOffsetMs ?? 0) === 0}
                className="px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none pointer-events-auto cursor-pointer shrink-0"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
                title="Reset the lyric offset to 0 ms"
              >
                Reset
              </button>
            </div>
            <div
              className="text-[10px]"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.55))' }}
            >
              Positive values highlight lyrics later, negative values earlier.
            </div>
          </div>
        </div>
        )}

        {/* ===================================================================== */}
        {/* CARD 7: DIAGNOSTICS                                                   */}
        {/* ===================================================================== */}
        {(activeCategory === 'all' || activeCategory === 'advanced') && (
        <div
          className="bento-card p-3.5 flex flex-col gap-2.5"
          style={{
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <FileText className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Diagnostics</span>
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
            >
              Logs &amp; Backup
            </span>
          </div>

          <SettingToggleRow
            title="Diagnostic Logging"
            description="Record host and bridge diagnostics to the log folder"
            checked={settings.diagnosticLogging}
            onToggle={() => updateSettings({ diagnosticLogging: !settings.diagnosticLogging })}
          />

          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[10px] font-mono"
              style={{
                color: logFeedback
                  ? logFeedback.kind === 'error'
                    ? '#f38ba8'
                    : '#a6e3a1'
                  : 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))',
              }}
            >
              {logFeedback ? logFeedback.text : 'Logs: host events + bridge calls'}
            </span>
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={handleOpenLogFolder}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition-all active:scale-95 pointer-events-auto cursor-pointer shrink-0"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                color: 'var(--theme-text-primary, #cdd6f4)',
              }}
              title="Reveal the Canopy log folder in Explorer"
            >
              <FolderOpen className="w-3 h-3" strokeWidth={2.2} />
              <span>Open Log Folder</span>
            </button>
          </div>

          {/* Settings Export / Import */}
          <div
            className="space-y-1.5 pt-1.5 border-t"
            style={{ borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))' }}
          >
            <label
              className="text-[11px] font-medium block"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))' }}
            >
              Settings Backup
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={handleExportSettings}
                className="flex-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border transition-all active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-accent, #cba6f7)',
                  borderColor: 'var(--theme-accent, #cba6f7)',
                  color: '#11111b',
                }}
                title="Download the current settings as canopy-settings.json"
              >
                <Download className="w-3 h-3" strokeWidth={2.2} />
                <span>Export Settings</span>
              </button>

              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                data-tauri-drag-region="false"
                onChange={handleImportSettingsFile}
                className="hidden pointer-events-auto cursor-pointer"
              />

              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() => importInputRef.current?.click()}
                className="flex-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border transition-all active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
                title="Load settings from a canopy-settings.json file"
              >
                <Upload className="w-3 h-3" strokeWidth={2.2} />
                <span>Import Settings</span>
              </button>
            </div>
            <div
              className="text-[10px] font-mono"
              style={{
                color: importFeedback
                  ? importFeedback.kind === 'error'
                    ? '#f38ba8'
                    : '#a6e3a1'
                  : 'var(--theme-text-secondary, rgba(205, 214, 244, 0.6))',
              }}
            >
              {importFeedback
                ? importFeedback.message
                : 'Import expects a JSON object exported from Canopy'}
            </div>
          </div>
        </div>
        )}

        {/* ===================================================================== */}
        {/* CARD 8: WALLPAPER (EXPERIMENTAL)                                      */}
        {/* ===================================================================== */}
        {(activeCategory === 'all' || activeCategory === 'advanced') && (
        <div
          className="bento-card p-3.5 flex flex-col gap-2.5"
          style={{
            borderColor: 'rgba(249, 226, 175, 0.28)',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            >
              <ImageIcon className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Wallpaper</span>
            </span>
            <span
              className="px-2 py-0.5 rounded-md text-[9px] font-mono border"
              style={{
                background: 'rgba(249, 226, 175, 0.14)',
                borderColor: 'rgba(249, 226, 175, 0.35)',
                color: '#f9e2af',
              }}
              title="Under active development — behaviour may change"
            >
              Experimental
            </span>
          </div>

          <SettingToggleRow
            title="Per-Monitor Wallpaper"
            description="Paint a different wallpaper on each connected display"
            checked={settings.wallpaperPerMonitor}
            onToggle={() => updateSettings({ wallpaperPerMonitor: !settings.wallpaperPerMonitor })}
          />

          <SettingToggleRow
            title="Wallpaper Slideshow"
            description="Rotate through the folder automatically"
            checked={settings.wallpaperSlideshowEnabled}
            onToggle={() =>
              updateSettings({ wallpaperSlideshowEnabled: !settings.wallpaperSlideshowEnabled })
            }
          />

          <SettingSliderRow
            title="Slideshow Interval"
            valueLabel={`${settings.wallpaperSlideshowMinutes} min`}
            min={5}
            max={1440}
            step={5}
            value={settings.wallpaperSlideshowMinutes}
            onChange={(value) => updateSettings({ wallpaperSlideshowMinutes: value })}
          />

          <SettingToggleRow
            title="Shuffle Order"
            description="Pick the next wallpaper at random instead of in order"
            checked={settings.wallpaperShuffle}
            onToggle={() => updateSettings({ wallpaperShuffle: !settings.wallpaperShuffle })}
          />
        </div>
        )}
      </div>
    </div>
  );
};
