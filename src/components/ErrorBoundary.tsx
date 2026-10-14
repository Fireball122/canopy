import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          data-tauri-drag-region="false"
          className="w-full h-full bento-card p-6 flex flex-col items-center justify-center gap-3 text-center pointer-events-auto select-none"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center border"
            style={{
              background: 'var(--theme-track, rgba(255, 255, 255, 0.05))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
              color: 'var(--theme-accent, #cba6f7)',
            }}
          >
            <AlertTriangle className="w-6 h-6 stroke-[1.8]" />
          </div>
          <div>
            <div
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--theme-text-primary, #F1F2F6)' }}
            >
              {this.props.fallbackTitle || 'Tab Encountered an Issue'}
            </div>
            <div
              className="text-xs max-w-sm mt-1"
              style={{ color: 'var(--theme-text-secondary, #9E9EA7)' }}
            >
              {this.state.error?.message || 'A transient error occurred while rendering this card.'}
            </div>
          </div>
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
            className="mt-2 px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border transition-all active:scale-95 pointer-events-auto cursor-pointer"
            style={{
              background: 'var(--theme-accent, #cba6f7)',
              color: '#11111b',
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload Tab</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
