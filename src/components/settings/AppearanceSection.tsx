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
    const nextCustomAccent = mode === 'canopy' || mode === 'auto' ? '' : settings.customAccentColor;
    updateSettings({ themeMode: mode, customAccentColor: nextCustomAccent });
    applyThemeModeFallback(
      mode,
      settings.glassOpacity,
      settings.glassBlurStrength,
      nextCustomAccent,
      settings.trueOledMode,
    );
    onThemeChanged?.();
  };

  const handleBlurChange = (val: number) => {
    updateSettings({ glassBlurStrength: val });
    applyThemeModeFallback(
      settings.themeMode,
      settings.glassOpacity,
      val,
      settings.customAccentColor,
      settings.trueOledMode,
    );
    onThemeChanged?.();
  };

  const handleOpacityChange = (val: number) => {
    const ratio = Number((val / 100).toFixed(2));
    updateSettings({ glassOpacity: ratio });
    applyThemeModeFallback(
      settings.themeMode,
      ratio,
      settings.glassBlurStrength,
      settings.customAccentColor,
      settings.trueOledMode,
    );
    onThemeChanged?.();
  };

  const handleAccentColorSelect = (hex: string) => {
    updateSettings({ customAccentColor: hex });
    applyThemeModeFallback(
      settings.themeMode,
      settings.glassOpacity,
      settings.glassBlurStrength,
      hex,
      settings.trueOledMode,
    );
    onThemeChanged?.();
  };

  const handleToggleTrueOled = (val: boolean) => {
    updateSettings({ trueOledMode: val });
    applyThemeModeFallback(
      settings.themeMode,
      settings.glassOpacity,
      settings.glassBlurStrength,
      settings.customAccentColor,
      val,
    );
    onThemeChanged?.();
  };
  // The host owns the live slideshow (WallpaperView toggles the same state), so changes are
  // pushed through setDesktopWallpaperState rather than only stored in settings.
  const applySlideshowEnabled = (enabled: boolean) => {
    updateSettings({ wallpaperSlideshowEnabled: enabled });
    void setDesktopWallpaperState({
      slideshow_enabled: enabled,
      slideshow_minutes: settings.wallpaperSlideshowMinutes,
      shuffle: settings.wallpaperShuffle,
    }).catch((err) => console.warn('Failed to update slideshow state:', err));
  };

  const applySlideshowMinutes = (minutes: number) => {
    updateSettings({ wallpaperSlideshowMinutes: minutes });
    void setDesktopWallpaperState({
      slideshow_enabled: settings.wallpaperSlideshowEnabled,
      slideshow_minutes: minutes,
      shuffle: settings.wallpaperShuffle,
    }).catch((err) => console.warn('Failed to update slideshow interval:', err));
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
      .catch((err) => console.warn('Failed to load wallpaper state:', err));
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
      <div className="flex flex-col gap-1.5 py-1">
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            Theme Mode
          </div>
          <div
            className="text-[10px] leading-snug mt-0.5"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            Color palette source for controls & HUD
          </div>
        </div>
        <div className="w-full pt-1">
          <div
            className="grid grid-cols-5 p-0.5 rounded-xl border w-full"
            style={{
              background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            }}
          >
            {[
              { id: 'canopy', label: 'Canopy', icon: <Sparkles className="w-3 h-3" /> },
              { id: 'adaptive', label: 'Adaptive', icon: <ImageIcon className="w-3 h-3" /> },
              { id: 'dark', label: 'Dark', icon: <Moon className="w-3 h-3" /> },
              { id: 'light', label: 'Light', icon: <Sun className="w-3 h-3" /> },
              { id: 'auto', label: 'Auto', icon: <Monitor className="w-3 h-3" /> },
            ].map((opt) => {
              const selected = opt.id === settings.themeMode;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    handleThemeModeSelect(
                      opt.id as 'canopy' | 'adaptive' | 'dark' | 'light' | 'auto',
                    )
                  }
                  className="py-1 px-1 rounded-lg text-[11px] font-mono transition-all flex items-center justify-center gap-1 pointer-events-auto cursor-pointer"
                  style={{
                    background: selected ? 'var(--theme-accent)' : 'transparent',
                    color: selected
                      ? 'var(--theme-on-accent, #111913)'
                      : 'var(--theme-text-secondary)',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {opt.icon}
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* Accent Color Palette Customization (Visible only when in Dark, Light, or Adaptive themes) */}
      {settings.themeMode !== 'canopy' && settings.themeMode !== 'auto' && (
        <div className="flex flex-col gap-1.5 py-1 border-t border-[var(--theme-border)] animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                Accent Color
              </div>
              <div
                className="text-[10px] leading-snug mt-0.5"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                Interactive focus, rings, and hardware luminescence
              </div>
            </div>
            {settings.customAccentColor && (
              <button
                type="button"
                onClick={() => handleAccentColorSelect('')}
                className="text-[10px] font-mono text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)] transition-colors cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 pt-1 flex-wrap">
            {[
              { label: 'Theme Default', hex: '', bg: 'var(--theme-accent)' },
              { label: 'Forest Emerald', hex: '#52b788', bg: '#52b788' },
              { label: 'Obsidian Cyan', hex: '#38bdf8', bg: '#38bdf8' },
              { label: 'Electric Indigo', hex: '#818cf8', bg: '#818cf8' },
              { label: 'Sunset Amber', hex: '#f59e0b', bg: '#f59e0b' },
              { label: 'Crimson Rose', hex: '#f43f5e', bg: '#f43f5e' },
              { label: 'Titanium', hex: '#e4e4e7', bg: '#e4e4e7' },
            ].map((c) => {
              const isSelected = (settings.customAccentColor || '') === c.hex;
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => handleAccentColorSelect(c.hex)}
                  title={c.label}
                  className="w-6 h-6 rounded-full border transition-all flex items-center justify-center cursor-pointer hover:scale-105 active:scale-95"
                  style={{
                    background: c.bg,
                    borderColor: isSelected
                      ? 'var(--theme-text-primary)'
                      : 'var(--theme-border, rgba(255, 255, 255, 0.15))',
                    boxShadow: isSelected ? '0 0 8px var(--theme-accent)' : 'none',
                  }}
                >
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white shadow-sm" />}
                </button>
              );
            })}
            <input
              type="text"
              placeholder="#hex"
              value={settings.customAccentColor || ''}
              onChange={(e) => handleAccentColorSelect(e.target.value)}
              className="ml-auto px-2 py-0.5 rounded-lg text-[10px] font-mono border bg-[var(--theme-track)] text-[var(--theme-text-primary)] border-[var(--theme-border)] outline-none w-20 text-center"
            />
          </div>
        </div>
      )}

      {/* True OLED Pitch Black Mode */}
      <SettingRow
        title="True OLED Black Canvas"
        description="Infinite contrast pure #000000 background for OLED / Mini-LED displays"
      >
        <ToggleSwitch checked={Boolean(settings.trueOledMode)} onChange={handleToggleTrueOled} />
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
              className="px-2.5 py-1 rounded-lg text-xs font-mono border focus:outline-none cursor-pointer"
              style={{
                background: 'var(--theme-card, #181825)',
                color: 'var(--theme-text-primary, #ffffff)',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.15))',
              }}
            >
              <option value={1} style={{ background: '#181825', color: '#ffffff' }}>
                1 minute (Fast / Test)
              </option>
              <option value={5} style={{ background: '#181825', color: '#ffffff' }}>
                5 minutes
              </option>
              <option value={10} style={{ background: '#181825', color: '#ffffff' }}>
                10 minutes
              </option>
              <option value={15} style={{ background: '#181825', color: '#ffffff' }}>
                15 minutes
              </option>
              <option value={30} style={{ background: '#181825', color: '#ffffff' }}>
                30 minutes
              </option>
              <option value={60} style={{ background: '#181825', color: '#ffffff' }}>
                1 hour
              </option>
              <option value={120} style={{ background: '#181825', color: '#ffffff' }}>
                2 hours
              </option>
              <option value={360} style={{ background: '#181825', color: '#ffffff' }}>
                6 hours
              </option>
              <option value={720} style={{ background: '#181825', color: '#ffffff' }}>
                12 hours
              </option>
              <option value={1440} style={{ background: '#181825', color: '#ffffff' }}>
                24 hours
              </option>
            </select>
          </SettingRow>
          <SettingRow
            title="Shuffle Wallpapers"
            description="Pick random wallpaper from directory on each rotation"
          >
            <ToggleSwitch
              checked={Boolean(settings.wallpaperShuffle)}
              onChange={(val) => {
                updateSettings({ wallpaperShuffle: val });
                void setDesktopWallpaperState({
                  slideshow_enabled: settings.wallpaperSlideshowEnabled,
                  slideshow_minutes: settings.wallpaperSlideshowMinutes,
                  shuffle: val,
                }).catch((err) => console.warn('Failed to update wallpaper shuffle:', err));
              }}
            />
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
            { id: 'bongo', label: 'Capi' },
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
