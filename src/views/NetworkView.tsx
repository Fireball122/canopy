import {
  ArrowDown,
  ArrowUp,
  Bluetooth,
  Cast,
  ChevronDown,
  Disc,
  Eye,
  EyeOff,
  Headphones,
  Plus,
  Radio,
  RefreshCw,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  addAndConnectWifi,
  connectBluetoothDevice,
  connectWifi,
  deleteWifiProfile,
  disconnectBluetoothDevice,
  disconnectWifi,
  getBluetoothState,
  getHotspotState,
  getNetworkAdapters,
  getPowerMode,
  getWifiState,
  type NetworkAdapterInfo,
  openExternalUrl,
  type SystemStats,
  setBluetoothEnabled as setHostBluetoothEnabled,
  setWifiEnabled as setHostWifiEnabled,
  setHotspotConfig,
  toggleHotspot as toggleHostHotspot,
  togglePowerSaver as toggleHostPowerSaver,
} from '../services/hostBridge';

export interface NetworkViewProps {
  stats: SystemStats;
  onToastNotification?: (message: string) => void;
}

export const NetworkView: React.FC<NetworkViewProps> = ({ stats, onToastNotification }) => {
  // Real Hardware States
  const [adapters, setAdapters] = useState<NetworkAdapterInfo[]>([]);
  const [wifiEnabled, setWifiEnabled] = useState<boolean>(true);
  const [connectedSsid, setConnectedSsid] = useState<string | null>(null);
  const [wifiSignal, setWifiSignal] = useState<number>(0);
  const [wifiBand, setWifiBand] = useState<string>('5 GHz');
  const [wifiProfiles, setWifiProfiles] = useState<string[]>([]);

  const [bluetoothEnabled, setBluetoothEnabled] = useState<boolean>(true);
  const [bluetoothDevices, setBluetoothDevices] = useState<
    Array<{
      id: string;
      name: string;
      status: string;
      connected: boolean;
      is_audio?: boolean;
    }>
  >([]);

  // Dropdown States: toggled by the dropdown arrow button on each capsule
  const [wifiDropdownOpen, setWifiDropdownOpen] = useState<boolean>(false);
  const [bluetoothDropdownOpen, setBluetoothDropdownOpen] = useState<boolean>(false);

  // Mobile Hotspot State
  const [hotspotEnabled, setHotspotEnabled] = useState<boolean>(false);
  const [hotspotSsid, setHotspotSsid] = useState<string>('Hotspot');
  const [hotspotPass, setHotspotPass] = useState<string>('');
  const [hotspotPassVisible, setHotspotPassVisible] = useState<boolean>(false);
  const [hotspotClients, setHotspotClients] = useState<number>(0);
  const [hotspotModalOpen, setHotspotModalOpen] = useState<boolean>(false);
  const [hotspotSaving, setHotspotSaving] = useState<boolean>(false);
  const [hotspotMsg, setHotspotMsg] = useState<string | null>(null);

  // Power Plan
  const [isPowerSaver, setIsPowerSaver] = useState<boolean>(false);

  // Inline "Connect to Wi-Fi with Password" Form
  const [showAddWifiForm, setShowAddWifiForm] = useState<boolean>(false);
  const [newWifiSsid, setNewWifiSsid] = useState<string>('');
  const [newWifiPassword, setNewWifiPassword] = useState<string>('');
  const [newWifiPassVisible, setNewWifiPassVisible] = useState<boolean>(false);
  const [isConnectingWifi, setIsConnectingWifi] = useState<boolean>(false);
  const [wifiFormError, setWifiFormError] = useState<string | null>(null);

  const [isActionInProgress, setIsActionInProgress] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // 1. Fetch real hardware telemetry from host
  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [adapList, wf, bt, hs, pm] = await Promise.all([
        getNetworkAdapters(),
        getWifiState(),
        getBluetoothState(),
        getHotspotState(),
        getPowerMode(),
      ]);

      setAdapters(adapList);

      setWifiEnabled(wf.enabled);
      setConnectedSsid(wf.connected ? wf.ssid || 'Connected' : null);
      setWifiSignal(wf.signal || 0);
      if (wf.band) setWifiBand(wf.band);
      setWifiProfiles(wf.profiles || []);

      setBluetoothEnabled(bt.enabled);
      setBluetoothDevices(bt.devices || []);

      setHotspotEnabled(hs.enabled);
      setHotspotSsid(hs.ssid?.trim() ? hs.ssid.trim() : 'Canopy Hotspot');
      setHotspotPass(hs.passphrase || '');
      setHotspotClients(hs.clients || 0);

      setIsPowerSaver(pm.is_power_saver);
    } catch {
      // Fallback
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Primary active connection info
  const activeEthernet = adapters.find((a) => a.type === 'ethernet' && a.is_connected);
  const activeBluetoothDevice = bluetoothDevices.find((d) => d.connected);

  // Actions
  const handleToggleWifi = async () => {
    const next = !wifiEnabled;
    setWifiEnabled(next);
    try {
      await setHostWifiEnabled(next);
      setTimeout(() => void refreshAll(), 1000);
      onToastNotification?.(next ? 'Wi-Fi radio enabled' : 'Wi-Fi radio disabled');
    } catch {
      // Ignore
    }
  };

  const handleToggleBluetooth = async () => {
    const next = !bluetoothEnabled;
    setBluetoothEnabled(next);
    try {
      await setHostBluetoothEnabled(next);
      setTimeout(() => void refreshAll(), 1000);
      onToastNotification?.(next ? 'Bluetooth radio enabled' : 'Bluetooth radio disabled');
    } catch {
      // Ignore
    }
  };

  const handleDisconnectWifi = async () => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    try {
      await disconnectWifi();
      onToastNotification?.('Disconnected from Wi-Fi network');
      setTimeout(() => {
        void refreshAll();
        setIsActionInProgress(false);
      }, 1200);
    } catch {
      setIsActionInProgress(false);
    }
  };

  const handleConnectProfile = async (ssid: string) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    onToastNotification?.(`Connecting to ${ssid}...`);
    try {
      await connectWifi(ssid);
      setTimeout(() => {
        void refreshAll();
        setIsActionInProgress(false);
        onToastNotification?.(`Connected to ${ssid}`);
      }, 1500);
    } catch {
      setIsActionInProgress(false);
    }
  };

  const handleForgetWifi = async (ssid: string) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    try {
      await deleteWifiProfile(ssid);
      setWifiProfiles((prev) => prev.filter((p) => p !== ssid));
      onToastNotification?.(`Removed Wi-Fi profile "${ssid}"`);
    } catch {
      onToastNotification?.(`Could not remove ${ssid}`);
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleAddAndConnectWifi = async () => {
    const cleanSsid = newWifiSsid.trim();
    if (!cleanSsid) {
      setWifiFormError('Please enter a network name');
      return;
    }
    setIsConnectingWifi(true);
    setWifiFormError(null);
    onToastNotification?.(`Connecting to ${cleanSsid}...`);
    try {
      const res = await addAndConnectWifi(cleanSsid, newWifiPassword);
      if (res.success) {
        onToastNotification?.(`Connected to ${cleanSsid}!`);
        setShowAddWifiForm(false);
        setNewWifiSsid('');
        setNewWifiPassword('');
        setTimeout(() => void refreshAll(), 1500);
      } else {
        setWifiFormError(res.message || 'Connection failed');
      }
    } catch {
      setWifiFormError('Failed to configure network profile');
    } finally {
      setIsConnectingWifi(false);
    }
  };

  const handleToggleHotspot = async () => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    try {
      const res = await toggleHostHotspot();
      setHotspotEnabled(res.enabled);
      const name = hotspotSsid?.trim() ? hotspotSsid.trim() : 'Canopy Hotspot';
      onToastNotification?.(
        res.enabled ? `Mobile Hotspot active (${name})` : 'Mobile Hotspot stopped',
      );
      setTimeout(() => void refreshAll(), 1500);
    } catch {
      // Ignore
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleSaveHotspotConfig = async () => {
    const cleanSsid = hotspotSsid.trim();
    if (!cleanSsid || cleanSsid.length > 32) {
      setHotspotMsg('SSID must be 1-32 characters');
      return;
    }
    if (hotspotPass.length < 8 || hotspotPass.length > 64) {
      setHotspotMsg('Password must be 8-64 characters');
      return;
    }
    setHotspotSaving(true);
    setHotspotMsg(null);
    try {
      const res = await setHotspotConfig(cleanSsid, hotspotPass);
      if (res.success) {
        setHotspotMsg('Saved successfully!');
        onToastNotification?.(`Hotspot renamed to "${cleanSsid}"`);
        setTimeout(() => {
          setHotspotModalOpen(false);
          setHotspotMsg(null);
          void refreshAll();
        }, 700);
      } else {
        setHotspotMsg(res.reason || 'Failed to update hotspot settings');
      }
    } catch {
      setHotspotMsg('Failed to update hotspot settings');
    } finally {
      setHotspotSaving(false);
    }
  };

  const handleTogglePowerPlan = async () => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    try {
      const res = await toggleHostPowerSaver();
      setIsPowerSaver(res.is_power_saver);
      onToastNotification?.(
        res.is_power_saver
          ? 'Switched to Windows Power Saver plan'
          : 'Restored Windows High Performance plan',
      );
      setTimeout(() => void refreshAll(), 1000);
    } catch {
      // Ignore
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleOpenAvailableNetworks = () => {
    void openExternalUrl('ms-availablenetworks:');
    onToastNotification?.('Opened Windows 11 Wi-Fi networks flyout');
  };

  const handleConnectBluetooth = async (id: string, name: string) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    onToastNotification?.(`Connecting to ${name}...`);
    try {
      await connectBluetoothDevice(id);
      setTimeout(() => {
        void refreshAll();
        setIsActionInProgress(false);
      }, 1500);
    } catch {
      setIsActionInProgress(false);
    }
  };

  const handleDisconnectBluetooth = async (id: string, name: string) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    onToastNotification?.(`Disconnecting ${name}...`);
    try {
      await disconnectBluetoothDevice(id);
      setTimeout(() => {
        void refreshAll();
        setIsActionInProgress(false);
      }, 1200);
    } catch {
      setIsActionInProgress(false);
    }
  };

  const getDeviceIcon = (dev: { name: string; is_audio?: boolean }) => {
    const low = dev.name.toLowerCase();
    if (
      dev.is_audio ||
      low.includes('buds') ||
      low.includes('ear') ||
      low.includes('head') ||
      low.includes('anc') ||
      low.includes('soundcore') ||
      low.includes('jabra') ||
      low.includes('riff')
    ) {
      return <Headphones className="w-4 h-4" />;
    }
    if (
      low.includes('phone') ||
      low.includes('s20') ||
      low.includes('pixel') ||
      low.includes('iphone')
    ) {
      return <Smartphone className="w-4 h-4" />;
    }
    if (low.includes('controller') || low.includes('xbox') || low.includes('dualshock')) {
      return <Disc className="w-4 h-4" />;
    }
    return <Bluetooth className="w-4 h-4" />;
  };

  const renderSignalIcon = (signal: number) => {
    if (signal > 75) return <SignalHigh className="w-4 h-4 text-[var(--theme-accent)] shrink-0" />;
    if (signal > 45)
      return <SignalMedium className="w-4 h-4 text-[var(--theme-accent)] shrink-0" />;
    return <SignalLow className="w-4 h-4 text-[var(--theme-text-secondary)] shrink-0" />;
  };

  return (
    <div className="w-full h-full flex flex-col justify-between p-2.5 select-none pointer-events-auto overflow-hidden relative gap-2">
      {/* ========================================================================= */}
      {/* MAIN TWO-COLUMN WORKSPACE: WI-FI CAPSULE (LEFT) & BLUETOOTH CAPSULE (RIGHT)*/}
      {/* ========================================================================= */}
      <div className="flex-1 w-full grid grid-cols-2 gap-2.5 min-h-0 items-start overflow-hidden">
        {/* ======================================================================= */}
        {/* LEFT CARD: WI-FI CAPSULE + TOGGLE + DROPDOWN ARROW                     */}
        {/* ======================================================================= */}
        <div
          className={`bento-card p-3 rounded-3xl flex flex-col justify-between border border-white/[0.08] backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-all duration-300 overflow-hidden ${
            wifiDropdownOpen ? 'h-full' : 'h-auto'
          }`}
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
            boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.28)',
          }}
        >
          {/* THE HERO WI-FI CAPSULE WITH TOGGLE AND DROPDOWN ARROW */}
          <div
            className={`w-full p-2.5 rounded-2xl border transition-all flex items-center justify-between gap-2.5 shrink-0 ${
              wifiEnabled
                ? 'border-white/10 bg-white/[0.04]'
                : 'border-white/5 bg-white/[0.015] opacity-60'
            }`}
          >
            {/* Left: Wi-Fi Icon & Live Label */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
                  wifiEnabled
                    ? connectedSsid
                      ? 'bg-[var(--theme-accent)]/20 text-[var(--theme-accent)] border-[var(--theme-accent)]/40 shadow-sm'
                      : 'bg-white/10 text-white border-white/10'
                    : 'bg-white/5 text-[var(--theme-text-secondary)] border-white/5'
                }`}
              >
                {wifiEnabled ? (
                  connectedSsid ? (
                    renderSignalIcon(wifiSignal)
                  ) : (
                    <Wifi className="w-5 h-5" />
                  )
                ) : (
                  <WifiOff className="w-5 h-5 opacity-40" />
                )}
              </div>

              <div className="min-w-0">
                <div className="text-sm font-bold text-[var(--theme-text-primary)] leading-none truncate">
                  Wi-Fi
                </div>
                <div className="text-[11px] text-[var(--theme-text-secondary)] mt-1 font-mono flex items-center gap-1.5 truncate">
                  {wifiEnabled ? (
                    connectedSsid ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)] animate-pulse" />
                        <span className="truncate font-semibold text-white">{connectedSsid}</span>
                        <span className="opacity-50">•</span>
                        <span className="text-[var(--theme-accent)]">{wifiBand}</span>
                      </>
                    ) : (
                      <span>Not Connected</span>
                    )
                  ) : (
                    <span>Radio Off</span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: The Toggle Switch AND The Dropdown Arrow Button */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Toggle Switch */}
              <button
                type="button"
                onClick={handleToggleWifi}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer active:scale-95 ${
                  wifiEnabled ? 'bg-[var(--theme-accent)]' : 'bg-white/10'
                }`}
                title="Turn Wi-Fi On/Off"
              >
                <span
                  className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                    wifiEnabled ? 'right-1 shadow-sm' : 'left-1 opacity-70'
                  }`}
                />
              </button>

              {/* Dropdown Arrow Button */}
              <button
                type="button"
                onClick={() => setWifiDropdownOpen((prev) => !prev)}
                className={`w-9 h-9 rounded-2xl border transition-all flex items-center justify-center cursor-pointer active:scale-95 ${
                  wifiDropdownOpen
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] shadow-sm'
                    : 'border-white/10 bg-white/5 text-[var(--theme-text-secondary)] hover:text-white hover:bg-white/10'
                }`}
                title="Drop down Wi-Fi networks and controls"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${
                    wifiDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* REVEALED ONLY WHEN DROPPED DOWN */}
          {wifiDropdownOpen && (
            <>
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden py-2 animate-in fade-in slide-in-from-top-1 duration-200 gap-1.5">
                {/* Drawer Action Bar */}
                <div className="flex items-center justify-between pb-1 border-b border-white/5 text-[10.5px] font-mono shrink-0">
                  <span className="text-[var(--theme-text-secondary)] uppercase tracking-wider font-semibold">
                    Available Networks ({wifiProfiles.length})
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowAddWifiForm((prev) => !prev)}
                      className="flex items-center gap-0.5 text-[var(--theme-accent)] hover:underline cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Password</span>
                    </button>
                    <span className="text-white/20">•</span>
                    <button
                      type="button"
                      onClick={handleOpenAvailableNetworks}
                      className="text-white/60 hover:text-white hover:underline cursor-pointer"
                    >
                      Flyout
                    </button>
                  </div>
                </div>

                {/* Inline Join Wi-Fi Form */}
                {showAddWifiForm && (
                  <div className="p-2.5 rounded-2xl border border-[var(--theme-accent)] bg-white/5 flex flex-col gap-1.5 shrink-0 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-xs font-bold pb-1 border-b border-white/10">
                      <span className="text-white">Join with Password</span>
                      <button
                        type="button"
                        onClick={() => setShowAddWifiForm(false)}
                        className="text-white/50 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newWifiSsid}
                        onChange={(e) => setNewWifiSsid(e.target.value)}
                        placeholder="Network Name (SSID)..."
                        className="flex-1 px-2.5 py-1 rounded-xl text-xs font-mono bg-white/5 text-white border border-white/10 outline-none focus:border-[var(--theme-accent)]"
                      />
                      <div className="relative flex-1">
                        <input
                          type={newWifiPassVisible ? 'text' : 'password'}
                          value={newWifiPassword}
                          onChange={(e) => setNewWifiPassword(e.target.value)}
                          placeholder="Password..."
                          className="w-full px-2.5 py-1 pr-6 rounded-xl text-xs font-mono bg-white/5 text-white border border-white/10 outline-none focus:border-[var(--theme-accent)]"
                        />
                        <button
                          type="button"
                          onClick={() => setNewWifiPassVisible(!newWifiPassVisible)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                        >
                          {newWifiPassVisible ? (
                            <EyeOff className="w-3 h-3" />
                          ) : (
                            <Eye className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddAndConnectWifi}
                        disabled={isConnectingWifi}
                        className="px-3 py-1 rounded-xl text-xs font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] hover:opacity-90 active:scale-95 disabled:opacity-50"
                      >
                        {isConnectingWifi ? '...' : 'Join'}
                      </button>
                    </div>

                    {wifiFormError && (
                      <div className="text-[10px] text-red-400 font-mono">{wifiFormError}</div>
                    )}
                  </div>
                )}

                {/* Networks List */}
                <div className="flex-1 overflow-y-auto canopy-scroll flex flex-col gap-1 pr-0.5 min-h-0">
                  {wifiProfiles.map((p) => {
                    const isCurrent = connectedSsid === p;
                    return (
                      <div
                        key={p}
                        className={`flex items-center justify-between p-2 px-3 rounded-2xl border text-xs transition-all ${
                          isCurrent
                            ? 'border-[var(--theme-accent)]/50 bg-[var(--theme-accent-soft,rgba(116,168,108,0.15))] text-white shadow-sm'
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-[var(--theme-accent)] text-white/80'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Wifi className="w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0" />
                          <span className="truncate font-medium">{p}</span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isCurrent ? (
                            <button
                              type="button"
                              onClick={handleDisconnectWifi}
                              disabled={isActionInProgress}
                              className="px-2.5 py-0.5 rounded-full border border-red-500/30 text-[10px] font-mono text-red-400 hover:bg-red-500/10 transition-all cursor-pointer active:scale-95"
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleConnectProfile(p)}
                              disabled={isActionInProgress}
                              className="px-2.5 py-0.5 rounded-full bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] text-[10px] font-mono font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer shadow-sm"
                            >
                              Connect
                            </button>
                          )}

                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => handleForgetWifi(p)}
                              className="p-1 rounded-lg border border-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400"
                              title="Forget Network"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer: Ethernet Link Status & Flyout */}
              <div className="pt-2 border-t border-white/5 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-mono text-[var(--theme-text-secondary)]">
                  {activeEthernet
                    ? `LAN: ${activeEthernet.ip_address}`
                    : connectedSsid
                      ? `Signal: ${wifiSignal}% (${wifiBand})`
                      : 'WLAN Adapter Ready'}
                </span>

                <button
                  type="button"
                  onClick={handleOpenAvailableNetworks}
                  className="px-3 py-1 rounded-full text-[10px] font-mono font-semibold bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer active:scale-95"
                >
                  Scan Networks
                </button>
              </div>
            </>
          )}
        </div>

        {/* ======================================================================= */}
        {/* RIGHT CARD: BLUETOOTH CAPSULE + TOGGLE + DROPDOWN ARROW                 */}
        {/* ======================================================================= */}
        <div
          className={`bento-card p-3 rounded-3xl flex flex-col justify-between border border-white/[0.08] backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-all duration-300 overflow-hidden ${
            bluetoothDropdownOpen ? 'h-full' : 'h-auto'
          }`}
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
            boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.28)',
          }}
        >
          {/* THE HERO BLUETOOTH CAPSULE WITH TOGGLE AND DROPDOWN ARROW */}
          <div
            className={`w-full p-2.5 rounded-2xl border transition-all flex items-center justify-between gap-2.5 shrink-0 ${
              bluetoothEnabled
                ? 'border-white/10 bg-white/[0.04]'
                : 'border-white/5 bg-white/[0.015] opacity-60'
            }`}
          >
            {/* Left: Bluetooth Icon & Live Label */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
                  bluetoothEnabled
                    ? activeBluetoothDevice
                      ? 'bg-[var(--theme-accent)]/20 text-[var(--theme-accent)] border-[var(--theme-accent)]/40 shadow-sm'
                      : 'bg-white/10 text-white border-white/10'
                    : 'bg-white/5 text-[var(--theme-text-secondary)] border-white/5'
                }`}
              >
                <Bluetooth className="w-5 h-5" />
              </div>

              <div className="min-w-0">
                <div className="text-sm font-bold text-[var(--theme-text-primary)] leading-none truncate">
                  Bluetooth
                </div>
                <div className="text-[11px] text-[var(--theme-text-secondary)] mt-1 font-mono flex items-center gap-1.5 truncate">
                  {bluetoothEnabled ? (
                    activeBluetoothDevice ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)] animate-pulse" />
                        <span className="truncate font-semibold text-white">
                          {activeBluetoothDevice.name}
                        </span>
                      </>
                    ) : (
                      <span>{bluetoothDevices.length} Paired Devices</span>
                    )
                  ) : (
                    <span>Radio Off</span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: The Toggle Switch AND The Dropdown Arrow Button */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Toggle Switch */}
              <button
                type="button"
                onClick={handleToggleBluetooth}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer active:scale-95 ${
                  bluetoothEnabled ? 'bg-[var(--theme-accent)]' : 'bg-white/10'
                }`}
                title="Turn Bluetooth On/Off"
              >
                <span
                  className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                    bluetoothEnabled ? 'right-1 shadow-sm' : 'left-1 opacity-70'
                  }`}
                />
              </button>

              {/* Dropdown Arrow Button */}
              <button
                type="button"
                onClick={() => setBluetoothDropdownOpen((prev) => !prev)}
                className={`w-9 h-9 rounded-2xl border transition-all flex items-center justify-center cursor-pointer active:scale-95 ${
                  bluetoothDropdownOpen
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] shadow-sm'
                    : 'border-white/10 bg-white/5 text-[var(--theme-text-secondary)] hover:text-white hover:bg-white/10'
                }`}
                title="Drop down Bluetooth devices and controls"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${
                    bluetoothDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* REVEALED ONLY WHEN DROPPED DOWN */}
          {bluetoothDropdownOpen && (
            <>
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden py-2 animate-in fade-in slide-in-from-top-1 duration-200 gap-1.5">
                {/* Drawer Action Bar */}
                <div className="flex items-center justify-between pb-1 border-b border-white/5 text-[10.5px] font-mono shrink-0">
                  <span className="text-[var(--theme-text-secondary)] uppercase tracking-wider font-semibold">
                    Paired Devices ({bluetoothDevices.length})
                  </span>

                  <button
                    type="button"
                    onClick={() => void openExternalUrl('ms-settings:bluetooth')}
                    className="flex items-center gap-0.5 text-[var(--theme-accent)] hover:underline cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Pair New</span>
                  </button>
                </div>

                {/* Devices Scroll Area */}
                <div className="flex-1 overflow-y-auto canopy-scroll flex flex-col gap-1 pr-0.5 min-h-0">
                  {bluetoothDevices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center text-white/40">
                      <Bluetooth className="w-5 h-5 opacity-40" />
                      <span className="text-xs">No paired Bluetooth devices</span>
                    </div>
                  ) : (
                    bluetoothDevices.map((dev) => (
                      <div
                        key={dev.id}
                        className={`flex items-center justify-between p-2 px-3 rounded-2xl border text-xs transition-all ${
                          dev.connected
                            ? 'border-[var(--theme-accent)]/50 bg-[var(--theme-accent-soft,rgba(116,168,108,0.15))] text-white shadow-sm'
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-[var(--theme-accent)] text-white/80'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                              dev.connected
                                ? 'bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)]'
                                : 'bg-white/5 text-[var(--theme-accent)]'
                            }`}
                          >
                            {getDeviceIcon(dev)}
                          </div>

                          <div className="min-w-0">
                            <div className="font-semibold truncate text-white">{dev.name}</div>
                            <div className="text-[9.5px] font-mono flex items-center gap-1.5">
                              {dev.connected ? (
                                <span className="text-[var(--theme-accent)] font-semibold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)] animate-pulse" />
                                  <span>Connected • Audio Ready</span>
                                </span>
                              ) : (
                                <span className="text-white/40">Paired</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {dev.connected ? (
                            <button
                              type="button"
                              onClick={() => handleDisconnectBluetooth(dev.id, dev.name)}
                              disabled={isActionInProgress}
                              className="px-2.5 py-0.5 rounded-full border border-red-500/30 text-[10px] font-mono text-red-400 hover:bg-red-500/10 transition-all cursor-pointer active:scale-95"
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleConnectBluetooth(dev.id, dev.name)}
                              disabled={isActionInProgress}
                              className="px-2.5 py-0.5 rounded-full bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] text-[10px] font-mono font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer shadow-sm"
                            >
                              Connect
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Footer: Accessory Status & Pair */}
              <div className="pt-2 border-t border-white/5 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-mono text-[var(--theme-text-secondary)]">
                  {bluetoothEnabled ? 'Headsets, Earbuds & Input' : 'Radio Off'}
                </span>

                <button
                  type="button"
                  onClick={() => void openExternalUrl('ms-settings:bluetooth')}
                  className="px-3 py-1 rounded-full text-[10px] font-mono font-semibold bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer active:scale-95"
                >
                  Pair New Device
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* UNIFIED BOTTOM CONTROL BAR (MATCHING MODERN CAPSULE AESTHETICS)           */}
      {/* ========================================================================= */}
      <div
        className="w-full shrink-0 flex items-center justify-between px-3.5 py-1.5 rounded-2xl border border-white/[0.08] backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
        style={{ background: 'var(--theme-card, rgba(255, 255, 255, 0.035))' }}
      >
        {/* Left: Live Throughput Telemetry */}
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <div className="flex items-center gap-1 font-semibold text-[var(--theme-accent)]">
            <ArrowDown className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              {stats.net_down_kbps > 1024
                ? `${(stats.net_down_kbps / 1024).toFixed(1)} MB/s`
                : `${Math.round(stats.net_down_kbps)} KB/s`}
            </span>
          </div>

          <div className="flex items-center gap-1 text-[var(--theme-text-secondary)]">
            <ArrowUp className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              {stats.net_up_kbps > 1024
                ? `${(stats.net_up_kbps / 1024).toFixed(1)} MB/s`
                : `${Math.round(stats.net_up_kbps)} KB/s`}
            </span>
          </div>

          <span className="text-white/20">•</span>
          <span className="text-[var(--theme-text-secondary)] truncate max-w-[180px]">
            {activeEthernet
              ? `LAN: ${activeEthernet.ip_address}`
              : connectedSsid || 'Network Online'}
          </span>
        </div>

        {/* Right: Mobile Hotspot + Power Plan + Cast + Refresh */}
        <div className="flex items-center gap-2">
          {/* Mobile Hotspot Pill Button */}
          <div className="flex items-center rounded-full border border-white/10 p-0.5 bg-white/5">
            <button
              type="button"
              onClick={handleToggleHotspot}
              disabled={isActionInProgress}
              className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono transition-all cursor-pointer ${
                hotspotEnabled
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] font-semibold shadow-sm'
                  : 'text-[var(--theme-text-secondary)] hover:text-white'
              }`}
              title={`Mobile Hotspot (${hotspotSsid} • ${hotspotClients} clients)`}
            >
              <Radio className={`w-3 h-3 ${hotspotEnabled ? 'animate-pulse' : ''}`} />
              <span>{hotspotEnabled ? `Hotspot (${hotspotClients})` : 'Hotspot Off'}</span>
            </button>
            <button
              type="button"
              onClick={() => setHotspotModalOpen(true)}
              className="px-2 py-0.5 text-[9px] font-mono text-[var(--theme-accent)] hover:underline cursor-pointer"
              title="Configure Hotspot SSID & Password"
            >
              Edit
            </button>
          </div>

          {/* Power Plan Quick Switch */}
          <button
            type="button"
            onClick={handleTogglePowerPlan}
            className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-mono transition-all pointer-events-auto cursor-pointer ${
              isPowerSaver
                ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] font-semibold'
                : 'border-white/10 hover:border-white/20 text-[var(--theme-text-secondary)] hover:text-white'
            }`}
            title="Toggle Windows Power Plan"
          >
            <Zap className="w-3 h-3" />
            <span>{isPowerSaver ? 'Power Saver' : 'Performance'}</span>
          </button>

          {/* Cast Screen */}
          <button
            type="button"
            onClick={() => void openExternalUrl('ms-settings:project')}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-white/10 text-[10px] font-mono hover:border-white/20 hover:bg-white/5 text-[var(--theme-text-secondary)] hover:text-white transition-all pointer-events-auto cursor-pointer"
            title="Wireless Display / Cast Screen (Win + K)"
          >
            <Cast className="w-3 h-3" />
            <span>Cast</span>
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={isRefreshing}
            className="p-1 rounded-full border border-white/10 hover:bg-white/10 text-[var(--theme-text-secondary)] hover:text-white transition-colors cursor-pointer"
            title="Refresh All Network Status"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* FLOATING HOTSPOT CONFIGURATION MODAL                                      */}
      {/* ========================================================================= */}
      {hotspotModalOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setHotspotModalOpen(false)}
        >
          <div
            className="w-full max-w-sm p-4 rounded-3xl border border-white/15 shadow-2xl flex flex-col gap-3 animate-in zoom-in-95 duration-150"
            style={{
              background: 'var(--theme-bg, #11111b)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[var(--theme-accent)]" />
                <span className="text-xs font-bold" style={{ color: 'var(--theme-text-primary)' }}>
                  Configure Mobile Hotspot
                </span>
              </div>
              <button
                type="button"
                onClick={() => setHotspotModalOpen(false)}
                className="text-[var(--theme-text-secondary)] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase text-[var(--theme-text-secondary)]">
                  Hotspot Network Name (SSID)
                </label>
                <input
                  type="text"
                  value={hotspotSsid}
                  maxLength={32}
                  onChange={(e) => setHotspotSsid(e.target.value)}
                  className="px-3 py-1.5 rounded-xl text-xs font-mono bg-[var(--theme-track)] text-[var(--theme-text-primary)] border border-white/10 outline-none focus:border-[var(--theme-accent)]"
                  placeholder="Network name..."
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase text-[var(--theme-text-secondary)]">
                  Network Password (WPA2)
                </label>
                <div className="relative">
                  <input
                    type={hotspotPassVisible ? 'text' : 'password'}
                    value={hotspotPass}
                    maxLength={64}
                    onChange={(e) => setHotspotPass(e.target.value)}
                    className="w-full px-3 py-1.5 pr-8 rounded-xl text-xs font-mono bg-[var(--theme-track)] text-[var(--theme-text-primary)] border border-white/10 outline-none focus:border-[var(--theme-accent)]"
                    placeholder="Min 8 characters..."
                  />
                  <button
                    type="button"
                    onClick={() => setHotspotPassVisible(!hotspotPassVisible)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--theme-text-secondary)] hover:text-white"
                  >
                    {hotspotPassVisible ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {hotspotMsg && (
                <div
                  className={`text-[10px] font-mono p-2 rounded-xl border ${
                    hotspotMsg.includes('success')
                      ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}
                >
                  {hotspotMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setHotspotModalOpen(false)}
                  className="px-3 py-1 rounded-full border border-white/10 text-xs font-medium hover:bg-white/5 transition-colors text-[var(--theme-text-secondary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveHotspotConfig}
                  disabled={hotspotSaving}
                  className="px-3.5 py-1 rounded-full text-xs font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
                >
                  {hotspotSaving ? 'Saving...' : 'Apply & Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
