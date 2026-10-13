import React, { useEffect, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';

export interface BongoCatProps {
  isPlaying: boolean;
  className?: string;
  customGifUrl?: string;
}

/**
 * Music-reactive mascot widget:
 * - Only animates when music is actively playing (`isPlaying === true`).
 * - When paused or idle (`isPlaying === false`), remains completely static.
 * - Supports custom user GIF URLs/uploads via `settings.customMascotGifUrl` (freezes the first frame on a canvas when paused).
 */
export const BongoCat: React.FC<BongoCatProps> = ({
  isPlaying,
  className = '',
  customGifUrl,
}) => {
  const { settings } = useSettings();
  const [frame, setFrame] = useState<'rest' | 'left' | 'right'>('rest');
  const [frozenGifDataUrl, setFrozenGifDataUrl] = useState<string | null>(null);
  const [customGifError, setCustomGifError] = useState<boolean>(false);
  const lastSampledGifRef = useRef<string>('');

  const activeGifUrl = (customGifUrl ?? settings.customMascotGifUrl ?? '').trim();
  const useCustomGif = activeGifUrl.length > 0 && !customGifError;

  // Reset error flag when custom GIF URL changes
  useEffect(() => {
    setCustomGifError(false);
    if (!activeGifUrl) {
      setFrozenGifDataUrl(null);
      lastSampledGifRef.current = '';
      return;
    }

    // Capture a static resting frame for the custom GIF so it stays completely still when music is paused
    if (lastSampledGifRef.current === activeGifUrl && frozenGifDataUrl) {
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 160;
        canvas.height = img.naturalHeight || 120;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setFrozenGifDataUrl(canvas.toDataURL('image/png'));
          lastSampledGifRef.current = activeGifUrl;
        }
      } catch {
        // Cross-origin GIF without CORS headers: still render static fallback or dimmed frame
        setFrozenGifDataUrl(null);
      }
    };
    img.onerror = () => {
      setCustomGifError(true);
    };
    img.src = activeGifUrl;
  }, [activeGifUrl, frozenGifDataUrl]);

  // Strictly music-reactive: only alternate paws when `isPlaying === true`
  useEffect(() => {
    if (!isPlaying) {
      setFrame('rest');
      return;
    }

    setFrame('left');
    const interval = window.setInterval(() => {
      setFrame((prev) => (prev === 'left' ? 'right' : 'left'));
    }, 125);

    return () => window.clearInterval(interval);
  }, [isPlaying]);

  if (useCustomGif) {
    return (
      <div
        role="img"
        aria-label={isPlaying ? 'Custom mascot animating to music' : 'Custom mascot resting'}
        className={`relative flex items-center justify-center select-none ${className}`}
      >
        {isPlaying ? (
          <img
            src={activeGifUrl}
            alt="Custom music mascot"
            onError={() => setCustomGifError(true)}
            className="max-h-full max-w-full object-contain rounded-xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
          />
        ) : frozenGifDataUrl ? (
          <img
            src={frozenGifDataUrl}
            alt="Custom music mascot (paused)"
            className="max-h-full max-w-full object-contain rounded-xl opacity-85 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
          />
        ) : (
          <img
            src={activeGifUrl}
            alt="Custom music mascot (idle)"
            onError={() => setCustomGifError(true)}
            className="max-h-full max-w-full object-contain rounded-xl opacity-75 grayscale-[25%]"
          />
        )}
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={isPlaying ? 'Bongo Cat drumming to music' : 'Bongo Cat resting'}
      className={`relative flex items-center justify-center select-none ${className}`}
    >
      {/* Floating music notes ONLY when music is actively playing */}
      {isPlaying && (
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          <span
            className="absolute -top-1 left-2 text-xs font-bold transition-transform duration-150"
            style={{
              color: 'var(--theme-accent)',
              transform:
                frame === 'left'
                  ? 'translateY(-4px) rotate(-12deg) scale(1.1)'
                  : 'translateY(1px) rotate(6deg) scale(0.9)',
            }}
          >
            ♪
          </span>
          <span
            className="absolute -top-2 right-2 text-xs font-bold text-[#89dceb] transition-transform duration-150"
            style={{
              transform:
                frame === 'right'
                  ? 'translateY(-5px) rotate(12deg) scale(1.12)'
                  : 'translateY(1px) rotate(-8deg) scale(0.9)',
            }}
          >
            ♫
          </span>
        </div>
      )}

      {/* High-DPI SVG Bongo Cat illustration */}
      <svg
        viewBox="0 0 180 110"
        className="w-28 h-16 overflow-visible drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line
          x1="10"
          y1="86"
          x2="170"
          y2="86"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Left Bongo Drum */}
        <g
          transform={
            isPlaying && frame === 'left' ? 'translate(0, 2) scale(1.03, 0.96)' : 'translate(0, 0)'
          }
          style={{ transformOrigin: '52px 84px', transition: 'transform 60ms ease' }}
        >
          <path
            d="M34 68 L40 94 L64 94 L70 68 Z"
            fill="#fab387"
            stroke="#181825"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <line x1="45" y1="70" x2="47" y2="93" stroke="#181825" strokeWidth="1.6" />
          <line x1="59" y1="70" x2="57" y2="93" stroke="#181825" strokeWidth="1.6" />
          <ellipse
            cx="52"
            cy="68"
            rx="18"
            ry="5.5"
            fill="#f9e2af"
            stroke="#181825"
            strokeWidth="2.2"
          />
          {isPlaying && frame === 'left' && (
            <ellipse
              cx="52"
              cy="67"
              rx="14"
              ry="3.5"
              fill="none"
              stroke="#cba6f7"
              strokeWidth="1.8"
              opacity="0.9"
            />
          )}
        </g>

        {/* Right Bongo Drum */}
        <g
          transform={
            isPlaying && frame === 'right' ? 'translate(0, 2) scale(1.03, 0.96)' : 'translate(0, 0)'
          }
          style={{ transformOrigin: '128px 84px', transition: 'transform 60ms ease' }}
        >
          <path
            d="M112 71 L117 94 L139 94 L144 71 Z"
            fill="#f38ba8"
            stroke="#181825"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <line x1="122" y1="73" x2="123" y2="93" stroke="#181825" strokeWidth="1.6" />
          <line x1="134" y1="73" x2="133" y2="93" stroke="#181825" strokeWidth="1.6" />
          <ellipse
            cx="128"
            cy="71"
            rx="16"
            ry="5"
            fill="#f9e2af"
            stroke="#181825"
            strokeWidth="2.2"
          />
          {isPlaying && frame === 'right' && (
            <ellipse
              cx="128"
              cy="70"
              rx="12"
              ry="3"
              fill="none"
              stroke="#89dceb"
              strokeWidth="1.8"
              opacity="0.9"
            />
          )}
        </g>

        {/* Cat Body & Head */}
        <g
          transform={isPlaying ? 'translate(0, -1)' : 'translate(0, 0)'}
          style={{ transition: 'transform 90ms ease' }}
        >
          <path
            d="M52 85 C50 48, 62 24, 62 14 L76 27 C85 24, 95 24, 104 27 L118 14 C118 24, 130 48, 128 85 Z"
            fill="#f5f5fa"
            stroke="#181825"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <polygon points="65,18 64,27 72,26" fill="#f5c2e7" />
          <polygon points="115,18 108,26 116,27" fill="#f5c2e7" />

          {isPlaying ? (
            <>
              <path
                d="M73 45 Q77 41 81 45"
                stroke="#181825"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M99 45 Q103 41 107 45"
                stroke="#181825"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />
            </>
          ) : (
            <>
              <circle cx="77" cy="45" r="2.7" fill="#181825" />
              <circle cx="103" cy="45" r="2.7" fill="#181825" />
            </>
          )}

          <ellipse cx="69" cy="50" rx="4.2" ry="2.2" fill="#f38ba8" opacity="0.65" />
          <ellipse cx="111" cy="50" rx="4.2" ry="2.2" fill="#f38ba8" opacity="0.65" />

          <path
            d="M84 50 Q87 54 90 50 Q93 54 96 50"
            stroke="#181825"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>

        {/* Left Paw */}
        {isPlaying && frame === 'left' ? (
          <g>
            <path
              d="M62 56 C52 60, 48 64, 52 68 C56 71, 65 66, 68 59"
              fill="#ffffff"
              stroke="#181825"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="50" cy="65" r="1.5" fill="#f5c2e7" />
            <circle cx="54" cy="67" r="1.5" fill="#f5c2e7" />
          </g>
        ) : (
          <g>
            <path
              d="M60 56 C50 47, 44 50, 48 57 C51 61, 58 61, 64 58"
              fill="#ffffff"
              stroke="#181825"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Right Paw */}
        {isPlaying && frame === 'right' ? (
          <g>
            <path
              d="M118 56 C128 61, 132 66, 128 70 C124 73, 115 67, 112 59"
              fill="#ffffff"
              stroke="#181825"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="126" cy="69" r="1.5" fill="#f5c2e7" />
            <circle cx="130" cy="67" r="1.5" fill="#f5c2e7" />
          </g>
        ) : (
          <g>
            <path
              d="M120 56 C130 47, 136 50, 132 57 C129 61, 122 61, 116 58"
              fill="#ffffff"
              stroke="#181825"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
        )}
      </svg>
    </div>
  );
};
