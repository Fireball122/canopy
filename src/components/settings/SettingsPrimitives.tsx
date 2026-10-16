import type React from 'react';
import { useState } from 'react';

export function SettingSection({
  title,
  icon,
  badge,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="p-4 rounded-2xl border backdrop-blur-md flex flex-col gap-3.5 transition-all"
      style={{
        background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
      }}
    >
      <div className="flex items-center justify-between pb-2 border-b border-[var(--theme-border)]">
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--theme-accent)' }}>{icon}</span>
          <span
            className="text-xs font-semibold tracking-wide"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            {title}
          </span>
        </div>
        {badge && (
          <span
            className="px-2 py-0.5 rounded-full text-[9px] font-mono border"
            style={{
              background: 'var(--theme-track)',
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text-secondary)',
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="flex-1 min-w-0 pr-2">
        <div className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
          {title}
        </div>
        {description && (
          <div
            className="text-[10px] leading-snug mt-0.5"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-10 h-5 rounded-full p-0.5 transition-all flex items-center pointer-events-auto cursor-pointer shrink-0 disabled:opacity-40"
      style={{
        background: checked
          ? 'var(--theme-accent, #cba6f7)'
          : 'var(--theme-track, rgba(255, 255, 255, 0.14))',
      }}
    >
      <div
        className="w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
        style={{
          transform: checked ? 'translateX(20px)' : 'translateX(0px)',
        }}
      />
    </button>
  );
}

export function SegmentedChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string; icon?: React.ReactNode }>;
  value: T;
  onChange: (val: T) => void;
}) {
  return (
    <div
      className="flex items-center p-0.5 rounded-xl border shrink-0"
      style={{
        background: 'var(--theme-track, rgba(0, 0, 0, 0.22))',
        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
      }}
    >
      {options.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all flex items-center gap-1.5 pointer-events-auto cursor-pointer"
            style={{
              background: selected ? 'var(--theme-accent)' : 'transparent',
              color: selected ? '#11111b' : 'var(--theme-text-secondary)',
              fontWeight: selected ? 600 : 400,
            }}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center justify-between text-xs font-medium">
        <span style={{ color: 'var(--theme-text-primary)' }}>{label}</span>
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded-md border tabular-nums"
          style={{
            background: 'var(--theme-track)',
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-accent)',
          }}
        >
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--theme-accent)] h-1.5 rounded-lg appearance-none cursor-pointer bg-[var(--theme-track)]"
      />
    </div>
  );
}

export function HotkeyRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (hotkey: string) => void;
}) {
  const [recording, setRecording] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      setRecording(false);
      return;
    }

    const modifiers: string[] = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.metaKey) modifiers.push('Win');

    const key = e.key.toUpperCase();
    if (['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key)) return;

    const formattedKey = key === ' ' ? 'Space' : key;
    const finalHotkey = [...modifiers, formattedKey].join('+');

    onChange(finalHotkey);
    setRecording(false);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onKeyDown={handleKeyDown}
        onClick={() => setRecording(!recording)}
        className={`px-3 py-1 rounded-lg text-xs font-mono border transition-all ${
          recording
            ? 'border-[var(--theme-accent)] ring-2 ring-[var(--theme-accent)] animate-pulse'
            : ''
        }`}
        style={{ background: 'var(--theme-track)', color: 'var(--theme-text-primary)' }}
      >
        {recording ? 'Press keys (Esc to cancel)...' : value || 'Click to record'}
      </button>
      <button
        type="button"
        onClick={() => onChange('Win+`')}
        className="text-[10px] text-[var(--theme-text-secondary)] hover:underline"
      >
        Default
      </button>
    </div>
  );
}
