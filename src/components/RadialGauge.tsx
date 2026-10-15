import React from 'react';

export interface RadialGaugeProps {
  /** Progress value in [0, 100] for the value ring. Omit to draw only the spectrum spokes. */
  percentage?: number;
  icon?: React.ReactNode;
  size?: number;
  strokeWidth?: number;
  accentColor?: string;
  /** Color the spoke gradient fades to. */
  secondaryColor?: string;
  label?: string;
  sublabel?: string;
  /** Live FFT spectrum amplitudes in [0, 1]. When provided a reactive spoke ring is drawn. */
  bands?: number[];
  /** Whether the spoke ring follows live playback; false renders an idle ring. */
  active?: boolean;
}

export const RadialGauge: React.FC<RadialGaugeProps> = ({
  percentage,
  icon,
  size = 64,
  strokeWidth = 6,
  accentColor = '#cba6f7',
  secondaryColor = '#89dceb',
  label,
  sublabel,
  bands,
  active = true,
}) => {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const hasRing = typeof percentage === 'number' && Number.isFinite(percentage);
  const clamped = Math.min(Math.max(hasRing ? (percentage as number) : 0, 0), 100);
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  // Unique, CSS-safe gradient id (useId may contain ':' which is invalid in url(#...)).
  const uid = React.useId().replace(/:/g, '');
  const spokeGradientId = `${uid}-spokes`;

  const spokes = React.useMemo(() => {
    if (!bands || bands.length === 0)
      return [] as Array<{
        idx: number;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        length: number;
      }>;
    const count = bands.length;
    const cx = size / 2;
    const cy = size / 2;
    const innerRadius = Math.max(strokeWidth * 2, radius - strokeWidth * 3.6);
    const maxLen = size * 0.17;
    return Array.from({ length: count }, (_, idx) => {
      const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
      const rawAmp = bands[idx] ?? 0;
      const amp = rawAmp > 0.005 ? Math.min(1, rawAmp * 2.8) : 0;
      const length = 3 + amp * maxLen;
      const outer = innerRadius + length;
      return {
        idx,
        x1: cx + Math.cos(angle) * innerRadius,
        y1: cy + Math.sin(angle) * innerRadius,
        x2: cx + Math.cos(angle) * outer,
        y2: cy + Math.sin(angle) * outer,
        length,
      };
    });
  }, [bands, size, radius, strokeWidth]);

  const gaugeElement = (
    <div
      className="relative flex items-center justify-center shrink-0 select-none group"
      style={{ width: size, height: size }}
      title={hasRing ? `${Math.round(clamped)}%` : undefined}
    >
      <svg width={size} height={size} className="overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={spokeGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={accentColor} />
            <stop offset="100%" stopColor={secondaryColor} />
          </linearGradient>
        </defs>

        {/* Live 40-spoke spectrum ring driven by the band array */}
        {spokes.length > 0 && (
          <>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={Math.max(0, radius - strokeWidth * 4.1)}
              fill="none"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth={1.25}
            />
            {spokes.map((spoke) => (
              <line
                key={spoke.idx}
                x1={spoke.x1}
                y1={spoke.y1}
                x2={spoke.x2}
                y2={spoke.y2}
                stroke={active ? `url(#${spokeGradientId})` : 'rgba(255, 255, 255, 0.22)'}
                strokeWidth={Math.max(1.6, (size / 190) * 2.6)}
                strokeLinecap="round"
                style={{
                  transition: 'all 85ms ease-out',
                  opacity: active ? Math.min(1, 0.55 + spoke.length / (size * 0.17)) : 0.45,
                }}
              />
            ))}
          </>
        )}

        {/* Optional progress ring */}
        {hasRing && (
          <>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={Math.max(0, radius - strokeWidth * 0.65)}
              fill="rgba(255, 255, 255, 0.015)"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={accentColor}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-500 ease-out"
              style={{
                filter: `drop-shadow(0 0 6px ${accentColor}66)`,
                transform: 'rotate(-90deg)',
                transformOrigin: '50% 50%',
              }}
            />
          </>
        )}
      </svg>

      {icon && (
        <div
          className="absolute inset-0 flex items-center justify-center text-white/85 transition-transform duration-200 ease-out group-hover:scale-105"
          style={{ color: accentColor }}
        >
          {icon}
        </div>
      )}
    </div>
  );

  if (!label && !sublabel) {
    return gaugeElement;
  }

  return (
    <div className="flex items-center gap-3">
      {gaugeElement}
      <div className="flex flex-col min-w-0">
        {label && (
          <span className="text-sm font-semibold text-white/90 tracking-tight truncate tabular-nums">
            {label}
          </span>
        )}
        {sublabel && (
          <span className="text-[11px] font-medium text-white/45 truncate tabular-nums">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
};
