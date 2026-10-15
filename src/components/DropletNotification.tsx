import { Bell, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

export interface DropletNotificationProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

export const DropletNotification: React.FC<DropletNotificationProps> = ({
  message,
  onDismiss,
  durationMs = 7000,
}) => {
  const [phase, setPhase] = useState<'idle' | 'drop' | 'expand' | 'exit'>('idle');
  const [isOverflowing, setIsOverflowing] = useState<boolean>(false);
  const [overflowOffset, setOverflowOffset] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!message) {
      setPhase('idle');
      return;
    }

    setPhase('drop');
    const expandTimer = window.setTimeout(() => {
      setPhase('expand');
    }, 280);

    const dismissTimer = window.setTimeout(() => {
      setPhase('exit');
      window.setTimeout(onDismiss, 320);
    }, durationMs);

    return () => {
      window.clearTimeout(expandTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [message, durationMs, onDismiss]);

  // Measure text width vs container to determine if marquee scrolling is needed
  useEffect(() => {
    if (phase !== 'expand' || !textRef.current || !containerRef.current) return;
    const textW = textRef.current.scrollWidth;
    const containerW = containerRef.current.clientWidth;
    if (textW > containerW) {
      setIsOverflowing(true);
      setOverflowOffset(textW - containerW + 16);
    } else {
      setIsOverflowing(false);
      setOverflowOffset(0);
    }
  }, [phase]);

  if (!message || phase === 'idle') return null;

  const isDroplet = phase === 'drop' || phase === 'exit';

  return (
    <div
      data-tauri-drag-region="false"
      className="fixed top-0 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
      style={{
        transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 250ms ease',
        transform: phase === 'exit' ? 'translate(-50%, -100%) scale(0.6)' : 'translate(-50%, 0)',
        opacity: phase === 'exit' ? 0 : 1,
      }}
    >
      <div
        className={`relative flex items-center overflow-hidden transition-all duration-300 ease-out ${
          isDroplet
            ? 'w-7 h-7 rounded-full bg-[var(--theme-accent,#cba6f7)] mt-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)] justify-center canopy-droplet-anim'
            : 'mt-3 px-3.5 py-2 rounded-2xl border border-[var(--theme-accent,#cba6f7)] bg-[#14141e]/96 backdrop-blur-2xl shadow-[0_16px_40px_rgba(0,0,0,0.7)] gap-2.5 max-w-[calc(100vw-48px)] w-auto min-w-[240px]'
        }`}
        style={{
          boxShadow: isDroplet
            ? '0 0 16px var(--theme-accent, #cba6f7)'
            : '0 12px 32px -4px rgba(0,0,0,0.65), 0 0 16px -2px var(--theme-accent, rgba(203,166,247,0.35))',
        }}
      >
        {isDroplet ? (
          <Bell className="w-3.5 h-3.5 text-[#11111b] animate-pulse" />
        ) : (
          <>
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--theme-accent)]/20 text-[var(--theme-accent)]">
              <Bell className="w-3.5 h-3.5 animate-bounce" />
            </div>

            <div
              ref={containerRef}
              className="flex-1 min-w-0 overflow-hidden relative"
              style={{
                maskImage: isOverflowing
                  ? 'linear-gradient(to right, black 88%, transparent 100%)'
                  : undefined,
                WebkitMaskImage: isOverflowing
                  ? 'linear-gradient(to right, black 88%, transparent 100%)'
                  : undefined,
              }}
            >
              <span
                ref={textRef}
                className={`inline-block text-xs font-medium text-white whitespace-nowrap tracking-tight ${
                  isOverflowing ? 'canopy-marquee-active' : ''
                }`}
                style={
                  isOverflowing
                    ? ({
                        '--marquee-offset': `-${overflowOffset}px`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                {message}
              </span>
            </div>

            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={() => {
                setPhase('exit');
                window.setTimeout(onDismiss, 280);
              }}
              className="p-1 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all pointer-events-auto cursor-pointer shrink-0"
              title="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
