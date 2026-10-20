import {
  AppWindow,
  Calculator,
  CheckCircle2,
  Code2,
  Compass,
  Cpu,
  ExternalLink,
  FileText,
  FolderOpen,
  Palette,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import {
  getInstalledApps,
  type InstalledAppItem,
  launchApp,
  pickExecutable,
} from '../services/hostBridge';
export interface AppsViewProps {
  onAppLaunched?: () => void;
  isPickerMode?: boolean;
  onPickApp?: (app: InstalledAppItem) => void;
  onPinApp?: (app: InstalledAppItem) => void;
  onCancelPicker?: () => void;
}

const BASE_CATEGORIES = [
  'All',
  'System',
  'Developer',
  'Productivity',
  'Utilities',
  'Browser',
  'Creative',
] as const;

function renderAppIcon(app: InstalledAppItem): React.ReactNode {
  const key = `${app.id} ${app.name} ${app.path} ${app.category}`.toLowerCase();
  if (
    key.includes('terminal') ||
    key.includes('powershell') ||
    key.includes('cmd') ||
    key.includes('wt')
  ) {
    return <Terminal className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (
    key.includes('code') ||
    key.includes('visual studio') ||
    key.includes('git') ||
    key.includes('dev')
  ) {
    return <Code2 className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (key.includes('explorer') || key.includes('folder') || key.includes('files')) {
    return <FolderOpen className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (
    key.includes('taskmgr') ||
    key.includes('task manager') ||
    key.includes('resource') ||
    key.includes('perf')
  ) {
    return <Cpu className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (
    key.includes('brave') ||
    key.includes('bravehtml') ||
    key.includes('zen') ||
    key.includes('arc') ||
    key.includes('vivaldi') ||
    key.includes('opera') ||
    key.includes('edge') ||
    key.includes('chrome') ||
    key.includes('firefox') ||
    key.includes('browser')
  ) {
    return <Compass className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (key.includes('calc')) {
    return <Calculator className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (key.includes('paint') || key.includes('photo') || key.includes('creative')) {
    return <Palette className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (
    key.includes('notepad') ||
    key.includes('note') ||
    key.includes('word') ||
    key.includes('doc')
  ) {
    return <FileText className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (key.includes('setting') || key.includes('control')) {
    return <Settings className="w-4 h-4" strokeWidth={1.9} />;
  }
  if (key.includes('snip') || key.includes('util') || key.includes('tool')) {
    return <Wrench className="w-4 h-4" strokeWidth={1.9} />;
  }
  return <AppWindow className="w-4 h-4" strokeWidth={1.9} />;
}

export const AppsView: React.FC<AppsViewProps> = ({
  onAppLaunched,
  isPickerMode = false,
  onPickApp,
  onPinApp,
  onCancelPicker,
}) => {
  const { settings, updateSettings } = useSettings();
  const favoriteApps = useMemo(
    () => (Array.isArray(settings.favoriteApps) ? settings.favoriteApps : []),
    [settings.favoriteApps],
  );

  const toggleFavorite = (appId: string) => {
    const isFav = favoriteApps.includes(appId);
    const next = isFav ? favoriteApps.filter((id) => id !== appId) : [appId, ...favoriteApps];
    updateSettings({ favoriteApps: next });
  };

  const [apps, setApps] = useState<InstalledAppItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchedId, setLaunchedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [failedIconIds, setFailedIconIds] = useState<Record<string, boolean>>({});
  const loadApps = async (force = true) => {
    setLoading(true);
    try {
      const items = await getInstalledApps(force);
      setApps(items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getInstalledApps()
      .then((items) => {
        if (!cancelled) {
          setApps(items);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const seen: Record<string, true> = {};
    const list: string[] = [];
    if (favoriteApps.length > 0) {
      list.push('Favorites');
      seen.favorites = true;
    }
    for (const base of BASE_CATEGORIES) {
      seen[base.toLowerCase()] = true;
      list.push(base);
    }
    for (const item of apps) {
      const trimmed = item.category?.trim();
      if (trimmed && !seen[trimmed.toLowerCase()]) {
        seen[trimmed.toLowerCase()] = true;
        list.push(trimmed);
      }
    }
    return list;
  }, [apps, favoriteApps.length]);
  const filteredApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = apps.filter((app) => {
      const combinedKey =
        `${app.id} ${app.name} ${app.path} ${app.category} ${app.description || ''}`.toLowerCase();
      const isBrowser =
        app.category.toLowerCase() === 'browser' ||
        combinedKey.includes('brave') ||
        combinedKey.includes('brave.exe') ||
        combinedKey.includes('bravehtml') ||
        combinedKey.includes('zen') ||
        combinedKey.includes('arc') ||
        combinedKey.includes('vivaldi') ||
        combinedKey.includes('opera') ||
        combinedKey.includes('chrome') ||
        combinedKey.includes('firefox') ||
        combinedKey.includes('msedge');

      const isFav = favoriteApps.includes(app.id);
      if (activeCategory.toLowerCase() === 'favorites') {
        if (!isFav) return false;
      } else {
        const matchesCategory =
          activeCategory === 'All' ||
          app.category.toLowerCase() === activeCategory.toLowerCase() ||
          (activeCategory.toLowerCase() === 'browser' && isBrowser);
        if (!matchesCategory) {
          return false;
        }
      }
      if (!query) {
        return true;
      }
      return combinedKey.includes(query);
    });

    // Float favorites to the very top!
    return filtered.sort((a, b) => {
      const aFav = favoriteApps.includes(a.id);
      const bFav = favoriteApps.includes(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return 0;
    });
  }, [apps, activeCategory, searchQuery, favoriteApps]);

  const handleLaunch = async (app: InstalledAppItem) => {
    setLaunchingId(app.id);
    setStatusMessage(`Launching ${app.name}...`);
    try {
      const ok = await launchApp(app.path);
      if (ok) {
        setLaunchedId(app.id);
        setStatusMessage(`Launched ${app.name}`);
        onAppLaunched?.();
        window.setTimeout(() => {
          setLaunchedId((prev) => (prev === app.id ? null : prev));
        }, 1800);
        window.setTimeout(() => {
          setStatusMessage((prev) => (prev === `Launched ${app.name}` ? null : prev));
        }, 2800);
      } else {
        setStatusMessage(`Could not launch ${app.name}`);
        window.setTimeout(() => setStatusMessage(null), 3000);
      }
    } catch {
      setStatusMessage(`Failed to start ${app.name}`);
      window.setTimeout(() => setStatusMessage(null), 3000);
    } finally {
      setLaunchingId(null);
    }
  };

  const handleBrowseAndLaunch = async () => {
    try {
      const filePath = await pickExecutable();
      if (!filePath) return;
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const cleanName = fileName.replace(/\.[^/.]+$/, '');
      const customItem: InstalledAppItem = {
        id: `custom-${cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`,
        name: cleanName,
        path: filePath,
        category: 'Custom',
      };
      if (isPickerMode && onPickApp) {
        onPickApp(customItem);
      } else {
        await handleLaunch(customItem);
      }
    } catch {
      // User cancelled
    }
  };

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full flex flex-col gap-2.5 overflow-hidden select-none pointer-events-auto"
    >
      {/* Top Bar: Search Input + Category Filter Pills */}
      <div
        className="bento-card p-2.5 flex flex-col gap-2 shrink-0"
        style={{
          background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
          borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
        }}
      >
        <div className="flex items-center gap-2">
          {/* Search Input Box */}
          <div
            className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all"
            style={{
              background: 'var(--theme-track, rgba(255, 255, 255, 0.05))',
              borderColor: searchQuery
                ? 'var(--theme-accent, #cba6f7)'
                : 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            }}
          >
            <Search
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
              strokeWidth={2}
            />
            <input
              type="text"
              data-tauri-drag-region="false"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search installed Windows apps & tools..."
              className="w-full bg-transparent text-xs focus:outline-none pointer-events-auto"
              style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
            />
            {searchQuery && (
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() => setSearchQuery('')}
                className="p-0.5 rounded-md transition-all hover:opacity-80 pointer-events-auto cursor-pointer"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))' }}
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Feedback Pill or Count */}
          {statusMessage ? (
            <div
              className="px-2.5 py-1.5 rounded-xl border text-[11px] font-mono flex items-center gap-1.5 shrink-0"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                borderColor: 'var(--theme-accent, #cba6f7)',
                color: 'var(--theme-text-primary, #cdd6f4)',
              }}
            >
              <Sparkles className="w-3 h-3" style={{ color: 'var(--theme-accent, #cba6f7)' }} />
              <span>{statusMessage}</span>
            </div>
          ) : (
            <div
              className="px-2.5 py-1.5 rounded-xl border text-[11px] font-mono tabular-nums shrink-0"
              style={{
                background: 'var(--theme-track, rgba(255, 255, 255, 0.04))',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
              }}
            >
              {filteredApps.length} {filteredApps.length === 1 ? 'app' : 'apps'}
            </div>
          )}

          {/* Refresh Apps List Button */}
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={() => void loadApps(true)}
            className="p-1.5 rounded-xl border transition-all hover:scale-[1.03] active:scale-95 pointer-events-auto cursor-pointer"
            style={{
              background: 'var(--theme-track, rgba(255, 255, 255, 0.05))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              color: 'var(--theme-text-primary, #cdd6f4)',
            }}
            title="Rescan installed Windows applications"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Browse for Executable Button */}
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={handleBrowseAndLaunch}
            className="p-1.5 rounded-xl border transition-all hover:scale-[1.03] active:scale-95 pointer-events-auto cursor-pointer"
            style={{
              background: 'var(--theme-track, rgba(255, 255, 255, 0.05))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
              color: 'var(--theme-text-primary, #cdd6f4)',
            }}
            title="Browse computer for an executable (.exe, .lnk) to add or run"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {categories.map((category) => {
            const isSelected = activeCategory === category;
            return (
              <button
                key={category}
                type="button"
                data-tauri-drag-region="false"
                onClick={() => setActiveCategory(category)}
                className="px-2.5 py-1 rounded-lg border text-[11px] font-mono font-medium transition-all shrink-0 active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: isSelected
                    ? 'var(--theme-accent, #cba6f7)'
                    : 'var(--theme-track, rgba(255, 255, 255, 0.04))',
                  borderColor: isSelected
                    ? 'var(--theme-accent, #cba6f7)'
                    : 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                  color: isSelected
                    ? '#11111b'
                    : 'var(--theme-text-secondary, rgba(205, 214, 244, 0.78))',
                }}
              >
                {category}
              </button>
            );
          })}
        </div>
      </div>
      {/* Top Banner when picking for Dashboard Quick Launch Dock */}
      {isPickerMode && (
        <div
          className="w-full px-3.5 py-2 rounded-xl border flex items-center justify-between gap-3 shrink-0 mb-1"
          style={{
            background: 'var(--theme-track, rgba(255, 255, 255, 0.08))',
            borderColor: 'var(--theme-accent, #cba6f7)',
            boxShadow: '0 0 16px -4px var(--theme-accent, rgba(203, 166, 247, 0.35))',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">🎯</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
              Click any application below to assign it to your Dashboard Quick Launch Dock
            </span>
          </div>
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={onCancelPicker}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold border hover:bg-white/10 active:scale-95 pointer-events-auto cursor-pointer"
            style={{
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text-secondary)',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Scrollable 4-Column App Cards Grid */}
      <div
        data-tauri-drag-region="false"
        className="flex-1 overflow-y-auto pr-1 pointer-events-auto"
        style={{
          maskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)',
        }}
      >
        {filteredApps.length === 0 ? (
          <div
            className="h-full bento-card p-6 flex flex-col items-center justify-center text-center gap-2"
            style={{
              background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            }}
          >
            <AppWindow
              className="w-7 h-7 opacity-60"
              style={{ color: 'var(--theme-accent, #cba6f7)' }}
            />
            <div
              className="text-xs font-semibold"
              style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
            >
              No matching Windows applications found
            </div>
            <div
              className="text-[11px]"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
            >
              Try clearing the search filter or switching to another category pill.
            </div>
            {(searchQuery || activeCategory !== 'All') && (
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('All');
                }}
                className="mt-1 px-3 py-1 rounded-lg border text-[11px] font-mono transition-all active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                  borderColor: 'var(--theme-accent, #cba6f7)',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 pb-1">
            {filteredApps.map((app) => {
              const isLaunching = launchingId === app.id;
              const isLaunched = launchedId === app.id;
              const isFavorite = favoriteApps.includes(app.id);
              return (
                <button
                  key={app.id}
                  type="button"
                  data-tauri-drag-region="false"
                  onClick={() => {
                    if (isPickerMode && onPickApp) {
                      onPickApp(app);
                      return;
                    }
                    handleLaunch(app);
                  }}
                  className={`bento-card bento-card-interactive p-2.5 text-left flex flex-col justify-between gap-2 group transition-all hover:-translate-y-0.5 active:scale-[0.98] pointer-events-auto cursor-pointer ${
                    isPickerMode ? 'ring-1 ring-[var(--theme-accent)] shadow-md' : ''
                  } ${isFavorite ? 'border-[var(--theme-accent)]/35' : ''}`}
                  style={{
                    background: isPickerMode
                      ? 'var(--theme-track, rgba(255, 255, 255, 0.07))'
                      : 'var(--theme-card, rgba(255, 255, 255, 0.04))',
                    borderColor: isLaunched
                      ? '#a6e3a1'
                      : isPickerMode
                        ? 'var(--theme-accent, #cba6f7)'
                        : isLaunching
                          ? 'var(--theme-accent, #cba6f7)'
                          : isFavorite
                            ? 'var(--theme-accent, rgba(203, 166, 247, 0.4))'
                            : 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                  }}
                  title={
                    isPickerMode
                      ? `Click to pin ${app.name} to Dashboard`
                      : `Launch ${app.name} (${app.path})`
                  }
                >
                  <div className="flex items-start justify-between gap-2 w-full">
                    {/* App Icon Badge */}
                    <div
                      className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
                      style={{
                        background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                        color: isLaunched ? '#a6e3a1' : 'var(--theme-accent, #cba6f7)',
                      }}
                    >
                      {isLaunched ? (
                        <CheckCircle2 className="w-4 h-4 text-[#a6e3a1]" strokeWidth={2} />
                      ) : app.icon_data_url &&
                        app.icon_data_url.trim().length > 0 &&
                        !failedIconIds[app.id] ? (
                        <img
                          src={app.icon_data_url}
                          alt={app.name}
                          className="w-6 h-6 object-contain drop-shadow-sm select-none"
                          loading="lazy"
                          onError={() =>
                            setFailedIconIds((prev) => ({
                              ...prev,
                              [app.id]: true,
                            }))
                          }
                        />
                      ) : (
                        renderAppIcon(app)
                      )}
                    </div>

                    {/* Category Badge / Pin to Quick Launch Button */}
                    <div className="flex items-center gap-1">
                      {isPickerMode ? (
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider"
                          style={{
                            background: 'var(--theme-accent, #cba6f7)',
                            color: '#11111b',
                          }}
                        >
                          + PIN
                        </span>
                      ) : (
                        <>
                          <span
                            className="px-1.5 py-0.5 rounded-md border text-[9px] font-mono uppercase tracking-wider flex items-center gap-1"
                            style={{
                              background: 'var(--theme-track, rgba(255, 255, 255, 0.04))',
                              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                              color: isLaunched
                                ? '#a6e3a1'
                                : 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                            }}
                          >
                            <span>
                              {isLaunched ? 'Launched' : isLaunching ? 'Starting' : app.category}
                            </span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-70 group-hover:opacity-100" />
                          </span>

                          {/* Star Favorite Button */}
                          <button
                            type="button"
                            data-tauri-drag-region="false"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(app.id);
                            }}
                            className={`p-1 rounded-md border transition-all active:scale-90 pointer-events-auto cursor-pointer ${
                              isFavorite
                                ? 'bg-[#f9e2af]/15 border-[#f9e2af]/40 text-[#f9e2af]'
                                : 'opacity-40 hover:opacity-100 hover:bg-white/10 text-[var(--theme-text-secondary)] border-[var(--theme-border)]'
                            }`}
                            title={
                              isFavorite
                                ? `Remove ${app.name} from Favorites`
                                : `Favorite ${app.name} (floats to top)`
                            }
                          >
                            <Star className={`w-3 h-3 ${isFavorite ? 'fill-current' : ''}`} />
                          </button>

                          {onPinApp && (
                            <button
                              type="button"
                              data-tauri-drag-region="false"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPinApp(app);
                              }}
                              className="px-1.5 py-0.5 rounded-md border text-[9px] font-mono hover:bg-white/10 active:scale-90 transition-all pointer-events-auto cursor-pointer"
                              style={{
                                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                                color: 'var(--theme-accent, #cba6f7)',
                              }}
                              title={`Pin ${app.name} to Dashboard Quick Launch`}
                            >
                              +Pin
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {/* App Name & Description / Target Path Subtitle */}
                  <div className="w-full min-w-0">
                    <div
                      className="text-xs font-semibold truncate"
                      style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
                    >
                      {app.name}
                    </div>
                    <div
                      className="text-[10px] truncate mt-0.5"
                      style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.68))' }}
                    >
                      {app.description || app.category || app.path}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
