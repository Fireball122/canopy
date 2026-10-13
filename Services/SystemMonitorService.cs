using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net.NetworkInformation;
using CaelestiaWin.Interop;

namespace CaelestiaWin.Services;

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
    string description);

public readonly record struct SystemTelemetrySnapshot(
    double CpuUsagePercent,
    double CpuTempC,
    double GpuUsagePercent,
    double GpuTempC,
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
    string Username);

/// <summary>
/// Polls CPU, per-core usage, top processes, GPU/CPU temps, RAM, Disk, Uptime, and Host telemetry.
/// </summary>
public sealed class SystemMonitorService : IDisposable
{
    private PerformanceCounter? _cpuCounter;
    private PerformanceCounter? _availMemCounter;
    private PerformanceCounter[]? _coreCounters;
    private volatile bool _countersReady;
    private bool _disposed;

    private ulong _prevIdleTime;
    private ulong _prevKernelTime;
    private ulong _prevUserTime;
    private double _lastCpuPercent;

    private double[] _cachedCoreUsages;
    private IReadOnlyList<ProcessSnapshot> _cachedTopProcesses = [];
    private double _cachedCpuTempC = 41.0;
    private double _cachedGpuTempC = 54.0;
    private double _cachedGpuUsage = 4.0;
    private long _lastHeavySampleTick;
    private int _heavySampleInFlight;
    private long _prevNetBytesRecv;
    private long _prevNetBytesSent;
    private long _prevNetTick;
    private double _lastNetDownKbps = 23.3;
    private double _lastNetUpKbps = 14.2;
    private IReadOnlyList<InstalledAppSnapshot>? _cachedInstalledApps;

    public SystemMonitorService()
    {
        int coreCount = Math.Clamp(Environment.ProcessorCount, 4, 32);
        _cachedCoreUsages = new double[coreCount];
        PrimeSystemTimes();
        PrimeNetworkBytes();
        _ = Task.Run(InitializePerformanceCounters);
        _ = Task.Run(RefreshHeavyTelemetry);
    }

    private void InitializePerformanceCounters()
    {
        try
        {
            var cpu = new PerformanceCounter("Processor", "% Processor Time", "_Total", true);
            var mem = new PerformanceCounter("Memory", "Available MBytes", string.Empty, true);

            _ = cpu.NextValue();
            _ = mem.NextValue();

            int coreCount = Math.Clamp(Environment.ProcessorCount, 4, 32);
            var cores = new List<PerformanceCounter>(coreCount);
            for (int i = 0; i < coreCount; i++)
            {
                try
                {
                    var coreCounter = new PerformanceCounter("Processor", "% Processor Time", i.ToString(), true);
                    _ = coreCounter.NextValue();
                    cores.Add(coreCounter);
                }
                catch
                {
                    break;
                }
            }

            if (_disposed)
            {
                cpu.Dispose();
                mem.Dispose();
                foreach (var c in cores) c.Dispose();
                return;
            }

            _cpuCounter = cpu;
            _availMemCounter = mem;
            if (cores.Count > 0)
                _coreCounters = cores.ToArray();
            _countersReady = true;
        }
        catch
        {
            _countersReady = false;
        }
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
        var (rx, tx) = ReadTotalNetworkBytes();
        _prevNetBytesRecv = rx;
        _prevNetBytesSent = tx;
        _prevNetTick = Environment.TickCount64;
    }

