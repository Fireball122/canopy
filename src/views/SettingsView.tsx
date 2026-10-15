import {
  Activity,
  AppWindow,
  Clock,
  CloudSun,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Keyboard,
  Monitor,
  Moon,
  Music,
  Plus,
  Power,
  RotateCcw,
  Search,
  Sliders,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type CanopySettings, useSettings } from '../context/SettingsContext';
import {
  getInstalledApps,
  type InstalledAppItem,
  openLogFolder,
  pickExecutable,
  pickWallpaperFolder,
  setLaunchOnStartup,
  setTopHoverTrigger,
  setWallpaperDirectory,
  testNotification,
  type WallpaperEntry,
} from '../services/hostBridge';
import { applyThemeModeFallback } from '../services/palette';

export interface SettingsViewProps {
  onDirectoryChanged?: (newDir: string, entries: WallpaperEntry[]) => void;
  onThemeChanged?: () => void;
  onStartAddQuickLaunch?: () => void;
}

const DEFAULT_PINNED_APPS = ['terminal', 'explorer', 'taskmgr', 'msedge', 'code'];

function toDockSlots(list: string[] | undefined): string[] {
  const slots = (list ?? DEFAULT_PINNED_APPS).slice(0, 6);
  while (slots.length < 6) slots.push('');
  return slots;
}

