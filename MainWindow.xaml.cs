using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Management;
using System.Windows.Threading;
using CaelestiaWin.Interop;
using CaelestiaWin.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace CaelestiaWin;

public partial class MainWindow : Window
{
    private const int HotkeyIdToggle = 9001;

    // Configurable top-screen trigger & debounce settings
    private int _topTriggerWidthPx = 950;
    private int _topTriggerHeightPx = 14;
    private int _topTriggerDelayMs = 0;
    private int _hideDebounceMs = 200;
    private DateTime _hoverEnteredTriggerUtc = DateTime.MinValue;

    private Win32.NOTIFYICONDATAW _trayData;
    private bool _trayIconCreated;
    private System.Drawing.Icon? _trayIconObj;
    private readonly AudioController _audioController;
    private readonly SystemMonitorService _systemMonitorService;
    private readonly WallpaperService _wallpaperService;
    private readonly SmtcMediaController _mediaController;
    private readonly AudioSessionController _audioSessions;
    private readonly DesktopWallpaperController _desktopWallpaper;
    private readonly DiagnosticsLog _log = new();

    private readonly DispatcherTimer _cursorPollTimer;
    private readonly DispatcherTimer _hideDebounceTimer;

    private IntPtr _hwnd;
    private HwndSource? _hwndSource;
    private bool _isExpanded;
    private bool _webViewReady;
    private readonly bool _startExpanded;
    private DateTime _ignoreAutoHideUntilUtc = DateTime.MinValue;
    private int _currentBrightness = 80;
    private bool _topHoverTriggerEnabled = true;
    private bool _fullscreenAppActive;
    private int _fullscreenProbeCounter;

    // Host-owned settings, pushed from the UI through set_host_config.
    private bool _animationsEnabled = true;
    private int _animationDurationMs = 280;
    private bool _pauseInFullscreen = true;
    private bool _pauseInPresentation = true;
    private bool _quietHoursEnabled;
    private string _quietHoursStart = "22:00";
    private string _quietHoursEnd = "07:00";
    private string _panelMonitorMode = "cursor";
    private string _triggerMonitorScope = "all";
    private bool _suspendWhenClosed = true;
    private bool _showPanelOnLaunch = true;
    private string _hotkey = "Win+`";

    // Slide animation state.
    private readonly DispatcherTimer _slideTimer;
    private double _slideFromTop;
    private double _slideToTop;
    private int _slideDurationMs;
    private DateTime _slideStartedUtc;
    private bool _slideTargetExpanded;

    public MainWindow(bool startExpanded = true)
    {
        _startExpanded = startExpanded;
        InitializeComponent();

        _audioController = new AudioController();
        _systemMonitorService = new SystemMonitorService();
        _wallpaperService = new WallpaperService();
        _mediaController = new SmtcMediaController();
        _audioSessions = new AudioSessionController();
        _desktopWallpaper = new DesktopWallpaperController();

        _audioController.VolumeStateChanged += OnMasterVolumeChanged;

        _cursorPollTimer = new DispatcherTimer(DispatcherPriority.Input)
        {
            Interval = TimeSpan.FromMilliseconds(25)
        };
        _cursorPollTimer.Tick += OnCursorPollTick;

        _hideDebounceTimer = new DispatcherTimer(DispatcherPriority.Normal)
        {
            Interval = TimeSpan.FromMilliseconds(_hideDebounceMs)
        };
        _hideDebounceTimer.Tick += OnHideDebounceTimerTick;

        _slideTimer = new DispatcherTimer(DispatcherPriority.Render)
        {
            Interval = TimeSpan.FromMilliseconds(15)
        };
        _slideTimer.Tick += OnSlideTimerTick;

        _log.Write("MainWindow constructed");
        _ = Task.Run(() => _currentBrightness = QueryHardwareBrightness());
    }

    private void OnWindowSourceInitialized(object? sender, EventArgs e)
    {
        _hwnd = new WindowInteropHelper(this).Handle;
        _hwndSource = HwndSource.FromHwnd(_hwnd);
        _hwndSource?.AddHook(WndProc);
        // Clip the physical HWND so the bottom corners are rounded without any rectangular bleed.
        Win32.DisableWindowClassBackgroundBrush(_hwnd);
        Win32.DisableNativeWindowFrameAndShadow(_hwnd);
        ApplyRoundedRegionForCurrentDpi();

        // Apply WS_EX_TOOLWINDOW without WS_EX_LAYERED so WebView2 receives all clicks natively
        Win32.SetClickThrough(_hwnd, clickThrough: false);

        ApplyHotkeyFromSettings();

        InitializeTrayIcon();

        Win32.RECT panelMonitor = GetPanelMonitor();
        PositionWindowAtTopCenter(panelMonitor, offscreen: !_startExpanded);
        _log.Write($"Source initialized; panel monitor {panelMonitor.Left},{panelMonitor.Top} {panelMonitor.Width}x{panelMonitor.Height}");
    }

    /// <summary>
    /// SetWindowRgn works in physical pixels, so the DIP window size must be scaled first or the
    /// panel's right/bottom edge is clipped on any monitor that is not at 100%.
    /// </summary>
    private void ApplyRoundedRegionForCurrentDpi()
    {
        if (_hwnd == IntPtr.Zero)
        {
            return;
        }

        DpiScale dpi = VisualTreeHelper.GetDpi(this);
        double scaleX = dpi.DpiScaleX > 0 ? dpi.DpiScaleX : 1.0;
        double scaleY = dpi.DpiScaleY > 0 ? dpi.DpiScaleY : 1.0;
        int cornerRadius = (int)Math.Round(24 * scaleY);
        Win32.ApplyWindowRoundedRegion(
            _hwnd,
            (int)Math.Round(Width * scaleX),
            (int)Math.Round(Height * scaleY),
            cornerRadius);
    }

    private async void OnWindowLoaded(object sender, RoutedEventArgs e)
    {
        await InitializeWebViewAsync();
        _cursorPollTimer.Start();

        if (_startExpanded)
        {
            ExpandWithPreviewGrace();
        }
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            string userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Canopy",
                "WebView2Data");

            var envOptions = new CoreWebView2EnvironmentOptions("--disable-features=HardwareMediaKeyHandling,MediaSessionService");
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
            await ShellWebView.EnsureCoreWebView2Async(env);
            ShellWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(0, 0, 0, 0);

            CoreWebView2 core = ShellWebView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;

