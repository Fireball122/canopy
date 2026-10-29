import {
  ArrowDown,
  ArrowUp,
  Bluetooth,
  BluetoothOff,
  Cast,
  ExternalLink,
  Eye,
  EyeOff,
  Network,
  Plus,
  Radio,
  RefreshCw,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  addAndConnectWifi,
  connectWifi,
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
    Array<{ id: string; name: string; status: string; connected: boolean }>
  >([]);

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

  // 1. Fetch all real data from C# host
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
      setHotspotSsid(hs.ssid || 'Hotspot');
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
  const activeWifiAdapter = adapters.find((a) => a.type === 'wifi');

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
    setIsActionInProgress(true);
    try {
      await disconnectWifi();
      onToastNotification?.('Disconnected from Wi-Fi network');
      setTimeout(() => {
        void refreshAll();
        setIsActionInProgress(false);
      }, 800);
    } catch {
      setIsActionInProgress(false);
    }
  };

  const handleConnectProfile = async (ssid: string) => {
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

  const handleAddAndConnectWifi = async () => {
    const cleanSsid = newWifiSsid.trim();
    if (!cleanSsid) {
      setWifiFormError('Please enter a Wi-Fi network name (SSID)');
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
        setTimeout(() => void refreshAll(), 1000);
      } else {
        setWifiFormError(res.message || 'Failed to connect');
      }
    } catch {
      setWifiFormError('Could not connect to Wi-Fi network');
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
      onToastNotification?.(
        res.enabled ? `Mobile Hotspot active (${hotspotSsid})` : 'Mobile Hotspot stopped',
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

  const renderSignalIcon = (signal: number) => {
    if (signal > 75)
      return <SignalHigh className="w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0" />;
    if (signal > 45)
      return <SignalMedium className="w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0" />;
    return <SignalLow className="w-3.5 h-3.5 text-[var(--theme-text-secondary)] shrink-0" />;
  };

  return (
    <div className="w-full h-full flex flex-col justify-between p-2.5 select-none pointer-events-auto overflow-hidden relative gap-2">
      {/* ========================================================================= */}
      {/* MAIN TWO-COLUMN WORKSPACE: Network & Wi-Fi on LEFT, Bluetooth on RIGHT     */}
      {/* ========================================================================= */}
      <div className="flex-1 w-full grid grid-cols-2 gap-2.5 min-h-0 overflow-hidden">
        {/* ============================================================== */}
        {/* LEFT COLUMN: INTERNET & WI-FI HUB (ETHERNET INTEGRATED INSIDE) */}
        {/* ============================================================== */}
        <div
          className="bento-card p-3 rounded-2xl flex flex-col justify-between transition-all duration-200 border h-full min-h-0 overflow-hidden"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
          }}
        >
          {/* 1. Header: Integrated Ethernet Status Banner */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--theme-border)] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Network className="w-4 h-4 text-[var(--theme-accent)] shrink-0" />
              <span className="text-xs font-bold" style={{ color: 'var(--theme-text-primary)' }}>
                Network & Wi-Fi
              </span>
              {activeEthernet ? (
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--theme-accent-soft, rgba(116,168,108,0.2))] text-[var(--theme-accent)] border border-[var(--theme-accent)] shrink-0">
                  Gigabit LAN ({activeEthernet.speed_mbps} Mbps)
                </span>
              ) : (
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full border border-white/10 text-[var(--theme-text-secondary)] shrink-0">
                  LAN Disconnected
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleToggleWifi}
                className="px-2 py-0.5 rounded-lg border text-[10px] font-mono font-medium hover:border-[var(--theme-accent)] transition-all pointer-events-auto cursor-pointer"
                style={{
                  background: wifiEnabled ? 'var(--theme-track)' : 'transparent',
                  borderColor: 'var(--theme-border)',
                  color: wifiEnabled ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                }}
              >
                {wifiEnabled ? 'Wi-Fi On' : 'Wi-Fi Off'}
              </button>
              <button
                type="button"
                onClick={() => void openExternalUrl('ms-settings:network-wifi')}
                className="p-1 rounded-lg border hover:bg-white/10 text-[var(--theme-text-secondary)] transition-colors cursor-pointer"
                title="Windows Wi-Fi Settings"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 2. Middle: Active Connection Hero or Add Wi-Fi Form */}
          <div className="flex-1 flex flex-col justify-between py-1.5 min-h-0 overflow-hidden">
            {/* Active Wi-Fi Connection Card */}
            <div
              className="p-2.5 rounded-xl border flex items-center justify-between gap-2.5 shrink-0 transition-colors"
              style={{
                background: 'var(--theme-track)',
                borderColor: connectedSsid ? 'var(--theme-accent)' : 'var(--theme-border)',
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    connectedSsid
                      ? 'bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)]'
                      : 'bg-white/5 text-[var(--theme-text-secondary)]'
                  }`}
                >
                  {connectedSsid ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div
                    className="text-xs font-bold truncate"
                    style={{ color: 'var(--theme-text-primary)' }}
                  >
                    {connectedSsid ||
                      (wifiEnabled ? 'Wi-Fi Idle / Disconnected' : 'Wi-Fi Radio Off')}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--theme-text-secondary)] mt-0.5 flex items-center gap-1.5">
                    {connectedSsid ? (
                      <>
                        <span>{wifiBand}</span>
                        <span>•</span>
                        <span className="flex items-center gap-0.5">
                          {renderSignalIcon(wifiSignal)}
                          <span>{wifiSignal}%</span>
                        </span>
                      </>
                    ) : (
                      <span>
                        {activeWifiAdapter?.description ||
                          `${wifiProfiles.length} saved network profiles`}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {connectedSsid ? (
                <button
                  type="button"
                  onClick={handleDisconnectWifi}
                  disabled={isActionInProgress}
                  className="px-2.5 py-1 rounded-lg border text-[10px] font-mono hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400 transition-colors cursor-pointer shrink-0"
                  style={{
                    borderColor: 'var(--theme-border)',
                    color: 'var(--theme-text-secondary)',
                  }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenAvailableNetworks}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] hover:opacity-90 active:scale-95 transition-all shrink-0 cursor-pointer"
                >
                  Connect
                </button>
              )}
            </div>

            {/* Inline Add & Connect Wi-Fi with Password Form */}
            {showAddWifiForm ? (
              <div className="p-2.5 rounded-xl border border-[var(--theme-accent)] bg-white/5 flex flex-col gap-1.5 my-1 animate-in fade-in duration-150">
                <div className="flex items-center justify-between text-xs font-bold pb-1 border-b border-[var(--theme-border)]">
                  <span style={{ color: 'var(--theme-text-primary)' }}>
                    Connect to Wi-Fi Network
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddWifiForm(false)}
                    className="text-[var(--theme-text-secondary)] hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newWifiSsid}
                    onChange={(e) => setNewWifiSsid(e.target.value)}
                    placeholder="Network Name (SSID)..."
                    className="flex-1 px-2 py-1 rounded-md text-xs font-mono bg-[var(--theme-track)] text-[var(--theme-text-primary)] border border-[var(--theme-border)] outline-none focus:border-[var(--theme-accent)]"
                  />
                  <div className="relative flex-1">
                    <input
                      type={newWifiPassVisible ? 'text' : 'password'}
                      value={newWifiPassword}
                      onChange={(e) => setNewWifiPassword(e.target.value)}
                      placeholder="Password..."
                      className="w-full px-2 py-1 pr-7 rounded-md text-xs font-mono bg-[var(--theme-track)] text-[var(--theme-text-primary)] border border-[var(--theme-border)] outline-none focus:border-[var(--theme-accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => setNewWifiPassVisible(!newWifiPassVisible)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--theme-text-secondary)] hover:text-white"
                    >
                      {newWifiPassVisible ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddAndConnectWifi}
                    disabled={isConnectingWifi}
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] hover:opacity-90 active:scale-95 disabled:opacity-50"
                  >
                    {isConnectingWifi ? '...' : 'Join'}
                  </button>
                </div>
                {wifiFormError && (
                  <span className="text-[10px] text-red-400 font-mono">{wifiFormError}</span>
                )}
              </div>
            ) : null}

            {/* Saved Wi-Fi Profiles List */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden mt-1">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)] pb-1">
                <span>Available & Saved Networks</span>
                <button
                  type="button"
                  onClick={() => setShowAddWifiForm(true)}
                  className="flex items-center gap-0.5 text-[var(--theme-accent)] hover:underline cursor-pointer lowercase"
                >
                  <Plus className="w-3 h-3" />
                  <span>Enter password</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto canopy-scroll flex flex-col gap-1 pr-0.5 min-h-0">
                {wifiProfiles.map((p) => {
                  const isCurrent = connectedSsid === p;
                  return (
                    <div
                      key={p}
                      className={`flex items-center justify-between p-1.5 px-2.5 rounded-lg border text-xs transition-all ${
                        isCurrent
                          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft, rgba(116,168,108,0.12))]'
                          : 'border-white/5 hover:border-[var(--theme-accent)] hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Wifi className="w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0" />
                        <span className="truncate text-[var(--theme-text-primary)] font-medium">
                          {p}
                        </span>
                      </div>
                      {isCurrent ? (
                        <span className="text-[9px] font-mono px-2 py-0.2 rounded-full bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] font-semibold shrink-0">
                          Connected
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleConnectProfile(p)}
                          disabled={isActionInProgress}
                          className="px-2 py-0.5 rounded border border-white/10 text-[10px] font-mono text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)] transition-all shrink-0 cursor-pointer"
                        >
                          Connect
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. Footer of Left Card: Native Flyout Action */}
          <div className="pt-2 border-t border-[var(--theme-border)] flex items-center justify-between shrink-0">
            <span className="text-[10px] font-mono text-[var(--theme-text-secondary)]">
              {activeEthernet ? `LAN: ${activeEthernet.ip_address}` : 'Wi-Fi Link Ready'}
            </span>
            <button
              type="button"
              onClick={handleOpenAvailableNetworks}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              Browse In-Range Wi-Fi (Flyout)
            </button>
          </div>
        </div>

        {/* ============================================================== */}
        {/* RIGHT COLUMN: BLUETOOTH DEVICES & PERIPHERALS HUB              */}
        {/* ============================================================== */}
        <div
          className="bento-card p-3 rounded-2xl flex flex-col justify-between transition-all duration-200 border h-full min-h-0 overflow-hidden"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
            borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
          }}
        >
          {/* 1. Header: Bluetooth Master Radio & Actions */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--theme-border)] shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
                  bluetoothEnabled
                    ? 'bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] shadow-md'
                    : 'bg-[var(--theme-track)] text-[var(--theme-text-primary)]'
                }`}
                style={{ borderColor: 'var(--theme-border)' }}
              >
                {bluetoothEnabled ? (
                  <Bluetooth className="w-5 h-5" />
                ) : (
                  <BluetoothOff className="w-5 h-5 opacity-60" />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className="text-xs font-bold truncate flex items-center gap-1.5"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  <span>Bluetooth</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full border border-white/10 text-[var(--theme-text-secondary)]">
                    {bluetoothDevices.length} Paired
                  </span>
                </div>
                <div className="text-[10px] font-mono text-[var(--theme-text-secondary)] mt-0.5 truncate">
                  {bluetoothEnabled
                    ? bluetoothDevices.find((d) => d.connected)?.name || 'Radio Active'
                    : 'Radio Off'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleToggleBluetooth}
                className="px-2.5 py-1 rounded-lg border text-[10px] font-mono font-medium hover:border-[var(--theme-accent)] transition-all pointer-events-auto cursor-pointer"
                style={{
                  background: bluetoothEnabled ? 'var(--theme-track)' : 'transparent',
                  borderColor: 'var(--theme-border)',
                  color: bluetoothEnabled ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                }}
              >
                {bluetoothEnabled ? 'Turn Off' : 'Turn On'}
              </button>
              <button
                type="button"
                onClick={() => void openExternalUrl('ms-settings:bluetooth')}
                className="p-1 rounded-lg border hover:bg-white/10 text-[var(--theme-text-secondary)] transition-colors cursor-pointer"
                title="Windows Bluetooth Settings"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 2. Middle: Discovered & Paired Devices List */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden py-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)] pb-1 shrink-0">
              <span>Paired Bluetooth Devices ({bluetoothDevices.length})</span>
              <button
                type="button"
                onClick={() => void openExternalUrl('ms-settings:bluetooth')}
                className="text-[var(--theme-accent)] hover:underline cursor-pointer lowercase"
              >
                + Pair new
              </button>
            </div>

            <div className="flex-1 overflow-y-auto canopy-scroll flex flex-col gap-1 pr-0.5 min-h-0">
              {bluetoothDevices.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1 py-6 text-center text-[var(--theme-text-secondary)]">
                  <Bluetooth className="w-5 h-5 opacity-40" />
                  <span className="text-xs">No paired Bluetooth devices</span>
                  <span className="text-[10px] font-mono">
                    Click Pair to discover nearby devices
                  </span>
                </div>
              ) : (
                bluetoothDevices.map((dev) => (
                  <div
                    key={dev.id}
                    className="flex items-center justify-between p-2 rounded-xl border border-white/5 bg-white/5 hover:border-[var(--theme-accent)] hover:bg-white/10 transition-all text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center shrink-0 text-[var(--theme-accent)]">
                        <Bluetooth className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate text-[var(--theme-text-primary)]">
                          {dev.name}
                        </div>
                        <div className="text-[9px] font-mono text-[var(--theme-text-secondary)]">
                          {dev.connected ? 'Connected' : 'Paired Device'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void openExternalUrl('ms-settings:bluetooth')}
                        className="px-2 py-0.5 rounded-lg border border-white/10 text-[10px] font-mono text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)] transition-all cursor-pointer"
                      >
                        {dev.connected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 3. Footer of Right Card: Pair Action */}
          <div className="pt-2 border-t border-[var(--theme-border)] flex items-center justify-between shrink-0">
            <span className="text-[10px] font-mono text-[var(--theme-text-secondary)]">
              {bluetoothEnabled ? 'Ready for audio & input' : 'Radio Powered Down'}
            </span>
            <button
              type="button"
              onClick={() => void openExternalUrl('ms-settings:bluetooth')}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              Pair New Device
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* BOTTOM ACTION & TELEMETRY BAR: TELEMETRY + HOTSPOT + POWER PLAN + CAST    */}
      {/* ========================================================================= */}
      <div
        className="bento-card px-3.5 py-1.5 flex items-center justify-between gap-3 shrink-0 rounded-xl"
        style={{
          background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
          borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
        }}
      >
        {/* Left: Live Network Telemetry */}
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

          <span style={{ color: 'var(--theme-border)' }}>•</span>
          <span className="text-[var(--theme-text-secondary)] truncate max-w-[170px]">
            {activeEthernet
              ? `LAN: ${activeEthernet.ip_address}`
              : connectedSsid || 'Network Online'}
          </span>
        </div>

        {/* Right: Mobile Hotspot (as requested!) + Power Plan + Cast + Refresh */}
        <div className="flex items-center gap-2">
          {/* Mobile Hotspot Pill Button */}
          <div className="flex items-center rounded-full border border-[var(--theme-border)] p-0.5 bg-white/5">
            <button
              type="button"
              onClick={handleToggleHotspot}
              disabled={isActionInProgress}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono transition-all cursor-pointer ${
                hotspotEnabled
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] font-semibold'
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
              className="px-1.5 py-0.5 text-[9px] font-mono text-[var(--theme-accent)] hover:underline cursor-pointer"
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
                : 'hover:border-[var(--theme-accent)] text-[var(--theme-text-secondary)]'
            }`}
            style={{
              borderColor: isPowerSaver ? 'var(--theme-accent)' : 'var(--theme-border)',
            }}
            title="Toggle Windows Power Saver Plan"
          >
            <Zap className="w-3 h-3" />
            <span>{isPowerSaver ? 'Power Saver' : 'Performance'}</span>
          </button>

          {/* Cast Screen */}
          <button
            type="button"
            onClick={() => void openExternalUrl('ms-settings:project')}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-mono hover:border-[var(--theme-accent)] hover:bg-white/5 transition-all pointer-events-auto cursor-pointer"
            style={{
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text-secondary)',
            }}
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
            className="p-1 rounded-full border hover:bg-white/10 text-[var(--theme-text-secondary)] hover:text-white transition-colors cursor-pointer"
            title="Refresh All Network Status"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* FLOATING HOTSPOT CONFIGURATION MODAL (CLEAN & NON-DISRUPTIVE)            */}
      {/* ========================================================================= */}
      {hotspotModalOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setHotspotModalOpen(false)}
        >
          <div
            className="w-full max-w-sm p-3.5 rounded-2xl border shadow-2xl flex flex-col gap-2.5 animate-in zoom-in-95 duration-150"
            style={{
              background: 'var(--theme-bg, #11111b)',
              borderColor: 'var(--theme-accent)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-[var(--theme-border)]">
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

            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase text-[var(--theme-text-secondary)]">
                  Hotspot Network Name (SSID)
                </label>
                <input
                  type="text"
                  value={hotspotSsid}
                  maxLength={32}
                  onChange={(e) => setHotspotSsid(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-mono bg-[var(--theme-track)] text-[var(--theme-text-primary)] border border-[var(--theme-border)] outline-none focus:border-[var(--theme-accent)]"
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
                    className="w-full px-2.5 py-1.5 pr-8 rounded-lg text-xs font-mono bg-[var(--theme-track)] text-[var(--theme-text-primary)] border border-[var(--theme-border)] outline-none focus:border-[var(--theme-accent)]"
                    placeholder="8-64 characters..."
                  />
                  <button
                    type="button"
                    onClick={() => setHotspotPassVisible(!hotspotPassVisible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--theme-text-secondary)] hover:text-white cursor-pointer"
                  >
                    {hotspotPassVisible ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <span className="text-[9px] font-mono text-[var(--theme-text-secondary)]">
                  Windows requires at least 8 characters.
                </span>
              </div>
            </div>

            {hotspotMsg && (
              <span className="text-[10px] text-[var(--theme-accent)] font-mono">{hotspotMsg}</span>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--theme-border)]">
              <button
                type="button"
                onClick={() => setHotspotModalOpen(false)}
                className="px-3 py-1 rounded-lg text-xs border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveHotspotConfig}
                disabled={hotspotSaving}
                className="px-3 py-1 rounded-lg text-xs font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent, #111)] hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {hotspotSaving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkView;
