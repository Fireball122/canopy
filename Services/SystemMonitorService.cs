using System.Text;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Canopy.Interop;
using Microsoft.Win32;

namespace Canopy.Services;

public sealed record ProcessSnapshot(
    string name,
    int pid,
    double cpu_usage,
    double memory_mb);

public sealed record InstalledAppSnapshot(
    string id,
    string name,
    string category,
    string path,
    string description,
    string? icon_data_url = null);

public readonly record struct SystemTelemetrySnapshot(
    double CpuUsagePercent,
    double? CpuTempC,
    double? GpuUsagePercent,
    double? GpuTempC,
    double[] CoreUsages,
    IReadOnlyList<ProcessSnapshot> TopProcesses,
    double NetDownKbps,
    double NetUpKbps,
    double RamUsagePercent,
    double RamUsedGb,
    double RamTotalGb,
    double DiskUsagePercent,
    double DiskUsedGb,
    double DiskTotalGb,
    string UptimeFormatted,
    string Hostname,
    string OsName,
    string Username,
    string? GpuName = null,
    string? CpuName = null);

/// <summary>
/// Polls CPU, per-core usage, top processes, GPU/CPU temps, RAM, Disk, Uptime, and Host telemetry.
/// </summary>
public sealed class SystemMonitorService : IDisposable
{
    private PerformanceCounter? _cpuCounter;
    private PerformanceCounter[]? _coreCounters;
    private volatile bool _countersReady;
    private volatile bool _disposed;
    private volatile bool _isPaused;
    private SystemTelemetrySnapshot? _lastSnapshot;

    // Sample() can be reached by overlapping bridge calls (and from any thread); all per-tick delta
    // state it mutates (CPU times, NIC byte maps, counters, last snapshot) is guarded by this gate.
    private readonly object _sampleGate = new();

    public void Pause() => _isPaused = true;
    public void Resume() => _isPaused = false;
    private ulong _prevIdleTime;
    private ulong _prevKernelTime;
    private ulong _prevUserTime;
    private double _lastCpuPercent;

    private double[] _cachedCoreUsages;
    private IReadOnlyList<ProcessSnapshot> _cachedTopProcesses = [];
    private double? _cachedCpuTempC;
    private int _wmiThermalFailures;
    private long _lastHeavySampleTick;
    private int _heavySampleInFlight;
    // Per-adapter byte counters keyed by NetworkInterface.Id. Summing totals over a changing adapter
    // set reported an adapter's whole lifetime traffic as one tick's throughput the moment it came up
    // (VPN connect, Wi-Fi reconnect), producing multi-GB/s spikes.
    private Dictionary<string, (long Rx, long Tx)> _prevNicBytes = new(StringComparer.Ordinal);
    private Dictionary<string, (long Rx, long Tx)> _nextNicBytes = new(StringComparer.Ordinal);
    private long _prevNetTick;
    private double _lastNetDownKbps;
    private double _lastNetUpKbps;
    private IReadOnlyList<InstalledAppSnapshot>? _cachedInstalledApps;
    private readonly Dictionary<int, (TimeSpan TotalTime, long SampleTick)> _processCpuHistory = new();
    private double? _cachedGpuUsage;
    private double? _cachedGpuTempC;
    // GPU Engine instances are per process (pid_N_..._engtype_3D) and churn constantly, so the
    // category is read in one query per heavy tick and diffed against the previous raw samples.
    // Only touched from the serialized heavy-telemetry task.
    private PerformanceCounterCategory? _gpuEngineCategory;
    private Dictionary<string, CounterSample> _prevGpuSamples = new(StringComparer.Ordinal);
    private Dictionary<string, CounterSample> _nextGpuSamples = new(StringComparer.Ordinal);
    private int _gpuPerfFailures;
    private int _gpuWmiFailures;
    private static int s_hardwareNameAttempts;
    private static string? _staticGpuName;
    private static string? _staticCpuName;
    private static readonly string? NvidiaSmiPath = FindNvidiaSmi();
    private static readonly TimeSpan WmiQueryTimeout = TimeSpan.FromSeconds(3);
    private const int MaxTerminalOutputChars = 200_000;

    /// <summary>
    /// Shares the host's process-wide logger so suppressed telemetry failures are recorded
    /// (and stay no-ops) under the same diagnosticLogging switch as the rest of the app.
    /// </summary>
    private static readonly DiagnosticsLog Log = new();

    private static string? FindNvidiaSmi()
    {
        string sys32 = Path.Combine(Environment.SystemDirectory, "nvidia-smi.exe");
        if (File.Exists(sys32)) return sys32;
        string nvsmi = @"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe";
        if (File.Exists(nvsmi)) return nvsmi;
        return null;
    }


    public SystemMonitorService()
    {
        int coreCount = Math.Max(1, Environment.ProcessorCount);
        _cachedCoreUsages = new double[coreCount];
        PrimeSystemTimes();
        PrimeNetworkBytes();
        _ = Task.Run(InitializePerformanceCounters);
        TryStartHeavyRefresh(Environment.TickCount64);
    }

