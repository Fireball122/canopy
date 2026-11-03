import {
  Activity,
  AppWindow,
  Clock,
  Compass,
  Download,
  ExternalLink,
  GitBranch,
  LayoutGrid,
  Palette,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Upload,
  Volume2,
  Wifi,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  applyUpdate,
  CANOPY_VERSION,
  checkForUpdates,
  getAppVersion,
  openExternalUrl,
  openLogFolder,
  pickWallpaperFolder,
  setLaunchOnStartup,
  setWallpaperDirectory,
  testNotification,
  type UpdateCheckResult,
  type WallpaperEntry,
} from '../services/hostBridge';

export interface SettingsViewProps {
  onDirectoryChanged?: (newDir: string, entries: WallpaperEntry[]) => void;
  onThemeChanged?: () => void;
  onStartAddQuickLaunch?: () => void;
}

type SettingsCategory = 'general' | 'appearance' | 'hud' | 'dock' | 'trigger' | 'system';

export const SettingsView: React.FC<SettingsViewProps> = ({
  onDirectoryChanged,
  onThemeChanged,
}) => {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [browsingFolder, setBrowsingFolder] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentVersion, setCurrentVersion] = useState<string>(CANOPY_VERSION);

  useEffect(() => {
    let active = true;
    setCheckingUpdate(true);
    getAppVersion()
      .then((ver) => {
        if (active) setCurrentVersion(ver);
        return checkForUpdates(ver);
      })
      .then((res) => {
        if (active) {
          setUpdateInfo(res);
          setCheckingUpdate(false);
        }
      })
      .catch(() => {
        if (active) setCheckingUpdate(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleManualCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatusText(null);
    try {
      const ver = await getAppVersion();
      setCurrentVersion(ver);
      const res = await checkForUpdates(ver);
      setUpdateInfo(res);
      if (!res.updateAvailable) {
        setUpdateStatusText('Canopy is currently up to date!');
        window.setTimeout(() => setUpdateStatusText(null), 4000);
      }
    } catch {
      setUpdateStatusText('Could not reach GitHub releases.');
      window.setTimeout(() => setUpdateStatusText(null), 4000);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!updateInfo?.downloadUrl) return;
    setApplyingUpdate(true);
    setUpdateStatusText('Downloading update & launching installer...');
    try {
      await applyUpdate(updateInfo.downloadUrl);
    } catch {
      setApplyingUpdate(false);
      setUpdateStatusText('Failed to apply update.');
      window.setTimeout(() => setUpdateStatusText(null), 4000);
    }
  };

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

  const q = searchQuery.trim().toLowerCase();
  const matches = (keywords: string[]) => !q || keywords.some((k) => k.toLowerCase().includes(q));

  const CATEGORY_TABS: Array<{ id: SettingsCategory; label: string; icon: React.ReactNode }> = [
    { id: 'general', label: 'General', icon: <Compass className="w-3.5 h-3.5" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'hud', label: 'Dashboard & HUD', icon: <AppWindow className="w-3.5 h-3.5" /> },
    { id: 'dock', label: 'Tabs & Dock', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'trigger', label: 'Trigger & Motion', icon: <Zap className="w-3.5 h-3.5" /> },
    { id: 'system', label: 'System & Audio', icon: <Power className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="w-full h-full flex flex-col gap-2.5 overflow-hidden select-none pointer-events-auto">
      {/* Top Header Bar */}
      <div
        className="bento-card px-3.5 py-1.5 flex items-center justify-between shrink-0"
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
            Preferences
          </span>
          <span
            className="text-[10px] font-mono px-1.5 py-0.2 rounded border"
            style={{
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text-secondary)',
              background: 'var(--theme-track)',
            }}
          >
            v{currentVersion}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2 text-[var(--theme-text-secondary)] pointer-events-none" />
            <input
              type="text"
              placeholder="Search preferences..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-6 py-1 rounded-lg text-xs bg-[var(--theme-track)] border border-[var(--theme-border)] text-[var(--theme-text-primary)] placeholder-[var(--theme-text-secondary)] focus:outline-none focus:border-[var(--theme-accent)] w-48 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-xs text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] cursor-pointer"
              >
                ×
              </button>
            )}
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
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Category Navigation Pills (Only shown when not actively searching) */}
      {!q && (
        <div
          className="bento-card p-1 flex items-center gap-1 shrink-0 overflow-x-auto"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeCategory === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCategory(tab.id)}
                className="flex-1 py-1 px-2.5 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 pointer-events-auto cursor-pointer whitespace-nowrap"
                style={{
                  background: isActive ? 'var(--theme-accent)' : 'transparent',
                  color: isActive
                    ? 'var(--theme-on-accent, #111913)'
                    : 'var(--theme-text-secondary)',
                  fontWeight: isActive ? 600 : 400,
                  boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
                }}
              >
                <span className={isActive ? 'opacity-100' : 'opacity-70'}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Settings Content Area */}
      <div className="flex-1 overflow-y-auto pr-1 pointer-events-auto pb-4 canopy-scroll">
        {q ? (
          /* Global Search Matches Mode */
          <div className="grid grid-cols-2 gap-3.5 items-start">
            {/* Matches: Appearance */}
            {matches([
              'appearance',
              'theme',
              'wallpaper',
              'glass',
              'blur',
              'opacity',
              'accent',
              'oled',
              'mascot',
              'slideshow',
            ]) && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--theme-accent)] px-1">
                  Appearance
                </span>
                <AppearanceSection
                  onThemeChanged={onThemeChanged}
                  onBrowseWallpaperFolder={handleBrowseWallpaperDirectory}
                  browsingFolder={browsingFolder}
                />
              </div>
            )}

            {/* Matches: Dashboard & Widgets */}
            {matches([
              'calendar',
              'weather',
              'dock',
              'specs',
              'uptime',
              'widgets',
              'dashboard',
              'sliders',
              'volume',
              'brightness',
              'mic',
            ]) && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--theme-accent)] px-1">
                  Dashboard & HUD
                </span>
                <SettingSection
                  title="Dashboard Widgets"
                  icon={<LayoutGrid className="w-4 h-4" />}
                  badge="HUD Layout"
                >
                  <SettingRow
                    title="Calendar Card"
                    description="Interactive monthly calendar and reminder alerts on Dashboard"
                  >
                    <ToggleSwitch
                      checked={settings.showCalendarWidget !== false}
                      onChange={(val) => updateSettings({ showCalendarWidget: val })}
                    />
                  </SettingRow>

                  <SettingRow
                    title="Weather Station Card"
                    description="Live local temperature and weather conditions on Dashboard"
                  >
                    <ToggleSwitch
                      checked={settings.showWeatherWidget !== false}
                      onChange={(val) => updateSettings({ showWeatherWidget: val })}
                    />
                  </SettingRow>

                  <SettingRow
                    title="Quick Apps Dock"
                    description="Quick-launch pinned app shortcuts bar in center column"
                  >
                    <ToggleSwitch
                      checked={settings.showQuickAppsDock !== false}
                      onChange={(val) => updateSettings({ showQuickAppsDock: val })}
                    />
                  </SettingRow>

                  <SettingRow
                    title="System Status Bar"
                    description="Hostname, Awake caffeine toggle, DND, and Screen Snip header"
                  >
                    <ToggleSwitch
                      checked={settings.showSystemSpecs !== false}
                      onChange={(val) => updateSettings({ showSystemSpecs: val })}
                    />
                  </SettingRow>
                </SettingSection>
              </div>
            )}

            {/* Matches: Navigation Tabs */}
            {matches([
              'tabs',
              'connect',
              'performance',
              'apps',
              'wallpaper tab',
              'weather tab',
              'terminal',
              'hotspot',
              'battery saver',
              'cast',
            ]) && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--theme-accent)] px-1">
                  Tabs & Navigation
                </span>
                <SettingSection
                  title="Navigation Tabs"
                  icon={<Sliders className="w-4 h-4" />}
                  badge="Header Bar"
                >
                  <SettingRow
                    title="Connect Tab"
                    description="Wi-Fi, Bluetooth, Mobile Hotspot, and Wireless Display"
                  >
                    <ToggleSwitch
                      checked={settings.showNetworkTab}
                      onChange={(val) => updateSettings({ showNetworkTab: val })}
                    />
                  </SettingRow>

                  <SettingRow
                    title="Performance Tab"
                    description="CPU, GPU, RAM, Disk, and hardware gauges"
                  >
                    <ToggleSwitch
                      checked={settings.showPerformanceTab}
                      onChange={(val) => updateSettings({ showPerformanceTab: val })}
                    />
                  </SettingRow>

                  <SettingRow
                    title="Apps Tab"
                    description="Windows start menu app search & catalogue"
                  >
                    <ToggleSwitch
                      checked={settings.showAppsTab}
                      onChange={(val) => updateSettings({ showAppsTab: val })}
                    />
                  </SettingRow>

                  <SettingRow
                    title="Terminal Tab"
                    description="Developer CLI terminal and command utilities"
                  >
                    <ToggleSwitch
                      checked={settings.showTerminalTab}
                      onChange={(val) => updateSettings({ showTerminalTab: val })}
                    />
                  </SettingRow>
                </SettingSection>
              </div>
            )}

            {/* Matches: Trigger & Hotkey */}
            {matches([
              'trigger',
              'hover',
              'hotkey',
              'shortcut',
              'summon',
              'monitor',
              'fullscreen',
              'quiet hours',
              'motion',
              'animation',
              'scale',
            ]) && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--theme-accent)] px-1">
                  Trigger & Motion
                </span>
                <TriggerSection />
              </div>
            )}

            {/* Matches: Audio & System */}
            {matches([
              'audio',
              'visualizer',
              'lyrics',
              'startup',
              'boot',
              'sleep',
              'suspend',
              'log',
              'backup',
              'restore',
              'update',
            ]) && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--theme-accent)] px-1">
                  System & Audio
                </span>
                <AudioSection />
              </div>
            )}
          </div>
        ) : (
          /* Focused Category Tab View (Clean, Non-crowded) */
          <>
            {/* 1. GENERAL TAB (PRIMARY ESSENTIALS & UPDATES) */}
            {activeCategory === 'general' && (
              <div className="grid grid-cols-2 gap-3.5 items-start">
                {/* Left Column: Updates, Version & Core Startup */}
                <div className="flex flex-col gap-3.5">
                  <SettingSection
                    title="Software Updates"
                    icon={<RefreshCw className="w-4 h-4" />}
                    badge={`v${currentVersion}`}
                  >
                    <SettingRow
                      title="Canopy Version"
                      description={
                        updateInfo?.updateAvailable
                          ? `Update ready: v${updateInfo.latestVersion} (Current: v${currentVersion})`
                          : `You are on the latest build (v${currentVersion})`
                      }
                    >
                      <div className="flex items-center gap-2">
                        {updateInfo?.updateAvailable ? (
                          <button
                            type="button"
                            disabled={applyingUpdate}
                            onClick={handleApplyUpdate}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all shadow-md active:scale-95 pointer-events-auto cursor-pointer animate-pulse"
                            style={{
                              background: 'var(--theme-accent, #16a34a)',
                              color: 'var(--theme-on-accent, #ffffff)',
                              borderColor: 'var(--theme-accent, #16a34a)',
                            }}
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>
                              {applyingUpdate
                                ? 'Updating...'
                                : `Update to v${updateInfo.latestVersion}`}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={checkingUpdate}
                            onClick={handleManualCheckUpdate}
                            className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)] active:scale-95 pointer-events-auto cursor-pointer"
                            style={{
                              borderColor: 'var(--theme-border)',
                              color: 'var(--theme-text-primary)',
                            }}
                          >
                            <RefreshCw
                              className={`w-3 h-3 ${checkingUpdate ? 'animate-spin' : ''}`}
                            />
                            <span>{checkingUpdate ? 'Checking...' : 'Check for Updates'}</span>
                          </button>
                        )}
                      </div>
                    </SettingRow>

                    {updateStatusText && (
                      <div className="text-[10px] font-mono text-center text-[var(--theme-accent)] pt-0.5">
                        {updateStatusText}
                      </div>
                    )}

                    <SettingRow
                      title="GitHub Repository"
                      description="View release notes, changelogs, and issues"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          void openExternalUrl(
                            updateInfo?.releaseUrl || 'https://github.com/Fireball122/canopy',
                          )
                        }
                        className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)] hover:scale-[1.02] active:scale-95 pointer-events-auto cursor-pointer"
                        style={{
                          borderColor: 'var(--theme-border)',
                          color: 'var(--theme-text-primary)',
                        }}
                      >
                        <span>Fireball122/canopy</span>
                        <ExternalLink className="w-3 h-3 text-[var(--theme-accent)]" />
                      </button>
                    </SettingRow>
                  </SettingSection>

                  <SettingSection
                    title="Startup & Window Behavior"
                    icon={<Power className="w-4 h-4" />}
                    badge="Windows Integration"
                  >
                    <SettingRow
                      title="Launch on Windows Boot"
                      description="Start minimized in system tray when Windows boots"
                    >
                      <ToggleSwitch
                        checked={settings.launchOnStartup}
                        onChange={handleToggleStartup}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Top Bezel Hover Trigger"
                      description="Slide down HUD when moving cursor to top edge"
                    >
                      <ToggleSwitch
                        checked={settings.topHoverTrigger}
                        onChange={(val) => updateSettings({ topHoverTrigger: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Screen Position Anchor"
                      description="Where the overlay aligns at the top of the monitor"
                    >
                      <SegmentedChoice
                        options={[
                          { id: 'top-center', label: 'Center' },
                          { id: 'top-left', label: 'Left' },
                          { id: 'top-right', label: 'Right' },
                        ]}
                        value={settings.panelAnchor || 'top-center'}
                        onChange={(val) => updateSettings({ panelAnchor: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Display Monitor Target"
                      description="Which screen the overlay attaches to"
                    >
                      <SegmentedChoice
                        options={[
                          { id: 'cursor', label: 'Active (Cursor)' },
                          { id: 'primary', label: 'Primary Only' },
                        ]}
                        value={settings.panelMonitorMode || 'cursor'}
                        onChange={(val) => updateSettings({ panelMonitorMode: val })}
                      />
                    </SettingRow>
                  </SettingSection>
                </div>

                {/* Right Column: Theme Quick Switch, Diagnostics & Compatibility */}
                <div className="flex flex-col gap-3.5">
                  <SettingSection
                    title="Appearance & Theme"
                    icon={<Palette className="w-4 h-4" />}
                    badge={settings.themeMode.toUpperCase()}
                  >
                    <SettingRow
                      title="Theme Mode"
                      description="Switch between signature Canopy, Adaptive, Dark OLED, and Light"
                    >
                      <SegmentedChoice
                        options={[
                          { id: 'canopy', label: 'Canopy' },
                          { id: 'dark', label: 'Dark' },
                          { id: 'light', label: 'Light' },
                          { id: 'auto', label: 'Auto' },
                        ]}
                        value={settings.themeMode}
                        onChange={(val) => {
                          updateSettings({ themeMode: val });
                          onThemeChanged?.();
                        }}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Smooth Animations"
                      description="Hardware-accelerated slide and fade transitions"
                    >
                      <ToggleSwitch
                        checked={settings.animationsEnabled !== false}
                        onChange={(val) => updateSettings({ animationsEnabled: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Deep Sleep When Parked"
                      description="Suspend WebView2 execution when closed to free CPU/RAM"
                    >
                      <ToggleSwitch
                        checked={settings.suspendWebViewWhenClosed}
                        onChange={(val) => updateSettings({ suspendWebViewWhenClosed: val })}
                      />
                    </SettingRow>
                  </SettingSection>

                  <SettingSection
                    title="Device & Environment"
                    icon={<ShieldCheck className="w-4 h-4" />}
                    badge="Universal Win32"
                  >
                    <div
                      className="p-2.5 rounded-xl border flex flex-col gap-2 text-xs"
                      style={{
                        background: 'var(--theme-track)',
                        borderColor: 'var(--theme-border)',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10.5px] text-[var(--theme-text-secondary)]">
                          Compatibility
                        </span>
                        <span className="font-semibold text-emerald-500 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Windows 10 / 11 Verified
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10.5px] text-[var(--theme-text-secondary)]">
                          DPI Scaling
                        </span>
                        <span className="font-mono text-[10.5px] text-[var(--theme-text-primary)]">
                          PerMonitorV2 Native
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10.5px] text-[var(--theme-text-secondary)]">
                          UI Runtime
                        </span>
                        <span className="font-mono text-[10.5px] text-[var(--theme-text-primary)]">
                          WebView2 Evergreen
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-[var(--theme-border)]">
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
                        <span>Diagnostics Log</span>
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
                      </div>
                    </div>
                  </SettingSection>
                </div>
              </div>
            )}

            {/* 2. APPEARANCE TAB */}
            {activeCategory === 'appearance' && (
              <div className="flex flex-col gap-3.5">
                <AppearanceSection
                  onThemeChanged={onThemeChanged}
                  onBrowseWallpaperFolder={handleBrowseWallpaperDirectory}
                  browsingFolder={browsingFolder}
                />
              </div>
            )}

            {/* 2. DASHBOARD & HUD TAB */}
            {activeCategory === 'hud' && (
              <div className="grid grid-cols-2 gap-3.5 items-start">
                <div className="flex flex-col gap-3.5">
                  <SettingSection
                    title="Dashboard Widgets"
                    icon={<LayoutGrid className="w-4 h-4" />}
                    badge="HUD Layout"
                  >
                    <SettingRow
                      title="Calendar Card"
                      description="Interactive monthly calendar and reminder alerts on Dashboard"
                    >
                      <ToggleSwitch
                        checked={settings.showCalendarWidget !== false}
                        onChange={(val) => updateSettings({ showCalendarWidget: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Weather Station Card"
                      description="Live local temperature and weather conditions on Dashboard"
                    >
                      <ToggleSwitch
                        checked={settings.showWeatherWidget !== false}
                        onChange={(val) => updateSettings({ showWeatherWidget: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Quick Apps Dock"
                      description="Quick-launch pinned app shortcuts bar in center column"
                    >
                      <ToggleSwitch
                        checked={settings.showQuickAppsDock !== false}
                        onChange={(val) => updateSettings({ showQuickAppsDock: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="System Status Bar"
                      description="Hostname, Awake caffeine toggle, DND, and Screen Snip header"
                    >
                      <ToggleSwitch
                        checked={settings.showSystemSpecs !== false}
                        onChange={(val) => updateSettings({ showSystemSpecs: val })}
                      />
                    </SettingRow>
                  </SettingSection>

                  <SettingSection
                    title="Audio & Monitor Sliders"
                    icon={<Volume2 className="w-4 h-4" />}
                    badge="Deck"
                  >
                    <SettingRow
                      title="Master Volume Slider"
                      description="Vertical master audio volume control slider"
                    >
                      <ToggleSwitch
                        checked={settings.showVolumeSlider !== false}
                        onChange={(val) => updateSettings({ showVolumeSlider: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Hardware Brightness Slider"
                      description="Monitor DDC/CI hardware brightness control slider"
                    >
                      <ToggleSwitch
                        checked={settings.enableBrightnessSlider}
                        onChange={(val) => updateSettings({ enableBrightnessSlider: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Microphone Level Slider"
                      description="Input microphone volume control and mute toggle"
                    >
                      <ToggleSwitch
                        checked={settings.showMicSlider}
                        onChange={(val) => updateSettings({ showMicSlider: val })}
                      />
                    </SettingRow>
                  </SettingSection>
                </div>

                <div className="flex flex-col gap-3.5">
                  <SettingSection
                    title="Header & Telemetry"
                    icon={<AppWindow className="w-4 h-4" />}
                    badge="Top Bar"
                  >
                    <SettingRow
                      title="Quick Search Button"
                      description="Command palette search icon in top header bar"
                    >
                      <ToggleSwitch
                        checked={settings.showHeaderSearch}
                        onChange={(val) => updateSettings({ showHeaderSearch: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Battery Charge Chip"
                      description="Percentage readout in the top header bar"
                    >
                      <ToggleSwitch
                        checked={settings.showBatteryChip}
                        onChange={(val) => updateSettings({ showBatteryChip: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Battery Position"
                      description="Left or right side of the header bar"
                    >
                      <SegmentedChoice
                        options={[
                          { id: 'left', label: 'Left (Default)' },
                          { id: 'right', label: 'Right' },
                        ]}
                        value={settings.batteryPosition || 'left'}
                        onChange={(val) =>
                          updateSettings({ batteryPosition: val as 'left' | 'right' })
                        }
                      />
                    </SettingRow>

                    <SettingRow
                      title="Search Position"
                      description="Side of header where Quick Search button appears"
                    >
                      <SegmentedChoice
                        options={[
                          { id: 'left', label: 'Left' },
                          { id: 'right', label: 'Right (Default)' },
                        ]}
                        value={
                          settings.searchPosition ||
                          (settings.batteryPosition === 'left' ? 'right' : 'left')
                        }
                        onChange={(val) =>
                          updateSettings({ searchPosition: val as 'left' | 'right' })
                        }
                      />
                    </SettingRow>
                  </SettingSection>

                  <SettingSection
                    title="Time & Weather"
                    icon={<Clock className="w-4 h-4" />}
                    badge="Regional"
                  >
                    <SettingRow title="Clock Format" description="Choose 12-hour or 24-hour clock">
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

                    <SettingRow
                      title="Temperature Unit"
                      description="Fahrenheit (°F) or Celsius (°C)"
                    >
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
                      title="Weather Location"
                      description="Automatic IP-based or manual city"
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
                </div>
              </div>
            )}

            {/* 3. TABS & DOCK TAB */}
            {activeCategory === 'dock' && (
              <div className="grid grid-cols-2 gap-3.5 items-start">
                <div className="flex flex-col gap-3.5">
                  <SettingSection
                    title="Navigation Tabs"
                    icon={<Sliders className="w-4 h-4" />}
                    badge="Header Bar"
                  >
                    <div className="text-[11px] text-[var(--theme-text-secondary)] pb-1">
                      Dashboard, Media, Power, and Settings are essential permanent tabs.
                    </div>

                    <SettingRow
                      title="Connect Tab"
                      description="Wi-Fi, Bluetooth, Mobile Hotspot, and Wireless Display"
                    >
                      <ToggleSwitch
                        checked={settings.showNetworkTab}
                        onChange={(val) => updateSettings({ showNetworkTab: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Performance Tab"
                      description="CPU, GPU, RAM, Disk, and hardware telemetry gauges"
                    >
                      <ToggleSwitch
                        checked={settings.showPerformanceTab}
                        onChange={(val) => updateSettings({ showPerformanceTab: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Apps Tab"
                      description="Windows start menu app search & catalogue"
                    >
                      <ToggleSwitch
                        checked={settings.showAppsTab}
                        onChange={(val) => updateSettings({ showAppsTab: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Wallpaper Tab"
                      description="Wallpaper gallery and per-monitor selection"
                    >
                      <ToggleSwitch
                        checked={settings.showWallpaperTab}
                        onChange={(val) => updateSettings({ showWallpaperTab: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Weather Tab"
                      description="Detailed hourly and 7-day weather forecast"
                    >
                      <ToggleSwitch
                        checked={settings.showWeatherTab}
                        onChange={(val) => updateSettings({ showWeatherTab: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Terminal Tab"
                      description="Developer CLI terminal and command utilities"
                    >
                      <ToggleSwitch
                        checked={settings.showTerminalTab}
                        onChange={(val) => updateSettings({ showTerminalTab: val })}
                      />
                    </SettingRow>
                  </SettingSection>

                  <SettingSection
                    title="Connect Tab Features"
                    icon={<Wifi className="w-4 h-4" />}
                    badge="Hardware"
                  >
                    <SettingRow
                      title="Mobile Hotspot"
                      description="Enable hotspot capsule and broadcast controls"
                    >
                      <ToggleSwitch
                        checked={settings.enableHotspotToggle}
                        onChange={(val) => updateSettings({ enableHotspotToggle: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Battery Saver"
                      description="Windows power saving mode quick switch"
                    >
                      <ToggleSwitch
                        checked={settings.enablePowerSaverToggle}
                        onChange={(val) => updateSettings({ enablePowerSaverToggle: val })}
                      />
                    </SettingRow>

                    <SettingRow
                      title="Wireless Display / Cast"
                      description="Miracast and external display connect trigger"
                    >
                      <ToggleSwitch
                        checked={settings.enableCastingToggle}
                        onChange={(val) => updateSettings({ enableCastingToggle: val })}
                      />
                    </SettingRow>
                  </SettingSection>
                </div>

                <div className="flex flex-col gap-3.5">
                  <DockSlotsSection />
                </div>
              </div>
            )}

            {/* 4. TRIGGER & MOTION TAB */}
            {activeCategory === 'trigger' && (
              <div className="grid grid-cols-2 gap-3.5 items-start">
                <div className="flex flex-col gap-3.5">
                  <TriggerSection />
                </div>

                <div className="flex flex-col gap-3.5">
                  <SettingSection
                    title="Motion & Dimensions"
                    icon={<Sparkles className="w-4 h-4" />}
                    badge="Geometry"
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

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateSettings({ appScale: 1.0, appWidth: 850, appHeight: 430 })
                        }
                        className="px-2.5 py-1 rounded-lg text-[10px] font-mono border hover:bg-white/10 transition-all pointer-events-auto cursor-pointer"
                        style={{
                          borderColor: 'var(--theme-border)',
                          color: 'var(--theme-text-secondary)',
                        }}
                        title="Reset to 100% scale (850x430)"
                      >
                        Reset Scale (100%)
                      </button>
                    </div>
                  </SettingSection>
                </div>
              </div>
            )}

            {/* 5. SYSTEM & AUDIO TAB */}
            {activeCategory === 'system' && (
              <div className="grid grid-cols-2 gap-3.5 items-start">
                <div className="flex flex-col gap-3.5">
                  <AudioSection />

                  <SettingSection
                    title="Notifications & Alerts"
                    icon={<Sparkles className="w-4 h-4" />}
                    badge="Raindrop Pill"
                  >
                    <SettingRow
                      title="Test Native Notification"
                      description="Trigger the expanding raindrop pill banner from the bezel"
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          await testNotification(
                            'Raindrop to Pill Capsule alert working seamlessly!',
                          );
                        }}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all shadow-sm active:scale-95 pointer-events-auto cursor-pointer"
                        style={{
                          background: 'var(--theme-accent, #74a86c)',
                          color: 'var(--theme-on-accent, #111913)',
                          borderColor: 'var(--theme-accent, #74a86c)',
                        }}
                      >
                        Send Test
                      </button>
                    </SettingRow>
                  </SettingSection>
                </div>

                <div className="flex flex-col gap-3.5">
                  <SettingSection
                    title="System & Power"
                    icon={<Power className="w-4 h-4" />}
                    badge="Runtime"
                  >
                    <SettingRow
                      title="Start on Windows Boot"
                      description="Auto-register in HKCU Run to start parked in tray"
                    >
                      <ToggleSwitch
                        checked={settings.launchOnStartup}
                        onChange={handleToggleStartup}
                      />
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

                  <SettingSection
                    title="Updates & Repository"
                    icon={<GitBranch className="w-4 h-4" />}
                    badge={`v${currentVersion}`}
                  >
                    <SettingRow
                      title="GitHub Repository"
                      description="View open-source repository, releases, and issue tracker"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          void openExternalUrl('https://github.com/Fireball122/canopy')
                        }
                        className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)] hover:scale-[1.02] active:scale-95 pointer-events-auto cursor-pointer"
                        style={{
                          borderColor: 'var(--theme-border)',
                          color: 'var(--theme-text-primary)',
                        }}
                      >
                        <span>Fireball122/canopy</span>
                        <ExternalLink className="w-3 h-3 text-[var(--theme-accent)]" />
                      </button>
                    </SettingRow>

                    <SettingRow
                      title="Version & Status"
                      description={
                        updateInfo?.updateAvailable
                          ? `A new release (v${updateInfo.latestVersion}) is available on GitHub!`
                          : `Canopy is up to date (v${currentVersion})`
                      }
                    >
                      <div className="flex items-center gap-2">
                        {updateInfo?.updateAvailable ? (
                          <button
                            type="button"
                            disabled={applyingUpdate}
                            onClick={handleApplyUpdate}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all shadow-md active:scale-95 pointer-events-auto cursor-pointer animate-pulse"
                            style={{
                              background: 'var(--theme-accent, #74a86c)',
                              color: 'var(--theme-on-accent, #111913)',
                              borderColor: 'var(--theme-accent, #74a86c)',
                            }}
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>
                              {applyingUpdate
                                ? 'Updating...'
                                : `Update to v${updateInfo.latestVersion}`}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={checkingUpdate}
                            onClick={handleManualCheckUpdate}
                            className="px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-1.5 transition-all hover:bg-[var(--theme-track)] active:scale-95 pointer-events-auto cursor-pointer"
                            style={{
                              borderColor: 'var(--theme-border)',
                              color: 'var(--theme-text-primary)',
                            }}
                          >
                            <RefreshCw
                              className={`w-3 h-3 ${checkingUpdate ? 'animate-spin' : ''}`}
                            />
                            <span>{checkingUpdate ? 'Checking...' : 'Check for Updates'}</span>
                          </button>
                        )}
                      </div>
                    </SettingRow>

                    {updateStatusText && (
                      <div className="text-[10px] font-mono text-center text-[var(--theme-accent)] pt-1">
                        {updateStatusText}
                      </div>
                    )}
                  </SettingSection>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
