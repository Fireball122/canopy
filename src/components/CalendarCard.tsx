import { Bell, ChevronLeft, ChevronRight, Clock, Plus, Trash2, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { usePanelOpen } from '../hooks/usePanelOpen';
import { setReminders } from '../services/hostBridge';

export interface CalendarEvent {
  id: string;
  date: string; // "YYYY-MM-DD"
  text: string;
  time?: string; // "HH:MM" in 24h
}

export interface CalendarCardProps {
  className?: string;
  firstDayOfWeek?: 'sunday' | 'monday';
  onToastNotification?: (message: string) => void;
}

interface CalendarDayCell {
  date: Date;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isoKey: string;
  eventCount: number;
}

const STORAGE_KEY = 'shell_calendar_events';
const WEEKDAYS_MONDAY = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const WEEKDAYS_SUNDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

const QUICK_TIME_PRESETS = [
  { label: '9 AM', time: '09:00' },
  { label: '12 PM', time: '12:00' },
  { label: '3 PM', time: '15:00' },
  { label: '6 PM', time: '18:00' },
  { label: '8 PM', time: '20:00' },
] as const;

const QUICK_TEXT_TAGS = ['Meeting', 'Standup', 'Call', 'Focus', 'Workout'] as const;

function format12HourDisplay(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  const rawH = parseInt(match[1], 10);
  const rawM = parseInt(match[2], 10);
  const period = rawH >= 12 ? 'PM' : 'AM';
  const hour12 = rawH % 12 === 0 ? 12 : rawH % 12;
  return `${hour12}:${String(rawM).padStart(2, '0')} ${period}`;
}

function formatFriendlyDate(iso: string): string {
  try {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export const CalendarCard: React.FC<CalendarCardProps> = ({
  className = '',
  firstDayOfWeek,
  onToastNotification,
}) => {
  const { settings } = useSettings();
  const calendarFirstDay: 'sunday' | 'monday' =
    firstDayOfWeek ?? settings?.calendarFirstDay ?? 'monday';

  const weekdayHeaders = calendarFirstDay === 'sunday' ? WEEKDAYS_SUNDAY : WEEKDAYS_MONDAY;

  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => {
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [today]);

  const [viewDate, setViewDate] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedIso, setSelectedIso] = useState<string>(todayIso);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [newReminderText, setNewReminderText] = useState<string>('');
  const [newReminderTime, setNewReminderTime] = useState<string>('09:00');
  const [isAdding, setIsAdding] = useState<boolean>(false);

  const panelOpen = usePanelOpen();

  useEffect(() => {
    if (!panelOpen) {
      setDrawerOpen(false);
      setIsAdding(false);
      setNewReminderText('');
    }
  }, [panelOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false);
        setIsAdding(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is CalendarEvent =>
            Boolean(
              item &&
                typeof item === 'object' &&
                typeof (item as CalendarEvent).id === 'string' &&
                !(item as CalendarEvent).id.startsWith('seed-canopy-') &&
                typeof (item as CalendarEvent).date === 'string' &&
                typeof (item as CalendarEvent).text === 'string',
            ),
          );
        }
      }
    } catch {
      // Fall through to empty
    }
    return [];
  });

  useEffect(() => {
    const handleEventsUpdated = (e: Event) => {
      const detail = (e as CustomEvent<CalendarEvent[]>).detail;
      if (Array.isArray(detail)) {
        setEvents(detail);
      } else {
        try {
          const raw =
            typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
          if (raw) setEvents(JSON.parse(raw));
        } catch {}
      }
    };
    window.addEventListener('calendar-events-updated', handleEventsUpdated);
    return () => window.removeEventListener('calendar-events-updated', handleEventsUpdated);
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
      }
    } catch {
      // Ignore storage errors
    }
    void setReminders(
      events.map((e) => ({
        id: e.id,
        text: e.text,
        date: e.date,
        time: e.time,
      })),
    );
  }, [events]);

  const selectedDayEvents = useMemo(
    () => events.filter((ev) => ev.date === selectedIso),
    [events, selectedIso],
  );

  const cells = useMemo<CalendarDayCell[]>(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const dayOfWeek = firstOfMonth.getDay();

    let offset: number;
    if (calendarFirstDay === 'sunday') {
      offset = dayOfWeek;
    } else {
      offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    }

    const gridStartDate = new Date(year, month, 1 - offset);
    const result: CalendarDayCell[] = [];

    const eventCountsByIso: Record<string, number> = {};
    for (const ev of events) {
      eventCountsByIso[ev.date] = (eventCountsByIso[ev.date] || 0) + 1;
    }

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(
        gridStartDate.getFullYear(),
        gridStartDate.getMonth(),
        gridStartDate.getDate() + i,
      );

      const y = cellDate.getFullYear();
      const m = String(cellDate.getMonth() + 1).padStart(2, '0');
      const d = String(cellDate.getDate()).padStart(2, '0');
      const isoKey = `${y}-${m}-${d}`;

      result.push({
        date: cellDate,
        dayNumber: cellDate.getDate(),
        isCurrentMonth: cellDate.getMonth() === month,
        isToday: isoKey === todayIso,
        isSelected: isoKey === selectedIso,
        isoKey,
        eventCount: eventCountsByIso[isoKey] || 0,
      });
    }

    return result;
  }, [viewDate, events, selectedIso, todayIso, calendarFirstDay]);

  const monthYearLabel = useMemo(() => {
    return viewDate.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }, [viewDate]);

  const isViewingCurrentMonth = useMemo(() => {
    return (
      viewDate.getFullYear() === today.getFullYear() && viewDate.getMonth() === today.getMonth()
    );
  }, [viewDate, today]);

  const handleResetToToday = () => {
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedIso(todayIso);
  };

  const handleAddReminder = (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = newReminderText.trim();
    if (!clean) return;

    const created: CalendarEvent = {
      id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: selectedIso,
      text: clean,
      time: newReminderTime || '09:00',
    };

    setEvents((prev) => [...prev, created]);
    setNewReminderText('');
    onToastNotification?.(
      `Added reminder: ${clean} (${format12HourDisplay(created.time || '09:00')})`,
    );
  };

  const handleDeleteReminder = (id: string) => {
    setEvents((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div
      className={`relative flex flex-col justify-between border shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] rounded-2xl p-2.5 transition-all duration-200 select-none overflow-hidden ${className}`}
      style={{
        background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
        color: 'var(--theme-text-primary)',
      }}
    >
      {/* Header: < Month Year > + Reminders toggle pill */}
      <div className="flex items-center justify-between mb-1 shrink-0">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() =>
              setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
            }
            aria-label="Previous month"
            className="p-1 rounded-lg hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2} />
          </button>

          <button
            type="button"
            onClick={handleResetToToday}
            title="Jump to today"
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-semibold tracking-tight hover:opacity-80 active:scale-95 transition-all cursor-pointer"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            <span>{monthYearLabel}</span>
            {!isViewingCurrentMonth && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--theme-accent)' }}
              />
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
            }
            aria-label="Next month"
            className="p-1 rounded-lg hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setDrawerOpen((prev) => !prev)}
          title="Toggle reminders for selected date"
          className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold transition-all border cursor-pointer active:scale-95"
          style={{
            borderColor:
              drawerOpen || selectedDayEvents.length > 0
                ? 'var(--theme-accent)'
                : 'var(--theme-border)',
            color:
              drawerOpen || selectedDayEvents.length > 0
                ? 'var(--theme-accent)'
                : 'var(--theme-text-secondary)',
            background: 'var(--theme-track)',
          }}
        >
          <Bell className="w-2.5 h-2.5" strokeWidth={2} />
          <span className="tabular-nums">{selectedDayEvents.length}</span>
        </button>
      </div>

      {/* Weekdays Row: Mo Tu We Th Fr Sa Su */}
      <div className="grid grid-cols-7 gap-0.5 mb-1 shrink-0">
        {weekdayHeaders.map((day) => (
          <div
            key={day}
            className="text-center text-[10px] font-mono font-semibold uppercase tracking-wider py-0.5 opacity-70"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 6-row x 7-col Date Grid */}
      <div className="grid grid-cols-7 grid-rows-6 gap-0.5 flex-1 items-center min-h-0">
        {cells.map((cell) => {
          const isToday = cell.isToday;
          const isSelected = cell.isSelected;

          let btnBg = 'transparent';
          let btnColor = cell.isCurrentMonth
            ? 'var(--theme-text-primary)'
            : 'var(--theme-text-secondary)';
          let btnBorder = 'transparent';
          let btnOpacity = cell.isCurrentMonth ? 1 : 0.35;

          if (isToday) {
            btnBg = 'var(--theme-accent)';
            btnColor = 'var(--theme-on-accent, #11111b)';
            btnBorder = 'var(--theme-accent)';
            btnOpacity = 1;
          } else if (isSelected) {
            btnBg = 'var(--theme-track)';
            btnBorder = 'var(--theme-accent)';
            btnColor = 'var(--theme-text-primary)';
            btnOpacity = 1;
          }

          return (
            <button
              key={cell.isoKey}
              type="button"
              onClick={() => {
                setSelectedIso(cell.isoKey);
                setDrawerOpen(true);
                setIsAdding(false);
              }}
              style={{
                background: btnBg,
                borderColor: btnBorder,
                color: btnColor,
                opacity: btnOpacity,
              }}
              className={`relative h-6 w-6 mx-auto flex flex-col items-center justify-center rounded-lg text-[11px] font-mono tabular-nums transition-all duration-150 border cursor-pointer active:scale-90 ${
                isToday ? 'font-bold shadow-sm' : isSelected ? 'font-semibold' : 'hover:bg-white/10'
              }`}
            >
              <span className={`leading-none ${cell.eventCount > 0 ? '-translate-y-[1.5px]' : ''}`}>
                {cell.dayNumber}
              </span>
              {cell.eventCount > 0 && (
                <span
                  style={{
                    background: isToday ? 'var(--theme-on-accent, #111)' : 'var(--theme-accent)',
                  }}
                  className="absolute bottom-[2px] w-1 h-1 rounded-full"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Slide-over Reminders & Time Management Drawer */}
      {drawerOpen && (
        <div
          className="absolute inset-1 z-30 rounded-xl border p-3 flex flex-col justify-between animate-in fade-in zoom-in-95 duration-150"
          style={{
            background: '#09090b',
            borderColor: 'var(--theme-border)',
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.95), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
          }}
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-[var(--theme-border)] pb-1.5 shrink-0">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--theme-accent)' }}
              />
              <span className="text-xs font-bold text-white tracking-tight">
                {formatFriendlyDate(selectedIso)}
              </span>
              <span
                className="px-1.5 py-0.2 rounded-full text-[9px] font-mono border"
                style={{
                  background: 'var(--theme-track)',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-secondary)',
                }}
              >
                {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'event' : 'events'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                setIsAdding(false);
              }}
              className="p-1 rounded-lg hover:bg-white/10 active:scale-95 transition-all text-[var(--theme-text-secondary)] hover:text-white cursor-pointer"
              title="Close drawer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {!isAdding ? (
            <div className="flex-1 flex flex-col justify-between min-h-0 my-1">
              {/* Events List for Selected Day */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 my-1 canopy-scroll min-h-0">
                {selectedDayEvents.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-3 opacity-60">
                    <Bell className="w-5 h-5 text-white/30 mb-1" />
                    <span className="text-[11px] text-[var(--theme-text-secondary)] font-medium">
                      No reminders set for this day
                    </span>
                    <span className="text-[9.5px] text-[var(--theme-text-secondary)] mt-0.5">
                      Click below to schedule one
                    </span>
                  </div>
                ) : (
                  selectedDayEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border text-xs"
                      style={{
                        background: 'var(--theme-card)',
                        borderColor: 'var(--theme-border)',
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-[9.5px] font-bold shrink-0 tabular-nums border"
                          style={{
                            background: 'var(--theme-track)',
                            borderColor: 'var(--theme-border)',
                            color: 'var(--theme-accent)',
                          }}
                        >
                          <Clock className="w-2.5 h-2.5" />
                          {format12HourDisplay(ev.time || '09:00')}
                        </span>
                        <span className="truncate text-white font-medium text-[11px]">
                          {ev.text}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteReminder(ev.id)}
                        className="p-1 rounded-lg hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0 text-[var(--theme-text-secondary)] cursor-pointer"
                        title="Delete reminder"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add Reminder Button */}
              <button
                type="button"
                onClick={() => setIsAdding(true)}
                className="w-full py-1.5 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-semibold hover:border-[var(--theme-accent)] transition-all cursor-pointer active:scale-98 shrink-0 mt-1 shadow-sm"
                style={{
                  background: 'var(--theme-track)',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-primary)',
                }}
              >
                <Plus className="w-3.5 h-3.5 text-[var(--theme-accent)]" />
                <span>Add Reminder</span>
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                handleAddReminder(e);
                setIsAdding(false);
              }}
              className="flex-1 flex flex-col justify-between min-h-0 my-0.5 animate-in fade-in duration-150"
            >
              <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto pr-0.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--theme-accent)] font-semibold">
                  New Reminder • {formatFriendlyDate(selectedIso)}
                </span>

                {/* Name Input */}
                <input
                  type="text"
                  autoFocus
                  value={newReminderText}
                  onChange={(e) => setNewReminderText(e.target.value)}
                  placeholder="Reminder name (e.g. Doctor appointment)..."
                  className="w-full border rounded-xl px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-[var(--theme-accent)] bg-white/5 text-white placeholder-white/40"
                  style={{
                    borderColor: 'var(--theme-border)',
                  }}
                />

                {/* Quick Suggestion Tags */}
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                  {QUICK_TEXT_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setNewReminderText(tag)}
                      className="px-2 py-0.5 rounded-md text-[9px] font-mono border hover:bg-white/10 active:scale-95 transition-all text-[var(--theme-text-secondary)] hover:text-white cursor-pointer shrink-0"
                      style={{
                        background: 'var(--theme-track)',
                        borderColor: 'var(--theme-border)',
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                {/* Time Selection Header */}
                <div className="flex items-center justify-between text-[10px] font-mono text-[var(--theme-text-secondary)] pt-1">
                  <span>Time:</span>
                  <span className="text-white font-semibold tabular-nums">
                    {format12HourDisplay(newReminderTime)}
                  </span>
                </div>

                {/* Quick Time Presets & Input */}
                <div className="flex items-center gap-1 overflow-x-auto">
                  {QUICK_TIME_PRESETS.map((preset) => {
                    const isSelected = newReminderTime === preset.time;
                    return (
                      <button
                        key={preset.time}
                        type="button"
                        onClick={() => setNewReminderTime(preset.time)}
                        className="flex-1 py-1 rounded-lg text-[9.5px] font-mono font-semibold border transition-all active:scale-95 cursor-pointer text-center tabular-nums shrink-0"
                        style={{
                          background: isSelected ? 'var(--theme-accent)' : 'var(--theme-track)',
                          borderColor: isSelected ? 'var(--theme-accent)' : 'var(--theme-border)',
                          color: isSelected
                            ? 'var(--theme-on-accent, #111)'
                            : 'var(--theme-text-secondary)',
                        }}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                  <input
                    type="time"
                    value={newReminderTime}
                    onChange={(e) => setNewReminderTime(e.target.value)}
                    className="px-2 py-1 rounded-lg text-[10px] font-mono font-semibold border bg-[var(--theme-track)] text-white border-[var(--theme-border)] outline-none cursor-pointer tabular-nums shrink-0"
                  />
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--theme-border)] shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-3 py-1 rounded-xl border text-xs font-medium hover:bg-white/5 transition-colors cursor-pointer text-[var(--theme-text-secondary)]"
                  style={{ borderColor: 'var(--theme-border)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newReminderText.trim()}
                  className="px-3.5 py-1 rounded-xl font-semibold text-xs transition-all active:scale-95 flex items-center gap-1 shadow-sm disabled:opacity-40 cursor-pointer"
                  style={{
                    background: 'var(--theme-accent)',
                    color: 'var(--theme-on-accent, #111)',
                  }}
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Save</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
