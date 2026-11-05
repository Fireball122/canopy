import {
  Bluetooth,
  Cast,
  Check,
  ChevronDown,
  Copy,
  Disc,
  Eye,
  EyeOff,
  Globe,
  Headphones,
  Network,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type WifiState,
} from '../services/hostBridge';

export interface NetworkViewProps {
  stats: SystemStats;
  onToastNotification?: (message: string) => void;
}

function formatLinkSpeed(speedMbps?: number): string {
  if (!speedMbps || speedMbps <= 0) return '—';
  if (speedMbps >= 1000) {
    const gbps = speedMbps / 1000;
    return Number.isInteger(gbps) ? `${gbps} Gbps` : `${gbps.toFixed(1)} Gbps`;
  }
  return `${speedMbps} Mbps`;
}

export const NetworkView: React.FC<NetworkViewProps> = ({ onToastNotification }) => {
  // Real Hardware States
  const [adapters, setAdapters] = useState<NetworkAdapterInfo[]>([]);
  const [wifiEnabled, setWifiEnabled] = useState<boolean>(true);
  const [connectedSsid, setConnectedSsid] = useState<string | null>(null);
  const [wifiSignal, setWifiSignal] = useState<number>(0);
  const [wifiBand, setWifiBand] = useState<string>('');
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

  // Dropdown Drawer States
  const [wifiDropdownOpen, setWifiDropdownOpen] = useState<boolean>(false);
  const [bluetoothDropdownOpen, setBluetoothDropdownOpen] = useState<boolean>(false);
  // Bluetooth Telemetry & Radio Details
  const [bluetoothAdapterName, setBluetoothAdapterName] =
    useState<string>('Bluetooth Radio Adapter');
  const [bluetoothVersion, setBluetoothVersion] = useState<string>('—');
  const [bluetoothLmp, setBluetoothLmp] = useState<string>('—');
  const [bluetoothConnectedCount, setBluetoothConnectedCount] = useState<number>(0);
  const [bluetoothRxKbps, setBluetoothRxKbps] = useState<number>(0);
  const [bluetoothTxKbps, setBluetoothTxKbps] = useState<number>(0);
  const [btTrafficHistory, setBtTrafficHistory] = useState<number[]>(() => new Array(20).fill(0));

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
  const [copiedIp, setCopiedIp] = useState<boolean>(false);

  // Fetch real hardware telemetry from host
  const refreshAll = useCallback(async (): Promise<WifiState | null> => {
    setIsRefreshing(true);
    try {
      // allSettled: one failing subsystem (e.g. no Bluetooth radio, hotspot API missing) must not
      // discard the adapter/Wi-Fi data that did arrive.
      const [adapRes, wfRes, btRes, hsRes, pmRes] = await Promise.allSettled([
        getNetworkAdapters(),
        getWifiState(),
        getBluetoothState(),
        getHotspotState(),
        getPowerMode(),
      ]);

      if (adapRes.status === 'fulfilled') {
        setAdapters(adapRes.value);
      }

      if (wfRes.status === 'fulfilled') {
        const wf = wfRes.value;
        setWifiEnabled(wf.enabled);
        setConnectedSsid(wf.connected ? wf.ssid || 'Connected' : null);
        setWifiSignal(wf.signal || 0);
        setWifiBand(wf.connected && wf.band ? wf.band : '');
        setWifiProfiles(wf.profiles || []);
      }

      if (btRes.status === 'fulfilled') {
        const bt = btRes.value;
        setBluetoothEnabled(bt.enabled);
        setBluetoothDevices(bt.devices || []);
        if (bt.adapter_name) setBluetoothAdapterName(bt.adapter_name);
        if (bt.version) setBluetoothVersion(bt.version);
        if (bt.lmp) setBluetoothLmp(bt.lmp);
        const connCount =
          typeof bt.connected_count === 'number'
            ? bt.connected_count
            : (bt.devices || []).filter((d) => d.connected).length;
        setBluetoothConnectedCount(connCount);
        const rx = typeof bt.rx_kbps === 'number' ? bt.rx_kbps : 0;
        const tx = typeof bt.tx_kbps === 'number' ? bt.tx_kbps : 0;
        setBluetoothRxKbps(rx);
        setBluetoothTxKbps(tx);
        setBtTrafficHistory((prev) => [...prev.slice(1), Math.max(0.5, rx + tx)]);
      }

      if (hsRes.status === 'fulfilled') {
        const hs = hsRes.value;
        setHotspotEnabled(hs.enabled);
        setHotspotSsid(hs.ssid?.trim() ? hs.ssid.trim() : 'Canopy Hotspot');
        setHotspotPass(hs.passphrase || '');
        setHotspotClients(hs.clients || 0);
      }

      if (pmRes.status === 'fulfilled') {
        setIsPowerSaver(pmRes.value.is_power_saver);
      }

      return wfRes.status === 'fulfilled' ? wfRes.value : null;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Timers scheduled from handlers; cleared on unmount so no callback fires after teardown.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  }, []);
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => {
        clearTimeout(id);
      });
      timers.clear();
    };
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Active Connection Info
  const activeEthernet = adapters.find(
    (a) =>
      a.type === 'ethernet' &&
      a.is_connected &&
      !a.name.toLowerCase().includes('vethernet') &&
      !a.name.toLowerCase().includes('virtual'),
  );
  const activeWifi = adapters.find((a) => a.type === 'wifi' && a.is_connected);
  const primaryAdapter =
    activeEthernet || activeWifi || adapters.find((a) => a.is_connected) || adapters[0];
  const activeBluetoothDevice = bluetoothDevices.find((d) => d.connected);

  // Actions
  const handleToggleWifi = async () => {
    const next = !wifiEnabled;
    setWifiEnabled(next);
    try {
      const ok = await setHostWifiEnabled(next);
      if (!ok) {
        setWifiEnabled(!next);
        onToastNotification?.(`Could not turn Wi-Fi ${next ? 'on' : 'off'}`);
        return;
      }
      scheduleTimeout(() => void refreshAll(), 1000);
      onToastNotification?.(next ? 'Wi-Fi radio enabled' : 'Wi-Fi radio disabled');
    } catch {
      setWifiEnabled(!next);
    }
  };

  const handleToggleBluetooth = async () => {
    const next = !bluetoothEnabled;
    setBluetoothEnabled(next);
    try {
      const ok = await setHostBluetoothEnabled(next);
      if (!ok) {
        setBluetoothEnabled(!next);
        onToastNotification?.(`Could not turn Bluetooth ${next ? 'on' : 'off'}`);
        return;
      }
      scheduleTimeout(() => void refreshAll(), 1000);
      onToastNotification?.(next ? 'Bluetooth radio enabled' : 'Bluetooth radio disabled');
    } catch {
      setBluetoothEnabled(!next);
    }
  };

  const handleDisconnectWifi = async () => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    try {
      await disconnectWifi();
      onToastNotification?.('Disconnected from Wi-Fi network');
      scheduleTimeout(() => {
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
      const requested = await connectWifi(ssid);
      if (!requested) {
        setIsActionInProgress(false);
        onToastNotification?.(`Could not connect to ${ssid}`);
        return;
      }
      scheduleTimeout(() => {
        // Report what Windows actually did instead of assuming the join succeeded.
        void refreshAll()
          .then((wf) => {
            onToastNotification?.(
              wf?.connected && wf.ssid === ssid
                ? `Connected to ${ssid}`
                : `Not connected to ${ssid} yet`,
            );
          })
          .finally(() => setIsActionInProgress(false));
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
        onToastNotification?.(`Connected to ${cleanSsid}`);
        setShowAddWifiForm(false);
        setNewWifiSsid('');
        setNewWifiPassword('');
        scheduleTimeout(() => void refreshAll(), 1500);
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
      scheduleTimeout(() => void refreshAll(), 1500);
    } catch (err) {
      onToastNotification?.(
        `Hotspot toggle failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
        scheduleTimeout(() => {
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
      scheduleTimeout(() => void refreshAll(), 1000);
    } catch (err) {
      onToastNotification?.(
        `Power plan change failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
      scheduleTimeout(() => {
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
      scheduleTimeout(() => {
        void refreshAll();
        setIsActionInProgress(false);
      }, 1200);
    } catch {
      setIsActionInProgress(false);
    }
  };

  const handleCopyIp = (ip: string) => {
    navigator.clipboard
      .writeText(ip)
      .then(() => {
        setCopiedIp(true);
        onToastNotification?.(`Copied IP: ${ip}`);
        scheduleTimeout(() => setCopiedIp(false), 2000);
      })
      .catch(() => onToastNotification?.('Could not copy IP address'));
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

  // Only a real address: a made-up fallback would be copied and trusted by the user.
  const activeIpAddress = primaryAdapter?.ip_address || '';
  const primaryConnected = Boolean(primaryAdapter?.is_connected);

  const btSparklineData = useMemo(() => {
    const w = 180;
    const h = 18;
    const pts = btTrafficHistory;
    const maxVal = Math.max(...pts, 4);
    const step = w / (pts.length - 1);
    const points = pts.map((val, idx) => {
      const x = idx * step;
      const y = h - (val / maxVal) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      polyline: points.join(' '),
      fill: `0,${h} ${points.join(' ')} ${w},${h}`,
    };
  }, [btTrafficHistory]);

  return (
    <div className="w-full h-full flex flex-col justify-between p-2 select-none pointer-events-auto overflow-hidden relative gap-2">
      {/* ========================================================================= */}
      {/* MAIN TWO-COLUMN WORKSPACE: WI-FI CARD (LEFT) & BLUETOOTH CARD (RIGHT)    */}
      {/* ========================================================================= */}
      <div className="flex-1 w-full grid grid-cols-2 gap-2.5 min-h-0 items-stretch overflow-hidden">
        {/* ======================================================================= */}
        {/* LEFT COLUMN: WI-FI CAPSULE + (DRAWER OR HARDWARE ADAPTER TELEMETRY)      */}
        {/* ======================================================================= */}
        <div
          className="bento-card p-3 rounded-2xl flex flex-col justify-between border border-white/[0.08] backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] h-full overflow-hidden"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
            boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.28)',
          }}
        >
          {/* Top: Hero Wi-Fi Capsule */}
          <div
            className={`w-full p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2.5 shrink-0 ${
              wifiEnabled
                ? 'border-white/10 bg-white/[0.04]'
                : 'border-white/5 bg-white/[0.015] opacity-60'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
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
                    <Wifi className="w-4 h-4" />
                  )
                ) : (
                  <WifiOff className="w-4 h-4 opacity-40" />
                )}
              </div>

              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--theme-text-primary)] leading-none truncate">
                  Wi-Fi
                </div>
                <div className="text-[10px] text-[var(--theme-text-secondary)] mt-1 font-mono flex items-center gap-1.5 truncate">
                  {wifiEnabled ? (
                    connectedSsid ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)] animate-pulse" />
                        <span className="truncate font-semibold text-white">{connectedSsid}</span>
                        {wifiBand && (
                          <>
                            <span className="opacity-50">•</span>
                            <span className="text-[var(--theme-accent)]">{wifiBand}</span>
                          </>
                        )}
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

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={wifiEnabled}
                onClick={handleToggleWifi}
                className="w-9 h-5 rounded-full p-0.5 transition-all flex items-center cursor-pointer pointer-events-auto shrink-0"
                style={{
                  background: wifiEnabled ? 'var(--theme-accent)' : 'rgba(255, 255, 255, 0.14)',
                }}
              >
                <div
                  className="w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{
                    transform: wifiEnabled ? 'translateX(16px)' : 'translateX(0px)',
                  }}
                />
              </button>

              <button
                type="button"
                onClick={() => setWifiDropdownOpen((prev) => !prev)}
                className={`w-8 h-8 rounded-xl border transition-all flex items-center justify-center cursor-pointer active:scale-95 ${
                  wifiDropdownOpen
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] shadow-sm'
                    : 'border-white/10 bg-white/5 text-[var(--theme-text-secondary)] hover:text-white hover:bg-white/10'
                }`}
                title="Toggle Wi-Fi networks drawer"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    wifiDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Middle/Bottom: Drawer when open OR Hardware Adapter Telemetry when closed */}
          {wifiDropdownOpen ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden py-2 gap-1.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-1 border-b border-white/5 text-[10px] font-mono shrink-0">
                <span className="text-[var(--theme-text-secondary)] uppercase tracking-wider font-semibold">
                  Networks ({wifiProfiles.length})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowAddWifiForm((prev) => !prev)}
                    className="flex items-center gap-0.5 text-[var(--theme-accent)] hover:underline cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Join</span>
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

              {showAddWifiForm && (
                <div className="p-2 rounded-xl border border-[var(--theme-accent)] bg-white/5 flex flex-col gap-1.5 shrink-0 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between text-xs font-bold pb-1 border-b border-white/10">
                    <span className="text-white text-[11px]">Join with Password</span>
                    <button
                      type="button"
                      onClick={() => setShowAddWifiForm(false)}
                      className="text-white/50 hover:text-white"
                      aria-label="Close join form"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newWifiSsid}
                      onChange={(e) => setNewWifiSsid(e.target.value)}
                      placeholder="SSID..."
                      className="flex-1 px-2 py-1 rounded-lg text-[11px] font-mono bg-white/5 text-white border border-white/10 outline-none focus:border-[var(--theme-accent)]"
                    />
                    <div className="relative flex-1">
                      <input
                        type={newWifiPassVisible ? 'text' : 'password'}
                        value={newWifiPassword}
                        onChange={(e) => setNewWifiPassword(e.target.value)}
                        placeholder="Password..."
                        className="w-full px-2 py-1 pr-5 rounded-lg text-[11px] font-mono bg-white/5 text-white border border-white/10 outline-none focus:border-[var(--theme-accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => setNewWifiPassVisible(!newWifiPassVisible)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                        aria-label={newWifiPassVisible ? 'Hide password' : 'Show password'}
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
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] hover:opacity-90 active:scale-95 disabled:opacity-50"
                    >
                      {isConnectingWifi ? '...' : 'Connect'}
                    </button>
                  </div>
                  {wifiFormError && (
                    <div className="text-[9px] text-red-400 font-mono">{wifiFormError}</div>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto canopy-scroll flex flex-col gap-1 pr-0.5 min-h-0">
                {wifiProfiles.length === 0 && (
                  <div className="flex-1 flex items-center justify-center text-center p-3 text-[11px] text-[var(--theme-text-secondary)]">
                    No saved Wi-Fi networks — use Join or Scan Networks
                  </div>
                )}
                {wifiProfiles.map((p) => {
                  const isCurrent = connectedSsid === p;
                  return (
                    <div
                      key={p}
                      className={`flex items-center justify-between p-1.5 px-2.5 rounded-xl border text-xs transition-all ${
                        isCurrent
                          ? 'border-[var(--theme-accent)]/50 bg-[var(--theme-accent-soft,rgba(116,168,108,0.15))] text-white shadow-sm'
                          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06] text-white/80'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Wifi className="w-3 h-3 text-[var(--theme-accent)] shrink-0" />
                        <span className="truncate text-[11px] font-medium">{p}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isCurrent ? (
                          <button
                            type="button"
                            onClick={handleDisconnectWifi}
                            disabled={isActionInProgress}
                            className="px-2 py-0.5 rounded-full border border-red-500/30 text-[9px] font-mono text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                          >
                            Disconnect
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleConnectProfile(p)}
                            disabled={isActionInProgress}
                            className="px-2 py-0.5 rounded-full bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] text-[9px] font-mono font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer"
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
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-1.5 border-t border-white/5 flex items-center justify-between shrink-0">
                <span className="text-[9px] font-mono text-[var(--theme-text-secondary)]">
                  Signal: {wifiSignal}%{wifiBand ? ` (${wifiBand})` : ''}
                </span>
                <button
                  type="button"
                  onClick={handleOpenAvailableNetworks}
                  className="px-2.5 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer active:scale-95"
                >
                  Scan Networks
                </button>
              </div>
            </div>
          ) : (
            /* Hardware Adapter & IP Telemetry Display */
            <div className="flex-1 flex flex-col justify-between pt-2.5 gap-2 min-h-0 animate-in fade-in duration-200">
              <div className="flex flex-col gap-2">
                {/* Header with status pill */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Network className="w-3.5 h-3.5 text-[var(--theme-accent)]" />
                    <span className="text-[11px] font-semibold text-white tracking-tight">
                      Network Interface
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--theme-text-secondary)]">
                    {primaryConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>

                {/* Adapter Description */}
                <div className="text-[11px] text-[var(--theme-text-secondary)] truncate">
                  {primaryAdapter?.description || 'No network adapter detected'}
                </div>

                {/* IP Address Card with One-Click Copy */}
                <div className="flex items-center justify-between p-2 rounded-xl border border-white/10 bg-white/[0.03]">
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0" />
                    <span className="text-[10px] font-mono text-[var(--theme-text-secondary)]">
                      IPv4:
                    </span>
                    <span className="text-xs font-mono font-semibold text-white tracking-tight truncate tabular-nums">
                      {activeIpAddress || 'Not assigned'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyIp(activeIpAddress)}
                    disabled={!activeIpAddress}
                    className="px-2 py-0.5 rounded-lg border border-white/10 text-[9.5px] font-mono hover:bg-white/10 active:scale-95 transition-all flex items-center gap-1 text-[var(--theme-text-secondary)] hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-default"
                  >
                    {copiedIp ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedIp ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                {/* 2x2 Telemetry Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)]">
                      Link Speed
                    </span>
                    <span className="text-xs font-bold font-mono text-white tabular-nums mt-0.5">
                      {formatLinkSpeed(primaryAdapter?.speed_mbps)}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)]">
                      Interface
                    </span>
                    <span className="text-xs font-bold font-mono text-[var(--theme-accent)] truncate mt-0.5">
                      {primaryAdapter?.type === 'ethernet'
                        ? '802.3 Ethernet'
                        : primaryAdapter?.type === 'wifi'
                          ? `802.11${wifiBand ? ` (${wifiBand})` : ''}`
                          : '—'}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)]">
                      Signal / Duplex
                    </span>
                    <span className="text-xs font-bold font-mono text-white tabular-nums mt-0.5">
                      {connectedSsid
                        ? `${wifiSignal}% Quality`
                        : primaryConnected
                          ? 'Full Duplex'
                          : '—'}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)]">
                      Gateway State
                    </span>
                    <span
                      className="text-xs font-bold font-mono mt-0.5 flex items-center gap-1.5"
                      style={{
                        color: primaryConnected ? '#34d399' : 'var(--theme-text-secondary)',
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {primaryConnected ? 'Active Route' : 'No Route'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom Quick Trigger */}
              <div className="pt-2 border-t border-white/5 flex items-center justify-between shrink-0">
                <span className="text-[9.5px] font-mono text-[var(--theme-text-secondary)]">
                  {adapters.length} total adapter{adapters.length === 1 ? '' : 's'} registered
                </span>
                <button
                  type="button"
                  onClick={() => setWifiDropdownOpen(true)}
                  className="text-[10px] font-mono text-[var(--theme-accent)] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>Manage Wi-Fi</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ======================================================================= */}
        {/* RIGHT COLUMN: BLUETOOTH CAPSULE + (DRAWER OR LIVE TRAFFIC WAVE)         */}
        {/* ======================================================================= */}
        <div
          className="bento-card p-3 rounded-2xl flex flex-col justify-between border border-white/[0.08] backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] h-full overflow-hidden"
          style={{
            background: 'var(--theme-card, rgba(255, 255, 255, 0.035))',
            boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.28)',
          }}
        >
          {/* Top: Hero Bluetooth Capsule */}
          <div
            className={`w-full p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2.5 shrink-0 ${
              bluetoothEnabled
                ? 'border-white/10 bg-white/[0.04]'
                : 'border-white/5 bg-white/[0.015] opacity-60'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
                  bluetoothEnabled
                    ? activeBluetoothDevice
                      ? 'bg-[var(--theme-accent)]/20 text-[var(--theme-accent)] border-[var(--theme-accent)]/40 shadow-sm'
                      : 'bg-white/10 text-white border-white/10'
                    : 'bg-white/5 text-[var(--theme-text-secondary)] border-white/5'
                }`}
              >
                <Bluetooth className="w-4 h-4" />
              </div>

              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--theme-text-primary)] leading-none truncate">
                  Bluetooth
                </div>
                <div className="text-[10px] text-[var(--theme-text-secondary)] mt-1 font-mono flex items-center gap-1.5 truncate">
                  {bluetoothEnabled ? (
                    activeBluetoothDevice ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)] animate-pulse" />
                        <span className="truncate font-semibold text-white">
                          {activeBluetoothDevice.name}
                        </span>
                      </>
                    ) : (
                      <span>
                        {bluetoothDevices.length} Paired Device
                        {bluetoothDevices.length === 1 ? '' : 's'}
                      </span>
                    )
                  ) : (
                    <span>Radio Off</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={bluetoothEnabled}
                onClick={handleToggleBluetooth}
                className="w-9 h-5 rounded-full p-0.5 transition-all flex items-center cursor-pointer pointer-events-auto shrink-0"
                style={{
                  background: bluetoothEnabled
                    ? 'var(--theme-accent)'
                    : 'rgba(255, 255, 255, 0.14)',
                }}
              >
                <div
                  className="w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{
                    transform: bluetoothEnabled ? 'translateX(16px)' : 'translateX(0px)',
                  }}
                />
              </button>

              <button
                type="button"
                onClick={() => setBluetoothDropdownOpen((prev) => !prev)}
                className={`w-8 h-8 rounded-xl border transition-all flex items-center justify-center cursor-pointer active:scale-95 ${
                  bluetoothDropdownOpen
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] shadow-sm'
                    : 'border-white/10 bg-white/5 text-[var(--theme-text-secondary)] hover:text-white hover:bg-white/10'
                }`}
                title="Toggle Bluetooth devices drawer"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    bluetoothDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Middle/Bottom: Bluetooth Drawer when open OR Real-time Traffic Wave when closed */}
          {bluetoothDropdownOpen ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden py-2 gap-1.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-1 border-b border-white/5 text-[10px] font-mono shrink-0">
                <span className="text-[var(--theme-text-secondary)] uppercase tracking-wider font-semibold">
                  Paired Devices ({bluetoothDevices.length})
                </span>
                <button
                  type="button"
                  onClick={() => void openExternalUrl('ms-settings:bluetooth')}
                  className="text-[var(--theme-accent)] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Pair</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto canopy-scroll flex flex-col gap-1 pr-0.5 min-h-0">
                {bluetoothDevices.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                    <Bluetooth className="w-6 h-6 text-white/20 mb-1" />
                    <span className="text-xs text-[var(--theme-text-secondary)]">
                      No paired devices found
                    </span>
                  </div>
                ) : (
                  bluetoothDevices.map((dev) => (
                    <div
                      key={dev.id}
                      className={`flex items-center justify-between p-1.5 px-2.5 rounded-xl border text-xs transition-all ${
                        dev.connected
                          ? 'border-[var(--theme-accent)]/50 bg-[var(--theme-accent-soft,rgba(116,168,108,0.15))] text-white shadow-sm'
                          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06] text-white/80'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={dev.connected ? 'text-[var(--theme-accent)]' : 'text-white/40'}
                        >
                          {getDeviceIcon(dev)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium truncate">{dev.name}</div>
                          <div className="text-[9px] font-mono text-[var(--theme-text-secondary)]">
                            {dev.connected ? 'Connected' : 'Paired'}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {dev.connected ? (
                          <button
                            type="button"
                            onClick={() => void handleDisconnectBluetooth(dev.id, dev.name)}
                            disabled={isActionInProgress}
                            className="px-2 py-0.5 rounded-full border border-red-500/30 text-[9px] font-mono text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                          >
                            Disconnect
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleConnectBluetooth(dev.id, dev.name)}
                            disabled={isActionInProgress}
                            className="px-2 py-0.5 rounded-full bg-[var(--theme-accent)] text-[var(--theme-on-accent,#111)] text-[9px] font-mono font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                          >
                            Connect
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-1.5 border-t border-white/5 flex items-center justify-between shrink-0">
                <span className="text-[9px] font-mono text-[var(--theme-text-secondary)]">
                  {bluetoothDevices.filter((d) => d.connected).length} active connected
                </span>
                <button
                  type="button"
                  onClick={() => void openExternalUrl('ms-settings:bluetooth')}
                  className="px-2.5 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer active:scale-95"
                >
                  Pair New Device
                </button>
              </div>
            </div>
          ) : (
            /* Hardware Adapter & Bluetooth Telemetry Display (Matches Wi-Fi Architecture) */
            <div className="flex-1 flex flex-col justify-between pt-2 gap-1.5 min-h-0 animate-in fade-in duration-200">
              <div className="flex flex-col gap-1.5">
                {/* Header with status pill */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Bluetooth className="w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0" />
                    <span className="text-[11px] font-semibold text-white tracking-tight truncate">
                      {bluetoothAdapterName}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--theme-text-secondary)] shrink-0">
                    {bluetoothConnectedCount > 0
                      ? `${bluetoothConnectedCount} Connected`
                      : bluetoothEnabled
                        ? 'Radio Active'
                        : 'Radio Off'}
                  </span>
                </div>

                {/* Primary Connected Peripheral or Discoverable Banner */}
                {activeBluetoothDevice ? (
                  <div className="flex items-center justify-between p-2 rounded-xl border border-[var(--theme-accent)]/30 bg-[var(--theme-accent)]/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[var(--theme-accent)] shrink-0">
                        {getDeviceIcon(activeBluetoothDevice)}
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-white truncate block">
                          {activeBluetoothDevice.name}
                        </span>
                        <span className="text-[9.5px] font-mono text-[var(--theme-accent)] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)] animate-pulse" />
                          <span>Active Peripheral Route</span>
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void handleDisconnectBluetooth(
                          activeBluetoothDevice.id,
                          activeBluetoothDevice.name,
                        )
                      }
                      className="px-2 py-0.5 rounded-lg border border-red-500/30 text-[9.5px] font-mono text-red-400 hover:bg-red-500/10 active:scale-95 transition-all cursor-pointer shrink-0"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-2 rounded-xl border border-white/10 bg-white/[0.03]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Bluetooth className="w-3.5 h-3.5 text-white/50 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-white/90 truncate block">
                          {bluetoothEnabled ? 'Ready for Connections' : 'Bluetooth Radio Disabled'}
                        </span>
                        <span className="text-[9.5px] font-mono text-[var(--theme-text-secondary)] truncate block">
                          {bluetoothEnabled
                            ? 'Discoverable by nearby devices'
                            : 'Switch radio on to connect'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openExternalUrl('ms-settings:bluetooth')}
                      className="px-2 py-0.5 rounded-lg border border-white/10 text-[9.5px] font-mono text-[var(--theme-text-secondary)] hover:text-white hover:bg-white/10 transition-all cursor-pointer shrink-0 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3 text-[var(--theme-accent)]" />
                      <span>Pair</span>
                    </button>
                  </div>
                )}

                {/* 2x2 Telemetry Grid (Matches Wi-Fi structure) */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="p-2 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)]">
                      Specification
                    </span>
                    <span className="text-xs font-bold font-mono text-white tabular-nums mt-0.5">
                      {bluetoothVersion}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)]">
                      LMP Architecture
                    </span>
                    <span className="text-xs font-bold font-mono text-[var(--theme-accent)] truncate mt-0.5">
                      {bluetoothLmp}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)]">
                      Connected Devices
                    </span>
                    <span className="text-xs font-bold font-mono text-white tabular-nums mt-0.5">
                      {bluetoothConnectedCount} Active / {bluetoothDevices.length} Paired
                    </span>
                  </div>

                  <div className="p-2 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col justify-between relative overflow-hidden">
                    <div className="flex items-center justify-between z-10">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--theme-text-secondary)]">
                        RF Link Activity
                      </span>
                      <span className="text-xs font-bold font-mono text-emerald-400 tabular-nums">
                        {(bluetoothTxKbps + bluetoothRxKbps).toFixed(1)} KB/s
                      </span>
                    </div>
                    <div className="h-3.5 w-full mt-1 z-10 overflow-hidden">
                      <svg
                        className="w-full h-full"
                        viewBox="0 0 180 18"
                        preserveAspectRatio="none"
                      >
                        <polyline
                          points={btSparklineData.polyline}
                          fill="none"
                          stroke="var(--theme-accent)"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Quick Trigger */}
              <div className="pt-1.5 border-t border-white/5 flex items-center justify-between shrink-0">
                <span className="text-[9.5px] font-mono text-[var(--theme-text-secondary)]">
                  {bluetoothDevices.length} paired peripheral
                  {bluetoothDevices.length === 1 ? '' : 's'} registered
                </span>
                <button
                  type="button"
                  onClick={() => setBluetoothDropdownOpen(true)}
                  className="text-[10px] font-mono text-[var(--theme-accent)] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>Manage Devices ({bluetoothDevices.length})</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* UNIFIED BOTTOM CONTROL BAR (HARDWARE TELEMETRY & CONTROLS)                */}
      {/* ========================================================================= */}
      <div
        className="w-full shrink-0 flex items-center justify-between px-3 py-1.5 rounded-xl border border-white/[0.08] backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
        style={{ background: 'var(--theme-card, rgba(255, 255, 255, 0.035))' }}
      >
        {/* Left: Active Connection Summary */}
        <div className="flex items-center gap-2 text-[10.5px] font-mono">
          <Globe className="w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0" />
          <span className="font-semibold text-white tracking-tight truncate max-w-[260px]">
            {activeEthernet
              ? `LAN: ${activeEthernet.ip_address} • ${formatLinkSpeed(activeEthernet.speed_mbps)}`
              : connectedSsid
                ? `Wi-Fi: ${connectedSsid}${wifiBand ? ` • ${wifiBand}` : ''}`
                : primaryConnected
                  ? 'Network Online'
                  : 'Offline'}
          </span>
        </div>

        {/* Right: Mobile Hotspot + Power Plan + Cast + Refresh */}
        <div className="flex items-center gap-1.5">
          {/* Mobile Hotspot Pill Button */}
          <div className="flex items-center rounded-full border border-white/10 p-0.5 bg-white/5">
            <button
              type="button"
              onClick={handleToggleHotspot}
              disabled={isActionInProgress}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-mono transition-all cursor-pointer ${
                hotspotEnabled
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-on-accent)] font-semibold shadow-sm'
                  : 'text-[var(--theme-text-secondary)] hover:text-white'
              }`}
              title={`Mobile Hotspot (${hotspotSsid} • ${hotspotClients} clients)`}
            >
              <Radio className={`w-2.5 h-2.5 ${hotspotEnabled ? 'animate-pulse' : ''}`} />
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
            className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[9.5px] font-mono transition-all pointer-events-auto cursor-pointer ${
              isPowerSaver
                ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-on-accent)] font-semibold'
                : 'border-white/10 hover:border-white/20 text-[var(--theme-text-secondary)] hover:text-white'
            }`}
            title="Toggle Windows Power Plan"
          >
            <Zap className="w-2.5 h-2.5" />
            <span>{isPowerSaver ? 'Power Saver' : 'Performance'}</span>
          </button>

          {/* Cast Screen */}
          <button
            type="button"
            onClick={() => void openExternalUrl('ms-settings:project')}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-white/10 text-[9.5px] font-mono hover:border-white/20 hover:bg-white/5 text-[var(--theme-text-secondary)] hover:text-white transition-all pointer-events-auto cursor-pointer"
            title="Wireless Display / Cast Screen (Win + K)"
          >
            <Cast className="w-2.5 h-2.5" />
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
            className="w-full max-w-sm p-4 rounded-2xl border border-white/15 shadow-2xl flex flex-col gap-3 animate-in zoom-in-95 duration-150"
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
                aria-label="Close hotspot settings"
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
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                    aria-label={hotspotPassVisible ? 'Hide password' : 'Show password'}
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
                  className="px-3.5 py-1 rounded-full text-xs font-semibold bg-[var(--theme-accent)] text-[var(--theme-on-accent)] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
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
