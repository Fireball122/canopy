import React from 'react';

export interface RadialGaugeProps {
  percentage: number;
  icon: React.ReactNode;
  size?: number;
  strokeWidth?: number;
  accentColor?: string;
  label?: string;
  sublabel?: string;
}

export const RadialGauge: React.FC<RadialGaugeProps> = ({
  percentage,
  icon,
  size = 64,
  strokeWidth = 6,
  accentColor = '#cba6f7',
  label,
  sublabel,
}) => {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(Number.isFinite(percentage) ? percentage : 0, 0), 100);
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  const gaugeElement = (
    <div
      className="relative flex items-center justify-center shrink-0 select-none group"
      style={{ width: size, height: size }}
      title={`${Math.round(clamped)}%`}
    >
      <svg
        width={size}
        height={size}
        className="transform -rotate-90 overflow-visible"
        aria-hidden="true"
      >
        {/* Subtle inner track surface */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={Math.max(0, radius - strokeWidth * 0.65)}
          fill="rgba(255, 255, 255, 0.015)"
        />
        {/* Track ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Animated value ring */}
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
          }}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-white/85 transition-transform duration-200 ease-out group-hover:scale-105"
        style={{ color: accentColor }}
      >
        {icon}
      </div>
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