    private void InitializePerformanceCounters()
    {
        PerformanceCounter? cpu = null;
        var cores = new List<PerformanceCounter>();
        try
        {
            cpu = new PerformanceCounter("Processor", "% Processor Time", "_Total", true);
            _ = cpu.NextValue();

            int coreCount = Math.Max(1, Environment.ProcessorCount);
            for (int i = 0; i < coreCount; i++)
            {
                PerformanceCounter? core = TryOpenCoreCounter(i);
                if (core is null)
                    break;
                cores.Add(core);
            }

            lock (_sampleGate)
            {
                if (_disposed)
                {
                    cpu.Dispose();
                    foreach (var c in cores) c.Dispose();
                    return;
                }

                _cpuCounter = cpu;
                if (cores.Count > 0)
                    _coreCounters = cores.ToArray();
                _countersReady = true;
            }
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(InitializePerformanceCounters), ex);
            _countersReady = false;
            // Only reached before the counters are published under the gate, so nothing else owns them.
            cpu?.Dispose();
            foreach (var c in cores) c.Dispose();
        }
    }

    /// <summary>
    /// Opens one per-core counter, trying the Processor instance name then the Processor Information
    /// name. Each failed attempt disposes its own counter; returns null when neither opens.
    /// </summary>
    private static PerformanceCounter? TryOpenCoreCounter(int index)
    {
        PerformanceCounter? counter = null;
        try
        {
            counter = new PerformanceCounter("Processor", "% Processor Time", index.ToString(), true);
            _ = counter.NextValue();
            return counter;
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(TryOpenCoreCounter), ex);
            counter?.Dispose();
        }

        PerformanceCounter? fallback = null;
        try
        {
            fallback = new PerformanceCounter("Processor Information", "% Processor Time", $"0,{index}", true);
            _ = fallback.NextValue();
            return fallback;
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(TryOpenCoreCounter), ex);
            fallback?.Dispose();
            return null;
        }
    }

    /// <summary>
    /// Starts one background heavy-telemetry pass unless one is already running. The pass mutates
    /// non-thread-safe state (<see cref="_processCpuHistory"/>, the GPU sample maps), so it must never
    /// overlap itself — the constructor's initial pass used to bypass this guard and race the first tick.
    /// </summary>
    private void TryStartHeavyRefresh(long nowTick)
    {
        if (Interlocked.CompareExchange(ref _heavySampleInFlight, 1, 0) != 0)
            return;

        _lastHeavySampleTick = nowTick;
        _ = Task.Run(() =>
        {
            try
            {
                RefreshHeavyTelemetry();
            }
            catch (Exception ex)
            {
                Log.WriteException(nameof(RefreshHeavyTelemetry), ex);
            }
            finally
            {
                Interlocked.Exchange(ref _heavySampleInFlight, 0);
            }
        });
    }


    private void PrimeSystemTimes()
    {
        if (Win32.GetSystemTimes(out var idle, out var kernel, out var user))
        {
            _prevIdleTime = idle.ToUInt64();
            _prevKernelTime = kernel.ToUInt64();
            _prevUserTime = user.ToUInt64();
        }
    }

    private void PrimeNetworkBytes()
    {
        ReadNetworkBytes(_prevNicBytes);
        _prevNetTick = Environment.TickCount64;
    }

    private static void ReadNetworkBytes(Dictionary<string, (long Rx, long Tx)> into)
    {
        into.Clear();
        NetworkInterface[] nics;
        try
        {
            nics = NetworkInterface.GetAllNetworkInterfaces();
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(ReadNetworkBytes), ex);
            return;
        }

        foreach (var nic in nics)
        {
            try
            {
                if (nic.OperationalStatus != OperationalStatus.Up ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }
                var stats = nic.GetIPv4Statistics();
                into[nic.Id] = (stats.BytesReceived, stats.BytesSent);
            }
            catch (Exception ex)
            {
                // One adapter failing its stats query must not zero the others.
                Log.WriteException(nameof(ReadNetworkBytes), ex);
            }
        }
    }

    private (double DownKbps, double UpKbps) SampleNetworkKbps()
    {
        long now = Environment.TickCount64;
        long elapsedMs = now - _prevNetTick;
        if (elapsedMs < 350)
        {
            return (_lastNetDownKbps, _lastNetUpKbps);
        }

        ReadNetworkBytes(_nextNicBytes);
        long diffRx = 0;
        long diffTx = 0;
        foreach (var (id, current) in _nextNicBytes)
        {
            // Adapters that just came up have no baseline yet, and a driver reset makes counters go
            // backwards; neither is traffic from this interval.
            if (_prevNicBytes.TryGetValue(id, out var previous))
            {
                diffRx += Math.Max(0L, current.Rx - previous.Rx);
                diffTx += Math.Max(0L, current.Tx - previous.Tx);
            }
        }

        (_prevNicBytes, _nextNicBytes) = (_nextNicBytes, _prevNicBytes);
        _prevNetTick = now;

        double seconds = elapsedMs / 1000.0;
        _lastNetDownKbps = Math.Round((diffRx / 1024.0) / seconds, 1);
        _lastNetUpKbps = Math.Round((diffTx / 1024.0) / seconds, 1);
        return (_lastNetDownKbps, _lastNetUpKbps);
    }

    public SystemTelemetrySnapshot Sample()
    {
        lock (_sampleGate)
        {
            return SampleLocked();
        }
    }

    private SystemTelemetrySnapshot SampleLocked()
    {
        if (_isPaused && _lastSnapshot.HasValue)
            return _lastSnapshot.Value;

        double cpuPercent = Math.Clamp(SampleCpuPercent(), 0.0, 100.0);
        (double usedGb, double totalGb, double ramPercent) = SampleMemory();
        (double diskUsedGb, double diskTotalGb, double diskPercent) = SampleDisk();
        (double netDownKbps, double netUpKbps) = SampleNetworkKbps();

        long nowTick = Environment.TickCount64;
        if (nowTick - _lastHeavySampleTick > 2500)
        {
            TryStartHeavyRefresh(nowTick);
        }

        double[] coreUsages = SampleCoreUsages(cpuPercent);
        double? cpuTemp = _cachedCpuTempC is double t ? Math.Round(t, 1) : null;
        long uptimeSecs = Environment.TickCount64 / 1000L;
        long hours = uptimeSecs / 3600L;
        long minutes = (uptimeSecs % 3600L) / 60L;
        string uptimeFormatted = $"up {hours} hours, {minutes} minutes";

        string hostname = Environment.MachineName;
        string username = Environment.UserName;

        var snapshot = new SystemTelemetrySnapshot(
            CpuUsagePercent: cpuPercent,
            CpuTempC: cpuTemp,
            GpuUsagePercent: _cachedGpuUsage,
            GpuTempC: _cachedGpuTempC,
            CoreUsages: coreUsages,
            TopProcesses: _cachedTopProcesses,
            NetDownKbps: netDownKbps,
            NetUpKbps: netUpKbps,
            RamUsagePercent: Math.Clamp(ramPercent, 0.0, 100.0),
            RamUsedGb: usedGb,
            RamTotalGb: totalGb,
            DiskUsagePercent: Math.Clamp(diskPercent, 0.0, 100.0),
            DiskUsedGb: diskUsedGb,
            DiskTotalGb: diskTotalGb,
            UptimeFormatted: uptimeFormatted,
            Hostname: hostname,
            OsName: Environment.OSVersion.Version.Build >= 22000 ? "Windows 11" : "Windows 10",
            Username: username,
            GpuName: _staticGpuName,
            CpuName: _staticCpuName);
        _lastSnapshot = snapshot;
        return snapshot;
    }

    private double[] SampleCoreUsages(double overallCpu)
    {
        var counters = _coreCounters;
        if (_countersReady && counters is { Length: > 0 })
        {
            try
            {
                var values = new double[counters.Length];
                for (int i = 0; i < counters.Length; i++)
                {
                    values[i] = Math.Round(Math.Clamp(counters[i].NextValue(), 0f, 100f), 1);
                }
                _cachedCoreUsages = values;
                return values;
            }
            catch (Exception ex)
            {
                Log.WriteException(nameof(SampleCoreUsages), ex);
            }
        }

        int count = _cachedCoreUsages.Length;
        var fallback = new double[count];
        for (int i = 0; i < count; i++)
        {
            fallback[i] = Math.Round(Math.Clamp(overallCpu, 0.0, 100.0), 1);
        }
        return fallback;
    }

    private void RefreshHeavyTelemetry()
    {
        if (_disposed || _isPaused)
            return;

        try
        {
            var procs = Process.GetProcesses();
            var top = new List<ProcessSnapshot>(procs.Length);
            long nowTick = Environment.TickCount64;
            int coreCount = Math.Max(1, Environment.ProcessorCount);
            var currentPids = new HashSet<int>();

            foreach (var p in procs)
            {
                try
                {
                    if (p.Id == 0) continue;
                    string name = p.ProcessName;
                    if (string.IsNullOrWhiteSpace(name)) continue;
                    currentPids.Add(p.Id);
                    double memMb = Math.Round(p.WorkingSet64 / (1024.0 * 1024.0), 1);

                    double cpuPercent = 0.0;
                    try
                    {
                        var totalTime = p.TotalProcessorTime;
                        if (_processCpuHistory.TryGetValue(p.Id, out var prev))
                        {
                            double deltaMs = nowTick - prev.SampleTick;
                            if (deltaMs > 250)
                            {
                                double cpuDeltaMs = (totalTime - prev.TotalTime).TotalMilliseconds;
                                cpuPercent = Math.Round(Math.Clamp((cpuDeltaMs / (deltaMs * coreCount)) * 100.0, 0.0, 100.0), 1);
                            }
                        }
                        _processCpuHistory[p.Id] = (totalTime, nowTick);
                    }
                    catch (Exception ex)
                    {
                        Log.WriteException("ProcessCpuTime", ex);
                        cpuPercent = 0.0;
                    }

                    top.Add(new ProcessSnapshot(name, p.Id, cpuPercent, memMb));
                }
                catch (Exception ex)
                {
                    Log.WriteException("ProcessSample", ex);
                }
                finally
                {
                    p.Dispose();
                }
            }

            if (_processCpuHistory.Count > 600)
            {
                var stale = _processCpuHistory.Keys.Where(pid => !currentPids.Contains(pid)).ToList();
                foreach (var pid in stale) _processCpuHistory.Remove(pid);
            }

            var topProcesses = top
                .OrderByDescending(x => x.cpu_usage)
                .ThenByDescending(x => x.memory_mb)
                .Take(5)
                .ToList();
            lock (_sampleGate) _cachedTopProcesses = topProcesses;
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(RefreshHeavyTelemetry), ex);
        }

        if (_wmiThermalFailures < 3)
        {
            try
            {
                using var searcher = CreateWmiSearcher(@"root\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature");
                using ManagementObjectCollection results = searcher.Get();
                bool foundTemp = false;
                foreach (ManagementObject obj in results)
                {
                    using (obj)
                    {
                        double kelvinTenths = Convert.ToDouble(obj["CurrentTemperature"]);
                        double celsius = (kelvinTenths / 10.0) - 273.15;
                        if (celsius is > 15.0 and < 115.0)
                        {
                            lock (_sampleGate) _cachedCpuTempC = celsius;
                            foundTemp = true;
                            _wmiThermalFailures = 0;
                            break;
                        }
                    }
                }
                if (!foundTemp)
                {
                    _wmiThermalFailures++;
                    lock (_sampleGate) _cachedCpuTempC = null;
                }
            }
            catch (Exception ex)
            {
                // Usually access denied (the class needs elevation); gives up after three attempts.
                Log.WriteException("ThermalZoneQuery", ex);
                _wmiThermalFailures++;
                lock (_sampleGate) _cachedCpuTempC = null;
            }
        }
        RefreshGpuTelemetry();
    }

    private static ManagementObjectSearcher CreateWmiSearcher(string scope, string query) =>
        // A wedged WMI provider otherwise blocks enumeration forever, which pinned the heavy-sample
        // in-flight flag and froze top processes / GPU telemetry for the rest of the session.
        new(scope, query, new System.Management.EnumerationOptions
        {
            Timeout = WmiQueryTimeout,
            ReturnImmediately = true,
            Rewindable = false,
        });

    private void RefreshGpuTelemetry()
    {
        // Names used to be resolved only after every usage source had failed, so machines where NVML
        // or the GPU Engine counters work never reported a CPU or GPU name.
        EnsureHardwareNames();

        // NVML is the only non-spawning source of GPU temperature; null when no NVIDIA driver is present.
        double? gpuTemp = NvmlGpu.TryReadTemperatureCelsius();
        lock (_sampleGate) _cachedGpuTempC = gpuTemp;

        double? nvmlUsage = NvmlGpu.TryReadUtilizationPercent();
        if (nvmlUsage.HasValue)
        {
            lock (_sampleGate) _cachedGpuUsage = Math.Clamp(Math.Round(nvmlUsage.Value, 1), 0.0, 100.0);
            return;
        }

        if (_gpuPerfFailures < 3 && TrySampleGpuEngineCounters())
            return;

        // The WMI class is backed by the same provider; stop hammering it once it keeps failing.
        if (_gpuWmiFailures >= 3)
            return;

        try
        {
            using var searcher = CreateWmiSearcher(@"root\CIMV2", "SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine WHERE Name LIKE '%engtype_3D%'");
            using ManagementObjectCollection results = searcher.Get();
            double sum = 0.0;
            int count = 0;
            foreach (ManagementObject obj in results)
            {
                using (obj)
                {
                    if (double.TryParse(obj["UtilizationPercentage"]?.ToString(), System.Globalization.CultureInfo.InvariantCulture, out double util))
                    {
                        sum += util;
                        count++;
                    }
                }
            }
            if (count > 0)
            {
                lock (_sampleGate) _cachedGpuUsage = Math.Clamp(Math.Round(sum, 1), 0.0, 100.0);
                _gpuWmiFailures = 0;
            }
            else
            {
                _gpuWmiFailures++;
            }
        }
        catch (Exception ex)
        {
            _gpuWmiFailures++;
            Log.WriteException("GpuUtilisationQuery", ex);
        }
    }

    /// <summary>
    /// Sums 3D-engine utilisation across every live GPU Engine instance from a single category read.
    /// The previous design primed one PerformanceCounter per instance at startup: instances belonging
    /// to processes launched later were never counted, and the first exited process made NextValue
    /// throw on every tick, permanently dropping to the WMI fallback.
    /// </summary>
    /// <returns>True when the category was readable (usage is updated once a baseline exists).</returns>
    private bool TrySampleGpuEngineCounters()
    {
        try
        {
            _gpuEngineCategory ??= new PerformanceCounterCategory("GPU Engine");
            InstanceDataCollection? utilization = _gpuEngineCategory.ReadCategory()["Utilization Percentage"];
            if (utilization is null)
            {
                _gpuPerfFailures++;
                return false;
            }

            _nextGpuSamples.Clear();
            double total = 0.0;
            bool hasBaseline = false;
            foreach (InstanceData instance in utilization.Values)
            {
                string name = instance.InstanceName;
                if (!name.EndsWith("engtype_3D", StringComparison.OrdinalIgnoreCase))
                    continue;

                CounterSample sample = instance.Sample;
                _nextGpuSamples[name] = sample;
                if (_prevGpuSamples.TryGetValue(name, out CounterSample previous))
                {
                    total += CounterSample.Calculate(previous, sample);
                    hasBaseline = true;
                }
            }

            (_prevGpuSamples, _nextGpuSamples) = (_nextGpuSamples, _prevGpuSamples);
            if (_prevGpuSamples.Count == 0)
            {
                _gpuPerfFailures++;
                return false;
            }

            _gpuPerfFailures = 0;
            if (hasBaseline)
            {
                lock (_sampleGate) _cachedGpuUsage = Math.Clamp(Math.Round(total, 1), 0.0, 100.0);
            }
            return true;
        }
        catch (Exception ex)
        {
            _gpuPerfFailures++;
            Log.WriteException(nameof(TrySampleGpuEngineCounters), ex);
            return false;
        }
    }

    private static void EnsureHardwareNames()
    {
        if ((!string.IsNullOrWhiteSpace(_staticGpuName) && !string.IsNullOrWhiteSpace(_staticCpuName)) ||
            s_hardwareNameAttempts >= 3)
        {
            return;
        }
        s_hardwareNameAttempts++;

        if (string.IsNullOrWhiteSpace(_staticGpuName))
        {
            try
            {
                using var searcher = CreateWmiSearcher(@"root\CIMV2", "SELECT Name FROM Win32_VideoController");
                using ManagementObjectCollection results = searcher.Get();
                foreach (ManagementObject obj in results)
                {
                    using (obj)
                    {
                        string? name = obj["Name"]?.ToString();
                        if (!string.IsNullOrWhiteSpace(name) && !name.Contains("Basic", StringComparison.OrdinalIgnoreCase))
                        {
                            _staticGpuName = name.Trim();
                            break;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log.WriteException("GpuNameQuery", ex);
            }
        }

        if (string.IsNullOrWhiteSpace(_staticCpuName))
        {
            // Registry read first: same string as Win32_Processor.Name without a WMI round trip.
            _ = GetFastCpuName();
        }

        if (string.IsNullOrWhiteSpace(_staticCpuName))
        {
            try
            {
                using var searcher = CreateWmiSearcher(@"root\CIMV2", "SELECT Name FROM Win32_Processor");
                using ManagementObjectCollection results = searcher.Get();
                foreach (ManagementObject obj in results)
                {
                    using (obj)
                    {
                        _staticCpuName = obj["Name"]?.ToString()?.Trim();
                        if (!string.IsNullOrWhiteSpace(_staticCpuName)) break;
                    }
                }
            }
            catch (Exception ex)
            {
                Log.WriteException("CpuNameQuery", ex);
            }
        }
    }
    private static string GetDefaultBrowserProgId()
    {
        try
        {
            using RegistryKey? key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice");
            return key?.GetValue("ProgId")?.ToString() ?? string.Empty;
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(GetDefaultBrowserProgId), ex);
            return string.Empty;
        }
    }

    private static bool IsBrowserIdentifier(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return false;

        string lower = text.ToLowerInvariant();
        return lower.Contains("brave") ||
               lower.Contains("brave.exe") ||
               lower.Contains("bravehtml") ||
               lower.Contains("zen") ||
               lower.Contains("arc") ||
               lower.Contains("vivaldi") ||
               lower.Contains("opera") ||
               lower.Contains("chrome") ||
               lower.Contains("firefox") ||
               lower.Contains("msedge") ||
               lower.Contains("waterfox") ||
               lower.Contains("librewolf");
    }

    private static bool MatchesDefaultBrowserProgId(string appNameOrPath, string progId)
    {
        if (string.IsNullOrWhiteSpace(progId) || string.IsNullOrWhiteSpace(appNameOrPath))
            return false;

        string p = progId.ToLowerInvariant();
        string a = appNameOrPath.ToLowerInvariant();

        if (p.Contains("brave") && a.Contains("brave")) return true;
        if (p.Contains("chrome") && a.Contains("chrome")) return true;
        if (p.Contains("msedge") && (a.Contains("edge") || a.Contains("msedge"))) return true;
        if (p.Contains("firefox") && a.Contains("firefox")) return true;
        if (p.Contains("vivaldi") && a.Contains("vivaldi")) return true;
        if (p.Contains("opera") && a.Contains("opera")) return true;
        if (p.Contains("arc") && a.Contains("arc")) return true;
        if (p.Contains("zen") && a.Contains("zen")) return true;
        return false;
    }

    private static string ClassifyAppCategory(string name, string path, string parentFolder)
    {
        string combined = $"{name} {path} {parentFolder}".ToLowerInvariant();
        if (IsBrowserIdentifier(combined))
            return "Browser";

        if (combined.Contains("code") || combined.Contains("visual studio") || combined.Contains("git") ||
            combined.Contains("wsl") || combined.Contains("terminal") || combined.Contains("powershell") ||
            combined.Contains("docker") || combined.Contains("python") || combined.Contains("node"))
        {
            return "Developer";
        }

        if (combined.Contains("cura") || combined.Contains("prusa") || combined.Contains("dwg") ||
            combined.Contains("paint") || combined.Contains("blender") || combined.Contains("obs") ||
            combined.Contains("photoshop") || combined.Contains("gimp") || combined.Contains("vlc") ||
            combined.Contains("media player"))
        {
            return "Creative";
        }

        if (combined.Contains("word") || combined.Contains("excel") || combined.Contains("powerpoint") ||
            combined.Contains("outlook") || combined.Contains("onenote") || combined.Contains("access") ||
            combined.Contains("publisher") || combined.Contains("sticky notes") || combined.Contains("notepad") ||
            combined.Contains("notion") || combined.Contains("obsidian"))
        {
            return "Productivity";
        }

        if (combined.Contains("angry ip") || combined.Contains("tailscale") || combined.Contains("localsend") ||
            combined.Contains("nextcloud") || combined.Contains("google drive") || combined.Contains("spacedesk") ||
            combined.Contains("calc") || combined.Contains("snipping") || combined.Contains("7-zip") ||
            combined.Contains("powertoys"))
        {
            return "Utilities";
        }

        if (string.IsNullOrWhiteSpace(parentFolder) ||
            string.Equals(parentFolder, "Programs", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(parentFolder, "Start Menu", StringComparison.OrdinalIgnoreCase))
        {
            return "System";
        }

        return parentFolder;
    }

    public Task<IReadOnlyList<InstalledAppSnapshot>> GetInstalledAppsAsync(bool forceRefresh = false)
    {
        if (!forceRefresh && _cachedInstalledApps is { Count: > 0 })
            return Task.FromResult(_cachedInstalledApps);

        return Task.Run<IReadOnlyList<InstalledAppSnapshot>>(() =>
        {
            string defaultProgId = GetDefaultBrowserProgId();
            string sysDir = Environment.SystemDirectory;
            string winDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localWinApps = Path.Combine(localAppData, "Microsoft", "WindowsApps");

            var apps = new List<InstalledAppSnapshot>();
            var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // 1. Check explicit Brave Browser installations (%LocalAppData%, %ProgramFiles%, %ProgramFiles(x86)%)
            string[] braveCandidates =
            [
                Path.Combine(localAppData, @"BraveSoftware\Brave-Browser\Application\brave.exe"),
                Path.Combine(progFiles, @"BraveSoftware\Brave-Browser\Application\brave.exe"),
                Path.Combine(progFilesX86, @"BraveSoftware\Brave-Browser\Application\brave.exe")
            ];

            string? braveExe = braveCandidates.FirstOrDefault(File.Exists);
            if (!string.IsNullOrWhiteSpace(braveExe))
            {
                bool isDefaultBrave = MatchesDefaultBrowserProgId("Brave", defaultProgId);
                string? braveIcon = TryExtractIconDataUrl(braveExe);
                apps.Add(new InstalledAppSnapshot(
                    id: "brave",
                    name: "Brave",
                    category: "Browser",
                    path: braveExe,
                    description: isDefaultBrave ? "Default Web Browser (BraveHTML)" : "Privacy web browser",
                    icon_data_url: braveIcon));
                seenNames.Add("Brave");
                seenNames.Add("Brave Browser");
            }

            // 2. Scan both Start Menu trees (%ProgramData% & %AppData%)
            string[] startMenuRoots =
            [
                Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
                Environment.GetFolderPath(Environment.SpecialFolder.Programs)
            ];

            foreach (string root in startMenuRoots)
            {
                if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                    continue;

                try
                {
                    foreach (string lnk in Directory.EnumerateFiles(root, "*.lnk", SearchOption.AllDirectories))
                    {
                        string name = Path.GetFileNameWithoutExtension(lnk);
                        if (string.IsNullOrWhiteSpace(name) ||
                            name.Contains("Uninstall", StringComparison.OrdinalIgnoreCase) ||
                            name.Contains("Readme", StringComparison.OrdinalIgnoreCase) ||
                            name.Contains("Help", StringComparison.OrdinalIgnoreCase) ||
                            !seenNames.Add(name))
                        {
                            continue;
                        }

                        string parentFolder = Path.GetFileName(Path.GetDirectoryName(lnk) ?? string.Empty);
                        string category = ClassifyAppCategory(name, lnk, parentFolder);
                        bool isDefaultBrowser = category == "Browser" && MatchesDefaultBrowserProgId($"{name} {lnk}", defaultProgId);
                        string desc = isDefaultBrowser
                            ? $"Default Web Browser ({defaultProgId})"
                            : category == "Browser"
                                ? "Web browser"
                                : $"{category} application";

                        string? iconDataUrl = TryExtractIconDataUrl(lnk);

                        apps.Add(new InstalledAppSnapshot(
                            id: name.ToLowerInvariant().Replace(' ', '-'),
                            name: name,
                            category: category,
                            path: lnk,
                            description: desc,
                            icon_data_url: iconDataUrl));
                    }
                }
                catch (Exception ex)
                {
                    Log.WriteException("StartMenuScan", ex);
                }
            }

            // 3. Ensure core Windows tools are present
            var builtInSpecs = new (string Id, string Name, string Category, string LaunchTarget, string IconCandidate, string Desc)[]
            {
                ("wt", "Windows Terminal", "Developer", "wt.exe", Path.Combine(localWinApps, "wt.exe"), "Modern command line & shells"),
                ("explorer", "File Explorer", "System", "explorer.exe", Path.Combine(winDir, "explorer.exe"), "Browse folders & drives"),
                ("taskmgr", "Task Manager", "System", "taskmgr.exe", Path.Combine(sysDir, "Taskmgr.exe"), "Performance & active processes"),
                ("notepad", "Notepad", "Productivity", "notepad.exe", Path.Combine(sysDir, "notepad.exe"), "Text & quick notes"),
                ("calc", "Calculator", "Utilities", "calc.exe", Path.Combine(sysDir, "calc.exe"), "Standard & scientific calculator"),
                ("mspaint", "Paint", "Creative", "mspaint.exe", Path.Combine(sysDir, "mspaint.exe"), "Image canvas & editor"),
                ("snippingtool", "Snipping Tool", "Utilities", "SnippingTool.exe", Path.Combine(sysDir, "SnippingTool.exe"), "Screen capture utility"),
                ("powershell", "PowerShell", "Developer", "powershell.exe", Path.Combine(sysDir, "WindowsPowerShell", "v1.0", "powershell.exe"), "Windows automation shell"),
                ("control", "Control Panel", "System", "control.exe", Path.Combine(sysDir, "control.exe"), "Classic system applets"),
                ("settings", "Windows Settings", "System", "ms-settings:", Path.Combine(sysDir, "control.exe"), "System configuration")
            };

            foreach (var spec in builtInSpecs)
            {
                if (!seenNames.Add(spec.Name))
                    continue;

                string? iconUrl = TryExtractIconDataUrl(spec.IconCandidate) ?? TryExtractIconDataUrl(spec.LaunchTarget);
                apps.Add(new InstalledAppSnapshot(
                    spec.Id,
                    spec.Name,
                    spec.Category,
                    spec.LaunchTarget,
                    spec.Desc,
                    iconUrl));
            }

            _cachedInstalledApps = apps;
            return apps;
        });
    }

    private static string? TryExtractIconDataUrl(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;

        IntPtr hIcon = IntPtr.Zero;
        try
        {
            var shinfo = new Win32.SHFILEINFOW();
            uint flags = Win32.SHGFI_ICON | Win32.SHGFI_LARGEICON;
            if (!File.Exists(path) && !Directory.Exists(path))
            {
                flags |= Win32.SHGFI_USEFILEATTRIBUTES;
            }

            IntPtr res = Win32.SHGetFileInfoW(
                path,
                0,
                ref shinfo,
                (uint)Marshal.SizeOf<Win32.SHFILEINFOW>(),
                flags);

            if (res == IntPtr.Zero || shinfo.hIcon == IntPtr.Zero)
                return null;

            hIcon = shinfo.hIcon;
            BitmapSource bmp = Imaging.CreateBitmapSourceFromHIcon(
                hIcon,
                Int32Rect.Empty,
                BitmapSizeOptions.FromEmptyOptions());
            bmp.Freeze();

            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bmp));
            using var ms = new MemoryStream();
            encoder.Save(ms);
            return $"data:image/png;base64,{Convert.ToBase64String(ms.ToArray())}";
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(TryExtractIconDataUrl), ex);
            return null;
        }
        finally
        {
            if (hIcon != IntPtr.Zero)
            {
                _ = Win32.DestroyIcon(hIcon);
            }
        }
    }

    public static bool LaunchApp(string? target)
    {
        if (string.IsNullOrWhiteSpace(target))
            return false;

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = target.Trim(),
                UseShellExecute = true
            });
            return true;
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(LaunchApp), ex);
            return false;
        }
    }

    private static (double UsedGb, double TotalGb, double Percent) SampleDisk()
    {
        try
        {
            string systemRoot = Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\";
            var drive = new DriveInfo(systemRoot);
            if (drive.IsReady && drive.TotalSize > 0)
            {
                const double bytesPerGb = 1024.0 * 1024.0 * 1024.0;
                double totalGb = drive.TotalSize / bytesPerGb;
                double availGb = drive.AvailableFreeSpace / bytesPerGb;
                double usedGb = Math.Max(0.0, totalGb - availGb);
                double percent = (usedGb / totalGb) * 100.0;
                return (usedGb, totalGb, percent);
            }
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(SampleDisk), ex);
        }

        // Unknown, not invented: the UI renders zeros instead of a plausible-looking fake drive.
        return (0.0, 0.0, 0.0);
    }

    private double SampleCpuPercent()
    {
        if (_countersReady && _cpuCounter is not null)
        {
            try
            {
                float raw = _cpuCounter.NextValue();
                _lastCpuPercent = Math.Clamp(raw, 0f, 100f);
                return _lastCpuPercent;
            }
            catch (Exception ex)
            {
                Log.WriteException(nameof(SampleCpuPercent), ex);
            }
        }

        if (Win32.GetSystemTimes(out var idle, out var kernel, out var user))
        {
            ulong idleTicks = idle.ToUInt64();
            ulong kernelTicks = kernel.ToUInt64();
            ulong userTicks = user.ToUInt64();

            ulong idleDiff = idleTicks - _prevIdleTime;
            ulong totalDiff = (kernelTicks - _prevKernelTime) + (userTicks - _prevUserTime);

            _prevIdleTime = idleTicks;
            _prevKernelTime = kernelTicks;
            _prevUserTime = userTicks;

            if (totalDiff > 0)
            {
                double busyRatio = 1.0 - ((double)idleDiff / totalDiff);
                _lastCpuPercent = Math.Clamp(busyRatio * 100.0, 0.0, 100.0);
            }
        }

        return _lastCpuPercent;
    }

    private static (double UsedGb, double TotalGb, double Percent) SampleMemory()
    {
        // ullAvailPhys is the same "Available" figure the Memory\Available MBytes counter reports,
        // without a second performance-data query on every tick.
        var memStatus = Win32.MEMORYSTATUSEX.Create();
        if (Win32.GlobalMemoryStatusEx(ref memStatus) && memStatus.ullTotalPhys > 0)
        {
            const double bytesPerGb = 1024.0 * 1024.0 * 1024.0;
            double totalGb = memStatus.ullTotalPhys / bytesPerGb;
            double availGb = memStatus.ullAvailPhys / bytesPerGb;
            double usedGb = Math.Max(0.0, totalGb - availGb);
            double percent = (usedGb / totalGb) * 100.0;
            return (usedGb, totalGb, percent);
        }

        return (0.0, 0.0, 0.0);
    }

    private static string GetFastCpuName()
    {
        if (!string.IsNullOrWhiteSpace(_staticCpuName)) return _staticCpuName;
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
            string? name = key?.GetValue("ProcessorNameString")?.ToString();
            if (!string.IsNullOrWhiteSpace(name))
            {
                _staticCpuName = System.Text.RegularExpressions.Regex.Replace(name.Trim(), @"\s+", " ");
                return _staticCpuName;
            }
        }
        catch (Exception ex) { Log.WriteException(nameof(GetFastCpuName), ex); }
        return "AMD/Intel x64 Processor";
    }

    private static string GetFastGpuName()
    {
        if (!string.IsNullOrWhiteSpace(_staticGpuName)) return _staticGpuName;
        if (NvidiaSmiPath is not null)
        {
            try
            {
                var psi = new ProcessStartInfo(NvidiaSmiPath, "--query-gpu=name --format=csv,noheader")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var proc = Process.Start(psi);
                if (proc is not null)
                {
                    // The name line is far below the pipe buffer size, so waiting before reading cannot
                    // deadlock; an unbounded ReadToEnd used to hang forever on a wedged driver.
                    if (!proc.WaitForExit(3000))
                    {
                        try { proc.Kill(); } catch (Exception killEx) { Log.WriteException("NvidiaSmiKill", killEx); }
                    }
                    else
                    {
                        string outName = proc.StandardOutput.ReadToEnd().Split('\n', 2)[0].Trim();
                        if (!string.IsNullOrWhiteSpace(outName))
                        {
                            _staticGpuName = outName;
                            return _staticGpuName;
                        }
                    }
                }
            }
            catch (Exception ex) { Log.WriteException(nameof(GetFastGpuName), ex); }
        }

        try
        {
            using var baseKey = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}");
            if (baseKey is not null)
            {
                foreach (string sub in baseKey.GetSubKeyNames())
                {
                    if (sub.Length == 4 && char.IsDigit(sub[0]))
                    {
                        using var cardKey = baseKey.OpenSubKey(sub);
                        string? desc = cardKey?.GetValue("DriverDesc") as string;
                        if (!string.IsNullOrWhiteSpace(desc) &&
                            !desc.Contains("Basic", StringComparison.OrdinalIgnoreCase) &&
                            !desc.Contains("Virtual", StringComparison.OrdinalIgnoreCase))
                        {
                            _staticGpuName = desc.Trim();
                            return _staticGpuName;
                        }
                    }
                }
            }
        }
        catch (Exception ex) { Log.WriteException(nameof(GetFastGpuName), ex); }

        return "DirectX 3D Video Controller";
    }

    public static string GenerateFastfetchOutput()
    {
        long upSecs = Environment.TickCount64 / 1000L;
        long hours = upSecs / 3600L;
        long minutes = (upSecs % 3600L) / 60L;

        string cpu = GetFastCpuName();
        string gpu = GetFastGpuName();
        string user = Environment.UserName;
        string host = Environment.MachineName;
        string sep = new string('-', Math.Max(12, user.Length + host.Length + 1));
        char e = (char)27;
        string osName = Environment.OSVersion.Version.Build >= 22000 ? "Windows 11" : "Windows 10";
        return $"""
                 ______        {user}@{host}
                /      \       {sep}
               /   /\   \      OS      : {osName} ({Environment.OSVersion.Version.Build}) x64
              /   /  \   \     Host    : {host} (Canopy Control Center)
             /   /    \   \    Uptime  : {hours}h {minutes}m
            /   /  /\  \   \   CPU     : {cpu} ({Environment.ProcessorCount} threads)
           /___/  /  \  \___\  GPU     : {gpu}
                 /    \        Runtime : .NET {Environment.Version} + WebView2
                /______\       Shell   : Canopy PowerShell v2.0
                               Palette : {e}[31m███{e}[0m {e}[32m███{e}[0m {e}[33m███{e}[0m {e}[34m███{e}[0m {e}[35m███{e}[0m {e}[36m███{e}[0m {e}[37m███{e}[0m
         """;
    }

    public static async Task<string> RunTerminalCommandAsync(string command)
    {
        if (string.IsNullOrWhiteSpace(command))
            return string.Empty;

        string trimmed = command.Trim();
        if (string.Equals(trimmed, "fastfetch", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "neofetch", StringComparison.OrdinalIgnoreCase))
        {
            // Off the caller's thread: the bridge dispatcher runs on the WPF UI thread, and the GPU
            // name lookup may spawn nvidia-smi and walk the display-class registry.
            return await Task.Run(GenerateFastfetchOutput);
        }

        Process? proc = null;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            byte[] bytes = Encoding.Unicode.GetBytes(trimmed);
            string encoded = Convert.ToBase64String(bytes);

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -EncodedCommand {encoded}",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            proc = Process.Start(psi);
            if (proc is null)
                return "Failed to start PowerShell process.";

            Task<string> stdoutTask = proc.StandardOutput.ReadToEndAsync(cts.Token);
            Task<string> stderrTask = proc.StandardError.ReadToEndAsync(cts.Token);

            // Both pipes must drain at once: reading one to completion first can deadlock a child
            // that fills the other pipe's buffer.
            await Task.WhenAll(stdoutTask, stderrTask);
            await proc.WaitForExitAsync(cts.Token);

            string stdout = await stdoutTask;
            string stderr = await stderrTask;

            string combined = string.IsNullOrWhiteSpace(stderr)
                ? stdout.TrimEnd()
                : $"{stdout.TrimEnd()}\n{stderr.TrimEnd()}".Trim();

            // A chatty command (recursive listings) can emit tens of MB in 8 s; posting all of it to
            // the WebView freezes the terminal view.
            if (combined.Length > MaxTerminalOutputChars)
            {
                combined = string.Concat(combined.AsSpan(0, MaxTerminalOutputChars), "\n… (output truncated)");
            }

            return string.IsNullOrWhiteSpace(combined) ? "(Command completed with no output)" : combined;
        }
        catch (OperationCanceledException)
        {
            try { proc?.Kill(entireProcessTree: true); } catch (Exception killEx) { Log.WriteException("TerminalTimeoutKill", killEx); }
            return "Error: Command timed out after 8 seconds.";
        }
        catch (Exception ex)
        {
            try { proc?.Kill(entireProcessTree: true); } catch (Exception killEx) { Log.WriteException("TerminalErrorKill", killEx); }
            return $"Error: {ex.Message}";
        }
        finally
        {
            proc?.Dispose();
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
        _countersReady = false;

        try
        {
            lock (_sampleGate)
            {
                _cpuCounter?.Dispose();
                if (_coreCounters is not null)
                {
                    foreach (var c in _coreCounters) c.Dispose();
                }
            }
        }
        catch (Exception ex)
        {
            Log.WriteException(nameof(Dispose), ex);
        }
    }
}
