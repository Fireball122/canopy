import { Send } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { runTerminalCommand, type SystemStats } from '../services/hostBridge';

export interface TerminalViewProps {
  stats: SystemStats;
}

interface TerminalHistoryItem {
  id: string;
  command: string;
  output: string;
  timestamp: string;
  isError?: boolean;
}

const WINDOWS_POWERSHELL_UPTIME_CMD =
  '(get-date) - (gcim Win32_OperatingSystem).LastBootUpTime | Select-Object Days, Hours, Minutes';

const INITIAL_TERMINAL_HISTORY: TerminalHistoryItem[] = [
  {
    id: 'init-1',
    command: 'fastfetch',
    output: `╭──────────────────────────────────────────╮\n│  🌿 Canopy Shell v2.0 (Windows 11)       │\n├──────────────────────────────────────────┤\n│  Type PowerShell or built-in commands:   │\n│  fastfetch, ipconfig, tasklist, uptime   │\n╰──────────────────────────────────────────╯`,
    timestamp: 'ready',
    isError: false,
  },
];

export const TerminalView: React.FC<TerminalViewProps> = ({ stats }) => {
  const [terminalHistory, setTerminalHistory] =
    useState<TerminalHistoryItem[]>(INITIAL_TERMINAL_HISTORY);
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [inputBuffer, setInputBuffer] = useState('');
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalHistory]);

  const executeCommand = async (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    if (!trimmed) return;

    if (trimmed.toLowerCase() === 'clear' || trimmed.toLowerCase() === 'cls') {
      setTerminalHistory([]);
      setTerminalInput('');
      setHistoryIndex(null);
      return;
    }

    const commandId = `cmd-${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    setTerminalHistory((prev) => [
      ...prev,
      {
        id: commandId,
        command: trimmed,
        output: '...',
        timestamp,
        isError: false,
      },
    ]);

    setTerminalInput('');
    setHistoryIndex(null);
    setTerminalLoading(true);

    try {
      const output = await runTerminalCommand(trimmed);
      const isError = output.startsWith('Error:');
      setTerminalHistory((prev) =>
        prev.map((item) => (item.id === commandId ? { ...item, output, isError } : item)),
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Command execution failed';
      setTerminalHistory((prev) =>
        prev.map((item) =>
          item.id === commandId ? { ...item, output: `Error: ${errorMsg}`, isError: true } : item,
        ),
      );
    } finally {
      setTerminalLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void executeCommand(terminalInput);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const pastCommands = terminalHistory.map((h) => h.command);
      if (pastCommands.length === 0) return;

      if (historyIndex === null) {
        setInputBuffer(terminalInput);
        const newIndex = pastCommands.length - 1;
        setHistoryIndex(newIndex);
        setTerminalInput(pastCommands[newIndex]);
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setTerminalInput(pastCommands[newIndex]);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const pastCommands = terminalHistory.map((h) => h.command);
      if (historyIndex === null) return;

      if (historyIndex < pastCommands.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setTerminalInput(pastCommands[newIndex]);
      } else {
        setHistoryIndex(null);
        setTerminalInput(inputBuffer);
      }
    }
  };

  return (
    <div className="w-full h-full bento-card p-3.5 flex flex-col justify-between font-mono overflow-hidden">
      <div
        className="flex items-center justify-between pb-2 shrink-0"
        style={{ borderBottom: '1px solid var(--theme-border)' }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#f38ba8]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#f9e2af]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#a6e3a1]" />
          <span className="ml-2 text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
            {stats.username || 'user'}@{stats.hostname}:~ (canopy-powershell)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {[
            { label: 'fastfetch', cmd: 'fastfetch' },
            { label: 'ipconfig', cmd: 'ipconfig' },
            { label: 'tasklist', cmd: 'tasklist' },
            { label: 'uptime', cmd: 'uptime' },
            { label: 'clear', cmd: 'clear' },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              data-tauri-drag-region="false"
              onClick={() => executeCommand(preset.cmd)}
              className="px-2 py-0.5 rounded-md text-[10px] transition-all pointer-events-auto cursor-pointer"
              style={{
                background: 'var(--theme-track)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-text-primary)',
              }}
              title={preset.label === 'uptime' ? WINDOWS_POWERSHELL_UPTIME_CMD : preset.cmd}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div
        data-tauri-drag-region="false"
        className="flex-1 overflow-y-auto py-2.5 pr-1 space-y-3 text-[11px] leading-relaxed select-text pointer-events-auto"
      >
        {terminalHistory.map((item) => (
          <div key={item.id} className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold" style={{ color: 'var(--theme-accent)' }}>
                ❯
              </span>
              <span className="font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
                {item.command}
              </span>
              <span className="text-[9px] ml-auto" style={{ color: 'var(--theme-text-secondary)' }}>
                {item.timestamp}
              </span>
            </div>

            <pre
              className="p-2.5 rounded-lg whitespace-pre-wrap font-mono text-[11px] leading-snug overflow-x-auto"
              style={{
                background: 'var(--theme-track, rgba(0, 0, 0, 0.35))',
                color: item.isError ? '#f38ba8' : 'var(--theme-text-primary)',
                border: '1px solid var(--theme-border)',
              }}
            >
              {item.output}
            </pre>
          </div>
        ))}
        <div ref={terminalEndRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void executeCommand(terminalInput);
        }}
        className="pt-2 flex items-center gap-2 shrink-0 border-t pointer-events-auto"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <span className="text-sm font-bold pl-1" style={{ color: 'var(--theme-accent)' }}>
          ❯
        </span>
        <input
          ref={inputRef}
          type="text"
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={terminalLoading ? 'Executing...' : 'Type PowerShell command or script...'}
          disabled={terminalLoading}
          className="flex-1 bg-transparent border-none outline-none font-mono text-[11px] placeholder:opacity-40"
          style={{ color: 'var(--theme-text-primary)' }}
        />
        <button
          type="submit"
          disabled={terminalLoading || !terminalInput.trim()}
          className="px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-[11px] font-sans font-medium transition-all disabled:opacity-40 pointer-events-auto cursor-pointer"
          style={{
            background: 'var(--theme-accent)',
            color: 'var(--theme-base, #11111b)',
          }}
        >
          <Send className="w-3 h-3" />
          <span>Run</span>
        </button>
      </form>
    </div>
  );
};
