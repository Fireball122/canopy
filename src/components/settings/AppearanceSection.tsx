import { FolderOpen, Image as ImageIcon, Monitor, Moon, Sparkles, Sun, Upload } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import {
  getDesktopWallpaperState,
  setDesktopWallpaperState,
  uploadMascot,
} from '../../services/hostBridge';
import { applyThemeModeFallback } from '../../services/palette';
import {
  SegmentedChoice,
  SettingRow,
  SettingSection,
  SliderRow,
  ToggleSwitch,
} from './SettingsPrimitives';

export function AppearanceSection({
  onThemeChanged,
  onBrowseWallpaperFolder,
  browsingFolder,
}: {
  onThemeChanged?: () => void;
  onBrowseWallpaperFolder?: () => void;
  browsingFolder?: boolean;
}) {
  const { settings, updateSettings } = useSettings();
  const gifInputRef = useRef<HTMLInputElement | null>(null);
  const [customGifUrlInput, setCustomGifUrlInput] = useState<string>(
    settings.customMascotGifUrl || '',
  );

  const handleThemeModeSelect = (mode: 'canopy' | 'adaptive' | 'dark' | 'light' | 'auto') => {
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

  // The host owns the live slideshow (WallpaperView toggles the same state), so changes are
  // pushed through setDesktopWallpaperState rather than only stored in settings.
  const applySlideshowEnabled = (enabled: boolean) => {
    updateSettings({ wallpaperSlideshowEnabled: enabled });
    void setDesktopWallpaperState({ slideshow_enabled: enabled }).catch(() => undefined);
  };

  const applySlideshowMinutes = (minutes: number) => {
    updateSettings({ wallpaperSlideshowMinutes: minutes });
    void setDesktopWallpaperState({ slideshow_minutes: minutes }).catch(() => undefined);
  };

  const handleGifUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        try {
          const uploaded = await uploadMascot(file.name, reader.result);
          if (uploaded?.url) {
            updateSettings({ customMascotGifUrl: uploaded.url, mascotMode: 'gif' });
            setCustomGifUrlInput('');
            return;
          }
        } catch {
          // Fallback to data URL
        }
        updateSettings({ customMascotGifUrl: reader.result, mascotMode: 'gif' });
        setCustomGifUrlInput('');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // The live slideshow is host state and WallpaperView can start/stop it, so mirror the real
  // state once on mount rather than trusting a possibly-stale stored value.
  useEffect(() => {
    let active = true;
    void getDesktopWallpaperState()
      .then((state) => {
        if (!active) return;
        updateSettings({
          wallpaperSlideshowEnabled: state.slideshow_enabled,
          wallpaperSlideshowMinutes: state.slideshow_minutes,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [updateSettings]);

  return (
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
            { id: 'light', label: 'Light', icon: <Sun className="w-3 h-3" /> },
            { id: 'auto', label: 'Auto', icon: <Monitor className="w-3 h-3" /> },
          ]}
          value={settings.themeMode}
          onChange={(val) =>
            handleThemeModeSelect(val as 'canopy' | 'adaptive' | 'dark' | 'light' | 'auto')
          }
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

      {/* Wallpaper Folder */}
      <SettingRow
        title="Wallpaper Directory"
        description="Local folder scanned for desktop backgrounds"
      >
        <button
          type="button"
          onClick={onBrowseWallpaperFolder}
          disabled={browsingFolder}
          className="px-3 py-1.5 rounded-xl border text-xs font-mono transition-all flex items-center gap-1.5 hover:border-[var(--theme-accent)] pointer-events-auto cursor-pointer"
          style={{
            background: 'var(--theme-track)',
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-text-primary)',
          }}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>{browsingFolder ? 'Selecting…' : 'Browse…'}</span>
        </button>
      </SettingRow>

      {/* Slideshow Engine */}
      <SettingRow
        title="Wallpaper Slideshow"
        description="Automatically cycle desktop backgrounds on a timer"
      >
        <ToggleSwitch
          checked={settings.wallpaperSlideshowEnabled}
          onChange={applySlideshowEnabled}
        />
      </SettingRow>

      {settings.wallpaperSlideshowEnabled && (
        <div className="flex flex-col gap-2 p-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-track)]">
          <SettingRow title="Interval" description="How often to switch to the next wallpaper">
            <select
              value={settings.wallpaperSlideshowMinutes}
              onChange={(e) => applySlideshowMinutes(Number(e.target.value))}
              className="px-2 py-1 rounded-lg text-xs font-mono border bg-[var(--theme-card)] text-[var(--theme-text-primary)] border-[var(--theme-border)]"
            >
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
              <option value={360}>6 hours</option>
              <option value={720}>12 hours</option>
              <option value={1440}>24 hours</option>
            </select>
          </SettingRow>
          <SettingRow
            title="Per-Monitor Wallpapers"
            description="Assign different wallpapers to each display"
          >
            <ToggleSwitch
              checked={settings.wallpaperPerMonitor}
              onChange={(val) => updateSettings({ wallpaperPerMonitor: val })}
            />
          </SettingRow>
        </div>
      )}

      {/* Mascot Customization */}
      <SettingRow
        title="Dashboard Mascot"
        description="Interactive pet displayed on the dashboard HUD"
      >
        <SegmentedChoice
          options={[
            { id: 'bongo', label: 'Bongo' },
            { id: 'gif', label: 'Custom' },
            { id: 'none', label: 'Off' },
          ]}
          value={settings.mascotMode}
          onChange={(val) => updateSettings({ mascotMode: val as 'bongo' | 'gif' | 'none' })}
        />
      </SettingRow>

      {settings.mascotMode === 'gif' && (
        <div
          className="p-3 rounded-xl border flex flex-col gap-2.5"
          style={{
            background: 'var(--theme-track, rgba(255, 255, 255, 0.03))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[11px] font-medium"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              Custom GIF or WebP File
            </span>
            {settings.customMascotGifUrl && (
              <button
                type="button"
                onClick={() => updateSettings({ customMascotGifUrl: '' })}
                className="text-[10px] text-red-400 hover:text-red-300 transition-colors pointer-events-auto cursor-pointer"
              >
                Clear GIF
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl border border-white/10 bg-black/30 flex items-center justify-center shrink-0 overflow-hidden">
              {settings.customMascotGifUrl ? (
                <img
                  src={settings.customMascotGifUrl}
                  alt="Custom mascot preview"
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-[10px] text-white/30 text-center px-1">No GIF</span>
              )}
            </div>

            <div className="flex flex-col gap-2 flex-1">
              <input
                ref={gifInputRef}
                type="file"
                accept="image/gif,image/webp,image/png"
                onChange={handleGifUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => gifInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center justify-center gap-1.5 hover:border-[var(--theme-accent)] transition-all pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-card)',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-primary)',
                }}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{settings.customMascotGifUrl ? 'Change GIF File…' : 'Upload GIF File…'}</span>
              </button>

              <input
                type="text"
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
                className="px-2.5 py-1 rounded-lg border text-[11px] font-mono outline-none"
                style={{
                  background: 'var(--theme-card)',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-primary)',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </SettingSection>
  );
}
