import { Bell, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DropletNotificationProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

export const DropletNotification: React.FC<DropletNotificationProps> = ({
  message,
  onDismiss,
  durationMs = 6000,
}) => {
  const [phase, setPhase] = useState<'idle' | 'drop' | 'expand' | 'retract'>('idle');
  const [contentVisible, setContentVisible] = useState<boolean>(false);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [isOverflowing, setIsOverflowing] = useState<boolean>(false);
  const [overflowOffset, setOverflowOffset] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const isHoveredRef = useRef<boolean>(false);
  isHoveredRef.current = isHovered;

  // Symmetrical reverse dismiss animation
  const startDismissAnimation = useCallback(() => {
    setContentVisible(false);

    // Step 2: Shrink pill back to bead
    window.setTimeout(() => {
      setPhase('drop');

      // Step 3: Retract up into bezel
      window.setTimeout(() => {
        setPhase('retract');
        window.setTimeout(onDismiss, 340);
      }, 340);
    }, 120);
  }, [onDismiss]);

  // Trigger sequence whenever a message arrives
  useEffect(() => {
    if (!message) {
      setPhase('idle');
      setContentVisible(false);
      return;
    }

    // Phase 1: Pure liquid droplet bead drops from top bezel
    setPhase('drop');
    setContentVisible(false);

    // Phase 2: Zero-stutter momentum transfer: bloom to pill begins at 200ms
    let revealTimer: number | null = null;
    const expandTimer = window.setTimeout(() => {
      setPhase('expand');

      // Phase 3: Reveal bell badge and text as capsule reaches ~80% expansion
      revealTimer = window.setTimeout(() => {
        setContentVisible(true);
      }, 260);
    }, 200);

    // Auto-dismiss countdown
    const dismissTimer = window.setTimeout(() => {
      if (!isHoveredRef.current) {
        startDismissAnimation();
      }
    }, durationMs + 460);
    timerRef.current = dismissTimer;

    return () => {
      window.clearTimeout(expandTimer);
      if (revealTimer) window.clearTimeout(revealTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [message, durationMs, startDismissAnimation]);

  // Measure text width to enable smooth gradient marquee if message is extra long
  useEffect(() => {
    if (!contentVisible || !textRef.current || !containerRef.current) return;
    const textW = textRef.current.scrollWidth;
    const containerW = containerRef.current.clientWidth;
    if (textW > containerW) {
      setIsOverflowing(true);
      setOverflowOffset(textW - containerW + 24);
    } else {
      setIsOverflowing(false);
      setOverflowOffset(0);
    }
  }, [contentVisible]);

  // Symmetrical reverse dismiss animation:
  // Step 1: Content and icon badge fade out
  // Step 2: Pill width smoothly shrinks back to 48px circular bead
  // Step 3: Pure bead retracts straight up into top bezel

  if (!message || phase === 'idle') return null;

  const isBead = phase === 'drop' || phase === 'retract';

  return (
    <div
      data-tauri-drag-region="false"
      className="fixed top-0 left-1/2 -translate-x-1/2 z-50 pointer-events-auto select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        // If timer was paused on hover, resume auto-dismiss with a 2-second grace
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(startDismissAnimation, 2200);
      }}
      style={{
        transform:
          phase === 'retract'
            ? 'translate(-50%, -70px) scale(0.85, 1.2)'
            : phase === 'drop'
              ? 'translate(-50%, 12px) scale(1, 1)'
              : 'translate(-50%, 12px) scale(1, 1)',
        opacity: phase === 'retract' ? 0 : 1,
        transition:
          phase === 'retract'
            ? 'transform 340ms cubic-bezier(0.32, 0, 0.15, 1), opacity 220ms ease'
            : 'transform 440ms cubic-bezier(0.05, 0.92, 0.2, 1), opacity 220ms ease',
        willChange: 'transform, opacity',
      }}
    >
      <div
        className={`relative flex items-center transition-all ${
          isBead
            ? 'w-12 h-12 rounded-full justify-center p-0'
            : 'h-12 rounded-full px-3 gap-2.5 max-w-[calc(100vw-48px)] w-auto min-w-[340px] max-w-[520px]'
        }`}
        style={{
          borderRadius: '9999px',
          boxShadow: isBead
            ? '0 10px 24px -2px rgba(0,0,0,0.7), 0 0 16px -2px var(--theme-accent, rgba(116, 168, 108, 0.45))'
            : '0 12px 30px -4px rgba(0,0,0,0.68), 0 0 20px -2px var(--theme-accent, rgba(116, 168, 108, 0.38))',
          transition:
            'width 500ms cubic-bezier(0.14, 1, 0.2, 1), max-width 500ms cubic-bezier(0.14, 1, 0.2, 1), box-shadow 400ms ease',
          willChange: 'width, max-width, box-shadow',
        }}
      >
        {/* Strictly clipped backdrop blur & glass layer - eliminates rectangular blur quad bleeding past pill */}
        <div
          className="absolute inset-0 rounded-full border pointer-events-none overflow-hidden"
          style={{
            borderRadius: '9999px',
            clipPath: 'inset(0 round 9999px)',
            WebkitClipPath: 'inset(0 round 9999px)',
            backgroundColor: 'var(--theme-bg, rgba(17, 25, 19, 0.94))',
            borderColor: 'var(--theme-border, rgba(116, 168, 108, 0.3))',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          }}
        >
          {/* Subtle interior glow sheen */}
          <div
            className="absolute inset-0 opacity-15 pointer-events-none transition-opacity duration-300"
            style={{
              background:
                'radial-gradient(circle at 10% 50%, var(--theme-accent, #74a86c) 0%, transparent 60%)',
            }}
          />
        </div>
        {/* Bell Icon Badge (Invisible during bead drop & retract, blooms in pill) */}
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-all duration-300 ${
            contentVisible && !isBead
              ? 'opacity-100 scale-100'
              : 'opacity-0 scale-50 pointer-events-none'
          }`}
          style={{
            backgroundColor: 'var(--theme-accent-soft, rgba(116, 168, 108, 0.2))',
            borderColor: 'var(--theme-border, rgba(116, 168, 108, 0.4))',
            color: 'var(--theme-accent, #74a86c)',
          }}
        >
          <Bell className="w-3.5 h-3.5" />
        </div>

        {/* Inner Content Row */}
        {!isBead && (
          <div
            className={`flex-1 flex items-center justify-between min-w-0 transition-opacity duration-200 ${
              contentVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {/* Text container */}
            <div className="flex-1 flex flex-col justify-center min-w-0 pr-2 overflow-hidden">
              <div className="flex items-center gap-1.5 leading-none mb-0.5">
                <span
                  className="text-[10px] tracking-widest font-bold uppercase"
                  style={{ color: 'var(--theme-accent, #74a86c)' }}
                >
                  REMINDER
                </span>
                <span className="text-[9px] text-white/50 font-mono">• Just now</span>
              </div>

              <div
                ref={containerRef}
                className="overflow-hidden relative"
                style={{
                  maskImage: isOverflowing
                    ? 'linear-gradient(to right, black 85%, transparent 100%)'
                    : undefined,
                  WebkitMaskImage: isOverflowing
                    ? 'linear-gradient(to right, black 85%, transparent 100%)'
                    : undefined,
                }}
              >
                <span
                  ref={textRef}
                  className={`inline-block text-xs font-semibold text-white whitespace-nowrap tracking-tight ${
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
            </div>

            {/* Dismiss button pinned strictly on the right */}
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={startDismissAnimation}
              className="w-6 h-6 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors pointer-events-auto cursor-pointer shrink-0"
              title="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Auto-Dismiss Countdown Bar at bottom edge */}
        {!isBead && contentVisible && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/5 overflow-hidden rounded-b-full">
            <div
              className="h-full w-full"
              style={{
                backgroundColor: 'var(--theme-accent, #74a86c)',
                animation: `shrinkWidth ${durationMs}ms linear forwards`,
                animationPlayState: isHovered ? 'paused' : 'running',
              }}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes shrinkWidth {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
};
