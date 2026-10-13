import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Bell, Clock } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';

export interface CalendarEvent {
  id: string;
  date: string; // "YYYY-MM-DD"
  text: string;
  time?: string; // "HH:MM"
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

function parse24HourTime(hhmm: string): {
  hour12: number;
  minute: number;
  period: 'AM' | 'PM';
} {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) {
    return { hour12: 9, minute: 0, period: 'AM' };
  }
  const rawH = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const rawM = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  const period: 'AM' | 'PM' = rawH >= 12 ? 'PM' : 'AM';
  const hour12 = rawH % 12 === 0 ? 12 : rawH % 12;
  return { hour12, minute: rawM, period };
}

function to24HourTime(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  let h24 = hour12 % 12;
  if (period === 'PM') {
    h24 += 12;
  }
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function format12HourDisplay(hhmm: string): string {
  const { hour12, minute, period } = parse24HourTime(hhmm);
  return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`;
}

const HOURS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => i);

export const CalendarCard: React.FC<CalendarCardProps> = ({
  className = '',
  firstDayOfWeek,
  onToastNotification,
}) => {
  const { settings } = useSettings();
  const calendarFirstDay: 'sunday' | 'monday' =
    firstDayOfWeek ?? settings?.calendarFirstDay ?? 'monday';

  const weekdayHeaders =
    calendarFirstDay === 'sunday' ? WEEKDAYS_SUNDAY : WEEKDAYS_MONDAY;

  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => {
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [today]);

  const [viewDate, setViewDate] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedIso, setSelectedIso] = useState<string>(todayIso);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [newReminderText, setNewReminderText] = useState<string>('');
  const [newReminderTime, setNewReminderTime] = useState<string>('09:00');
  const [timePickerOpen, setTimePickerOpen] = useState<boolean>(false);
  const [pickerHour, setPickerHour] = useState<number>(9);
  const [pickerMinute, setPickerMinute] = useState<number>(0);
  const [pickerPeriod, setPickerPeriod] = useState<'AM' | 'PM'>('AM');

  const hourColumnRef = useRef<HTMLDivElement | null>(null);
  const minuteColumnRef = useRef<HTMLDivElement | null>(null);

  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is CalendarEvent =>
              Boolean(
                item &&
                  typeof item === 'object' &&
                  typeof (item as CalendarEvent).id === 'string' &&
                  typeof (item as CalendarEvent).date === 'string' &&
                  typeof (item as CalendarEvent).text === 'string'
              )
          );
        }
      }
    } catch {
      // Fall through to seed sample events
    }

    const seeded: CalendarEvent[] = [
      {
        id: 'seed-canopy-1',
        date: todayIso,
        text: 'Canopy shell telemetry review',
        time: '14:00',
      },
      {
        id: 'seed-canopy-2',
        date: todayIso,
        text: 'Evening desktop workspace backup',
        time: '18:30',
      },
    ];
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      }
    } catch {
      // Ignore storage quota errors
    }
    return seeded;
  });

  const firedNotificationsRef = useRef<Record<string, true>>({});
  const toastCallbackRef = useRef(onToastNotification);
  toastCallbackRef.current = onToastNotification;

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
      }
    } catch {
      // Ignore storage errors
    }
  }, [events]);

  useEffect(() => {
    if (!timePickerOpen) return;
    const raf = window.requestAnimationFrame(() => {
      const activeHourEl = hourColumnRef.current?.querySelector<HTMLButtonElement>(
        '[data-active="true"]'
      );
      activeHourEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });

      const activeMinuteEl = minuteColumnRef.current?.querySelector<HTMLButtonElement>(
        '[data-active="true"]'
      );
      activeMinuteEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [timePickerOpen]);

  // Every 30 seconds, check if any reminder matches today's YYYY-MM-DD and current HH:MM
  useEffect(() => {
    const checkDueReminders = () => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const currentIso = `${y}-${m}-${d}`;
      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
      ).padStart(2, '0')}`;

      for (const ev of events) {
        if (ev.date === currentIso && ev.time === currentHHMM) {
          const fireKey = `${ev.id}:${currentIso}:${currentHHMM}`;
          if (!firedNotificationsRef.current[fireKey]) {
            firedNotificationsRef.current[fireKey] = true;
            toastCallbackRef.current?.(`Reminder: ${ev.text}`);
            if (typeof window !== 'undefined' && 'Notification' in window) {
              if (Notification.permission === 'granted') {
                new Notification('Canopy Reminder', { body: ev.text });
              } else if (Notification.permission === 'default') {
                Notification.requestPermission()
                  .then((perm) => {
                    if (perm === 'granted') {
                      new Notification('Canopy Reminder', { body: ev.text });
                    }
                  })
                  .catch(() => undefined);
              }
            }
          }
        }
      }
    };

    checkDueReminders();
    const timer = window.setInterval(checkDueReminders, 30_000);
    return () => window.clearInterval(timer);
  }, [events]);

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  const monthYearLabel = viewDate.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });

  const isViewingCurrentMonth =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();

  const eventsByDate = useMemo(() => {
    const byDate: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      const list = byDate[ev.date] ?? [];
      list.push(ev);
      byDate[ev.date] = list;
    }
    return byDate;
  }, [events]);

  const selectedDayEvents = useMemo(
    () => eventsByDate[selectedIso] ?? [],
    [eventsByDate, selectedIso]
  );

  const cells = useMemo<CalendarDayCell[]>(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const rawDay = firstDayOfMonth.getDay(); // 0 = Sunday .. 6 = Saturday
    const startWeekday =
      calendarFirstDay === 'sunday' ? rawDay : (rawDay + 6) % 7;

    const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();

    const grid: CalendarDayCell[] = [];

    for (let i = 0; i < 42; i++) {
      let cellDate: Date;
      let isCurrentMonth = true;

      if (i < startWeekday) {
        const prevDay = daysInPrevMonth - (startWeekday - 1 - i);
        cellDate = new Date(viewYear, viewMonth - 1, prevDay);
        isCurrentMonth = false;
      } else if (i >= startWeekday + daysInCurrentMonth) {
        const nextDay = i - (startWeekday + daysInCurrentMonth) + 1;
        cellDate = new Date(viewYear, viewMonth + 1, nextDay);
        isCurrentMonth = false;
      } else {
        const curDay = i - startWeekday + 1;
        cellDate = new Date(viewYear, viewMonth, curDay);
        isCurrentMonth = true;
      }

      const cy = cellDate.getFullYear();
      const cm = cellDate.getMonth();
      const cd = cellDate.getDate();
      const isoKey = `${cy}-${String(cm + 1).padStart(2, '0')}-${String(cd).padStart(2, '0')}`;
      const isToday = cy === todayYear && cm === todayMonth && cd === todayDate;
      const eventCount = eventsByDate[isoKey]?.length ?? 0;

      grid.push({
        date: cellDate,
        dayNumber: cd,
        isCurrentMonth,
        isToday,
        isSelected: isoKey === selectedIso,
        isoKey,
        eventCount,
      });
    }

    return grid;
  }, [viewYear, viewMonth, today, selectedIso, eventsByDate, calendarFirstDay]);

  const handleResetToToday = () => {
    const now = new Date();
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    setSelectedIso(`${y}-${m}-${d}`);
  };

  const handleSelectCell = (cell: CalendarDayCell) => {
    setSelectedIso(cell.isoKey);
    if (!cell.isCurrentMonth) {
      setViewDate(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
    }
    setDrawerOpen(true);
  };

  const handleOpenTimePicker = () => {
    const parsed = parse24HourTime(newReminderTime);
    setPickerHour(parsed.hour12);
    setPickerMinute(parsed.minute);
    setPickerPeriod(parsed.period);
    setTimePickerOpen(true);
  };

  const handleConfirmTimePicker = () => {
    setNewReminderTime(to24HourTime(pickerHour, pickerMinute, pickerPeriod));
    setTimePickerOpen(false);
  };

  const handleAddReminder = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newReminderText.trim();
    if (!trimmed) return;

    const cleanTime =
      newReminderTime && /^\d{2}:\d{2}$/.test(newReminderTime.trim())
        ? newReminderTime.trim()
        : undefined;

    const created: CalendarEvent = {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: selectedIso,
      text: trimmed,
      time: cleanTime,
    };

    setEvents((prev) => [...prev, created]);
    setNewReminderText('');
    onToastNotification?.(`Added reminder for ${selectedIso}`);
  };

  return (
    <div
      data-tauri-drag-region="false"
      style={{
        pointerEvents: 'auto',
        background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
        color: 'var(--theme-text-primary, #F8FAFC)',
      }}
      className={`relative flex flex-col justify-between border shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] rounded-2xl p-3 transition-all duration-200 select-none overflow-hidden ${className}`}
    >
      {/* Header: < Month Year > + Reminder drawer button */}
      <div
        data-tauri-drag-region="false"
        style={{ pointerEvents: 'auto' }}
        className="flex items-center justify-between mb-1.5"
      >
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-tauri-drag-region="false"
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              color: 'var(--theme-text-secondary, #94A3B8)',
            }}
            onClick={() =>
              setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
            }
            aria-label="Previous month"
            className="pointer-events-auto cursor-pointer p-1 rounded-lg hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2} />
          </button>

          <button
            type="button"
            data-tauri-drag-region="false"
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              color: 'var(--theme-text-primary, #F8FAFC)',
            }}
            onClick={handleResetToToday}
            title="Jump to today"
            className="pointer-events-auto cursor-pointer flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg text-xs font-semibold tracking-tight hover:opacity-80 active:scale-95 transition-all"
          >
            <span>{monthYearLabel}</span>
            {!isViewingCurrentMonth && (
              <span
                style={{ background: 'var(--theme-accent, #A29BFE)' }}
                className="w-1.5 h-1.5 rounded-full"
              />
            )}
          </button>

          <button
            type="button"
            data-tauri-drag-region="false"
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              color: 'var(--theme-text-secondary, #94A3B8)',
            }}
            onClick={() =>
              setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
            }
            aria-label="Next month"
            className="pointer-events-auto cursor-pointer p-1 rounded-lg hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all"
          >
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>

        <button
          type="button"
          data-tauri-drag-region="false"
          style={{
            pointerEvents: 'auto',
            cursor: 'pointer',
            borderColor:
              drawerOpen || selectedDayEvents.length > 0
                ? 'var(--theme-accent, #A29BFE)'
                : 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            color:
              drawerOpen || selectedDayEvents.length > 0
                ? 'var(--theme-accent, #A29BFE)'
                : 'var(--theme-text-secondary, #94A3B8)',
            background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
          }}
          onClick={() => {
            setDrawerOpen((prev) => {
              if (prev) setTimePickerOpen(false);
              return !prev;
            });
          }}
          title="Toggle reminders for selected date"
          className="pointer-events-auto cursor-pointer flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all border"
        >
          <Bell className="w-2.5 h-2.5" strokeWidth={2} />
          <span className="tabular-nums">{selectedDayEvents.length}</span>
        </button>
      </div>

      {/* Days of week header: Sunday or Monday first */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {weekdayHeaders.map((day) => (
          <div
            key={day}
            style={{ color: 'var(--theme-text-secondary, #94A3B8)' }}
            className="text-center text-[10px] font-semibold uppercase tracking-wider py-0.5 opacity-80"
          >
            {day}
          </div>
        ))}
      </div>

      {/* 6-row x 7-col date grid */}
      <div
        data-tauri-drag-region="false"
        style={{ pointerEvents: 'auto' }}
        className="grid grid-cols-7 grid-rows-6 gap-y-0.5 gap-x-0.5 flex-1 items-center"
      >
        {cells.map((cell) => {
          const isToday = cell.isToday;
          const isSelected = cell.isSelected;

          let inlineStyle: React.CSSProperties = {
            pointerEvents: 'auto',
            cursor: 'pointer',
            color: cell.isCurrentMonth
              ? 'var(--theme-text-primary, #F8FAFC)'
              : 'var(--theme-text-secondary, #94A3B8)',
            opacity: cell.isCurrentMonth ? 1 : 0.38,
          };

          if (isSelected && !isToday) {
            inlineStyle = {
              ...inlineStyle,
              background: 'var(--theme-track, rgba(255, 255, 255, 0.12))',
              boxShadow: '0 0 0 1.5px var(--theme-accent, #A29BFE)',
              color: 'var(--theme-text-primary, #F8FAFC)',
              opacity: 1,
            };
          } else if (isToday) {
            inlineStyle = {
              pointerEvents: 'auto',
              cursor: 'pointer',
              background: 'var(--theme-accent, #A29BFE)',
              color: '#FFFFFF',
              boxShadow: isSelected
                ? '0 0 0 2px var(--theme-text-primary, #FFFFFF), 0 2px 10px rgba(0,0,0,0.25)'
                : '0 2px 8px rgba(0,0,0,0.2)',
              opacity: 1,
            };
          }

          return (
            <button
              key={cell.isoKey}
              type="button"
              data-tauri-drag-region="false"
              style={inlineStyle}
              onClick={() => handleSelectCell(cell)}
              className={`pointer-events-auto cursor-pointer relative h-6 w-6 mx-auto flex flex-col items-center justify-center rounded-full text-[11px] tabular-nums transition-all duration-150 active:scale-90 ${
                isToday ? 'font-bold' : isSelected ? 'font-semibold' : 'font-medium'
              }`}
            >
              <span className={`leading-none ${cell.eventCount > 0 ? '-translate-y-[1.5px]' : ''}`}>
                {cell.dayNumber}
              </span>
              {cell.eventCount > 0 && (
                <span
                  style={{
                    background: isToday ? '#FFFFFF' : 'var(--theme-accent, #A29BFE)',
                  }}
                  className="absolute bottom-[2px] w-1 h-1 rounded-full"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Compact inline reminder drawer / popover */}
      {drawerOpen && (
        <div
          data-tauri-drag-region="false"
          style={{
            pointerEvents: 'auto',
            background: 'var(--theme-bg, rgba(18, 18, 24, 0.96))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.14))',
            color: 'var(--theme-text-primary, #F8FAFC)',
          }}
          className="absolute inset-1.5 z-20 rounded-xl backdrop-blur-xl border p-2.5 flex flex-col justify-between shadow-2xl"
        >
          <div
            style={{ borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))' }}
            className="flex items-center justify-between border-b pb-1.5 mb-1.5"
          >
            <div className="flex items-center gap-1.5">
              <span
                style={{ background: 'var(--theme-accent, #A29BFE)' }}
                className="w-1.5 h-1.5 rounded-full"
              />
              <span
                style={{ color: 'var(--theme-text-primary, #F8FAFC)' }}
                className="text-[11px] font-semibold font-mono"
              >
                {selectedIso}
              </span>
              <span
                style={{ color: 'var(--theme-text-secondary, #94A3B8)' }}
                className="text-[10px]"
              >
                ({selectedDayEvents.length})
              </span>
            </div>
            <button
              type="button"
              data-tauri-drag-region="false"
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                color: 'var(--theme-text-secondary, #94A3B8)',
              }}
              onClick={() => {
                setTimePickerOpen(false);
                setDrawerOpen(false);
              }}
              aria-label="Close reminders"
              className="pointer-events-auto cursor-pointer p-1 rounded-md hover:opacity-100 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div
            data-tauri-drag-region="false"
            style={{ pointerEvents: 'auto' }}
            className="flex-1 overflow-y-auto space-y-1 pr-0.5 my-0.5"
          >
            {selectedDayEvents.length === 0 ? (
              <div
                style={{ color: 'var(--theme-text-secondary, #94A3B8)' }}
                className="h-full flex items-center justify-center text-[11px] italic opacity-75"
              >
                No reminders scheduled for this day
              </div>
            ) : (
              selectedDayEvents.map((ev) => (
                <div
                  key={ev.id}
                  data-tauri-drag-region="false"
                  style={{
                    pointerEvents: 'auto',
                    background: 'var(--theme-card, rgba(255, 255, 255, 0.05))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                  }}
                  className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg border text-[11px]"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {ev.time && (
                      <span
                        style={{
                          background: 'var(--theme-track, rgba(255, 255, 255, 0.1))',
                          color: 'var(--theme-accent, #A29BFE)',
                        }}
                        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-mono text-[9px] shrink-0 font-semibold"
                      >
                        <Clock className="w-2.5 h-2.5" />
                        {format12HourDisplay(ev.time)}
                      </span>
                    )}
                    <span
                      style={{ color: 'var(--theme-text-primary, #F8FAFC)' }}
                      className="truncate"
                    >
                      {ev.text}
                    </span>
                  </div>
                  <button
                    type="button"
                    data-tauri-drag-region="false"
                    style={{
                      pointerEvents: 'auto',
                      cursor: 'pointer',
                      color: 'var(--theme-text-secondary, #94A3B8)',
                    }}
                    onClick={() => setEvents((prev) => prev.filter((item) => item.id !== ev.id))}
                    aria-label="Delete reminder"
                    className="pointer-events-auto cursor-pointer p-0.5 rounded hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={handleAddReminder}
            data-tauri-drag-region="false"
            style={{
              pointerEvents: 'auto',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
            }}
            className="flex items-center gap-1 pt-1.5 border-t"
          >
            <input
              type="text"
              value={newReminderText}
              onChange={(e) => setNewReminderText(e.target.value)}
              placeholder="New reminder..."
              data-tauri-drag-region="false"
              style={{
                pointerEvents: 'auto',
                background: 'var(--theme-track, rgba(255, 255, 255, 0.08))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                color: 'var(--theme-text-primary, #F8FAFC)',
              }}
              className="pointer-events-auto flex-1 min-w-0 border rounded-lg px-2 py-1 text-[11px] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleOpenTimePicker}
              data-tauri-drag-region="false"
              title="Select reminder time"
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                background: 'var(--theme-track, rgba(255, 255, 255, 0.08))',
                borderColor: timePickerOpen
                  ? 'var(--theme-accent, #A29BFE)'
                  : 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                color: 'var(--theme-text-primary, #F8FAFC)',
              }}
              className="pointer-events-auto cursor-pointer inline-flex items-center gap-1 border rounded-lg px-2 py-1 text-[10px] font-mono font-semibold hover:border-white/25 active:scale-95 transition-all shrink-0 tabular-nums"
            >
              <Clock
                className="w-3 h-3 shrink-0"
                style={{ color: 'var(--theme-accent, #A29BFE)' }}
              />
              <span>{format12HourDisplay(newReminderTime)}</span>
            </button>
            <button
              type="submit"
              data-tauri-drag-region="false"
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                background: 'var(--theme-accent, #A29BFE)',
                color: '#FFFFFF',
              }}
              aria-label="Add reminder"
              className="pointer-events-auto cursor-pointer p-1.5 rounded-lg font-semibold active:scale-95 transition-all shrink-0"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            </button>
          </form>

          {/* Interactive Time Selector Popup Modal */}
          {timePickerOpen && (
            <div
              data-tauri-drag-region="false"
              style={{
                pointerEvents: 'auto',
                background: 'var(--theme-bg, rgba(16, 16, 22, 0.98))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.16))',
                color: 'var(--theme-text-primary, #F8FAFC)',
              }}
              className="absolute inset-0 z-30 rounded-xl backdrop-blur-2xl border p-2.5 flex flex-col justify-between shadow-2xl animate-in fade-in duration-150"
            >
              {/* Modal Header */}
              <div
                style={{ borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))' }}
                className="flex items-center justify-between border-b pb-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <Clock
                    className="w-3.5 h-3.5"
                    style={{ color: 'var(--theme-accent, #A29BFE)' }}
                  />
                  <span className="text-[11px] font-semibold tracking-tight">Select Time</span>
                </div>
                <span
                  style={{
                    background: 'var(--theme-track, rgba(255, 255, 255, 0.1))',
                    color: 'var(--theme-accent, #A29BFE)',
                  }}
                  className="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold tabular-nums"
                >
                  {`${String(pickerHour).padStart(2, '0')}:${String(pickerMinute).padStart(2, '0')} ${pickerPeriod}`}
                </span>
              </div>

              {/* Scrollable / Clickable Selector Columns: Hours (1-12), Minutes (00-59), AM/PM */}
              <div
                data-tauri-drag-region="false"
                style={{ pointerEvents: 'auto' }}
                className="grid grid-cols-3 gap-1.5 flex-1 min-h-0 my-1.5"
              >
                {/* Hours Column (1..12) */}
                <div
                  style={{
                    background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                  }}
                  className="flex flex-col rounded-lg border p-1 min-h-0"
                >
                  <div
                    style={{ color: 'var(--theme-text-secondary, #94A3B8)' }}
                    className="text-[9px] font-mono font-semibold uppercase tracking-wider text-center pb-0.5"
                  >
                    Hour
                  </div>
                  <div
                    ref={hourColumnRef}
                    data-tauri-drag-region="false"
                    style={{ pointerEvents: 'auto' }}
                    className="flex-1 overflow-y-auto space-y-0.5 pr-0.5"
                  >
                    {HOURS_12.map((h) => {
                      const active = pickerHour === h;
                      return (
                        <button
                          key={h}
                          type="button"
                          data-active={active}
                          data-tauri-drag-region="false"
                          onClick={() => setPickerHour(h)}
                          style={{
                            pointerEvents: 'auto',
                            cursor: 'pointer',
                            background: active
                              ? 'var(--theme-accent, #A29BFE)'
                              : 'transparent',
                            color: active
                              ? '#FFFFFF'
                              : 'var(--theme-text-primary, #F8FAFC)',
                          }}
                          className={`pointer-events-auto cursor-pointer w-full py-0.5 rounded text-[11px] font-mono tabular-nums text-center transition-all ${
                            active ? 'font-bold shadow-sm' : 'hover:bg-white/10 opacity-80'
                          }`}
                        >
                          {String(h).padStart(2, '0')}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Minutes Column (00..59) */}
                <div
                  style={{
                    background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                  }}
                  className="flex flex-col rounded-lg border p-1 min-h-0"
                >
                  <div
                    style={{ color: 'var(--theme-text-secondary, #94A3B8)' }}
                    className="text-[9px] font-mono font-semibold uppercase tracking-wider text-center pb-0.5"
                  >
                    Min
                  </div>
                  <div
                    ref={minuteColumnRef}
                    data-tauri-drag-region="false"
                    style={{ pointerEvents: 'auto' }}
                    className="flex-1 overflow-y-auto space-y-0.5 pr-0.5"
                  >
                    {MINUTES_60.map((m) => {
                      const active = pickerMinute === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          data-active={active}
                          data-tauri-drag-region="false"
                          onClick={() => setPickerMinute(m)}
                          style={{
                            pointerEvents: 'auto',
                            cursor: 'pointer',
                            background: active
                              ? 'var(--theme-accent, #A29BFE)'
                              : 'transparent',
                            color: active
                              ? '#FFFFFF'
                              : 'var(--theme-text-primary, #F8FAFC)',
                          }}
                          className={`pointer-events-auto cursor-pointer w-full py-0.5 rounded text-[11px] font-mono tabular-nums text-center transition-all ${
                            active ? 'font-bold shadow-sm' : 'hover:bg-white/10 opacity-80'
                          }`}
                        >
                          {String(m).padStart(2, '0')}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* AM / PM Toggle Pill Column */}
                <div
                  style={{
                    background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                  }}
                  className="flex flex-col justify-between rounded-lg border p-1 min-h-0"
                >
                  <div
                    style={{ color: 'var(--theme-text-secondary, #94A3B8)' }}
                    className="text-[9px] font-mono font-semibold uppercase tracking-wider text-center pb-0.5"
                  >
                    AM/PM
                  </div>
                  <div
                    style={{
                      background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                      borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                    }}
                    className="flex-1 flex flex-col justify-center gap-1 p-1 rounded-md border"
                  >
                    {(['AM', 'PM'] as const).map((period) => {
                      const active = pickerPeriod === period;
                      return (
                        <button
                          key={period}
                          type="button"
                          data-tauri-drag-region="false"
                          onClick={() => setPickerPeriod(period)}
                          style={{
                            pointerEvents: 'auto',
                            cursor: 'pointer',
                            background: active
                              ? 'var(--theme-accent, #A29BFE)'
                              : 'transparent',
                            color: active
                              ? '#FFFFFF'
                              : 'var(--theme-text-secondary, #94A3B8)',
                          }}
                          className={`pointer-events-auto cursor-pointer flex-1 rounded py-1 text-[11px] font-mono font-bold tracking-wider transition-all active:scale-95 ${
                            active ? 'shadow-sm' : 'hover:text-white'
                          }`}
                        >
                          {period}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Modal Footer: Cancel + Confirm */}
              <div
                style={{ borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))' }}
                className="flex items-center justify-end gap-1.5 pt-1.5 border-t"
              >
                <button
                  type="button"
                  data-tauri-drag-region="false"
                  onClick={() => setTimePickerOpen(false)}
                  style={{
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                    color: 'var(--theme-text-secondary, #94A3B8)',
                  }}
                  className="pointer-events-auto cursor-pointer px-2.5 py-1 rounded-lg border text-[10px] font-semibold hover:opacity-100 active:scale-95 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-tauri-drag-region="false"
                  onClick={handleConfirmTimePicker}
                  style={{
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    background: 'var(--theme-accent, #A29BFE)',
                    color: '#FFFFFF',
                  }}
                  className="pointer-events-auto cursor-pointer px-3 py-1 rounded-lg text-[10px] font-semibold shadow-sm active:scale-95 transition-all"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
