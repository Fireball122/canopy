import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

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
          className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none"
          style={{
            background: 'var(--theme-bg, #0d1117)',
            color: 'var(--theme-text-primary, #cdd6f4)',
          }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'rgba(243, 139, 168, 0.15)',
              border: '1px solid rgba(243, 139, 168, 0.3)',
            }}
          >
            <AlertTriangle className="w-6 h-6 text-[#f38ba8]" strokeWidth={2} />
          </div>
          <h2 className="text-base font-semibold mb-1">
            {this.props.fallbackTitle || 'Something went wrong'}
          </h2>
          <p
            className="text-xs max-w-sm mb-4 line-clamp-2"
            style={{ color: 'var(--theme-text-secondary, #a6adc8)' }}
          >
            {this.state.error?.message || 'An unexpected rendering error occurred in this view.'}
          </p>
          <button
            data-tauri-drag-region="false"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            style={{
              background: 'var(--theme-accent, #89b4fa)',
              color: 'var(--theme-bg, #11111b)',
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
