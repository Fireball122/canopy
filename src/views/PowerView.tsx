import { Check, Clock, Lock, LogOut, Moon, Power, RotateCw, Shield, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { executePowerAction, type SystemStats } from '../services/hostBridge';

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
    <div className="w-full h-full flex flex-col justify-between p-3 select-none pointer-events-auto overflow-hidden relative">
      {/* Single Horizontal Row of Monochromatic Theme-Adaptive Logo Tiles */}
      <div className="flex-1 w-full flex items-center justify-center my-auto px-1">
        <div className="grid grid-cols-5 gap-3.5 w-full">
          {actionItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleActionClick(item)}
              className="group h-[190px] rounded-2xl border flex flex-col items-center justify-center gap-3 transition-all duration-200 hover:scale-[1.02] active:scale-95 pointer-events-auto cursor-pointer focus:outline-none relative overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
              style={{
                background: 'var(--theme-card)',
                borderColor: 'var(--theme-border)',
                boxShadow:
                  '0 4px 16px rgba(0, 0, 0, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.06)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-border)';
              }}
            >
              {/* Monochromatic Theme-Adaptive Logo Container */}
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center border transition-all duration-200 group-hover:scale-105"
                style={{
                  background: 'var(--theme-track)',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-primary)',
                }}
              >
                {item.icon}
              </div>

              {/* Title Under Logo */}
              <span
                className="text-xs font-semibold tracking-tight transition-colors duration-200 group-hover:text-white"
                style={{ color: 'var(--theme-text-primary)' }}
              >
                {item.label}
              </span>

              {/* Subtle bottom hover line matching active wallpaper theme */}
              <div
                className="absolute inset-x-0 bottom-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, var(--theme-accent), transparent)',
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
          background: 'var(--theme-card)',
          borderColor: 'var(--theme-border)',
        }}
      >
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span
            className="flex items-center gap-1.5 font-semibold"
            style={{ color: 'var(--theme-accent)' }}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{stats.uptime_formatted}</span>
          </span>
          <span style={{ color: 'var(--theme-text-secondary)' }}>•</span>
          <span className="font-medium" style={{ color: 'var(--theme-text-secondary)' }}>
            {stats.os_name}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {statusFeedback ? (
            <span
              className="text-[11px] font-mono font-semibold"
              style={{ color: 'var(--theme-accent)' }}
            >
              {statusFeedback}
            </span>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] font-mono opacity-80">
              <Shield className="w-3 h-3" style={{ color: 'var(--theme-accent)' }} />
              <span style={{ color: 'var(--theme-text-secondary)' }}>
                {stats.username}@{stats.hostname}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Theme-Adaptive 4-second Confirmation Modal */}
      {pendingItem && (
        <div
          className="absolute inset-2.5 z-40 rounded-2xl p-5 flex flex-col justify-between backdrop-blur-2xl border shadow-2xl pointer-events-auto"
          style={{
            background: 'var(--theme-bg)',
            borderColor: 'var(--theme-accent)',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.75), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border"
                style={{
                  background: 'var(--theme-track)',
                  borderColor: 'var(--theme-accent)',
                  color: 'var(--theme-accent)',
                }}
              >
                {pendingItem.icon}
              </div>
              <div>
                <div
                  className="text-base font-bold tracking-tight"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  Confirm {pendingItem.label}
                </div>
                <div className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
                  Executing in{' '}
                  <span className="font-mono font-bold" style={{ color: 'var(--theme-accent)' }}>
                    {countdownSeconds}s
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={clearPendingCountdown}
              className="p-1.5 rounded-full hover:bg-white/10 active:scale-95 transition-all pointer-events-auto cursor-pointer"
              style={{ color: 'var(--theme-text-secondary)' }}
              title="Cancel action"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Clean Progress Line */}
          <div
            className="w-full h-1 rounded-full overflow-hidden my-4"
            style={{ background: 'var(--theme-track)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${(countdownSeconds / 4) * 100}%`,
                background: 'var(--theme-accent)',
              }}
            />
          </div>

          {/* Actions: Cancel vs Execute Now */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={clearPendingCountdown}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold border transition-all hover:bg-white/10 active:scale-95 pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-card)',
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-text-primary)',
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => void triggerDirectAction(pendingItem.id)}
              className="px-4 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 pointer-events-auto cursor-pointer flex items-center gap-1.5 shadow-lg"
              style={{
                background: 'var(--theme-accent)',
                color: 'var(--theme-on-accent, #111)',
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
