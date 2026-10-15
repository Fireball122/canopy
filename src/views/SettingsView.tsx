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
  Power,
  RotateCcw,
  Sliders,
  Sparkles,
  Upload,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type CanopySettings, useSettings } from '../context/SettingsContext';
import {
  openLogFolder,
  pickWallpaperFolder,
  setLaunchOnStartup,
  setTopHoverTrigger,
  setWallpaperDirectory,
  type WallpaperEntry,
} from '../services/hostBridge';
import { applyThemeModeFallback } from '../services/palette';

export interface SettingsViewProps {
  onDirectoryChanged?: (newDir: string, entries: WallpaperEntry[]) => void;
  onThemeChanged?: () => void;
  onStartAddQuickLaunch?: () => void;
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

            <SettingRow title="Show Apps Tab" description="Windows start menu app launcher tab">
              <ToggleSwitch
                checked={settings.showAppsTab}
                onChange={(val) => updateSettings({ showAppsTab: val })}
              />
            </SettingRow>

            <SettingRow
              title="Show Developer Console"
              description="Interactive PowerShell shell tab"
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