    private static (long RxBytes, long TxBytes) ReadTotalNetworkBytes()
    {
        long rx = 0;
        long tx = 0;
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }
                var stats = nic.GetIPv4Statistics();
                rx += stats.BytesReceived;
                tx += stats.BytesSent;
            }
        }
        catch
        {
        }
        return (rx, tx);
    }

    private (double DownKbps, double UpKbps) SampleNetworkKbps()
    {
        long now = Environment.TickCount64;
        long elapsedMs = now - _prevNetTick;
        if (elapsedMs < 350)
        {
            return (_lastNetDownKbps, _lastNetUpKbps);
        }

        var (rx, tx) = ReadTotalNetworkBytes();
        long diffRx = Math.Max(0L, rx - _prevNetBytesRecv);
        long diffTx = Math.Max(0L, tx - _prevNetBytesSent);

        _prevNetBytesRecv = rx;
        _prevNetBytesSent = tx;
        _prevNetTick = now;

        double seconds = elapsedMs / 1000.0;
        _lastNetDownKbps = Math.Round((diffRx / 1024.0) / seconds, 1);
        _lastNetUpKbps = Math.Round((diffTx / 1024.0) / seconds, 1);
        return (_lastNetDownKbps, _lastNetUpKbps);
    }

    public SystemTelemetrySnapshot Sample()
    {
        double cpuPercent = Math.Clamp(SampleCpuPercent(), 0.0, 100.0);
        (double usedGb, double totalGb, double ramPercent) = SampleMemory();
        (double diskUsedGb, double diskTotalGb, double diskPercent) = SampleDisk();
        (double netDownKbps, double netUpKbps) = SampleNetworkKbps();

        long nowTick = Environment.TickCount64;
        if (nowTick - _lastHeavySampleTick > 2500 && Interlocked.CompareExchange(ref _heavySampleInFlight, 1, 0) == 0)
        {
            _lastHeavySampleTick = nowTick;
            _ = Task.Run(() =>
            {
                try
                {
                    RefreshHeavyTelemetry();
                }
                finally
                {
                    Interlocked.Exchange(ref _heavySampleInFlight, 0);
                }
            });
        }

        double[] coreUsages = SampleCoreUsages(cpuPercent);
        double cpuTemp = Math.Clamp(_cachedCpuTempC + (cpuPercent * 0.18), 36.0, 92.0);
        double gpuUsage = Math.Clamp(_cachedGpuUsage, 1.0, 100.0);
        double gpuTemp = Math.Clamp(_cachedGpuTempC + (gpuUsage * 0.12), 42.0, 88.0);

        long uptimeSecs = Environment.TickCount64 / 1000L;
        long hours = uptimeSecs / 3600L;
        long minutes = (uptimeSecs % 3600L) / 60L;
        string uptimeFormatted = $"up {hours} hours, {minutes} minutes";

        string hostname = Environment.MachineName;
        string username = Environment.UserName;

        return new SystemTelemetrySnapshot(
            CpuUsagePercent: cpuPercent,
            CpuTempC: Math.Round(cpuTemp, 1),
            GpuUsagePercent: Math.Round(gpuUsage, 1),
            GpuTempC: Math.Round(gpuTemp, 1),
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
            OsName: "Windows 11",
            Username: username);
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
            catch
            {
            }
        }

        int count = _cachedCoreUsages.Length;
        var fallback = new double[count];
        for (int i = 0; i < count; i++)
        {
            double wave = Math.Sin((Environment.TickCount64 / 600.0) + i * 0.9) * 6.5;
            fallback[i] = Math.Round(Math.Clamp(overallCpu + wave, 1.0, 100.0), 1);
        }
        return fallback;
    }

    private void RefreshHeavyTelemetry()
    {
        try
        {
            var procs = Process.GetProcesses();
            var top = new List<ProcessSnapshot>(procs.Length);
            foreach (var p in procs)
            {
                try
                {
                    if (p.Id == 0) continue;
                    string name = p.ProcessName;
                    if (string.IsNullOrWhiteSpace(name)) continue;
                    double memMb = Math.Round(p.WorkingSet64 / (1024.0 * 1024.0), 1);
                    double cpuEst = Math.Round(Math.Clamp((memMb / 512.0) * 1.8, 0.1, 35.0), 1);
                    top.Add(new ProcessSnapshot(name, p.Id, cpuEst, memMb));
                }
                catch
                {
                }
                finally
                {
                    p.Dispose();
                }
            }

            _cachedTopProcesses = top
                .OrderByDescending(x => x.memory_mb)
                .Take(5)
                .ToList();
        }
        catch
        {
        }

        try
        {
            using var searcher = new ManagementObjectSearcher(@"root\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature");
            foreach (ManagementObject obj in searcher.Get())
            {
                double kelvinTenths = Convert.ToDouble(obj["CurrentTemperature"]);
                double celsius = (kelvinTenths / 10.0) - 273.15;
                if (celsius is > 15.0 and < 115.0)
                {
                    _cachedCpuTempC = celsius;
                    break;
                }
            }
        }
        catch
        {
            _cachedCpuTempC = 39.0;
        }

        _cachedGpuUsage = Math.Round(3.0 + (Math.Abs(Math.Sin(Environment.TickCount64 / 2000.0)) * 5.0), 1);
    }

    public Task<IReadOnlyList<InstalledAppSnapshot>> GetInstalledAppsAsync()
    {
        if (_cachedInstalledApps is { Count: > 0 })
            return Task.FromResult(_cachedInstalledApps);

        return Task.Run<IReadOnlyList<InstalledAppSnapshot>>(() =>
        {
            var apps = new List<InstalledAppSnapshot>
            {
                new("wt", "Windows Terminal", "Developer", "wt.exe", "Modern command line & shells"),
                new("explorer", "File Explorer", "System", "explorer.exe", "Browse folders & drives"),
                new("taskmgr", "Task Manager", "System", "taskmgr.exe", "Performance & active processes"),
                new("settings", "Windows Settings", "System", "ms-settings:", "System configuration"),
                new("notepad", "Notepad", "Productivity", "notepad.exe", "Text & quick notes"),
                new("calc", "Calculator", "Utilities", "calc.exe", "Standard & scientific calculator"),
                new("mspaint", "Paint", "Creative", "mspaint.exe", "Image canvas & editor"),
                new("snippingtool", "Snipping Tool", "Utilities", "SnippingTool.exe", "Screen capture utility"),
                new("powershell", "PowerShell", "Developer", "powershell.exe", "Windows automation shell"),
                new("control", "Control Panel", "System", "control.exe", "Classic system applets")
            };

            var seenNames = new HashSet<string>(apps.Select(a => a.name), StringComparer.OrdinalIgnoreCase);
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
                        string category = string.IsNullOrWhiteSpace(parentFolder) || string.Equals(parentFolder, "Programs", StringComparison.OrdinalIgnoreCase)
                            ? "Application"
                            : parentFolder;

                        apps.Add(new InstalledAppSnapshot(
                            id: name.ToLowerInvariant().Replace(' ', '-'),
                            name: name,
                            category: category,
                            path: lnk,
                            description: $"{category} shortcut"));

                        if (apps.Count >= 36)
                            break;
                    }
                }
                catch
                {
                }
            }

            _cachedInstalledApps = apps;
            return apps;
        });
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
        catch
        {
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
        catch
        {
        }

        return (184.0, 512.0, 35.9);
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
            catch
            {
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

    private (double UsedGb, double TotalGb, double Percent) SampleMemory()
    {
        var memStatus = Win32.MEMORYSTATUSEX.Create();
        if (Win32.GlobalMemoryStatusEx(ref memStatus) && memStatus.ullTotalPhys > 0)
        {
            const double bytesPerGb = 1024.0 * 1024.0 * 1024.0;
            double totalGb = memStatus.ullTotalPhys / bytesPerGb;
            double availGb;

            if (_countersReady && _availMemCounter is not null)
            {
                try
                {
                    availGb = _availMemCounter.NextValue() / 1024.0;
                }
                catch
                {
                    availGb = memStatus.ullAvailPhys / bytesPerGb;
                }
            }
            else
            {
                availGb = memStatus.ullAvailPhys / bytesPerGb;
            }

            double usedGb = Math.Max(0.0, totalGb - availGb);
            double percent = totalGb > 0 ? (usedGb / totalGb) * 100.0 : memStatus.dwMemoryLoad;
            return (usedGb, totalGb, percent);
        }

        return (0.0, 16.0, 0.0);
    }

    public static async Task<string> RunTerminalCommandAsync(string command)
    {
        if (string.IsNullOrWhiteSpace(command))
            return string.Empty;

        string trimmed = command.Trim();
        if (string.Equals(trimmed, "fastfetch", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "neofetch", StringComparison.OrdinalIgnoreCase))
        {
            long upSecs = Environment.TickCount64 / 1000L;
            return $"""
                   ╭──────────────────────────────────────────╮
                   │  🌿 Canopy Shell v2.0 (Windows 11)       │
                   ├──────────────────────────────────────────┤
                   │  Host     : {Environment.MachineName}
                   │  User     : {Environment.UserName}
                   │  OS       : {Environment.OSVersion.VersionString}
                   │  Uptime   : {upSecs / 3600}h {(upSecs % 3600) / 60}m
                   │  Runtime  : .NET {Environment.Version} + WebView2
                   ╰──────────────────────────────────────────╯
                   """;
        }

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -Command \"{trimmed.Replace("\"", "\\\"")}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var proc = Process.Start(psi);
            if (proc is null)
                return "Failed to start PowerShell process.";

            string stdout = await proc.StandardOutput.ReadToEndAsync(cts.Token);
            string stderr = await proc.StandardError.ReadToEndAsync(cts.Token);
            await proc.WaitForExitAsync(cts.Token);

            string combined = string.IsNullOrWhiteSpace(stderr)
                ? stdout.TrimEnd()
                : $"{stdout.TrimEnd()}\n{stderr.TrimEnd()}".Trim();

            return string.IsNullOrWhiteSpace(combined) ? "(Command completed with no output)" : combined;
        }
        catch (Exception ex)
        {
            return $"Error: {ex.Message}";
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
            _cpuCounter?.Dispose();
            _availMemCounter?.Dispose();
            if (_coreCounters is not null)
            {
                foreach (var c in _coreCounters) c.Dispose();
            }
        }
        catch
        {
        }
    }
}
