import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Lock,
  LogOut,
  Moon,
  Power,
  RotateCw,
  Shield,
  X,
} from 'lucide-react';
import { SystemStats, executePowerAction } from '../services/hostBridge';

export interface PowerViewProps {
  stats: SystemStats;
  onActionTriggered?: (action: string) => void;
}

type PowerActionType = 'lock' | 'sleep' | 'restart' | 'shutdown' | 'signout';

interface PowerActionItem {
  id: PowerActionType;
  label: string;
  icon: React.ReactNode;
  requiresCountdown: boolean;
}

export const PowerView: React.FC<PowerViewProps> = ({ stats, onActionTriggered }) => {
  const [pendingAction, setPendingAction] = useState<PowerActionType | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(4);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const countdownTimerRef = useRef<number | null>(null);

  const clearPendingCountdown = () => {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setPendingAction(null);
    setCountdownSeconds(4);
  };

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  const triggerDirectAction = async (action: PowerActionType) => {
    clearPendingCountdown();
    setStatusFeedback(`Executing ${action}...`);
    onActionTriggered?.(action);
    try {
      await executePowerAction(action);
    } catch {
      setStatusFeedback(`Failed to execute ${action}`);
      window.setTimeout(() => setStatusFeedback(null), 3000);
    }
  };

  const handleActionClick = (item: PowerActionItem) => {
    if (!item.requiresCountdown) {
      void triggerDirectAction(item.id);
      return;
    }

    clearPendingCountdown();
    setPendingAction(item.id);
    setCountdownSeconds(4);

    let remaining = 4;
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setCountdownSeconds(remaining);
      if (remaining <= 0) {
        if (countdownTimerRef.current) {
          window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        void triggerDirectAction(item.id);
      }
    }, 1000);
  };

  const actionItems: PowerActionItem[] = [
    {
      id: 'lock',
      label: 'Lock',
      icon: <Lock className="w-7 h-7" strokeWidth={1.8} />,
      requiresCountdown: false,
    },
    {
      id: 'sleep',
      label: 'Sleep',
      icon: <Moon className="w-7 h-7" strokeWidth={1.8} />,
      requiresCountdown: true,
    },
    {
      id: 'restart',
      label: 'Restart',
      icon: <RotateCw className="w-7 h-7" strokeWidth={1.8} />,
      requiresCountdown: true,
    },
    {
      id: 'shutdown',
      label: 'Shut Down',
      icon: <Power className="w-7 h-7" strokeWidth={1.8} />,
      requiresCountdown: true,
    },
    {
      id: 'signout',
      label: 'Sign Out',
      icon: <LogOut className="w-7 h-7" strokeWidth={1.8} />,
      requiresCountdown: true,
    },
  ];

  const pendingItem = actionItems.find((a) => a.id === pendingAction);

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full flex flex-col justify-between p-3 select-none pointer-events-auto overflow-hidden relative"
    >
      {/* Single Horizontal Row of Monochromatic Theme-Adaptive Logo Tiles */}
      <div className="flex-1 w-full flex items-center justify-center my-auto px-1">
        <div className="grid grid-cols-5 gap-3.5 w-full">
          {actionItems.map((item) => (
            <button
              key={item.id}
              type="button"
              data-tauri-drag-region="false"
              onClick={() => handleActionClick(item)}
              className="group h-[190px] rounded-2xl border flex flex-col items-center justify-center gap-3 transition-all duration-200 hover:scale-[1.03] active:scale-95 pointer-events-auto cursor-pointer focus:outline-none relative overflow-hidden"
              style={{
                background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-accent, #A29BFE)';
                e.currentTarget.style.boxShadow =
                  '0 8px 24px -4px rgba(0, 0, 0, 0.35), 0 0 16px -2px var(--theme-accent, rgba(162, 155, 254, 0.35))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-border, rgba(255, 255, 255, 0.08))';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
              }}
            >
              {/* Monochromatic Theme-Adaptive Logo Container */}
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center border transition-all duration-200 group-hover:scale-105"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.05))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                  color: 'var(--theme-text-primary, #F1F2F6)',
                }}
              >
                {item.icon}
              </div>

              {/* Title Under Logo */}
              <span
                className="text-xs font-semibold tracking-tight transition-colors duration-200 group-hover:text-white"
                style={{ color: 'var(--theme-text-primary, #F1F2F6)' }}
              >
                {item.label}
              </span>

              {/* Subtle bottom hover line matching active wallpaper theme */}
              <div
                className="absolute inset-x-0 bottom-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, var(--theme-accent, #A29BFE), transparent)',
                }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Clean Bottom Telemetry Status Bar */}
      <div
        className="bento-card px-4 py-2 flex items-center justify-between gap-3 shrink-0 rounded-xl"
        style={{
          background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
          borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
        }}
      >
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span
            className="flex items-center gap-1.5 font-semibold"
            style={{ color: 'var(--theme-accent, #A29BFE)' }}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{stats.uptime_formatted}</span>
          </span>
          <span style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}>•</span>
          <span
            className="font-medium"
            style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
          >
            {stats.os_name}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {statusFeedback ? (
            <span
              className="text-[11px] font-mono font-semibold"
              style={{ color: 'var(--theme-accent, #A29BFE)' }}
            >
              {statusFeedback}
            </span>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] font-mono opacity-80">
              <Shield
                className="w-3 h-3"
                style={{ color: 'var(--theme-accent, #A29BFE)' }}
              />
              <span style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}>
                {stats.username}@{stats.hostname}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Theme-Adaptive 4-second Confirmation Modal */}
      {pendingItem && (
        <div
          data-tauri-drag-region="false"
          className="absolute inset-2.5 z-40 rounded-2xl p-5 flex flex-col justify-between backdrop-blur-2xl border shadow-2xl pointer-events-auto"
          style={{
            background: 'var(--theme-bg, rgba(18, 18, 24, 0.97))',
            borderColor: 'var(--theme-accent, rgba(162, 155, 254, 0.45))',
            boxShadow:
              '0 16px 48px rgba(0, 0, 0, 0.65), 0 0 24px -4px var(--theme-accent, rgba(162, 155, 254, 0.35))',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.08))',
                  borderColor: 'var(--theme-accent, rgba(162, 155, 254, 0.5))',
                  color: 'var(--theme-accent, #A29BFE)',
                }}
              >
                {pendingItem.icon}
              </div>
              <div>
                <div
                  className="text-base font-bold tracking-tight"
                  style={{ color: 'var(--theme-text-primary, #F1F2F6)' }}
                >
                  Confirm {pendingItem.label}
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
                >
                  Executing in{' '}
                  <span
                    className="font-mono font-bold"
                    style={{ color: 'var(--theme-accent, #A29BFE)' }}
                  >
                    {countdownSeconds}s
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={clearPendingCountdown}
              className="p-1.5 rounded-full hover:bg-white/10 active:scale-95 transition-all pointer-events-auto cursor-pointer"
              style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
              title="Cancel action"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Clean Progress Line */}
          <div
            className="w-full h-1 rounded-full overflow-hidden my-4"
            style={{ background: 'var(--theme-track, rgba(255, 255, 255, 0.1))' }}
          >
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${(countdownSeconds / 4) * 100}%`,
                background: 'var(--theme-accent, #A29BFE)',
              }}
            />
          </div>

          {/* Actions: Cancel vs Execute Now */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={clearPendingCountdown}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold border transition-all hover:bg-white/10 active:scale-95 pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-card, rgba(255, 255, 255, 0.05))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.15))',
                color: 'var(--theme-text-primary, #F1F2F6)',
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={() => void triggerDirectAction(pendingItem.id)}
              className="px-4 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 pointer-events-auto cursor-pointer flex items-center gap-1.5 shadow-lg"
              style={{
                background: 'var(--theme-accent, #A29BFE)',
                color: '#11111b',
                boxShadow:
                  '0 4px 16px -2px var(--theme-accent, rgba(162, 155, 254, 0.45))',
              }}
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Execute Now ({countdownSeconds}s)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
