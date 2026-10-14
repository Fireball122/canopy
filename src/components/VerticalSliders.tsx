import React, { useRef, useState } from 'react';
import { Volume2, VolumeX, Sun, Mic, MicOff } from 'lucide-react';

export interface VerticalSlidersProps {
  volume: number;
  onVolumeChange: (val: number) => void;
  brightness: number;
  onBrightnessChange: (val: number) => void;
  showBrightness?: boolean;
  showMic?: boolean;
  micLevel?: number;
  onMicLevelChange?: (val: number) => void;
  micMuted?: boolean;
  onMicMuteToggle?: () => void;
}

type SliderId = 'volume' | 'brightness' | 'mic';

export const VerticalSliders: React.FC<VerticalSlidersProps> = ({
  volume,
  onVolumeChange,
  brightness,
  onBrightnessChange,
  showBrightness = false,
  showMic = true,
  micLevel,
  onMicLevelChange,
  micMuted,
  onMicMuteToggle,
}) => {
  const [internalMicLevel, setInternalMicLevel] = useState<number>(75);
  const [internalMicMuted, setInternalMicMuted] = useState<boolean>(false);
  const [activeDrag, setActiveDrag] = useState<SliderId | null>(null);
  const [hoveredSlider, setHoveredSlider] = useState<SliderId | null>(null);

  const lastNonZeroVolumeRef = useRef<number>(volume > 0 ? volume : 68);
  if (volume > 0) {
    lastNonZeroVolumeRef.current = volume;
  }

  const effectiveMicLevel = typeof micLevel === 'number' ? micLevel : internalMicLevel;
  const effectiveMicMuted = typeof micMuted === 'boolean' ? micMuted : internalMicMuted;

  const clampedVolume = Math.round(Math.min(100, Math.max(0, volume)));
  const clampedBrightness = Math.round(Math.min(100, Math.max(1, brightness)));
  const clampedMic = Math.round(Math.min(100, Math.max(0, effectiveMicLevel)));

  const applySliderValue = (id: SliderId, pct: number) => {
    const clamped = Math.round(Math.min(100, Math.max(0, pct)));
    if (id === 'volume') {
      onVolumeChange(clamped);
    } else if (id === 'brightness') {
      onBrightnessChange(Math.max(5, clamped));
    } else {
      setInternalMicLevel(clamped);
      if (clamped > 0 && effectiveMicMuted) {
        setInternalMicMuted(false);
      }
      onMicLevelChange?.(clamped);
    }
  };

  const computePercentFromPointer = (el: HTMLElement, clientY: number): number => {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return 0;
    const relY = clientY - rect.top;
    const ratio = 1 - relY / rect.height;
    return Math.round(Math.min(100, Math.max(0, ratio * 100)));
  };

  const handlePointerDown = (id: SliderId, e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-slider-icon-btn="true"]')) {
      return;
    }
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture unavailable
    }
    setActiveDrag(id);
    const pct = computePercentFromPointer(e.currentTarget, e.clientY);
    applySliderValue(id, pct);
  };

  const handlePointerMove = (id: SliderId, e: React.PointerEvent<HTMLDivElement>) => {
    if (activeDrag !== id && (e.buttons & 1) !== 1) {
      return;
    }
    e.stopPropagation();
    const pct = computePercentFromPointer(e.currentTarget, e.clientY);
    applySliderValue(id, pct);
  };

  const handlePointerUpOrCancel = (id: SliderId, e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    if (activeDrag === id) {
      setActiveDrag(null);
    }
  };

  const handleWheel = (id: SliderId, currentVal: number, e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 5 : -5;
    applySliderValue(id, currentVal + delta);
  };

  const handleVolumeIconClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (clampedVolume > 0) {
      lastNonZeroVolumeRef.current = clampedVolume;
      onVolumeChange(0);
    } else {
      onVolumeChange(lastNonZeroVolumeRef.current || 65);
    }
  };

  const handleMicIconClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setInternalMicMuted((prev) => !prev);
    onMicMuteToggle?.();
  };

  const allSliders: Array<{
    id: SliderId;
    label: string;
    value: number;
    displayValue: string;
    fillStyle: React.CSSProperties;
    glowColor: string;
    muted?: boolean;
  }> = [
    {
      id: 'volume',
      label: 'Volume',
      value: clampedVolume,
      displayValue: clampedVolume === 0 ? 'Mute' : `${clampedVolume}%`,
      fillStyle: {
        background:
          clampedVolume === 0
            ? 'var(--theme-track, rgba(255, 255, 255, 0.12))'
            : 'linear-gradient(to top, var(--theme-accent, #A29BFE) 0%, var(--theme-text-primary, #FFFFFF) 100%)',
      },
      glowColor: 'var(--theme-accent, #A29BFE)',
      muted: clampedVolume === 0,
    },
    ...(showBrightness
      ? [
          {
            id: 'brightness' as SliderId,
            label: 'Brightness',
            value: clampedBrightness,
            displayValue: `${clampedBrightness}%`,
            fillStyle: {
              background:
                'linear-gradient(to top, var(--theme-accent, #A29BFE) 0%, #FDE047 100%)',
            },
            glowColor: 'var(--theme-accent, #A29BFE)',
            muted: false,
          },
        ]
      : []),
    ...(showMic
      ? [
          {
            id: 'mic' as SliderId,
            label: 'Mic',
            value: effectiveMicMuted ? 0 : clampedMic,
            displayValue: effectiveMicMuted ? 'Muted' : `${clampedMic}%`,
            fillStyle: {
              background: effectiveMicMuted
                ? 'rgba(239, 68, 68, 0.65)'
                : 'linear-gradient(to top, var(--theme-accent, #A29BFE) 0%, #89DCEB 100%)',
            },
            glowColor: effectiveMicMuted ? 'rgba(239, 68, 68, 0.7)' : 'var(--theme-accent, #A29BFE)',
            muted: effectiveMicMuted,
          },
        ]
      : []),
  ];

  return (
    <div
      data-tauri-drag-region="false"
      style={{ pointerEvents: 'auto' }}
      className="bento-card h-full w-full p-2 flex items-stretch justify-center gap-1.5 overflow-hidden select-none"
    >
      {allSliders.map((slider) => {
        const isDragging = activeDrag === slider.id;
        const isHovered = hoveredSlider === slider.id;
        const showTooltip = isDragging || isHovered;

        return (
          <div
            key={slider.id}
            role="group"
            aria-label={slider.label}
            data-tauri-drag-region="false"
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              touchAction: 'none',
              background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
              borderColor: isDragging
                ? 'var(--theme-accent, #A29BFE)'
                : 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            }}
            onPointerEnter={() => setHoveredSlider(slider.id)}
            onPointerLeave={() => setHoveredSlider((prev) => (prev === slider.id ? null : prev))}
            onPointerDown={(e) => handlePointerDown(slider.id, e)}
            onPointerMove={(e) => handlePointerMove(slider.id, e)}
            onPointerUp={(e) => handlePointerUpOrCancel(slider.id, e)}
            onPointerCancel={(e) => handlePointerUpOrCancel(slider.id, e)}
            onWheel={(e) =>
              handleWheel(slider.id, slider.id === 'mic' ? clampedMic : slider.value, e)
            }
            className="relative flex-1 min-w-0 max-w-[38px] h-full rounded-full border transition-colors duration-200 overflow-hidden flex flex-col items-center justify-between py-2.5 shadow-inner"
          >
            {/* Native range input for accessibility */}
            <input
              type="range"
              min={0}
              max={100}
              value={slider.id === 'mic' ? clampedMic : slider.value}
              aria-label={slider.label}
              data-tauri-drag-region="false"
              style={{ pointerEvents: 'none', cursor: 'pointer' }}
              onChange={(e) => applySliderValue(slider.id, Number(e.target.value))}
              className="sr-only"
            />

            {/* Vertical fill bar anchored at bottom (reacts 100% to wallpaper theme colors) */}
            <div
              data-tauri-drag-region="false"
              style={{
                height: `${slider.value}%`,
                pointerEvents: 'none',
                ...slider.fillStyle,
                boxShadow: `0 -4px 16px ${slider.glowColor}40`,
              }}
              className={`absolute bottom-0 left-0 right-0 rounded-b-full ${
                isDragging
                  ? 'transition-none'
                  : 'transition-[height,background] duration-150 ease-out'
              }`}
            />

            {/* Top percentage readout */}
            <div
              data-tauri-drag-region="false"
              style={{ pointerEvents: 'none' }}
              className={`relative z-10 px-1 py-0.5 rounded-full text-[9px] font-mono font-semibold tabular-nums tracking-tight transition-all duration-150 ${
                showTooltip
                  ? 'bg-black/75 text-white shadow-sm scale-105'
                  : 'opacity-85'
              }`}
            >
              {slider.displayValue}
            </div>

            {/* Subtle vertical track tick marks */}
            <div
              data-tauri-drag-region="false"
              style={{ pointerEvents: 'none' }}
              className="relative z-10 flex flex-col items-center gap-2 opacity-25 my-auto"
            >
              <span className="w-1.5 h-[1px] bg-current rounded-full" />
              <span className="w-1 h-[1px] bg-current rounded-full" />
              <span className="w-1.5 h-[1px] bg-current rounded-full" />
              <span className="w-1 h-[1px] bg-current rounded-full" />
              <span className="w-1.5 h-[1px] bg-current rounded-full" />
            </div>

            {/* Bottom Icon Button */}
            <button
              type="button"
              data-slider-icon-btn="true"
              data-tauri-drag-region="false"
              aria-label={`Toggle ${slider.label}`}
              onClick={
                slider.id === 'volume'
                  ? handleVolumeIconClick
                  : slider.id === 'mic'
                  ? handleMicIconClick
                  : undefined
              }
              className={`relative z-10 p-1.5 rounded-full transition-transform active:scale-90 pointer-events-auto cursor-pointer ${
                slider.muted ? 'text-rose-400 opacity-90' : 'text-current opacity-90'
              }`}
              style={{
                color: slider.muted
                  ? 'rgb(244, 63, 94)'
                  : 'var(--theme-text-primary, #F1F2F6)',
              }}
            >
              {slider.id === 'volume' ? (
                slider.value === 0 ? (
                  <VolumeX className="w-3.5 h-3.5" strokeWidth={2.3} />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" strokeWidth={2.3} />
                )
              ) : slider.id === 'mic' ? (
                effectiveMicMuted ? (
                  <MicOff className="w-3.5 h-3.5 text-rose-400" strokeWidth={2.3} />
                ) : (
                  <Mic className="w-3.5 h-3.5" strokeWidth={2.3} />
                )
              ) : (
                <Sun className="w-3.5 h-3.5" strokeWidth={2.3} />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
};