            // Inject native bridge before React bundle executes
            const string bridgeInitScript = """
                (() => {
                  const pending = new Map();
                  let seq = 1;
                  window.chrome.webview.addEventListener('message', (e) => {
                    const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                    if (msg && msg.type === 'rpc-response' && pending.has(msg.id)) {
                      const { resolve, reject } = pending.get(msg.id);
                      pending.delete(msg.id);
                      if (msg.error) reject(new Error(msg.error));
                      else resolve(msg.result);
                    } else if (msg && msg.type === 'event') {
                      window.dispatchEvent(new CustomEvent(msg.name, { detail: msg.payload }));
                    }
                  });
                  window.__CANOPY_BRIDGE__ = {
                    invoke(cmd, args = {}) {
                      return new Promise((resolve, reject) => {
                        const id = seq++;
                        pending.set(id, { resolve, reject });
                        window.chrome.webview.postMessage(JSON.stringify({ id, cmd, args }));
                      });
                    }
                  };
                  window.__CAELESTIA_BRIDGE__ = window.__CANOPY_BRIDGE__;
                })();
                """;
            await core.AddScriptToExecuteOnDocumentCreatedAsync(bridgeInitScript);
            core.WebMessageReceived += OnWebMessageReceived;

            string distDir = ResolveDistDirectory();
            core.SetVirtualHostNameToFolderMapping(
                "canopy.local",
                distDir,
                CoreWebView2HostResourceAccessKind.Allow);

