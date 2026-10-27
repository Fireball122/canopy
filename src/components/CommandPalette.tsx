import { Calculator, Calendar as CalendarIcon, Search, Sun, Volume2 } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { setReminders } from '../services/hostBridge';

export interface CommandPaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  run: () => void;
  keywords?: string[];
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandPaletteItem[];
  onVolumeChange?: (val: number) => void;
  onBrightnessChange?: (val: number) => void;
  initialQuery?: string;
}

function filterPaletteCommands(
  commands: CommandPaletteItem[],
  query: string,
): CommandPaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((cmd) => {
    if (cmd.label.toLowerCase().includes(q)) return true;
    if (cmd.hint.toLowerCase().includes(q)) return true;
    if (cmd.keywords?.some((k) => k.toLowerCase().includes(q))) {
      return true;
    }
    return false;
  });
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  commands,
  onVolumeChange,
  onBrightnessChange,
  initialQuery = '',
}) => {
  const [query, setQuery] = useState<string>(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setSelectedIndex(0);
    }
  }, [open, initialQuery]);

  const matches = useMemo(() => {
    const dynamicCommands: CommandPaletteItem[] = [];
    const trimmed = query.trim();

    // 1. Math calculation (= 120 * 1.08)
    if (trimmed.startsWith('=')) {
      const expr = trimmed.slice(1).trim();
      if (expr.length > 0) {
        try {
          if (/^[0-9+\-*/().\s%^]+$/.test(expr)) {
            const result = Function(`'use strict'; return (${expr})`)();
            if (typeof result === 'number' && Number.isFinite(result)) {
              dynamicCommands.push({
                id: 'calc:result',
                label: `${expr} = ${result}`,
                hint: 'Copy Calculation',
                icon: <Calculator className="w-3.5 h-3.5 text-amber-400" />,
                run: () => {
                  void navigator.clipboard.writeText(String(result));
                },
              });
            }
          }
        } catch {}
      }
    }

    // 2. Volume command (vol 75, volume 50)
    const volMatch = trimmed.match(/^(?:vol|volume)\s+(\d{1,3})$/i);
    if (volMatch && onVolumeChange) {
      const targetVol = Math.max(0, Math.min(100, parseInt(volMatch[1], 10)));
      dynamicCommands.push({
        id: 'action:set-vol',
        label: `Set Volume to ${targetVol}%`,
        hint: 'Audio',
        icon: <Volume2 className="w-3.5 h-3.5 text-sky-400" />,
        run: () => {
          onVolumeChange(targetVol);
        },
      });
    }

    // 3. Brightness command (bri 80, brightness 60)
    const briMatch = trimmed.match(/^(?:bri|brightness)\s+(\d{1,3})$/i);
    if (briMatch && onBrightnessChange) {
      const targetBri = Math.max(0, Math.min(100, parseInt(briMatch[1], 10)));
      dynamicCommands.push({
        id: 'action:set-bri',
        label: `Set Brightness to ${targetBri}%`,
        hint: 'Display',
        icon: <Sun className="w-3.5 h-3.5 text-yellow-400" />,
        run: () => {
          onBrightnessChange(targetBri);
        },
      });
    }

    // 4. Quick reminder (remind Take a stretch, reminder Check email)
    const remindMatch = trimmed.match(/^(?:remind|reminder)\s+(.+)$/i);
    if (remindMatch && remindMatch[1].trim().length > 0) {
      const reminderText = remindMatch[1].trim();
      dynamicCommands.push({
        id: 'action:add-reminder',
        label: `Add Reminder: "${reminderText}"`,
        hint: 'Calendar',
        icon: <CalendarIcon className="w-3.5 h-3.5 text-emerald-400" />,
        run: () => {
          const now = new Date();
          const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
          const hh = String(nextHour.getHours()).padStart(2, '0');
          const mm = String(nextHour.getMinutes()).padStart(2, '0');
          const yyyy = nextHour.getFullYear();
          const mon = String(nextHour.getMonth() + 1).padStart(2, '0');
          const dd = String(nextHour.getDate()).padStart(2, '0');
          const newReminder = {
            id: `rem_${Date.now()}`,
            text: reminderText,
            date: `${yyyy}-${mon}-${dd}`,
            time: `${hh}:${mm}`,
          };
          try {
            const raw = window.localStorage.getItem('shell_calendar_events');
            const existing = raw ? JSON.parse(raw) : [];
            const updated = Array.isArray(existing) ? [...existing, newReminder] : [newReminder];
            window.localStorage.setItem('shell_calendar_events', JSON.stringify(updated));
            window.dispatchEvent(new CustomEvent('calendar-events-updated', { detail: updated }));
            void setReminders(updated);
          } catch {}
        },
      });
    }

    if (dynamicCommands.length > 0) {
      return dynamicCommands;
    }

    return filterPaletteCommands(commands, query);
  }, [commands, query, onVolumeChange, onBrightnessChange]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-[70] flex items-start justify-center pt-12 px-4 bg-[#0b0b12]/55 backdrop-blur-[3px] pointer-events-auto"
      onMouseDown={onClose}
    >
      <div
        className="w-[520px] rounded-2xl overflow-hidden pointer-events-auto"
        style={{
          background: 'var(--theme-bg)',
          border: '1px solid var(--theme-border)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: '1px solid var(--theme-border)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--theme-accent)' }} />
          <input
            autoFocus
            type="text"
            value={query}
            placeholder="Type a command…"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  matches.length === 0 ? 0 : (prev + 1) % matches.length,
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  matches.length === 0 ? 0 : (prev - 1 + matches.length) % matches.length,
                );
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = matches[selectedIndex];
                if (cmd) {
                  onClose();
                  cmd.run();
                }
              }
            }}
            className="flex-1 bg-transparent text-xs focus:outline-none pointer-events-auto"
            style={{ color: 'var(--theme-text-primary)' }}
          />
          <span
            className="px-1.5 py-0.5 rounded-md text-[9px] font-mono shrink-0"
            style={{ background: 'var(--theme-track)', color: 'var(--theme-text-secondary)' }}
          >
            Esc
          </span>
        </div>

        <div className="max-h-[230px] overflow-y-auto py-1">
          {matches.length === 0 ? (
            <div className="px-3 py-3 text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
              No matching commands
            </div>
          ) : (
            matches.map((command, index) => {
              const highlighted = index === selectedIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    onClose();
                    command.run();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors duration-150 pointer-events-auto cursor-pointer"
                  style={{
                    background: highlighted ? 'var(--theme-track)' : 'transparent',
                    color: 'var(--theme-text-primary)',
                  }}
                >
                  <span
                    className="shrink-0"
                    style={{
                      color: highlighted ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                    }}
                  >
                    {command.icon}
                  </span>
                  <span className="flex-1 truncate">{command.label}</span>
                  <span
                    className="text-[9px] font-mono shrink-0"
                    style={{ color: 'var(--theme-text-secondary)' }}
                  >
                    {command.hint}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
