import React, { useRef, useState } from 'react';
import { Volume2, VolumeX, Sun, Mic, MicOff } from 'lucide-react';

export interface VerticalSlidersProps {
  volume: number;
  onVolumeChange: (val: number) => void;
  brightness: number;
  onBrightnessChange: (val: number) => void;
  showBrightness?: boolean;
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
      // Ignore if pointer capture is unavailable
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
    fillClass: string;
    glowClass: string;
    muted?: boolean;
  }> = [
    {
      id: 'volume',
      label: 'Volume',
      value: clampedVolume,
      displayValue: clampedVolume === 0 ? 'Mute' : `${clampedVolume}%`,
      fillClass: clampedVolume === 0 ? 'bg-zinc-500/40' : 'bg-amber-500/80',
      glowClass: 'border-t border-amber-200/40 shadow-[0_-4px_16px_rgba(245,158,11,0.3)]',
      muted: clampedVolume === 0,
    },
    ...(showBrightness
      ? [
          {
            id: 'brightness' as SliderId,
            label: 'Brightness',
            value: clampedBrightness,
            displayValue: `${clampedBrightness}%`,
            fillClass: 'bg-amber-400/60',
            glowClass: 'border-t border-amber-100/40 shadow-[0_-4px_16px_rgba(251,191,36,0.28)]',
            muted: false,
          },
        ]
      : []),
    {
      id: 'mic',
      label: 'Mic',
      value: effectiveMicMuted ? 0 : clampedMic,
      displayValue: effectiveMicMuted ? 'Muted' : `${clampedMic}%`,
      fillClass: effectiveMicMuted ? 'bg-rose-500/45' : 'bg-emerald-500/70',
      glowClass: effectiveMicMuted
        ? 'border-t border-rose-300/35 shadow-[0_-4px_14px_rgba(244,63,94,0.25)]'
        : 'border-t border-emerald-200/40 shadow-[0_-4px_16px_rgba(16,185,129,0.28)]',
      muted: effectiveMicMuted,
    },
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
              background: 'var(--theme-track)',
              borderColor: isDragging ? 'var(--theme-accent)' : 'var(--theme-border)',
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
            className="relative flex-1 min-w-0 max-w-[38px] h-full rounded-full border transition-colors duration-150 overflow-hidden flex flex-col items-center justify-between py-2.5 shadow-inner"
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

            {/* Vertical fill bar anchored at bottom */}
            <div
              data-tauri-drag-region="false"
              style={{
                height: `${slider.value}%`,
                pointerEvents: 'none',
              }}
              className={`absolute bottom-0 left-0 right-0 rounded-b-full ${slider.fillClass} ${slider.glowClass} ${
                isDragging ? 'transition-none' : 'transition-[height,background-color] duration-100 ease-out'
              }`}
            />

            {/* Top percentage readout */}
            <div
              data-tauri-drag-region="false"
              style={{ pointerEvents: 'none' }}
              className={`relative z-10 px-1 py-0.5 rounded-full text-[9px] font-mono font-semibold tabular-nums tracking-tight transition-all duration-150 ${
                showTooltip
                  ? 'bg-black/75 text-white shadow-sm scale-105'
                  : 'opacity-80'
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

            {/* Bottom Icon / Mute Control */}
            {slider.id === 'volume' && (
              <button
                type="button"
                data-slider-icon-btn="true"
                data-tauri-drag-region="false"
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleVolumeIconClick}
                title={clampedVolume === 0 ? 'Unmute volume' : 'Mute volume'}
                className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center bg-black/30 hover:bg-black/50 text-white active:scale-90 transition-all border border-white/10"
              >
                {clampedVolume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 text-rose-300" strokeWidth={2} />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                )}
              </button>
            )}

            {slider.id === 'brightness' && (
              <div
                data-tauri-drag-region="false"
                style={{ pointerEvents: 'none' }}
                className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center bg-black/25 text-white border border-white/10"
              >
                <Sun className="w-3.5 h-3.5 text-amber-100" strokeWidth={2} />
              </div>
            )}

            {slider.id === 'mic' && (
              <button
                type="button"
                data-slider-icon-btn="true"
                data-tauri-drag-region="false"
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleMicIconClick}
                title={effectiveMicMuted ? 'Unmute microphone' : 'Mute microphone'}
                className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-all border ${
                  effectiveMicMuted
                    ? 'bg-rose-500/30 hover:bg-rose-500/45 border-rose-300/30 text-rose-200'
                    : 'bg-black/30 hover:bg-black/50 border-white/10 text-white'
                }`}
              >
                {effectiveMicMuted ? (
                  <MicOff className="w-3.5 h-3.5 text-rose-200" strokeWidth={2} />
                ) : (
                  <Mic className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
