import {
  Activity,
  AppWindow,
  Clock,
  CloudSun,
  Download,
  Power,
  RotateCcw,
  Sliders,
  Sparkles,
  Upload,
} from 'lucide-react';
import type React from 'react';
import { useRef, useState } from 'react';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { AudioSection } from '../components/settings/AudioSection';
import { DockSlotsSection } from '../components/settings/DockSlotsSection';
import {
  SegmentedChoice,
  SettingRow,
  SettingSection,
  SliderRow,
  ToggleSwitch,
} from '../components/settings/SettingsPrimitives';
import { TriggerSection } from '../components/settings/TriggerSection';
import { type CanopySettings, useSettings } from '../context/SettingsContext';
import {
  openLogFolder,
  pickWallpaperFolder,
  setLaunchOnStartup,
  setWallpaperDirectory,
  testNotification,
  type WallpaperEntry,
} from '../services/hostBridge';

export interface SettingsViewProps {
  onDirectoryChanged?: (newDir: string, entries: WallpaperEntry[]) => void;
  onThemeChanged?: () => void;
  onStartAddQuickLaunch?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onDirectoryChanged,
  onThemeChanged,
}) => {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [browsingFolder, setBrowsingFolder] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleToggleStartup = async (enabled: boolean) => {
    updateSettings({ launchOnStartup: enabled });
    await setLaunchOnStartup(enabled);
  };

  const handleBrowseWallpaperDirectory = async () => {
    setBrowsingFolder(true);
    try {
      const selected = await pickWallpaperFolder(settings.wallpaperDirectory);
      if (selected && selected !== settings.wallpaperDirectory) {
        updateSettings({ wallpaperDirectory: selected });
        const list = await setWallpaperDirectory(selected);
        onDirectoryChanged?.(selected, list);
      }
    } finally {
      setBrowsingFolder(false);
    }
  };

  const exportSettingsJson = () => {
    const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(settings, null, 2))}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `canopy-settings-${new Date().toISOString().slice(0, 10)}.json`,
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
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
      {/* Top Header Bar */}
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

      {/* Settings Dual-Column Flow */}
      <div
        data-tauri-drag-region="false"
        className="flex-1 overflow-y-auto pr-1 flex flex-col md:flex-row gap-3.5 items-start pointer-events-auto pb-4"
      >
        {/* Left Column Stack */}
        <div className="flex-1 w-full flex flex-col gap-3.5">
          {/* 1. TIME & REGIONAL */}
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
          <AppearanceSection
            onThemeChanged={onThemeChanged}
            onBrowseWallpaperFolder={handleBrowseWallpaperDirectory}
            browsingFolder={browsingFolder}
          />

          {/* 3. QUICK LAUNCH DOCK SLOTS */}
          <DockSlotsSection />

          {/* 4. MOTION & PANEL SCALE */}
          <SettingSection
            title="Motion & Dimensions"
            icon={<Sparkles className="w-4 h-4" />}
            badge="Animations"
          >
            <SettingRow
              title="Panel Animations"
              description="Smooth slide animations when expanding or collapsing"
            >
              <ToggleSwitch
                checked={settings.animationsEnabled}
                onChange={(val) => updateSettings({ animationsEnabled: val })}
              />
            </SettingRow>

            <SliderRow
              label="Animation Duration"
              value={settings.animationDurationMs}
              min={120}
              max={600}
              step={20}
              unit="ms"
              onChange={(val) => updateSettings({ animationDurationMs: val })}
            />

            <SliderRow
              label="Application Scale"
              value={Math.round((settings.appScale || 1.0) * 100)}
              min={75}
              max={135}
              step={5}
              unit="%"
              onChange={(val) => {
                const scale = val / 100;
                updateSettings({
                  appScale: scale,
                  appWidth: Math.round(850 * scale),
                  appHeight: Math.round(430 * scale),
                });
              }}
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => updateSettings({ appScale: 1.0, appWidth: 850, appHeight: 430 })}
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
          </SettingSection>

          {/* DASHBOARD & HUD */}
          <SettingSection
            title="Dashboard & HUD"
            icon={<AppWindow className="w-4 h-4" />}
            badge="Navigation"
          >
            <SettingRow title="Apps Tab" description="Windows start menu app launcher tab">
              <ToggleSwitch
                checked={settings.showAppsTab}
                onChange={(val) => updateSettings({ showAppsTab: val })}
              />
            </SettingRow>

            <SettingRow
              title="Developer Tab"
              description="Show the Developer PowerShell console & fastfetch tab"
            >
              <ToggleSwitch
                checked={settings.showTerminalTab}
                onChange={(val) => updateSettings({ showTerminalTab: val })}
              />
            </SettingRow>

            <SettingRow
              title="Hardware Brightness Slider"
              description="Show the display brightness slider on the Dashboard"
            >
              <ToggleSwitch
                checked={settings.enableBrightnessSlider}
                onChange={(val) => updateSettings({ enableBrightnessSlider: val })}
              />
            </SettingRow>

            <SettingRow
              title="Battery Indicator Chip"
              description="Display the battery status badge in the top header"
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
          </SettingSection>
        </div>

        {/* Right Column Stack */}
        <div className="flex-1 w-full flex flex-col gap-3.5">
          {/* 5. WEATHER TELEMETRY */}
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

          {/* 6. HOVER TRIGGER & MULTI-MONITOR */}
          <TriggerSection />

          {/* 7. AUDIO & LYRICS */}
          <AudioSection />

          {/* 8. SYSTEM & DIAGNOSTICS */}
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
              title="Deep Sleep When Parked"
              description="Suspend WebView2 execution when closed to conserve CPU/RAM"
            >
              <ToggleSwitch
                checked={settings.suspendWebViewWhenClosed}
                onChange={(val) => updateSettings({ suspendWebViewWhenClosed: val })}
              />
            </SettingRow>

            <SettingRow
              title="Diagnostic Logging"
              description="Record detailed interop events to %LOCALAPPDATA%\Canopy\canopy.log"
            >
              <ToggleSwitch
                checked={settings.diagnosticLogging}
                onChange={(val) => updateSettings({ diagnosticLogging: val })}
              />
            </SettingRow>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--theme-border)]">
              <button
                type="button"
                onClick={() => void openLogFolder()}
                className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)] pointer-events-auto cursor-pointer"
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
                  className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)] pointer-events-auto cursor-pointer"
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
                  className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)] pointer-events-auto cursor-pointer"
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
