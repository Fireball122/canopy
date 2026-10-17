import { Sliders } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import {
  HotkeyRecorder,
  SegmentedChoice,
  SettingRow,
  SettingSection,
  SliderRow,
  ToggleSwitch,
} from './SettingsPrimitives';

export function TriggerSection() {
  const { settings, updateSettings } = useSettings();

  return (
    <SettingSection
      title="Hover Summon & Hotkey"
      icon={<Sliders className="w-4 h-4" />}
      badge="Interaction"
    >
      {/* Global Hotkey */}
      <SettingRow
        title="Summon Hotkey"
        description="Global shortcut to summon or dismiss the dropdown"
      >
        <HotkeyRecorder
          value={settings.globalHotkey}
          onChange={(newHotkey) => updateSettings({ globalHotkey: newHotkey })}
        />
      </SettingRow>

      {/* Top Hover Trigger Toggle */}
      <SettingRow
        title="Top-Bezel Hover Trigger"
        description="Summon the panel by moving cursor to the top monitor edge"
      >
        <ToggleSwitch
          checked={settings.topHoverTrigger}
          onChange={(val) => updateSettings({ topHoverTrigger: val })}
        />
      </SettingRow>

      {settings.topHoverTrigger && (
        <div className="flex flex-col gap-2.5 p-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-track)]">
          {/* Live Top-Bezel Trigger Visualizer */}
          <div className="flex flex-col gap-1.5 p-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)]">
            <div className="flex items-center justify-between text-[11px] text-[var(--theme-text-secondary)] font-mono">
              <span>Top Bezel Catch Zone Preview</span>
              <span className="text-[var(--theme-accent)] font-semibold">
                {settings.triggerWidth}px × {settings.triggerHeight}px
              </span>
            </div>
            <div className="relative w-full h-12 rounded-md border border-[var(--theme-border)] bg-black/20 flex flex-col items-center overflow-hidden">
              <div
                className="h-2 rounded-b-md transition-all duration-150 shadow-[0_0_8px_var(--theme-accent)]"
                style={{
                  width: `${Math.min(100, Math.max(10, (settings.triggerWidth / 1920) * 100))}%`,
                  height: `${Math.max(3, settings.triggerHeight * 0.8)}px`,
                  backgroundColor: 'var(--theme-accent)',
                }}
              />
              <div className="absolute bottom-1 text-[10px] text-[var(--theme-text-secondary)] opacity-60">
                1920px Display Frame
              </div>
            </div>
          </div>

          <SliderRow
            label="Catch Zone Width"
            value={settings.triggerWidth}
            min={150}
            max={1800}
            step={50}
            unit="px"
            onChange={(val) => updateSettings({ triggerWidth: val })}
          />

          <SliderRow
            label="Catch Zone Depth"
            value={settings.triggerHeight}
            min={2}
            max={20}
            step={1}
            unit="px"
            onChange={(val) => updateSettings({ triggerHeight: val })}
          />

          <SliderRow
            label="Hover Activation Delay"
            value={settings.triggerDelayMs}
            min={0}
            max={600}
            step={20}
            unit="ms"
            onChange={(val) => updateSettings({ triggerDelayMs: val })}
          />

          <SliderRow
            label="Auto-Hide Debounce"
            value={settings.hideDebounceMs}
            min={100}
            max={1000}
            step={50}
            unit="ms"
            onChange={(val) => updateSettings({ hideDebounceMs: val })}
          />
        </div>
      )}

      {/* Multi-Monitor Options */}
      <SettingRow title="Panel Placement" description="Which monitor to open the dropdown on">
        <SegmentedChoice
          options={[
            { id: 'cursor', label: 'Under Cursor' },
            { id: 'primary', label: 'Primary Only' },
          ]}
          value={settings.panelMonitorMode}
          onChange={(val) => updateSettings({ panelMonitorMode: val as 'cursor' | 'primary' })}
        />
      </SettingRow>

      <SettingRow
        title="Hover Monitor Scope"
        description="Monitors that listen for the top-bezel hover trigger"
      >
        <SegmentedChoice
          options={[
            { id: 'all', label: 'All Displays' },
            { id: 'primary', label: 'Primary Only' },
          ]}
          value={settings.triggerMonitorScope}
          onChange={(val) => updateSettings({ triggerMonitorScope: val as 'all' | 'primary' })}
        />
      </SettingRow>

      {/* Fullscreen & Presentation Suppression */}
      <SettingRow
        title="Pause in Full-Screen Games"
        description="Do not summon over full-screen D3D games or videos"
      >
        <ToggleSwitch
          checked={settings.pauseTriggerInFullscreen}
          onChange={(val) => updateSettings({ pauseTriggerInFullscreen: val })}
        />
      </SettingRow>

      <SettingRow
        title="Pause in Presentations"
        description="Suppress hover during PowerPoint presentations or screen shares"
      >
        <ToggleSwitch
          checked={settings.pauseTriggerDuringPresentations}
          onChange={(val) => updateSettings({ pauseTriggerDuringPresentations: val })}
        />
      </SettingRow>

      {/* Focus & Quiet Hours */}
      <SettingRow
        title="Quiet Hours (Focus)"
        description="Disable top-bezel hover during scheduled focus hours"
      >
        <ToggleSwitch
          checked={settings.quietHoursEnabled}
          onChange={(val) => updateSettings({ quietHoursEnabled: val })}
        />
      </SettingRow>

      {settings.quietHoursEnabled && (
        <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-track)]">
          <div className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            Scheduled Time
          </div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={settings.quietHoursStart}
              onChange={(e) => updateSettings({ quietHoursStart: e.target.value })}
              className="px-2 py-1 rounded-lg text-xs font-mono border bg-[var(--theme-card)] text-[var(--theme-text-primary)] border-[var(--theme-border)]"
            />
            <span className="text-xs text-[var(--theme-text-secondary)]">to</span>
            <input
              type="time"
              value={settings.quietHoursEnd}
              onChange={(e) => updateSettings({ quietHoursEnd: e.target.value })}
              className="px-2 py-1 rounded-lg text-xs font-mono border bg-[var(--theme-card)] text-[var(--theme-text-primary)] border-[var(--theme-border)]"
            />
          </div>
        </div>
      )}
    </SettingSection>
  );
}
