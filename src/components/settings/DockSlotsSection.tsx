import { AppWindow, FolderOpen, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { getInstalledApps, type InstalledAppItem, pickExecutable } from '../../services/hostBridge';
import { SettingSection } from './SettingsPrimitives';

const DEFAULT_PINNED_APPS = ['terminal', 'explorer', 'taskmgr', 'msedge', 'code'];

function toDockSlots(pinned: string[] = []): string[] {
  const result: string[] = [];
  for (let i = 0; i < 6; i++) {
    result[i] = pinned[i] || '';
  }
  return result;
}

export function DockSlotsSection() {
  const { settings, updateSettings } = useSettings();
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);
  const [availableApps, setAvailableApps] = useState<InstalledAppItem[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState<string>('');
  const [loadingApps, setLoadingApps] = useState<boolean>(false);

  const openAppPickerForSlot = async (slotIdx: number) => {
    setPickerSlotIndex(slotIdx);
    setAppSearchQuery('');
    if (availableApps.length === 0) {
      setLoadingApps(true);
      try {
        const apps = await getInstalledApps();
        setAvailableApps(apps);
      } finally {
        setLoadingApps(false);
      }
    }
  };

  const assignAppToSlot = (
    slotIdx: number,
    app: { id: string; name: string; path: string; icon_data_url?: string | null },
  ) => {
    const slots = toDockSlots(settings.pinnedApps);
    slots[slotIdx] = app.id;
    updateSettings({
      pinnedApps: slots,
      customApps: {
        ...(settings.customApps || {}),
        [app.id]: { label: app.name, path: app.path, icon_data_url: app.icon_data_url },
      },
    });
    setPickerSlotIndex(null);
  };

  const handleBrowseExecutable = async () => {
    if (pickerSlotIndex === null) return;
    try {
      const filePath = await pickExecutable();
      if (!filePath) return;
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const cleanName = fileName.replace(/\.[^/.]+$/, '');
      const customId = `custom-${cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-${Date.now().toString(36)}`;
      assignAppToSlot(pickerSlotIndex, {
        id: customId,
        name: cleanName,
        path: filePath,
      });
    } catch {
      // User cancelled
    }
  };

  const clearSlot = (slotIdx: number) => {
    const slots = toDockSlots(settings.pinnedApps);
    slots[slotIdx] = '';
    updateSettings({ pinnedApps: slots });
  };

  return (
    <SettingSection
      title="Quick Launch Dock"
      icon={<AppWindow className="w-4 h-4" />}
      badge="App Launcher"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            Pinned Dock Apps
          </div>
          <div className="text-[10px] text-[var(--theme-text-secondary)]">
            Configure the 6 app shortcuts on the Dashboard dock
          </div>
        </div>
        <button
          type="button"
          onClick={() => updateSettings({ pinnedApps: [...DEFAULT_PINNED_APPS, ''] })}
          className="px-2 py-0.5 rounded text-[10px] font-mono border hover:bg-white/10 transition-all pointer-events-auto cursor-pointer"
          style={{
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-text-secondary)',
          }}
        >
          Reset Dock
        </button>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {toDockSlots(settings.pinnedApps).map((appId, slotIdx) => {
          const isOccupied = Boolean(appId && appId.trim().length > 0);
          const custom = appId ? settings.customApps?.[appId] : undefined;
          const label = custom?.label || appId || `Slot ${slotIdx + 1}`;

          return (
            <div
              key={`slot-${slotIdx}`}
              onClick={() => openAppPickerForSlot(slotIdx)}
              className={`group relative p-1.5 rounded-xl border flex flex-col items-center justify-between min-h-[64px] transition-all hover:scale-[1.03] active:scale-95 pointer-events-auto cursor-pointer ${
                pickerSlotIndex === slotIdx ? 'ring-2 ring-[var(--theme-accent)] shadow-lg' : ''
              }`}
              style={{
                background: isOccupied
                  ? 'var(--theme-track, rgba(255, 255, 255, 0.05))'
                  : 'rgba(0, 0, 0, 0.2)',
                borderColor: isOccupied ? 'var(--theme-border)' : 'rgba(255, 255, 255, 0.06)',
              }}
              title={
                isOccupied
                  ? `Slot ${slotIdx + 1}: ${label} (Click to change)`
                  : `Slot ${slotIdx + 1}: Empty (Click to assign)`
              }
            >
              {isOccupied && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearSlot(slotIdx);
                  }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 pointer-events-auto"
                  title="Remove app from this slot"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}

              {isOccupied ? (
                <div className="flex flex-col items-center gap-1 w-full text-center">
                  <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[var(--theme-accent)]">
                    {custom?.icon_data_url ? (
                      <img
                        src={custom.icon_data_url}
                        alt={label}
                        className="w-4 h-4 object-contain"
                      />
                    ) : (
                      <AppWindow className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span
                    className="text-[9px] font-medium truncate w-full px-0.5"
                    style={{ color: 'var(--theme-text-primary)' }}
                  >
                    {label}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 my-auto text-white/40 group-hover:text-[var(--theme-accent)] transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                  <span className="text-[9px]">Slot {slotIdx + 1}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* In-Place App Selector Modal when Slot is Clicked */}
      {pickerSlotIndex !== null && (
        <div
          className="p-3 rounded-xl border flex flex-col gap-2 mt-1 animate-in fade-in zoom-in-95 duration-150"
          style={{
            background: 'var(--theme-card, rgba(20, 20, 30, 0.98))',
            borderColor: 'var(--theme-accent, #cba6f7)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-semibold"
                style={{ color: 'var(--theme-text-primary)' }}
              >
                Choose App for Slot #{pickerSlotIndex + 1}
              </span>
              <span className="text-[10px] text-white/40">Select an installed application</span>
            </div>
            <button
              type="button"
              onClick={() => setPickerSlotIndex(null)}
              className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10 pointer-events-auto cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-white/5 border-white/10">
            <Search className="w-3.5 h-3.5 text-[var(--theme-accent)]" />
            <input
              type="text"
              value={appSearchQuery}
              onChange={(e) => setAppSearchQuery(e.target.value)}
              placeholder="Search apps (Discord, Chrome, Steam, VS Code, Spotify...)"
              className="w-full bg-transparent text-xs focus:outline-none pointer-events-auto"
              style={{ color: 'var(--theme-text-primary)' }}
              autoFocus
            />
            {appSearchQuery && (
              <button
                type="button"
                onClick={() => setAppSearchQuery('')}
                className="p-0.5 text-white/50 hover:text-white pointer-events-auto cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={handleBrowseExecutable}
              className="p-1 rounded text-white/50 hover:text-[var(--theme-accent)] hover:bg-white/10 transition-all pointer-events-auto cursor-pointer shrink-0"
              title="Browse computer for an executable (.exe, .lnk)"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-44 overflow-y-auto grid grid-cols-3 gap-1.5 pr-0.5">
            {loadingApps ? (
              <div className="col-span-3 py-6 text-center text-xs text-white/50">
                Scanning installed Windows apps...
              </div>
            ) : (
              [
                { id: 'terminal', name: 'Terminal', path: 'wt.exe', category: 'Developer' },
                { id: 'explorer', name: 'Files', path: 'explorer.exe', category: 'System' },
                { id: 'taskmgr', name: 'Task Manager', path: 'taskmgr.exe', category: 'System' },
                { id: 'msedge', name: 'Edge Browser', path: 'msedge.exe', category: 'Browser' },
                { id: 'code', name: 'VS Code', path: 'code', category: 'Developer' },
                { id: 'notepad', name: 'Notepad', path: 'notepad.exe', category: 'Productivity' },
                { id: 'calc', name: 'Calculator', path: 'calc.exe', category: 'Utilities' },
                { id: 'spotify', name: 'Spotify', path: 'spotify.exe', category: 'Media' },
                ...availableApps.filter(
                  (a) =>
                    ![
                      'terminal',
                      'explorer',
                      'taskmgr',
                      'msedge',
                      'code',
                      'notepad',
                      'calc',
                      'spotify',
                    ].includes(a.id),
                ),
              ]
                .filter((app) => {
                  const q = appSearchQuery.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    app.name.toLowerCase().includes(q) ||
                    app.id.toLowerCase().includes(q) ||
                    Boolean(app.path?.toLowerCase().includes(q))
                  );
                })
                .map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => assignAppToSlot(pickerSlotIndex, app)}
                    className="p-1.5 rounded-lg border flex items-center gap-2 text-left hover:bg-white/10 hover:border-[var(--theme-accent)] transition-all pointer-events-auto cursor-pointer group"
                    style={{
                      background: 'var(--theme-card)',
                      borderColor: 'var(--theme-border)',
                    }}
                  >
                    <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[var(--theme-accent)]">
                      {'icon_data_url' in app && app.icon_data_url ? (
                        <img
                          src={app.icon_data_url}
                          alt={app.name}
                          className="w-4 h-4 object-contain"
                        />
                      ) : (
                        <AppWindow className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[11px] font-medium truncate group-hover:text-[var(--theme-accent)]"
                        style={{ color: 'var(--theme-text-primary)' }}
                      >
                        {app.name}
                      </div>
                      <div className="text-[9px] text-white/40 truncate">
                        {app.category || app.path}
                      </div>
                    </div>
                  </button>
                ))
            )}
          </div>
        </div>
      )}
    </SettingSection>
  );
}
