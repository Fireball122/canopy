import { Music } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import {
  SegmentedChoice,
  SettingRow,
  SettingSection,
  SliderRow,
  ToggleSwitch,
} from './SettingsPrimitives';

export function AudioSection() {
  const { settings, updateSettings } = useSettings();

  return (
    <SettingSection
      title="Audio & Lyrics"
      icon={<Music className="w-4 h-4" />}
      badge="Media Engine"
    >
      <SettingRow
        title="Microphone Volume Slider"
        description="Display input gain slider on the audio controls panel"
      >
        <ToggleSwitch
          checked={settings.showMicSlider}
          onChange={(val) => updateSettings({ showMicSlider: val })}
        />
      </SettingRow>

      <SettingRow
        title="Audio Visualizer Style"
        description="Frequency spectrum visualizer rendered under album art"
      >
        <SegmentedChoice
          options={[
            { id: 'radial', label: 'Radial' },
            { id: 'bars', label: 'Bars' },
            { id: 'wave', label: 'Wave' },
          ]}
          value={settings.visualizerStyle}
          onChange={(val) => updateSettings({ visualizerStyle: val as 'radial' | 'bars' | 'wave' })}
        />
      </SettingRow>

      <SliderRow
        label="Visualizer Reactivity"
        value={Math.round((settings.visualizerSensitivity || 1.0) * 100)}
        min={50}
        max={250}
        step={10}
        unit="%"
        onChange={(val) => updateSettings({ visualizerSensitivity: val / 100 })}
      />

      <SliderRow
        label="Synced Lyrics Offset"
        value={settings.lyricOffsetMs}
        min={-2000}
        max={2000}
        step={50}
        unit="ms"
        onChange={(val) => updateSettings({ lyricOffsetMs: val })}
      />
    </SettingSection>
  );
}