function SettingSection({
  title,
  icon,
  badge,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bento-card p-4 flex flex-col gap-3 rounded-2xl border transition-all"
      style={{
        background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
      }}
    >
      <div
        className="flex items-center justify-between pb-2 border-b"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--theme-accent)' }}>{icon}</span>
          <span
            className="text-xs font-semibold tracking-wide"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            {title}
          </span>
        </div>
        {badge && (
          <span
            className="px-2 py-0.5 rounded-full text-[9px] font-mono border"
            style={{
              background: 'var(--theme-track)',
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text-secondary)',
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="flex-1 min-w-0 pr-2">
        <div className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
          {title}
        </div>
        {description && (
          <div
            className="text-[10px] leading-snug mt-0.5"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-10 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0 disabled:opacity-40"
      style={{
        background: checked
          ? 'var(--theme-accent, #cba6f7)'
          : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
      }}
    >
      <div
        className="w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
        style={{
          transform: checked ? 'translateX(20px)' : 'translateX(0px)',
        }}
      />
    </button>
  );
}

function SegmentedChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string; icon?: React.ReactNode }>;
  value: T;
  onChange: (val: T) => void;
}) {
  return (
    <div
      className="flex items-center p-0.5 rounded-xl border shrink-0"
      style={{
        background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
      }}
    >
      {options.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all flex items-center gap-1.5 pointer-events-auto cursor-pointer"
            style={{
              background: selected ? 'var(--theme-accent)' : 'transparent',
              color: selected ? '#11111b' : 'var(--theme-text-secondary)',
              fontWeight: selected ? 600 : 400,
            }}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center justify-between text-xs font-medium">
        <span style={{ color: 'var(--theme-text-primary)' }}>{label}</span>
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded-md border tabular-nums"
          style={{
            background: 'var(--theme-track)',
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-accent)',
          }}
        >
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--theme-accent)] h-1.5 rounded-lg appearance-none cursor-pointer bg-[var(--theme-track)]"
      />
    </div>
  );
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onDirectoryChanged,
  onThemeChanged,
}) => {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [directoryText, setDirectoryText] = useState(settings.wallpaperDirectory ?? '');
  const [browsingFolder, setBrowsingFolder] = useState(false);
  const [hotkeyText, setHotkeyText] = useState(settings.globalHotkey || 'Win+`');
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);
  const [availableApps, setAvailableApps] = useState<InstalledAppItem[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState<string>('');
  const [loadingApps, setLoadingApps] = useState<boolean>(false);
  const gifInputRef = useRef<HTMLInputElement | null>(null);
  const [customGifUrlInput, setCustomGifUrlInput] = useState<string>(
    settings.customMascotGifUrl || '',
  );

  const handleGifUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateSettings({ customMascotGifUrl: reader.result, mascotMode: 'gif' });
        setCustomGifUrlInput('');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

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
    app: { id: string; name: string; path: string; icon_data_url?: string | null },
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

  const handleBrowseExecutable = async () => {
    if (pickerSlotIndex === null) return;
    try {
      const filePath = await pickExecutable();
      if (!filePath) return;
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const cleanName = fileName.replace(/\.[^/.]+$/, '');
      const customId = `custom-${cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-${Date.now().toString(36)}`;
      assignAppToSlot(pickerSlotIndex, {
        id: customId,
        name: cleanName,
        path: filePath,
      });
    } catch {
      // User cancelled
    }
  };

  const clearSlot = (slotIdx: number) => {
    const slots = toDockSlots(settings.pinnedApps);
    slots[slotIdx] = '';
    updateSettings({ pinnedApps: slots });
  };

  useEffect(() => {
    setDirectoryText(settings.wallpaperDirectory ?? '');
  }, [settings.wallpaperDirectory]);

  useEffect(() => {
    setHotkeyText(settings.globalHotkey || 'Win+`');
  }, [settings.globalHotkey]);

  const commitWallpaperDirectory = async () => {
    const trimmed = directoryText.trim();
    if (!trimmed || trimmed === settings.wallpaperDirectory) return;
    try {
      const entries = await setWallpaperDirectory(trimmed);
      updateSettings({ wallpaperDirectory: trimmed });
      onDirectoryChanged?.(trimmed, entries);
    } catch {
      setDirectoryText(settings.wallpaperDirectory ?? '');
    }
  };

  const handleBrowseWallpaperDirectory = async () => {
    setBrowsingFolder(true);
    try {
      const selected = await pickWallpaperFolder(settings.wallpaperDirectory);
      if (selected && selected !== settings.wallpaperDirectory) {
        setDirectoryText(selected);
        const entries = await setWallpaperDirectory(selected);
        updateSettings({ wallpaperDirectory: selected });
        onDirectoryChanged?.(selected, entries);
      }
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleThemeModeSelect = (mode: 'canopy' | 'adaptive' | 'dark' | 'light') => {
    updateSettings({ themeMode: mode });
    applyThemeModeFallback(mode, settings.glassOpacity, settings.glassBlurStrength);
    onThemeChanged?.();
  };

  const handleBlurChange = (val: number) => {
    updateSettings({ glassBlurStrength: val });
    applyThemeModeFallback(settings.themeMode, settings.glassOpacity, val);
    onThemeChanged?.();
  };

  const handleOpacityChange = (val: number) => {
    const ratio = Number((val / 100).toFixed(2));
    updateSettings({ glassOpacity: ratio });
    applyThemeModeFallback(settings.themeMode, ratio, settings.glassBlurStrength);
    onThemeChanged?.();
  };

  const commitHotkey = () => {
    const trimmed = hotkeyText.trim();
    if (!trimmed) {
      setHotkeyText(settings.globalHotkey || 'Win+`');
      setHotkeyError(null);
      return;
    }
    const parts = trimmed.split('+').map((p) => p.trim());
    if (parts.length < 2) {
      setHotkeyError('Requires modifier + key (e.g. Win+`)');
      return;
    }
    setHotkeyError(null);
    updateSettings({ globalHotkey: trimmed });
  };

  const handleToggleStartup = async (enabled: boolean) => {
    updateSettings({ launchOnStartup: enabled });
    await setLaunchOnStartup(enabled);
  };

  const handleToggleHoverTrigger = async (enabled: boolean) => {
    updateSettings({ topHoverTrigger: enabled });
    await setTopHoverTrigger(enabled);
  };

  const exportSettingsJson = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canopy-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const raw = evt.target?.result as string;
        const parsed = JSON.parse(raw) as Partial<CanopySettings>;
        updateSettings(parsed);
        setImportStatus('Settings imported successfully');
        window.setTimeout(() => setImportStatus(null), 3000);
      } catch {
        setImportStatus('Invalid JSON settings file');
        window.setTimeout(() => setImportStatus(null), 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full flex flex-col gap-3 overflow-hidden select-none pointer-events-auto"
    >
      {/* Top Header Bar (No Category Tabs) */}
      <div
        className="bento-card px-3.5 py-2 flex items-center justify-between shrink-0"
        style={{
          background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
          borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
        }}
      >
        <div className="flex items-center gap-2">
          <Sliders className="w-3.5 h-3.5 text-[var(--theme-accent)]" />
          <span
            className="text-xs font-semibold tracking-wide"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            Canopy Preferences
          </span>
        </div>

        <button
          type="button"
          onClick={resetSettings}
          className="px-2.5 py-1 rounded-xl text-[10px] font-mono border flex items-center gap-1.5 transition-all hover:text-[#f38ba8] hover:border-[#f38ba8] pointer-events-auto cursor-pointer shrink-0"
          style={{
            background: 'var(--theme-track)',
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-text-secondary)',
          }}
          title="Reset all settings to default"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset Defaults</span>
        </button>
      </div>

      {/* Settings Dual-Column Flow (zero vertical gaps) */}
      <div
        data-tauri-drag-region="false"
        className="flex-1 overflow-y-auto pr-1 flex flex-col md:flex-row gap-3.5 items-start pointer-events-auto pb-4"
      >
        {/* Left Column Stack */}
        <div className="flex-1 w-full flex flex-col gap-3.5">
          {/* 1. GENERAL / REGIONAL */}
          <SettingSection
            title="Time & Regional"
            icon={<Clock className="w-4 h-4" />}
            badge="Clock & Calendar"
          >
            <SettingRow title="Clock Format" description="Choose 12-hour or 24-hour military clock">
              <SegmentedChoice
                options={[
                  { id: '12h', label: '12-Hour' },
                  { id: '24h', label: '24-Hour' },
                ]}
                value={settings.clockFormat}
                onChange={(val) => updateSettings({ clockFormat: val })}
              />
            </SettingRow>

            <SettingRow
              title="Show Seconds"
              description="Live second counter ticker on Dashboard clock"
            >
              <ToggleSwitch
                checked={settings.showSeconds}
                onChange={(val) => updateSettings({ showSeconds: val })}
              />
            </SettingRow>

            <SettingRow title="First Day of Week" description="Calendar week alignment">
              <SegmentedChoice
                options={[
                  { id: 'sunday', label: 'Sun' },
                  { id: 'monday', label: 'Mon' },
                ]}
                value={settings.calendarFirstDay}
                onChange={(val) => updateSettings({ calendarFirstDay: val })}
              />
            </SettingRow>
          </SettingSection>

          {/* 2. APPEARANCE & WALLPAPERS */}
          <SettingSection
            title="Wallpaper & Glass"
            icon={<ImageIcon className="w-4 h-4" />}
            badge="Theme Engine"
          >
            <SettingRow title="Theme Mode" description="Color palette source for controls & HUD">
              <SegmentedChoice
                options={[
                  { id: 'canopy', label: 'Canopy', icon: <Sparkles className="w-3 h-3" /> },
                  { id: 'adaptive', label: 'Adaptive', icon: <ImageIcon className="w-3 h-3" /> },
                  { id: 'dark', label: 'Dark', icon: <Moon className="w-3 h-3" /> },
                ]}
                value={
                  settings.themeMode === 'light' || settings.themeMode === 'auto'
                    ? 'dark'
                    : settings.themeMode
                }
                onChange={handleThemeModeSelect}
              />
            </SettingRow>

            <SliderRow
              label="Glass Blur Strength"
              value={settings.glassBlurStrength}
              min={16}
              max={32}
              unit="px"
              onChange={handleBlurChange}
            />

            <SliderRow
              label="Glass Opacity"
              value={Math.round(settings.glassOpacity * 100)}
              min={70}
              max={95}
              unit="%"
              onChange={handleOpacityChange}
            />

            <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--theme-border)]">
              <span className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                Wallpaper Directory
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={directoryText}
                  onChange={(e) => setDirectoryText(e.target.value)}
                  onBlur={() => void commitWallpaperDirectory()}
                  onKeyDown={(e) => e.key === 'Enter' && void commitWallpaperDirectory()}
                  placeholder="%USERPROFILE%\Pictures\Wallpapers"
                  className="flex-1 px-2.5 py-1 rounded-lg text-xs font-mono border bg-[var(--theme-track)] text-[var(--theme-text-primary)] border-[var(--theme-border)] outline-none truncate"
                />
                <button
                  type="button"
                  onClick={handleBrowseWallpaperDirectory}
                  disabled={browsingFolder}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all active:scale-95 shrink-0"
                  style={{
                    background: 'var(--theme-accent)',
                    color: '#11111b',
                    borderColor: 'var(--theme-accent)',
                  }}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>{browsingFolder ? 'Opening…' : 'Browse'}</span>
                </button>
              </div>
            </div>
          </SettingSection>

          {/* 3. INTERFACE & MASCOT */}
          <SettingSection
            title="Interface & Mascot"
            icon={<AppWindow className="w-4 h-4" />}
            badge="HUD Layout"
          >
            <SettingRow
              title="Mascot Spirit Mode"
              description="Animated dancing mushroom spirit / GIF"
            >
              <SegmentedChoice
                options={[
                  { id: 'bongo', label: 'Capi' },
                  { id: 'gif', label: 'Custom' },
                  { id: 'none', label: 'Off' },
                ]}
                value={settings.mascotMode}
                onChange={(val) => updateSettings({ mascotMode: val })}
              />
            </SettingRow>

            {/* Custom Mascot GIF Manager */}
            {settings.mascotMode === 'gif' && (
              <div
                className="p-3 rounded-xl border flex flex-col gap-2.5 animate-in fade-in duration-200"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.04))',
                  borderColor: 'var(--theme-accent, #cba6f7)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs font-semibold"
                    style={{ color: 'var(--theme-text-primary)' }}
                  >
                    Custom Mascot GIF
                  </span>
                  {settings.customMascotGifUrl && (
                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => updateSettings({ customMascotGifUrl: '' })}
                      className="text-[10px] text-red-400 hover:text-red-300 transition-colors pointer-events-auto cursor-pointer"
                    >
                      Clear GIF
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl border border-white/10 bg-black/30 flex items-center justify-center shrink-0 overflow-hidden relative group">
                    {settings.customMascotGifUrl ? (
                      <img
                        src={settings.customMascotGifUrl}
                        alt="Custom mascot preview"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <Upload className="w-5 h-5 text-white/30" />
                    )}
                  </div>

                  <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <input
                      ref={gifInputRef}
                      type="file"
                      accept="image/gif,image/webp,image/png,image/jpeg"
                      data-tauri-drag-region="false"
                      onChange={handleGifUpload}
                      className="hidden"
                    />

                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => gifInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition-all active:scale-95 pointer-events-auto cursor-pointer"
                      style={{
                        background: 'var(--theme-accent, #cba6f7)',
                        borderColor: 'var(--theme-accent, #cba6f7)',
                        color: '#11111b',
                      }}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {settings.customMascotGifUrl ? 'Change GIF File…' : 'Upload GIF File…'}
                      </span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        data-tauri-drag-region="false"
                        value={customGifUrlInput}
                        onChange={(e) => setCustomGifUrlInput(e.target.value)}
                        onBlur={() => {
                          if (customGifUrlInput.trim()) {
                            updateSettings({ customMascotGifUrl: customGifUrlInput.trim() });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && customGifUrlInput.trim()) {
                            updateSettings({ customMascotGifUrl: customGifUrlInput.trim() });
                          }
                        }}
                        placeholder="Or paste online GIF URL..."
                        className="w-full px-2 py-1 rounded-lg text-[10px] border bg-black/20 focus:outline-none pointer-events-auto"
                        style={{
                          borderColor: 'var(--theme-border)',
                          color: 'var(--theme-text-primary)',
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="text-[10px] text-[var(--theme-text-secondary)]">
                  Supports animated .gif and .webp. Plays rhythmically in the media panel and
                  dashboard.
                </div>
              </div>
            )}

            <SettingRow title="Show Apps Tab" description="Windows start menu app launcher tab">
              <ToggleSwitch
                checked={settings.showAppsTab}
                onChange={(val) => updateSettings({ showAppsTab: val })}
              />
            </SettingRow>

            <SettingRow
              title="Developer Tab"
              description="Show Developer PowerShell console & system fastfetch tab"
            >
              <ToggleSwitch
                checked={settings.showTerminalTab}
                onChange={(val) => updateSettings({ showTerminalTab: val })}
              />
            </SettingRow>

            <SettingRow
              title="Hardware Brightness Slider"
              description="Show display brightness slider on Dashboard"
            >
              <ToggleSwitch
                checked={settings.enableBrightnessSlider}
                onChange={(val) => updateSettings({ enableBrightnessSlider: val })}
              />
            </SettingRow>

            <SettingRow
              title="Battery Indicator Chip"
              description="Display battery status badge in top header"
            >
              <ToggleSwitch
                checked={settings.showBatteryChip}
                onChange={(val) => updateSettings({ showBatteryChip: val })}
              />
            </SettingRow>

            <SettingRow
              title="Test Raindrop Notification"
              description="Preview the top-screen raindrop to pill capsule popup"
            >
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() =>
                  void testNotification('Meeting with team in 5 minutes!', 'Canopy Reminder')
                }
                className="px-3 py-1 rounded-lg text-xs font-semibold border hover:scale-105 active:scale-95 transition-all pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-accent, #cba6f7)',
                  color: '#11111b',
                  borderColor: 'var(--theme-accent, #cba6f7)',
                }}
              >
                Send Test
              </button>
            </SettingRow>

            {/* Uniform Application Scaling Slider (Locked 850x430 Aspect Ratio) */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--theme-border)]">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <div
                    className="text-xs font-medium"
                    style={{ color: 'var(--theme-text-primary)' }}
                  >
                    Application Scale
                  </div>
                  <div className="text-[10px] text-[var(--theme-text-secondary)]">
                    Scales the entire application up or down proportionally
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-mono font-semibold"
                    style={{ color: 'var(--theme-accent)' }}
                  >
                    {Math.round((settings.appScale || 1.0) * 100)}%
                  </span>
                  <button
                    type="button"
                    data-tauri-drag-region="false"
                    onClick={() => {
                      updateSettings({
                        appScale: 1.0,
                        appWidth: 850,
                        appHeight: 430,
                      });
                    }}
                    className="px-2 py-0.5 rounded text-[10px] font-mono border hover:bg-white/10 transition-all pointer-events-auto cursor-pointer"
                    style={{
                      borderColor: 'var(--theme-border)',
                      color: 'var(--theme-text-secondary)',
                    }}
                    title="Reset to 100% scale (850x430)"
                  >
                    Reset (100%)
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={75}
                max={135}
                step={5}
                value={Math.round((settings.appScale || 1.0) * 100)}
                onChange={(e) => {
                  const newScale = Number((Number(e.target.value) / 100).toFixed(2));
                  updateSettings({
                    appScale: newScale,
                    appWidth: Math.round(850 * newScale),
                    appHeight: Math.round(430 * newScale),
                  });
                }}
                className="w-full accent-[var(--theme-accent)] h-1.5 rounded-lg appearance-none cursor-pointer bg-[var(--theme-track)]"
              />
            </div>

            {/* Quick Launch Dock App Slots */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[var(--theme-border)]">
              <div className="flex items-center justify-between">
                <div>
                  <div
                    className="text-xs font-medium"
                    style={{ color: 'var(--theme-text-primary)' }}
                  >
                    Quick Launch Dock Slots
                  </div>
                  <div className="text-[10px] text-[var(--theme-text-secondary)]">
                    Configure the 6 app shortcuts on the Dashboard dock
                  </div>
                </div>
                <button
                  type="button"
                  data-tauri-drag-region="false"
                  onClick={() => updateSettings({ pinnedApps: [...DEFAULT_PINNED_APPS, ''] })}
                  className="px-2 py-0.5 rounded text-[10px] font-mono border hover:bg-white/10 transition-all pointer-events-auto cursor-pointer"
                  style={{
                    borderColor: 'var(--theme-border)',
                    color: 'var(--theme-text-secondary)',
                  }}
                >
                  Reset Dock
                </button>
              </div>

              <div className="grid grid-cols-6 gap-1.5">
                {toDockSlots(settings.pinnedApps).map((appId, slotIdx) => {
                  const isOccupied = Boolean(appId && appId.trim().length > 0);
                  const custom = appId ? settings.customApps?.[appId] : undefined;
                  const label = custom?.label || appId || `Slot ${slotIdx + 1}`;

                  return (
                    <div
                      key={`slot-${slotIdx}`}
                      data-tauri-drag-region="false"
                      onClick={() => openAppPickerForSlot(slotIdx)}
                      className={`group relative p-1.5 rounded-xl border flex flex-col items-center justify-between min-h-[64px] transition-all hover:scale-[1.03] active:scale-95 pointer-events-auto cursor-pointer ${
                        pickerSlotIndex === slotIdx
                          ? 'ring-2 ring-[var(--theme-accent)] shadow-lg'
                          : ''
                      }`}
                      style={{
                        background: isOccupied
                          ? 'var(--theme-track, rgba(255, 255, 255, 0.05))'
                          : 'rgba(0, 0, 0, 0.2)',
                        borderColor: isOccupied
                          ? 'var(--theme-border)'
                          : 'rgba(255, 255, 255, 0.06)',
                      }}
                      title={
                        isOccupied
                          ? `Slot ${slotIdx + 1}: ${label} (Click to change)`
                          : `Slot ${slotIdx + 1}: Empty (Click to assign)`
                      }
                    >
                      {isOccupied && (
                        <button
                          type="button"
                          data-tauri-drag-region="false"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearSlot(slotIdx);
                          }}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 pointer-events-auto"
                          title="Remove app from this slot"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}

                      {isOccupied ? (
                        <div className="flex flex-col items-center gap-1 w-full text-center">
                          <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[var(--theme-accent)]">
                            {custom?.icon_data_url ? (
                              <img
                                src={custom.icon_data_url}
                                alt={label}
                                className="w-4 h-4 object-contain"
                              />
                            ) : (
                              <AppWindow className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <span
                            className="text-[9px] font-medium truncate w-full px-0.5"
                            style={{ color: 'var(--theme-text-primary)' }}
                          >
                            {label}
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 my-auto text-white/40 group-hover:text-[var(--theme-accent)] transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                          <span className="text-[9px]">Slot {slotIdx + 1}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* In-Place App Selector Modal when Slot is Clicked */}
              {pickerSlotIndex !== null && (
                <div
                  className="p-3 rounded-xl border flex flex-col gap-2 mt-1 animate-in fade-in zoom-in-95 duration-150"
                  style={{
                    background: 'var(--theme-card, rgba(20, 20, 30, 0.98))',
                    borderColor: 'var(--theme-accent, #cba6f7)',
                    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-semibold"
                        style={{ color: 'var(--theme-text-primary)' }}
                      >
                        Choose App for Slot #{pickerSlotIndex + 1}
                      </span>
                      <span className="text-[10px] text-white/40">
                        Select an installed application
                      </span>
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

                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-white/5 border-white/10">
                    <Search className="w-3.5 h-3.5 text-[var(--theme-accent)]" />
                    <input
                      type="text"
                      data-tauri-drag-region="false"
                      value={appSearchQuery}
                      onChange={(e) => setAppSearchQuery(e.target.value)}
                      placeholder="Search apps (Discord, Chrome, Steam, VS Code, Spotify...)"
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
                    <button
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={handleBrowseExecutable}
                      className="p-1 rounded text-white/50 hover:text-[var(--theme-accent)] hover:bg-white/10 transition-all pointer-events-auto cursor-pointer shrink-0"
                      title="Browse computer for an executable (.exe, .lnk)"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="max-h-44 overflow-y-auto grid grid-cols-3 gap-1.5 pr-0.5">
                    {loadingApps ? (
                      <div className="col-span-3 py-6 text-center text-xs text-white/50">
                        Scanning installed Windows apps...
                      </div>
                    ) : (
                      [
                        { id: 'terminal', name: 'Terminal', path: 'wt.exe', category: 'Developer' },
                        { id: 'explorer', name: 'Files', path: 'explorer.exe', category: 'System' },
                        {
                          id: 'taskmgr',
                          name: 'Task Manager',
                          path: 'taskmgr.exe',
                          category: 'System',
                        },
                        {
                          id: 'msedge',
                          name: 'Edge Browser',
                          path: 'msedge.exe',
                          category: 'Browser',
                        },
                        { id: 'code', name: 'VS Code', path: 'code', category: 'Developer' },
                        {
                          id: 'notepad',
                          name: 'Notepad',
                          path: 'notepad.exe',
                          category: 'Productivity',
                        },
                        { id: 'calc', name: 'Calculator', path: 'calc.exe', category: 'Utilities' },
                        { id: 'spotify', name: 'Spotify', path: 'spotify.exe', category: 'Media' },
                        ...availableApps.filter(
                          (a) =>
                            ![
                              'terminal',
                              'explorer',
                              'taskmgr',
                              'msedge',
                              'code',
                              'notepad',
                              'calc',
                              'spotify',
                            ].includes(a.id),
                        ),
                      ]
                        .filter((app) => {
                          const q = appSearchQuery.trim().toLowerCase();
                          if (!q) return true;
                          return (
                            app.name.toLowerCase().includes(q) ||
                            app.id.toLowerCase().includes(q) ||
                            Boolean(app.path?.toLowerCase().includes(q))
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
                                <img
                                  src={app.icon_data_url}
                                  alt={app.name}
                                  className="w-4 h-4 object-contain"
                                />
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
          </SettingSection>
        </div>

        {/* Right Column Stack */}
        <div className="flex-1 w-full flex flex-col gap-3.5">
          {/* 4. WEATHER */}
          <SettingSection
            title="Weather Telemetry"
            icon={<CloudSun className="w-4 h-4" />}
            badge="Open-Meteo"
          >
            <SettingRow title="Temperature Unit" description="Fahrenheit (°F) or Celsius (°C)">
              <SegmentedChoice
                options={[
                  { id: 'fahrenheit', label: '°F' },
                  { id: 'celsius', label: '°C' },
                ]}
                value={settings.temperatureUnit}
                onChange={(val) => updateSettings({ temperatureUnit: val })}
              />
            </SettingRow>

            <SettingRow
              title="Location Mode"
              description="Automatic IP-based or manual coordinates"
            >
              <SegmentedChoice
                options={[
                  { id: 'auto', label: 'Auto IP' },
                  { id: 'manual', label: 'Manual' },
                ]}
                value={settings.weatherLocationMode}
                onChange={(val) => updateSettings({ weatherLocationMode: val })}
              />
            </SettingRow>

            {settings.weatherLocationMode === 'manual' && (
              <SettingRow title="Manual City" description="City name for weather lookup">
                <input
                  type="text"
                  value={settings.manualCityName || ''}
                  onChange={(e) => updateSettings({ manualCityName: e.target.value })}
                  placeholder="e.g. Denver, CO"
                  className="px-2.5 py-1 rounded-lg text-xs font-mono border bg-[var(--theme-track)] text-[var(--theme-text-primary)] border-[var(--theme-border)] outline-none w-36"
                />
              </SettingRow>
            )}
          </SettingSection>

          {/* 5. TRIGGERS & WINDOW */}
          <SettingSection
            title="Bezel Trigger & Hotkey"
            icon={<Monitor className="w-4 h-4" />}
            badge="Win32 Hook"
          >
            <SettingRow
              title="Top Bezel Hover Trigger"
              description="Drop down panel on top-screen mouse hover"
            >
              <ToggleSwitch
                checked={settings.topHoverTrigger}
                onChange={handleToggleHoverTrigger}
              />
            </SettingRow>

            <SliderRow
              label="Trigger Bezel Width"
              value={settings.triggerWidth}
              min={200}
              max={1920}
              step={10}
              unit="px"
              onChange={(val) => updateSettings({ triggerWidth: val })}
            />

            <SliderRow
              label="Trigger Bezel Height"
              value={settings.triggerHeight}
              min={2}
              max={24}
              unit="px"
              onChange={(val) => updateSettings({ triggerHeight: val })}
            />

            <SliderRow
              label="Hover Dwell Delay"
              value={settings.triggerDelayMs}
              min={0}
              max={600}
              step={20}
              unit="ms"
              onChange={(val) => updateSettings({ triggerDelayMs: val })}
            />

            <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--theme-border)]">
              <span className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                Global Hotkey
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={hotkeyText}
                  onChange={(e) => {
                    setHotkeyText(e.target.value);
                    setHotkeyError(null);
                  }}
                  onBlur={commitHotkey}
                  onKeyDown={(e) => e.key === 'Enter' && commitHotkey()}
                  placeholder="Win+`"
                  className="flex-1 px-2.5 py-1 rounded-lg text-xs font-mono border bg-[var(--theme-track)] text-[var(--theme-text-primary)] border-[var(--theme-border)] outline-none"
                />
                <span className="text-[10px] font-mono shrink-0 px-2 py-1 rounded border border-[var(--theme-border)] text-[var(--theme-text-secondary)]">
                  <Keyboard className="w-3 h-3 inline mr-1" />
                  Press Enter
                </span>
              </div>
              {hotkeyError && <span className="text-[10px] text-[#f38ba8]">{hotkeyError}</span>}
            </div>
          </SettingSection>

          {/* 6. AUDIO & MEDIA */}
          <SettingSection
            title="Audio & Visualizer"
            icon={<Music className="w-4 h-4" />}
            badge="CoreAudio"
          >
            <SettingRow
              title="Visualizer Style"
              description="Animation style for audio loopback spectrum"
            >
              <SegmentedChoice
                options={[
                  { id: 'radial', label: 'Radial' },
                  { id: 'bars', label: 'Bars' },
                  { id: 'wave', label: 'Wave' },
                ]}
                value={settings.visualizerStyle || 'radial'}
                onChange={(val) => updateSettings({ visualizerStyle: val })}
              />
            </SettingRow>

            <SettingRow
              title="Microphone Slider"
              description="Live microphone input slider on Dashboard"
            >
              <ToggleSwitch
                checked={settings.showMicSlider}
                onChange={(val) => updateSettings({ showMicSlider: val })}
              />
            </SettingRow>

            <SettingRow
              title="Audio Session Mixer"
              description="Control per-app volumes (Spotify, Chrome, Discord)"
            >
              <div className="text-[10px] font-mono text-[var(--theme-accent)]">
                Available in Media tab
              </div>
            </SettingRow>
          </SettingSection>

          {/* 7. SYSTEM & MAINTENANCE */}
          <SettingSection
            title="System & Power"
            icon={<Power className="w-4 h-4" />}
            badge="Runtime"
          >
            <SettingRow
              title="Start on Windows Boot"
              description="Auto-register in HKCU Run to start parked in tray"
            >
              <ToggleSwitch checked={settings.launchOnStartup} onChange={handleToggleStartup} />
            </SettingRow>

            <SettingRow
              title="Pause in Fullscreen Games"
              description="Suppress hover trigger when DirectX game is active"
            >
              <ToggleSwitch
                checked={settings.pauseTriggerInFullscreen}
                onChange={(val) => updateSettings({ pauseTriggerInFullscreen: val })}
              />
            </SettingRow>

            <SettingRow
              title="Deep Sleep When Parked"
              description="Suspend WebView2 JS execution to conserve CPU/RAM"
            >
              <ToggleSwitch
                checked={settings.suspendWebViewWhenClosed}
                onChange={(val) => updateSettings({ suspendWebViewWhenClosed: val })}
              />
            </SettingRow>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--theme-border)]">
              <button
                type="button"
                onClick={() => void openLogFolder()}
                className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)]"
                style={{
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-primary)',
                }}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Open Logs</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportSettingsJson}
                  className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)]"
                  style={{
                    borderColor: 'var(--theme-border)',
                    color: 'var(--theme-text-primary)',
                  }}
                  title="Export settings JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Backup</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)]"
                  style={{
                    borderColor: 'var(--theme-border)',
                    color: 'var(--theme-text-primary)',
                  }}
                  title="Restore settings JSON"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Restore</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportJson}
                  className="hidden"
                />
              </div>
            </div>
            {importStatus && (
              <div className="text-[10px] font-mono text-center text-[var(--theme-accent)]">
                {importStatus}
              </div>
            )}
          </SettingSection>
        </div>
      </div>
    </div>
  );
};
