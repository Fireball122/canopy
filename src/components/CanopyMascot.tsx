import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';

export interface CanopyMascotProps {
  isPlaying: boolean;
  className?: string;
  customGifUrl?: string;
  showSleepZzz?: boolean;
  showAmbientGlow?: boolean;
}

const CAPI_FRAMES = [
  '/capi_1.png',
  '/capi_2.png',
  '/capi_3.png',
  '/capi_4.png',
  '/capi_5.png',
  '/capi_6.png',
  '/capi_7.png',
  '/capi_8.png',
  '/capi_9.png',
  '/capi_10.png',
  '/capi_11.png',
  '/capi_12.png',
];

/**
 * "Capi" — The Mushroom Spirit Mascot for Canopy
 * - Adorable headphone-wearing mushroom spirit with 7 dancing animation frames:
 *   Frame 1: Preparation (Idle)
 *   Frame 2: Sway Left
 *   Frame 3: Jump
 *   Frame 4: Bounce Up
 *   Frame 5: Sway Right (Wink)
 *   Frame 6: Squish / Beat Drop
 *   Frame 7: Return
 * - Music-Reactive: Cycles through all 7 frames rhythmically when music plays.
 * - Idle Mode: Rests on Frame 1 with gentle breathing when paused.
 * - Supports custom user GIF uploads via settings.
 */
export const CanopyMascot: React.FC<CanopyMascotProps> = ({
  isPlaying,
  className = '',
  customGifUrl,
  showSleepZzz = true,
  showAmbientGlow = false,
}) => {
  const { settings } = useSettings();
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [frozenGifDataUrl, setFrozenGifDataUrl] = useState<string | null>(null);
  const [customGifError, setCustomGifError] = useState<boolean>(false);
  const [isWiggling, setIsWiggling] = useState<boolean>(false);
  const lastSampledGifRef = useRef<string>('');

  const activeGifUrl = (customGifUrl ?? settings.customMascotGifUrl ?? '').trim();
  const useCustomGif = activeGifUrl.length > 0 && !customGifError;

  // Custom user GIF processing
  useEffect(() => {
    setCustomGifError(false);
    if (!activeGifUrl) {
      setFrozenGifDataUrl(null);
      lastSampledGifRef.current = '';
      return;
    }

    if (lastSampledGifRef.current === activeGifUrl && frozenGifDataUrl) {
      return;
    }
    const img = new Image();
    if (activeGifUrl.startsWith('http://') || activeGifUrl.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 160;
        canvas.height = img.naturalHeight || 120;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          setFrozenGifDataUrl(dataUrl);
          lastSampledGifRef.current = activeGifUrl;
          return;
        }
      } catch {
        // If canvas export is blocked, fall back to displaying the gif directly without breaking playback
      }
      setFrozenGifDataUrl(activeGifUrl);
      lastSampledGifRef.current = activeGifUrl;
    };
    img.onerror = () => {
      setCustomGifError(true);
    };
    img.src = activeGifUrl;
  }, [activeGifUrl, frozenGifDataUrl]);

  // Crisp 6-Beat Dance Animation loop strictly when music is playing (140ms tempo)
  useEffect(() => {
    if (!isPlaying) {
      setFrameIndex(0); // Reset to Frame 1 (Preparation / Idle)
      return;
    }

    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % CAPI_FRAMES.length);
    }, 140);

    return () => window.clearInterval(timer);
  }, [isPlaying]);

  if (settings.mascotMode === 'none') {
    return null;
  }

  // User configured a custom GIF
  if (useCustomGif && settings.mascotMode === 'gif') {
    return (
      <div
        className={`relative flex items-center justify-center select-none pointer-events-auto h-full max-h-full overflow-hidden ${className}`}
        title={isPlaying ? 'Mascot dancing' : 'Mascot resting'}
      >
        <img
          src={isPlaying ? activeGifUrl : frozenGifDataUrl || activeGifUrl}
          alt="Canopy Mascot"
          className="max-h-full max-w-full h-full w-auto object-contain rounded-xl drop-shadow-md transition-all duration-300"
          style={{ opacity: isPlaying ? 1 : 0.85 }}
        />
      </div>
    );
  }

  // Native Capi Mascot (Mushroom Spirit with Headphones)
  const currentSrc = isPlaying ? CAPI_FRAMES[frameIndex] : '/capi_idle.png';

  return (
    <div
      onClick={() => {
        setIsWiggling(true);
        window.setTimeout(() => setIsWiggling(false), 700);
      }}
      className={`relative flex flex-col items-center justify-center select-none pointer-events-auto cursor-pointer group h-full max-h-full overflow-hidden ${className}`}
      title={isPlaying ? 'Capi is dancing to your music!' : 'Capi is resting (click to bounce!)'}
    >
      {/* Ambient soft circular glow behind Capi (strictly circular, never clips) */}
      {showAmbientGlow && (
        <div
          className="absolute w-14 h-14 rounded-full pointer-events-none transition-opacity duration-500"
          style={{
            background:
              'radial-gradient(circle at center, var(--theme-accent, #A29BFE) 0%, rgba(162, 155, 254, 0.2) 40%, transparent 70%)',
            opacity: isPlaying ? 0.45 : 0.15,
          }}
        />
      )}

      {!isPlaying && showSleepZzz && (
        <div className="absolute top-2 right-4 text-[11px] font-mono font-bold text-[var(--theme-text-secondary)] opacity-60 animate-pulse pointer-events-none">
          z<span className="text-sm">Z</span>
        </div>
      )}

      {/* Capi Character Frame Image */}
      <div
        className={`relative flex items-center justify-center transition-transform duration-200 h-full max-h-full ${
          isWiggling ? 'scale-110' : 'group-hover:scale-105'
        }`}
      >
        <img
          src={currentSrc}
          alt="Capi - Canopy Mushroom Mascot"
          className={`max-h-full h-full w-auto object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)] select-none ${
            !isPlaying ? 'opacity-90' : 'opacity-100'
          }`}
          draggable={false}
        />
      </div>
    </div>
  );
};

// Re-export as BongoCat for 100% backwards compatibility
export const BongoCat = CanopyMascot;