            core.Navigate("https://canopy.local/index.html");
            _webViewReady = true;
        }
        catch (Exception ex)
        {
            _log.WriteException("webview init", ex);
            try
            {
                File.AppendAllText(
                    Path.Combine(AppContext.BaseDirectory, "error.log"),
                    $"[{DateTime.Now:O}] WebView2 init error: {ex}\r\n");
            }
            catch
            {
            }
        }
    }

    private static string ResolveDistDirectory()
    {
        string localDist = Path.Combine(AppContext.BaseDirectory, "dist");
        if (Directory.Exists(localDist))
        {
            return localDist;
        }

        return AppContext.BaseDirectory;
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        int id = 0;
        string cmd = string.Empty;
        try
        {
            string raw = e.TryGetWebMessageAsString();
            using JsonDocument doc = JsonDocument.Parse(raw);
            JsonElement root = doc.RootElement;

            id = root.TryGetProperty("id", out JsonElement idEl) ? idEl.GetInt32() : 0;
            cmd = root.TryGetProperty("cmd", out JsonElement cmdEl) ? (cmdEl.GetString() ?? string.Empty) : string.Empty;
            JsonElement args = root.TryGetProperty("args", out JsonElement argsEl) ? argsEl : default;

            object? result = await HandleBridgeCommandAsync(cmd, args);
            SendRpcResponse(id, result, null);
        }
        catch (Exception ex)
        {
            _log.WriteException($"command '{cmd}'", ex);
            SendRpcResponse(id, null, ex.Message);
        }
    }

    private async Task<object?> HandleBridgeCommandAsync(string cmd, JsonElement args)
    {
        switch (cmd)
        {
            case "get_system_stats":
            {
                SystemTelemetrySnapshot snap = _systemMonitorService.Sample();
                return new
                {
                    cpu_usage = (float)Math.Round(snap.CpuUsagePercent, 1),
                    cpu_temp_c = (float)Math.Round(snap.CpuTempC, 1),
                    gpu_usage = (float)Math.Round(snap.GpuUsagePercent, 1),
                    gpu_temp_c = (float)Math.Round(snap.GpuTempC, 1),
                    core_usages = snap.CoreUsages,
                    top_processes = snap.TopProcesses,
                    net_down_kbps = (float)Math.Round(snap.NetDownKbps, 1),
                    net_up_kbps = (float)Math.Round(snap.NetUpKbps, 1),
                    ram_usage = (float)Math.Round(snap.RamUsagePercent, 1),
                    ram_used_gb = (float)Math.Round(snap.RamUsedGb, 1),
                    ram_total_gb = (float)Math.Round(snap.RamTotalGb, 1),
                    disk_usage = (float)Math.Round(snap.DiskUsagePercent, 1),
                    disk_used_gb = (float)Math.Round(snap.DiskUsedGb, 0),
                    disk_total_gb = (float)Math.Round(snap.DiskTotalGb, 0),
                    uptime_formatted = snap.UptimeFormatted,
                    hostname = snap.Hostname,
                    os_name = snap.OsName,
                    username = snap.Username
                };
            }

            case "get_media_info":
            {
                SmtcMediaSnapshot media = await _mediaController.GetMediaInfoAsync();
                // SMTC timelines are snapshots, not clocks: apps (Chromium especially) publish a
                // position once and never update it, so project it forward to "now" instead of
                // handing the frontend a frozen playhead.
                double livePositionSecs = SmtcMediaController.AnchorPosition(
                    media.PositionSecs,
                    media.PositionAnchorAgeSecs,
                    media.PlaybackRate);
                return new
                {
                    title = media.Title,
                    artist = media.Artist,
                    album = media.Album,
                    is_playing = media.IsPlaying,
                    position_secs = (float)Math.Round(livePositionSecs, 1),
                    duration_secs = (float)Math.Round(media.DurationSecs, 1),
                    artwork_url = media.ArtworkUrl,
                    source_app = media.SourceApp,
                    sessions = media.Sessions,
                    is_shuffle = media.IsShuffleActive,
                    auto_repeat = media.AutoRepeatMode
                };
            }
            case "get_media_sessions":
                return await _mediaController.GetSessionsAsync();

            case "select_media_session":
            {
                if (args.ValueKind == JsonValueKind.Object)
                {
                    string? sid = null;
                    if (args.TryGetProperty("sessionId", out JsonElement s1)) sid = s1.GetString();
                    else if (args.TryGetProperty("session_id", out JsonElement s2)) sid = s2.GetString();
                    _mediaController.SelectSession(sid);
                }
                return null;
            }

            case "media_play_pause":
                await _mediaController.PlayPauseAsync();
                return null;

            case "media_next":
                await _mediaController.NextAsync();
                return null;

            case "media_prev":
                await _mediaController.PreviousAsync();
                return null;

            case "media_seek":
            {
                if (args.ValueKind == JsonValueKind.Object &&
                    args.TryGetProperty("seconds", out JsonElement secEl) &&
                    secEl.TryGetDouble(out double secs))
                {
                    await _mediaController.SeekAsync(secs);
                }
                return null;
            }
            case "media_toggle_shuffle":
                return await _mediaController.ToggleShuffleAsync();

            case "media_cycle_repeat":
                return await _mediaController.CycleRepeatModeAsync();

            case "tab_changed":
                _ignoreAutoHideUntilUtc = DateTime.UtcNow.AddMilliseconds(600);
                return true;

            case "set_host_config":
                ApplyHostConfig(args);
                return BuildHostConfigPayload();

            case "get_host_config":
                return BuildHostConfigPayload();

            case "get_mic_state":
                return new
                {
                    volume = Math.Round(_audioController.GetMicVolumePercent()),
                    muted = _audioController.GetMicMute(),
                };

            case "set_mic_volume":
            {
                if (TryGetInt(args, "level", out int level))
                {
                    _audioController.SetMicVolumePercent(Math.Clamp(level, 0, 100));
                    EmitMicStatus();
                }
                return null;
            }

            case "set_mic_mute":
            {
                if (TryGetBool(args, "muted", out bool muted))
                {
                    _audioController.SetMicMute(muted);
                    EmitMicStatus();
                }
                return null;
            }

            case "get_audio_sessions":
                return _audioSessions.GetSessions()
                    .Select(session => new
                    {
                        id = session.Id,
                        name = session.Name,
                        volume = Math.Round(session.VolumePercent),
                        muted = session.Muted,
                        is_active = session.IsActive,
                    })
                    .ToList();

            case "set_session_volume":
            {
                if (TryGetString(args, "id", out string sessionId) && TryGetInt(args, "level", out int sessionLevel))
                {
                    return _audioSessions.SetSessionVolume(sessionId, Math.Clamp(sessionLevel, 0, 100));
                }
                return false;
            }

            case "set_session_mute":
            {
                if (TryGetString(args, "id", out string sessionId) && TryGetBool(args, "muted", out bool sessionMuted))
                {
                    return _audioSessions.SetSessionMute(sessionId, sessionMuted);
                }
                return false;
            }

            case "get_battery_status":
            {
                var (hasBattery, percent, charging) = Win32.GetBatteryStatus();
                return new { has_battery = hasBattery, percent, charging };
            }
            case "get_master_volume":
                return (float)Math.Round(_audioController.GetMasterVolumePercent(), 1);

            case "set_master_volume":
            {
                if (args.ValueKind == JsonValueKind.Object)
                {
                    if (args.TryGetProperty("level", out JsonElement lvlEl) && lvlEl.TryGetDouble(out double lvl))
                    {
                        _audioController.SetMasterVolumePercent((float)lvl);
                    }
                    else if (args.TryGetProperty("volume", out JsonElement volEl) && volEl.TryGetDouble(out double vol))
                    {
                        _audioController.SetMasterVolumePercent((float)vol);
                    }
                }
                else if (args.ValueKind == JsonValueKind.Number && args.TryGetDouble(out double directLvl))
                {
                    _audioController.SetMasterVolumePercent((float)directLvl);
                }
                return null;
            }

            case "get_brightness":
                return _currentBrightness;

            case "set_brightness":
            {
                if (args.ValueKind == JsonValueKind.Object)
                {
                    if (args.TryGetProperty("level", out JsonElement lvlEl) && lvlEl.TryGetDouble(out double lvl))
                    {
                        _currentBrightness = (int)Math.Clamp(Math.Round(lvl), 5, 100);
                        _ = Task.Run(() => ApplyHardwareBrightness(_currentBrightness));
                    }
                }
                else if (args.ValueKind == JsonValueKind.Number && args.TryGetDouble(out double directLvl))
                {
                    _currentBrightness = (int)Math.Clamp(Math.Round(directLvl), 5, 100);
                    _ = Task.Run(() => ApplyHardwareBrightness(_currentBrightness));
                }
                return null;
            }

            case "get_audio_spectrum":
                return _audioController.GetAudioSpectrum();

            case "set_audio_volume":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("volume", out JsonElement volEl))
                {
                    float vol = (float)volEl.GetDouble();
                    _audioController.SetMasterVolumePercent(vol);
                }
                return null;
            }

            case "get_wallpapers":
                return await _wallpaperService.GetWallpaperBridgeEntriesAsync();

            case "apply_wallpaper":
            case "set_desktop_wallpaper":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("path", out JsonElement pathEl))
                {
                    string? path = pathEl.GetString();
                    if (!string.IsNullOrWhiteSpace(path))
                    {
                        return await _wallpaperService.ApplyWallpaperAsync(path);
                    }
                }
                return false;
            }

            case "get_desktop_wallpaper_state":
            {
                var monitors = new List<object>();
                if (_desktopWallpaper.IsSupported)
                {
                    foreach (MonitorWallpaper monitor in _desktopWallpaper.GetMonitors())
                    {
                        monitors.Add(new { id = monitor.Id, label = monitor.Label, path = monitor.Path });
                    }
                }

                uint intervalMs = _desktopWallpaper.IsSupported ? _desktopWallpaper.GetSlideShowIntervalMs() : 0;
                return new
                {
                    per_monitor_supported = _desktopWallpaper.IsSupported,
                    monitors,
                    slideshow_enabled = intervalMs > 0,
                    slideshow_minutes = (int)Math.Round(intervalMs / 60000.0),
                    shuffle = _desktopWallpaper.IsSupported && _desktopWallpaper.GetShuffle(),
                };
            }

            case "set_desktop_wallpaper_state":
            {
                if (!_desktopWallpaper.IsSupported)
                {
                    return false;
                }

                if (TryGetBool(args, "slideshow_enabled", out bool slideshowEnabled) && slideshowEnabled)
                {
                    int minutes = TryGetInt(args, "slideshow_minutes", out int requestedMinutes)
                        ? Math.Clamp(requestedMinutes, 1, 1440)
                        : 30;
                    bool shuffle = TryGetBool(args, "shuffle", out bool requestedShuffle) && requestedShuffle;
                    return _desktopWallpaper.SetSlideShow(_wallpaperService.WallpapersDirectory, (uint)minutes * 60000u, shuffle);
                }

                _desktopWallpaper.StopSlideShow();
                return true;
            }

            case "set_monitor_wallpaper":
            {
                if (TryGetString(args, "monitor_id", out string monitorId) && TryGetString(args, "path", out string monitorPath))
                {
                    if (_desktopWallpaper.IsSupported)
                    {
                        return _desktopWallpaper.SetMonitorWallpaper(monitorId, monitorPath);
                    }

                    return await _wallpaperService.ApplyWallpaperAsync(monitorPath);
                }
                return false;
            }

            case "open_log_folder":
                OpenLogFolder();
                return null;

            case "reload_ui":
                ShellWebView.CoreWebView2?.Reload();
                return null;

            case "pick_wallpaper_folder":
            {
                _ignoreAutoHideUntilUtc = DateTime.UtcNow.AddSeconds(60);

                // The UI sends the folder it currently shows; prefer it over the host's own memory.
                string preferred = _wallpaperService.WallpapersDirectory;
                if (TryGetString(args, "currentDir", out string currentDir) && Directory.Exists(currentDir))
                {
                    preferred = currentDir;
                }

                var dialog = new OpenFolderDialog
                {
                    Title = "Select Canopy Wallpaper Folder",
                    InitialDirectory = Directory.Exists(preferred)
                        ? preferred
                        : Environment.GetFolderPath(Environment.SpecialFolder.MyPictures)
                };
                bool? picked = dialog.ShowDialog(this);
                _ignoreAutoHideUntilUtc = DateTime.UtcNow.AddSeconds(3);
                if (picked == true && !string.IsNullOrWhiteSpace(dialog.FolderName))
                {
                    _wallpaperService.SetWallpapersDirectory(dialog.FolderName);
                    return dialog.FolderName;
                }
                return null;
            }

            case "set_wallpaper_directory":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("path", out JsonElement pathEl))
                {
                    string? dir = pathEl.GetString();
                    if (!string.IsNullOrWhiteSpace(dir))
                    {
                        _wallpaperService.SetWallpapersDirectory(dir);
                    }
                }
                return await _wallpaperService.GetWallpaperBridgeEntriesAsync();
            }

            case "set_top_hover_trigger":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("enabled", out JsonElement enEl))
                {
                    _topHoverTriggerEnabled = enEl.GetBoolean();
                }
                return _topHoverTriggerEnabled;
            }

            case "set_launch_on_startup":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("enabled", out JsonElement enEl))
                {
                    bool enabled = enEl.GetBoolean();
                    try
                    {
                        using RegistryKey? key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
                        if (key is null)
                        {
                            _log.Write("autostart registry key unavailable");
                            return false;
                        }

                        if (enabled)
                        {
                            string? exePath = Environment.ProcessPath;
                            if (string.IsNullOrWhiteSpace(exePath))
                            {
                                _log.Write("autostart requested but the executable path is unknown");
                                return false;
                            }

                            key.SetValue("Canopy", $"\"{exePath}\"");
                        }
                        else
                        {
                            key.DeleteValue("Canopy", throwOnMissingValue: false);
                        }

                        _log.Write($"autostart {(enabled ? "enabled" : "disabled")}");
                        return true;
                    }
                    catch (Exception ex)
                    {
                        // Never report success when the registry write was rejected.
                        _log.WriteException("autostart registry write", ex);
                        return false;
                    }
                }
                return false;
            }

            case "run_terminal_command":
            {
                string commandText = "fastfetch";
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("cmd", out JsonElement cmdEl))
                {
                    commandText = cmdEl.GetString() ?? "fastfetch";
                }
                return await SystemMonitorService.RunTerminalCommandAsync(commandText);
            }

            case "get_installed_apps":
                return await _systemMonitorService.GetInstalledAppsAsync();

            case "launch_app":
            {
                string? target = null;
                if (args.ValueKind == JsonValueKind.Object)
                {
                    if (args.TryGetProperty("target", out JsonElement t1)) target = t1.GetString();
                    else if (args.TryGetProperty("path", out JsonElement t2)) target = t2.GetString();
                }
                bool launched = SystemMonitorService.LaunchApp(target);
                if (launched && _isExpanded)
                {
                    CollapsePanel();
                }
                return launched;
            }

            case "execute_power_action":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("action", out JsonElement actEl))
                {
                    string? action = actEl.GetString();
                    if (!string.IsNullOrWhiteSpace(action))
                    {
                        if (_isExpanded && action != "lock")
                        {
                            CollapsePanel();
                        }
                        return Win32.ExecutePowerAction(action);
                    }
                }
                return false;
            }

            case "set_dropdown_open":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("open", out JsonElement openEl))
                {
                    bool open = openEl.GetBoolean();
                    if (!open && _isExpanded)
                    {
                        CollapsePanel();
                    }
                    else if (open && !_isExpanded)
                    {
                        ExpandPanel(GetActiveMonitorBounds());
                    }
                }
                return null;
            }


            default:
                return null;
        }
    }

    private static int QueryHardwareBrightness()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(@"root\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness");
            using ManagementObjectCollection results = searcher.Get();
            foreach (ManagementObject obj in results)
            {
                using (obj)
                {
                    return Convert.ToInt32(obj["CurrentBrightness"]);
                }
            }
        }
        catch
        {
        }

        return 80;
    }

    private static void ApplyHardwareBrightness(int level)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM WmiMonitorBrightnessMethods");
            using ManagementObjectCollection results = searcher.Get();
            foreach (ManagementObject obj in results)
            {
                using (obj)
                {
                    obj.InvokeMethod("WmiSetBrightness", new object[] { 1, (byte)Math.Clamp(level, 0, 100) });
                }
            }
        }
        catch
        {
        }
    }

    private void SendRpcResponse(int id, object? result, string? error)
    {
        if (!_webViewReady || ShellWebView.CoreWebView2 is null || id == 0)
            return;

        string json = JsonSerializer.Serialize(new
        {
            type = "rpc-response",
            id,
            result,
            error
        });

        ShellWebView.CoreWebView2.PostWebMessageAsJson(json);
    }

    private void EmitFrontendEvent(string eventName, object? payload)
    {
        if (!_webViewReady || ShellWebView.CoreWebView2 is null)
            return;

        string json = JsonSerializer.Serialize(new
        {
            type = "event",
            name = eventName,
            payload
        });

        ShellWebView.CoreWebView2.PostWebMessageAsJson(json);
    }

    /// <summary>
    /// Registers the user-configured global hotkey, surfacing failures instead of losing them.
    /// </summary>
    private void ApplyHotkeyFromSettings()
    {
        if (_hwnd == IntPtr.Zero)
        {
            return;
        }

        _ = Win32.UnregisterHotKey(_hwnd, HotkeyIdToggle);

        if (!Win32.TryParseHotkey(_hotkey, out uint modifiers, out uint virtualKey))
        {
            _log.Write($"hotkey '{_hotkey}' could not be parsed");
            EmitFrontendEvent("hotkey-failed", new { hotkey = _hotkey });
            return;
        }

        if (!Win32.RegisterHotKey(_hwnd, HotkeyIdToggle, modifiers | Win32.MOD_NOREPEAT, virtualKey))
        {
            _log.Write($"hotkey '{_hotkey}' was rejected (already owned by another application)");
            EmitFrontendEvent("hotkey-failed", new { hotkey = _hotkey });
            return;
        }

        _log.Write($"hotkey '{_hotkey}' registered");
    }

    private void OnMasterVolumeChanged(object? sender, AudioVolumeStateChangedEventArgs e)
    {
        void Report() => EmitFrontendEvent("volume-changed", new { level = Math.Round(e.VolumePercent), muted = e.IsMuted });

        if (Dispatcher.CheckAccess())
        {
            Report();
        }
        else
        {
            Dispatcher.BeginInvoke(Report);
        }
    }

    private void EmitBatteryStatus()
    {
        var (hasBattery, percent, charging) = Win32.GetBatteryStatus();
        EmitFrontendEvent("battery-changed", new { has_battery = hasBattery, percent, charging });
    }

    private void EmitMicStatus()
    {
        try
        {
            EmitFrontendEvent("mic-changed", new
            {
                level = Math.Round(_audioController.GetMicVolumePercent()),
                muted = _audioController.GetMicMute(),
            });
        }
        catch (Exception ex)
        {
            _log.WriteException("mic status", ex);
        }
    }

    /// <summary>
    /// Applies a partial host configuration pushed from the settings surface.
    /// </summary>
    private void ApplyHostConfig(JsonElement args)
    {
        if (TryGetInt(args, "triggerWidth", out int width))
        {
            _topTriggerWidthPx = Math.Clamp(width, 100, 4096);
        }

        if (TryGetInt(args, "triggerHeight", out int height))
        {
            _topTriggerHeightPx = Math.Clamp(height, 1, 60);
        }

        if (TryGetInt(args, "triggerDelayMs", out int delay))
        {
            _topTriggerDelayMs = Math.Clamp(delay, 0, 2000);
        }

        if (TryGetInt(args, "hideDebounceMs", out int debounce))
        {
            _hideDebounceMs = Math.Clamp(debounce, 50, 3000);
            _hideDebounceTimer.Interval = TimeSpan.FromMilliseconds(_hideDebounceMs);
        }

        if (TryGetBool(args, "pauseInFullscreen", out bool pauseFullscreen))
        {
            _pauseInFullscreen = pauseFullscreen;
        }

        if (TryGetBool(args, "pauseInPresentation", out bool pausePresentation))
        {
            _pauseInPresentation = pausePresentation;
        }

        if (TryGetBool(args, "quietHoursEnabled", out bool quietEnabled))
        {
            _quietHoursEnabled = quietEnabled;
        }

        if (TryGetString(args, "quietHoursStart", out string quietStart))
        {
            _quietHoursStart = quietStart;
        }

        if (TryGetString(args, "quietHoursEnd", out string quietEnd))
        {
            _quietHoursEnd = quietEnd;
        }

        if (TryGetString(args, "panelMonitorMode", out string monitorMode))
        {
            _panelMonitorMode = string.Equals(monitorMode, "primary", StringComparison.OrdinalIgnoreCase) ? "primary" : "cursor";
        }

        if (TryGetString(args, "triggerMonitorScope", out string scope))
        {
            _triggerMonitorScope = string.Equals(scope, "primary", StringComparison.OrdinalIgnoreCase) ? "primary" : "all";
        }

        if (TryGetBool(args, "animationsEnabled", out bool animations))
        {
            _animationsEnabled = animations;
            if (!_animationsEnabled)
            {
                _slideTimer.Stop();
            }
        }

        if (TryGetInt(args, "animationDurationMs", out int duration))
        {
            _animationDurationMs = Math.Clamp(duration, 0, 2000);
        }

        if (TryGetBool(args, "suspendWhenClosed", out bool suspend))
        {
            _suspendWhenClosed = suspend;
            if (!_isExpanded)
            {
                if (_suspendWhenClosed)
                {
                    SuspendWebView();
                }
                else
                {
                    ResumeWebView();
                }
            }
        }

        if (TryGetBool(args, "diagnosticLogging", out bool logging))
        {
            _log.Enabled = logging;
            _log.Write($"diagnostic logging {(logging ? "enabled" : "disabled")}");
        }

        if (TryGetBool(args, "showPanelOnLaunch", out bool showOnLaunch))
        {
            _showPanelOnLaunch = showOnLaunch;
            if (!_showPanelOnLaunch && _isExpanded && DateTime.UtcNow < _ignoreAutoHideUntilUtc)
            {
                CollapsePanel();
            }
        }

        if (TryGetString(args, "hotkey", out string hotkey) &&
            !string.IsNullOrWhiteSpace(hotkey) &&
            !string.Equals(hotkey, _hotkey, StringComparison.Ordinal))
        {
            _hotkey = hotkey;
            ApplyHotkeyFromSettings();
        }
    }

    private object BuildHostConfigPayload() => new
    {
        triggerWidth = _topTriggerWidthPx,
        triggerHeight = _topTriggerHeightPx,
        triggerDelayMs = _topTriggerDelayMs,
        hideDebounceMs = _hideDebounceMs,
        pauseInFullscreen = _pauseInFullscreen,
        pauseInPresentation = _pauseInPresentation,
        quietHoursEnabled = _quietHoursEnabled,
        quietHoursStart = _quietHoursStart,
        quietHoursEnd = _quietHoursEnd,
        panelMonitorMode = _panelMonitorMode,
        triggerMonitorScope = _triggerMonitorScope,
        animationsEnabled = _animationsEnabled,
        animationDurationMs = _animationDurationMs,
        suspendWhenClosed = _suspendWhenClosed,
        showPanelOnLaunch = _showPanelOnLaunch,
        hotkey = _hotkey,
        diagnosticLogging = _log.Enabled,
        wallpaperDirectory = _wallpaperService.WallpapersDirectory,
        triggerSuppressed = _fullscreenAppActive,
        webViewSuspended = ShellWebView.CoreWebView2?.IsSuspended ?? false,
    };

    private static bool TryGetInt(JsonElement args, string name, out int value)
    {
        value = 0;
        return args.ValueKind == JsonValueKind.Object &&
               args.TryGetProperty(name, out JsonElement element) &&
               element.ValueKind == JsonValueKind.Number &&
               element.TryGetInt32(out value);
    }

    private static bool TryGetBool(JsonElement args, string name, out bool value)
    {
        value = false;
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out JsonElement element))
        {
            return false;
        }

        if (element.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            return false;
        }

        value = element.GetBoolean();
        return true;
    }

    private static bool TryGetString(JsonElement args, string name, out string value)
    {
        value = string.Empty;
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty(name, out JsonElement element) ||
            element.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        value = element.GetString() ?? string.Empty;
        return true;
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == Win32.WM_HOTKEY)
        {
            if (wParam.ToInt32() == HotkeyIdToggle)
            {
                ToggleDropdown();
                handled = true;
            }
        }
        else if (msg == Win32.WM_TRAYICON)
        {
            int mouseMsg = (int)lParam.ToInt64() & 0xFFFF;
            if (mouseMsg == 0x0202) // WM_LBUTTONUP
            {
                ToggleDropdown();
                handled = true;
            }
            else if (mouseMsg == 0x0205) // WM_RBUTTONUP
            {
                ShowTrayContextMenu();
                handled = true;
            }
        }

        return IntPtr.Zero;
    }

    public void ToggleDropdown()
    {
        if (_isExpanded)
        {
            CollapsePanel();
        }
        else
        {
            ExpandWithPreviewGrace();
        }
    }

    public void ExpandWithPreviewGrace()
    {
        _ignoreAutoHideUntilUtc = DateTime.UtcNow.AddSeconds(5.0);
        _hideDebounceTimer.Stop();
        ExpandPanel(GetPanelMonitor());
    }

    private static Win32.RECT GetActiveMonitorBounds()
    {
        if (Win32.GetCursorPos(out Win32.POINT cursor))
        {
            IntPtr hMon = Win32.MonitorFromPoint(cursor, Win32.MONITOR_DEFAULTTONEAREST);
            Win32.MONITORINFO mi = new() { cbSize = Marshal.SizeOf<Win32.MONITORINFO>() };
            if (Win32.GetMonitorInfo(hMon, ref mi))
            {
                return mi.rcMonitor;
            }
        }

        return Win32.GetPrimaryMonitorBounds();
    }

    /// <summary>
    /// Monitor the panel is hosted on: the monitor under the cursor, or the primary monitor when
    /// the user pinned the panel there.
    /// </summary>
    private Win32.RECT GetPanelMonitor() =>
        string.Equals(_panelMonitorMode, "primary", StringComparison.OrdinalIgnoreCase)
            ? Win32.GetPrimaryMonitorBounds()
            : GetActiveMonitorBounds();

    private static bool IsSameMonitor(Win32.RECT a, Win32.RECT b) =>
        a.Left == b.Left && a.Top == b.Top && a.Width == b.Width && a.Height == b.Height;

    /// <summary>
    /// Target Y for a monitor in device-independent units: on-screen (flush to the top edge) or
    /// parked far enough above it that the panel cannot be seen or hovered.
    /// </summary>
    private double ComputeTargetTop(Win32.RECT monitor, bool expanded)
    {
        DpiScale dpi = VisualTreeHelper.GetDpi(this);
        double scaleY = dpi.DpiScaleY > 0 ? dpi.DpiScaleY : 1.0;
        double monitorTopDip = monitor.Top / scaleY;
        return expanded
            ? Math.Round(monitorTopDip)
            : Math.Round(monitorTopDip - Height - 100);
    }

    private void PositionWindowAtTopCenter(Win32.RECT monitor, bool offscreen)
    {
        DpiScale dpi = VisualTreeHelper.GetDpi(this);
        double scaleX = dpi.DpiScaleX > 0 ? dpi.DpiScaleX : 1.0;
        double monitorLeftDip = monitor.Left / scaleX;
        double monitorWidthDip = monitor.Width / scaleX;

        Left = Math.Round(monitorLeftDip + ((monitorWidthDip - Width) / 2.0));
        Top = ComputeTargetTop(monitor, expanded: !offscreen);
    }

    /// <summary>
    /// Slides the window to its expanded or collapsed Y position with an ease-out curve, or snaps
    /// when animations are disabled (or disallowed by the system accessibility setting).
    /// </summary>
    private void SlideTo(bool expanded, Win32.RECT monitor)
    {
        PositionWindowHorizontally(monitor);

        double target = ComputeTargetTop(monitor, expanded);
        int duration = _animationDurationMs > 0 ? _animationDurationMs : 280;
        bool animate = _animationsEnabled && duration > 0 && Win32.AreSystemAnimationsEnabled() && Math.Abs(Top - target) > 0.5;

        _slideTimer.Stop();
        _slideTargetExpanded = expanded;
        _slideToTop = target;

        if (!animate)
        {
            Top = target;
            OnSlideFinished();
            return;
        }

        // If the panel is currently parked, re-anchor the animation at its true start so it always
        // slides in from off-screen rather than from a stale Top value.
        _slideFromTop = Top;
        if (expanded && _slideFromTop > target)
        {
            _slideFromTop = target - Height - 100;
            Top = _slideFromTop;
        }

        _slideDurationMs = duration;
        _slideStartedUtc = DateTime.UtcNow;
        _slideTimer.Start();
    }

    private void PositionWindowHorizontally(Win32.RECT monitor)
    {
        DpiScale dpi = VisualTreeHelper.GetDpi(this);
        double scaleX = dpi.DpiScaleX > 0 ? dpi.DpiScaleX : 1.0;
        double monitorLeftDip = monitor.Left / scaleX;
        double monitorWidthDip = monitor.Width / scaleX;
        Left = Math.Round(monitorLeftDip + ((monitorWidthDip - Width) / 2.0));
    }

    private void OnSlideTimerTick(object? sender, EventArgs e)
    {
        double elapsed = (DateTime.UtcNow - _slideStartedUtc).TotalMilliseconds;
        double progress = _slideDurationMs <= 0 ? 1.0 : Math.Clamp(elapsed / _slideDurationMs, 0.0, 1.0);
        double eased = 1.0 - Math.Pow(1.0 - progress, 3.0);

        Top = _slideFromTop + ((_slideToTop - _slideFromTop) * eased);

        if (progress >= 1.0)
        {
            _slideTimer.Stop();
            Top = _slideToTop;
            OnSlideFinished();
        }
    }

    private void OnSlideFinished()
    {
        if (_slideTargetExpanded)
        {
            ApplyRoundedRegionForCurrentDpi();
            ResumeWebView();
            EmitBatteryStatus();
            return;
        }

        Win32.SetClickThrough(_hwnd, clickThrough: true);
        SuspendWebView();
    }

    /// <summary>
    /// WebView2 only suspends while it is hidden, so the control has to be collapsed first;
    /// otherwise every JS timer and animation keeps burning CPU behind the parked panel.
    /// </summary>
    private void SuspendWebView()
    {
        if (!_suspendWhenClosed || ShellWebView.CoreWebView2 is null)
        {
            return;
        }

        ShellWebView.Visibility = Visibility.Collapsed;
        _ = ShellWebView.CoreWebView2.TrySuspendAsync();
    }

    private void ResumeWebView()
    {
        if (ShellWebView.CoreWebView2 is null)
        {
            ShellWebView.Visibility = Visibility.Visible;
            return;
        }

        ShellWebView.Visibility = Visibility.Visible;
        ShellWebView.CoreWebView2.Resume();
    }

    /// <summary>
    /// True while the automatic hover trigger must stay silent: quiet hours, a full-screen game
    /// (when allowed by the setting) or a presentation.
    /// </summary>
    private bool ShouldSuppressTrigger()
    {
        if (_quietHoursEnabled && IsWithinQuietHours())
        {
            return true;
        }

        int state = Win32.QueryUserNotificationState();
        return state switch
        {
            Win32.QUNS_RUNNING_D3D_FULL_SCREEN => _pauseInFullscreen,
            Win32.QUNS_BUSY => _pauseInFullscreen,
            Win32.QUNS_PRESENTATION_MODE => _pauseInPresentation,
            _ => false,
        };
    }

    private bool IsWithinQuietHours()
    {
        if (!TimeOnly.TryParse(_quietHoursStart, out TimeOnly start) ||
            !TimeOnly.TryParse(_quietHoursEnd, out TimeOnly end))
        {
            return false;
        }

        TimeOnly now = TimeOnly.FromDateTime(DateTime.Now);
        return start <= end
            ? now >= start && now < end
            : now >= start || now < end;
    }

    private void OnCursorPollTick(object? sender, EventArgs e)
    {
        if (!Win32.GetCursorPos(out Win32.POINT cursor))
        {
            return;
        }

        Win32.RECT cursorMonitor = GetActiveMonitorBounds();
        Win32.RECT primaryMonitor = Win32.GetPrimaryMonitorBounds();
        bool onPrimary = IsSameMonitor(cursorMonitor, primaryMonitor);

        // Out-of-scope monitors must not even be sampled, so a stray cursor at the top of a
        // secondary display can never summon the panel.
        bool scopeAllows = string.Equals(_triggerMonitorScope, "all", StringComparison.OrdinalIgnoreCase) || onPrimary;
        int effectiveTriggerWidth = Math.Clamp(_topTriggerWidthPx, 100, cursorMonitor.Width);
        int centerX = cursorMonitor.Left + (cursorMonitor.Width / 2);
        int triggerHeight = Math.Max(26, _topTriggerHeightPx);
        bool inTopTriggerZone =
            scopeAllows &&
            cursor.Y >= (cursorMonitor.Top - 12) &&
            cursor.Y <= (cursorMonitor.Top + triggerHeight) &&
            Math.Abs(cursor.X - centerX) <= (effectiveTriggerWidth / 2);

        Win32.RECT panelTarget = string.Equals(_panelMonitorMode, "primary", StringComparison.OrdinalIgnoreCase)
            ? primaryMonitor
            : cursorMonitor;

        if (!_isExpanded)
        {
            // Re-probe a few times per second rather than on every tick.
            if (_fullscreenProbeCounter++ % 8 == 0)
            {
                _fullscreenAppActive = ShouldSuppressTrigger();
            }

            // Never drop the panel over a game, during quiet hours, or out of scope — the hotkey and
            // the tray menu still open it on demand.
            if (!_topHoverTriggerEnabled || _fullscreenAppActive || !inTopTriggerZone)
            {
                _hoverEnteredTriggerUtc = DateTime.MinValue;
                return;
            }

            if (_topTriggerDelayMs <= 0)
            {
                _hoverEnteredTriggerUtc = DateTime.MinValue;
                _hideDebounceTimer.Stop();
                ExpandPanel(panelTarget);
                return;
            }

            // Dwell continuously inside the zone before opening so a cursor merely passing by never triggers it.
            if (_hoverEnteredTriggerUtc == DateTime.MinValue)
            {
                _hoverEnteredTriggerUtc = DateTime.UtcNow;
                return;
            }

            if ((DateTime.UtcNow - _hoverEnteredTriggerUtc).TotalMilliseconds >= _topTriggerDelayMs)
            {
                _hoverEnteredTriggerUtc = DateTime.MinValue;
                _hideDebounceTimer.Stop();
                ExpandPanel(panelTarget);
            }
            return;
        }

        bool isInsideCard = IsCursorInsideWindow(cursor);
        if (isInsideCard || inTopTriggerZone)
        {
            if (_hideDebounceTimer.IsEnabled)
            {
                _hideDebounceTimer.Stop();
            }
            return;
        }

        if (DateTime.UtcNow < _ignoreAutoHideUntilUtc)
        {
            _hideDebounceTimer.Stop();
            return;
        }
        if (Win32.IsAnyMouseButtonDown())
        {
            _hideDebounceTimer.Stop();
            CollapsePanel();
            return;
        }

        if (!_hideDebounceTimer.IsEnabled)
        {
            _hideDebounceTimer.Start();
        }
    }

    /// <summary>
    /// Uses physical Win32 GetWindowRect coordinates so there is zero DPI scaling mismatch with GetCursorPos.
    /// </summary>
    private bool IsCursorInsideWindow(Win32.POINT screenCursor)
    {
        if (_hwnd == IntPtr.Zero || !Win32.GetWindowRect(_hwnd, out Win32.RECT rect))
            return false;

        return screenCursor.X >= (rect.Left - 2) &&
               screenCursor.X <= (rect.Right + 2) &&
               screenCursor.Y >= (rect.Top - 2) &&
               screenCursor.Y <= (rect.Bottom + 2);
    }

    private void OnHideDebounceTimerTick(object? sender, EventArgs e)
    {
        _hideDebounceTimer.Stop();
        if (!_isExpanded)
            return;

        if (Win32.GetCursorPos(out Win32.POINT cursor))
        {
            Win32.RECT monitor = GetActiveMonitorBounds();
            int triggerHeight = Math.Max(26, _topTriggerHeightPx);
            bool inTrigger = cursor.Y >= (monitor.Top - 12) && cursor.Y <= (monitor.Top + triggerHeight);
            if (IsCursorInsideWindow(cursor) || inTrigger)
                return;
        }

        CollapsePanel();
    }
    public void ExpandPanel(Win32.RECT monitor)
    {
        _slideTimer.Stop();
        _cursorPollTimer.Interval = TimeSpan.FromMilliseconds(25);
        Win32.SetClickThrough(_hwnd, clickThrough: false);
        ResumeWebView();

        bool wasExpanded = _isExpanded;
        _isExpanded = true;

        SlideTo(expanded: true, monitor);

        if (!wasExpanded)
        {
            _log.Write($"expand on monitor {monitor.Left},{monitor.Top} {monitor.Width}x{monitor.Height}");
            EmitFrontendEvent("canopy:set-open", true);
            EmitFrontendEvent("caelestia:set-open", true);
            EmitFrontendEvent("toggle-dropdown", true);
        }
    }

    public void CollapsePanel()
    {
        if (!_isExpanded)
        {
            return;
        }

        _hoverEnteredTriggerUtc = DateTime.MinValue;
        _isExpanded = false;
        _hideDebounceTimer.Stop();

        // Park less aggressively once hidden: the trigger only needs coarse sampling when closed.
        _cursorPollTimer.Interval = TimeSpan.FromMilliseconds(60);

        SlideTo(expanded: false, GetPanelMonitor());
        _log.Write("collapse");

        EmitFrontendEvent("canopy:set-open", false);
        EmitFrontendEvent("caelestia:set-open", false);
        EmitFrontendEvent("toggle-dropdown", false);
    }

    protected override void OnClosed(EventArgs e)
    {
        _cursorPollTimer.Stop();
        _hideDebounceTimer.Stop();
        _slideTimer.Stop();
        _audioController.VolumeStateChanged -= OnMasterVolumeChanged;

        if (_hwnd != IntPtr.Zero)
        {
            _ = Win32.UnregisterHotKey(_hwnd, HotkeyIdToggle);
        }

        RemoveTrayIcon();
        _hwndSource?.RemoveHook(WndProc);
        _audioController.Dispose();
        _audioSessions.Dispose();
        _desktopWallpaper.Dispose();
        _wallpaperService.Dispose();
        _systemMonitorService.Dispose();
        ShellWebView.Dispose();
        _log.Write("shutdown");

        base.OnClosed(e);
    }

    private void InitializeTrayIcon()
    {
        if (_hwnd == IntPtr.Zero || _trayIconCreated) return;
        try
        {
            IntPtr hIcon = IntPtr.Zero;
            string icoPath = System.IO.Path.Combine(AppContext.BaseDirectory, "app.ico");
            if (System.IO.File.Exists(icoPath))
            {
                try
                {
                    _trayIconObj = new System.Drawing.Icon(icoPath, 32, 32);
                    hIcon = _trayIconObj.Handle;
                }
                catch
                {
                }
            }
            if (hIcon == IntPtr.Zero)
            {
                hIcon = Win32.LoadIcon(IntPtr.Zero, Win32.IDI_APPLICATION);
            }

            _trayData = new Win32.NOTIFYICONDATAW
            {
                cbSize = (uint)Marshal.SizeOf<Win32.NOTIFYICONDATAW>(),
                hWnd = _hwnd,
                uID = 1001,
                uFlags = Win32.NIF_MESSAGE | Win32.NIF_ICON | Win32.NIF_TIP,
                uCallbackMessage = (uint)Win32.WM_TRAYICON,
                hIcon = hIcon,
                szTip = "Canopy - Desktop Control Center"
            };
            _trayIconCreated = Win32.Shell_NotifyIcon(Win32.NIM_ADD, ref _trayData);
            if (!_trayIconCreated)
            {
                // Registration was rejected: release the icon handle we created so it cannot leak.
                _trayIconObj?.Dispose();
                _trayIconObj = null;
                _log.Write("tray icon registration failed");
            }
        }
        catch
        {
        }
    }

    private void RemoveTrayIcon()
    {
        if (_trayIconCreated)
        {
            try
            {
                Win32.Shell_NotifyIcon(Win32.NIM_DELETE, ref _trayData);
            }
            catch
            {
            }
            _trayIconCreated = false;
            try
            {
                _trayIconObj?.Dispose();
                _trayIconObj = null;
            }
            catch
            {
            }
        }
    }

    private void ShowTrayContextMenu()
    {
        var menu = new ContextMenu();

        var toggleItem = new MenuItem { Header = _isExpanded ? "Collapse Canopy" : "Open Canopy" };
        toggleItem.Click += (_, _) => ToggleDropdown();
        menu.Items.Add(toggleItem);

        menu.Items.Add(new Separator());

        var dashItem = new MenuItem { Header = "Dashboard" };
        dashItem.Click += (_, _) => { ExpandWithPreviewGrace(); EmitFrontendEvent("navigate_tab", new { tab = "dashboard" }); };
        menu.Items.Add(dashItem);

        var wallItem = new MenuItem { Header = "Wallpapers" };
        wallItem.Click += (_, _) => { ExpandWithPreviewGrace(); EmitFrontendEvent("navigate_tab", new { tab = "wallpaper" }); };
        menu.Items.Add(wallItem);

        var settItem = new MenuItem { Header = "Settings" };
        settItem.Click += (_, _) => { ExpandWithPreviewGrace(); EmitFrontendEvent("navigate_tab", new { tab = "settings" }); };
        menu.Items.Add(settItem);

        menu.Items.Add(new Separator());

        var loggingItem = new MenuItem
        {
            Header = "Diagnostic Logging",
            IsCheckable = true,
            IsChecked = _log.Enabled
        };
        loggingItem.Click += (_, _) =>
        {
            _log.Enabled = loggingItem.IsChecked;
            _log.Write($"diagnostic logging {(loggingItem.IsChecked ? "enabled" : "disabled")}");
        };
        menu.Items.Add(loggingItem);

        var openLogItem = new MenuItem { Header = "Open Log Folder" };
        openLogItem.Click += (_, _) => OpenLogFolder();
        menu.Items.Add(openLogItem);

        var reloadItem = new MenuItem { Header = "Reload Interface" };
        reloadItem.Click += (_, _) => ShellWebView.CoreWebView2?.Reload();
        menu.Items.Add(reloadItem);

        menu.Items.Add(new Separator());

        var exitItem = new MenuItem { Header = "Exit Canopy" };
        exitItem.Click += (_, _) => Application.Current.Shutdown();
        menu.Items.Add(exitItem);

        menu.IsOpen = true;
    }

    private void OpenLogFolder()
    {
        try
        {
            string? folder = System.IO.Path.GetDirectoryName(_log.FilePath);
            if (string.IsNullOrEmpty(folder))
            {
                return;
            }

            System.IO.Directory.CreateDirectory(folder);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            _log.WriteException("open log folder", ex);
        }
    }
}
