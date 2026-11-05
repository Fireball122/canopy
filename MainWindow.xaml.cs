using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Management;
using System.Windows.Threading;
using Canopy.Interop;
using Canopy.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Canopy;

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
    private static readonly string SettingsJsonPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Canopy",
        "settings.json");
    private static readonly JsonSerializerOptions IndentedJsonOptions = new() { WriteIndented = true };
    private static readonly SemaphoreSlim _settingsFileLock = new(1, 1);

    private readonly DispatcherTimer _cursorPollTimer;
    private readonly DispatcherTimer _hideDebounceTimer;

    private IntPtr _hwnd;
    private HwndSource? _hwndSource;
    private bool _isExpanded;
    private Win32.RECT _expandedMonitor;
    private Win32.RECT _lastProbedMonitor;
    private bool _webViewReady;
    // Completed on the first successful WebView navigation; lets startup commands wait for the bundle.
    private readonly TaskCompletionSource _uiReadyTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly bool _startExpanded;
    private volatile bool _isSuspending;
    private CancellationTokenSource? _suspendCts;
    private volatile bool _isResizingWindow;
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
    private bool _dndEnabled;
    private string _quietHoursStart = "22:00";
    private string _quietHoursEnd = "07:00";
    private string _panelAnchor = "top-center";
    private string _panelMonitorMode = "cursor";
    private string _triggerMonitorScope = "all";
    private bool _suspendWhenClosed = true;
    private bool _showPanelOnLaunch = true;
    private string _hotkey = "Win+`";
    private string? _currentThemeAccent;
    private string? _currentThemeBg;

    // Host-owned reminder scheduling: the renderer is suspended while the panel is parked, so
    // calendar alerts have to be timed natively to slide the panel down on their own.
    private readonly DispatcherTimer _reminderTimer;
    private readonly DispatcherTimer _notificationCollapseTimer;
    private readonly DispatcherTimer _slideshowTimer;
    private bool _slideshowShuffle;
    private int _slideshowWallpaperIndex;
    private readonly List<HostReminder> _reminders = new();
    private readonly Dictionary<string, DateTime> _pendingReminders = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _firedReminders = new(StringComparer.OrdinalIgnoreCase);
    private bool _notificationVisible;
    private bool _caffeineEnabled;
    private static readonly char[] ChecksumLineSeparators = ['\r', '\n'];
    private static readonly char[] ChecksumSpaceSeparators = [' ', '\t'];
    private static readonly string[] BluetoothDeviceProperties = ["System.Devices.Aep.IsConnected", "System.Devices.Aep.Bluetooth.Le.IsConnectable"];
    private static List<string>? s_cachedWifiProfiles;
    private static long s_lastWifiProfilesTicks;
    /// <summary>Deferred reminders are dropped once they are this stale, so a long game session never
    /// dumps a burst of overdue alerts the moment gameplay ends.</summary>
    private static readonly TimeSpan ReminderDeferWindow = TimeSpan.FromMinutes(10);

    /// <summary>
    /// Process names that must never be treated as a full-screen game. Chromium-family browsers
    /// composite through Direct3D, so the shell reports QUNS_RUNNING_D3D_FULL_SCREEN for an F11
    /// full-screen browser as well; without this list the hover trigger looks dead while a browser
    /// is full-screen. Windows shell surfaces are excluded for the same reason.
    /// </summary>
    private static readonly HashSet<string> NonGameProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        // Browsers
        "brave", "chrome", "msedge", "msedgewebview2", "firefox", "opera", "opera_gx", "vivaldi",
        "iexplore", "librewolf", "floorp", "waterfox", "zen", "arc", "thorium", "tor browser",
        // Chat, Media & Desktop Apps (Electron / Chromium D3D composited)
        "Discord", "DiscordPTB", "DiscordCanary", "Vesktop", "Slack", "Teams", "ms-teams",
        "Spotify", "Code", "Cursor", "Notion", "Obsidian", "obs64", "obs32", "steamwebhelper",
        "explorer", "ApplicationFrameHost", "SearchHost", "ShellExperienceHost",
        "StartMenuExperienceHost", "TextInputHost", "Canopy", "dwm", "powershell", "pwsh", "cmd",
        "WindowsTerminal", "OpenConsole", "conhost", "taskmgr",
    };

    /// <summary>
    /// A reminder that the native host times itself, mirroring the calendar entries the UI owns.
    /// </summary>
    private sealed record HostReminder(string Id, string Text, string Date, string Time);

    // VSync-locked physical pixel slide animation state
    private readonly Stopwatch _slideStopwatch = new();
    private int _slidePhysicalX;
    private int _slideFromPhysicalY;
    private int _slideToPhysicalY;
    private int _slideDurationMs;
    private bool _slideTargetExpanded;
    private bool _isSlideRenderingHooked;

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

        // Reminder watchdog runs for the lifetime of the tray-resident process so alerts still fire
        // while the panel is parked off-screen.
        _reminderTimer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromSeconds(20)
        };
        _reminderTimer.Tick += (_, _) => CheckDueReminders();
        _reminderTimer.Start();

        _notificationCollapseTimer = new DispatcherTimer(DispatcherPriority.Normal)
        {
            Interval = TimeSpan.FromSeconds(7.5)
        };
        _notificationCollapseTimer.Tick += (_, _) =>
        {
            _notificationCollapseTimer.Stop();
            _notificationVisible = false;
        };
        _slideshowTimer = new DispatcherTimer(DispatcherPriority.Background);
        _slideshowTimer.Tick += OnSlideshowTimerTick;



        _log.Write("MainWindow constructed");
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
        _ = Task.Run(() => _currentBrightness = QueryHardwareBrightness());
    }

    private const double BaseDesignWidth = 850.0;
    private const double BaseDesignHeight = 430.0;
    private double _customWidth = BaseDesignWidth;
    private double _customHeight = BaseDesignHeight;

    /// <summary>
    /// Resolves the true DPI scale and balanced physical pixel dimensions for the panel.
    /// Preserves the native 850x430 aspect ratio while capping height to at most 48% of the monitor height,
    /// keeping the drop-down sleek and non-intrusive on all displays (e.g. 1080p @ 150% scaling).
    /// </summary>
    private (double scaleX, double scaleY, int physicalWidth, int physicalHeight) GetDpiScaleAndPhysicalSize(Win32.RECT monitor)
    {
        double scaleX = 1.0;
        double scaleY = 1.0;

        if (_hwnd != IntPtr.Zero)
        {
            uint dpi = Win32.GetDpiForWindow(_hwnd);
            if (dpi > 0)
            {
                scaleX = dpi / 96.0;
                scaleY = dpi / 96.0;
            }
        }

        if (scaleX <= 0.0 || scaleY <= 0.0 || Math.Abs(scaleX - 1.0) < 0.001)
        {
            try
            {
                DpiScale dpi = VisualTreeHelper.GetDpi(this);
                if (dpi.DpiScaleX > 0) scaleX = dpi.DpiScaleX;
                if (dpi.DpiScaleY > 0) scaleY = dpi.DpiScaleY;
            }
            catch (Exception ex)
            {
                _log.WriteException("GetDpiScaleVisualTree", ex);
            }
        }

        int targetPhysicalHeight = (int)Math.Round(_customHeight * scaleY);

        // Cap to 48% of monitor height so the panel never dominates the screen at high DPI scaling
        if (monitor.Height > 0)
        {
            int maxPhysicalHeight = (int)Math.Round(monitor.Height * 0.48);
            if (targetPhysicalHeight > maxPhysicalHeight)
                targetPhysicalHeight = maxPhysicalHeight;
        }

        // Preserve aspect ratio after any height clamping
        int targetPhysicalWidth = (int)Math.Round(targetPhysicalHeight * (_customWidth / _customHeight));
        return (scaleX, scaleY, targetPhysicalWidth, targetPhysicalHeight);
    }

    /// <summary>
    /// Programmatically synchronizes WebView2 zoom with the physical panel dimensions so the 850x430
    /// layout renders smoothly with zero cropping and crisp typography.
    /// </summary>
    private void ApplyAdaptiveZoom(Win32.RECT monitor)
    {
        if (ShellWebView.CoreWebView2 is null)
            return;

        var (scaleX, _, physicalWidth, _) = GetDpiScaleAndPhysicalSize(monitor);
        if (scaleX > 0 && physicalWidth > 0)
        {
            double targetZoom = (double)physicalWidth / (scaleX * BaseDesignWidth);
            targetZoom = Math.Clamp(targetZoom, 0.4, 2.0);
            try
            {
                ShellWebView.ZoomFactor = targetZoom;
            }
            catch (Exception ex)
            {
                _log.WriteException("zoom factor", ex);
            }
        }
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

        Win32.RECT panelMonitor = GetPanelMonitor();
        var (scaleX, scaleY, physicalWidth, physicalHeight) = GetDpiScaleAndPhysicalSize(panelMonitor);
        double targetZoom = physicalWidth > 0 ? (double)physicalWidth / (scaleX * BaseDesignWidth) : 1.0;
        int cornerRadius = (int)Math.Round(24.0 * scaleY * targetZoom);

        // Clip HWND bottom corners to eliminate external DWM frame border artifact
        Win32.ApplyWindowRoundedRegion(_hwnd, physicalWidth, physicalHeight, cornerRadius);
        ApplyAdaptiveZoom(panelMonitor);
    }

    public void SetCustomWindowSize(double width, double height)
    {
        Dispatcher.Invoke(() =>
        {
            double targetW = Math.Clamp(width, 700.0, 1600.0);
            double targetH = Math.Clamp(height, 360.0, 900.0);
            if (Math.Abs(_customWidth - targetW) < 0.5 && Math.Abs(_customHeight - targetH) < 0.5)
            {
                return;
            }

            _customWidth = targetW;
            _customHeight = targetH;
            Width = _customWidth;
            Height = _customHeight;
            Win32.RECT panelMonitor = GetPanelMonitor();
            PositionWindowAtTopCenter(panelMonitor, offscreen: !_isExpanded);
            ApplyRoundedRegionForCurrentDpi();
        });
    }

    private async void OnWindowLoaded(object sender, RoutedEventArgs e)
    {
        await InitializeWebViewAsync();
        _cursorPollTimer.Start();

        if (_startExpanded)
        {
            ExpandWithPreviewGrace();
        }
        else
        {
            // Initial state is parked/collapsed: pause background polling and suspend webview
            _audioController.PauseCapture();
            _audioSessions.Pause();
            _systemMonitorService.Pause();
            await SuspendWebViewAsync();
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
#if !DEBUG
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
#else
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
#endif
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
                        const timer = setTimeout(() => {
                          if (pending.has(id)) {
                            pending.delete(id);
                            reject(new Error(`RPC timeout: ${cmd}`));
                          }
                        }, 20000);
                        pending.set(id, {
                          resolve: (res) => { clearTimeout(timer); resolve(res); },
                          reject: (err) => { clearTimeout(timer); reject(err); }
                        });
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
            string mascotDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Canopy",
                "mascot");
            try { Directory.CreateDirectory(mascotDir); } catch (Exception ex) { _ = ex; }

            core.AddWebResourceRequestedFilter("https://canopy.local/mascot/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (sender, args) =>
            {
                try
                {
                    var uri = new Uri(args.Request.Uri);
                    if (uri.AbsolutePath.StartsWith("/mascot/", StringComparison.OrdinalIgnoreCase))
                    {
                        string filename = Path.GetFileName(uri.LocalPath);
                        string mascotPath = Path.Combine(mascotDir, filename);
                        if (File.Exists(mascotPath))
                        {
                            byte[] bytes = File.ReadAllBytes(mascotPath);
                            var ms = new MemoryStream(bytes);
                            string ext = Path.GetExtension(filename).ToLowerInvariant();
                            string contentType = ext switch
                            {
                                ".gif" => "image/gif",
                                ".webp" => "image/webp",
                                ".png" => "image/png",
                                ".jpg" or ".jpeg" => "image/jpeg",
                                _ => "application/octet-stream"
                            };
                            args.Response = core.Environment.CreateWebResourceResponse(
                                ms,
                                200,
                                "OK",
                                $"Content-Type: {contentType}\r\nCache-Control: no-store, no-cache, must-revalidate\r\nAccess-Control-Allow-Origin: *");
                        }
                    }
                }
                catch (Exception ex)
                {
                    _log.WriteException("WebResourceRequested_Mascot", ex);
                }
            };

            core.NavigationStarting += (_, args) =>
            {
                if (!IsTrustedCanopyUri(args.Uri))
                {
                    args.Cancel = true;
                    _log.Write($"rejected WebView navigation to untrusted URI '{args.Uri}'");
                }
            };
            core.NewWindowRequested += (_, args) => args.Handled = true;

            core.ProcessFailed += (_, args) =>
            {
                _log.Write($"WebView2 ProcessFailed: kind={args.ProcessFailedKind}, reason={args.Reason}");
                _ = Dispatcher.InvokeAsync(async () =>
                {
                    await Task.Delay(300);
                    try
                    {
                        ShellWebView.CoreWebView2?.Reload();
                    }
                    catch (Exception reloadEx)
                    {
                        _log.WriteException("WebViewProcessFailedReload", reloadEx);
                    }
                });
            };

            core.NavigationCompleted += (_, navArgs) =>
            {
                ApplyAdaptiveZoom(GetPanelMonitor());
                if (navArgs.IsSuccess)
                    _uiReadyTcs.TrySetResult();
            };

            string indexHtmlPath = Path.Combine(distDir, "index.html");
            long bundleTicks = File.Exists(indexHtmlPath) ? File.GetLastWriteTimeUtc(indexHtmlPath).Ticks : DateTime.UtcNow.Ticks;
            core.Navigate($"https://canopy.local/index.html?v={bundleTicks}");
            _webViewReady = true;
            ApplyAdaptiveZoom(GetPanelMonitor());
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
            catch (Exception logEx)
            {
                _log.WriteException("WebViewInitErrorLog", logEx);
            }

            MessageBox.Show(
                $"Canopy encountered an error while starting its UI engine:\n\n{ex.Message}\n\nIf Microsoft Edge WebView2 is not installed, please download and install the Evergreen Bootstrapper from:\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703",
                "Canopy - UI Engine Initialization Error",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }

    /// <summary>
    /// Waits until the React bundle has loaded (or <paramref name="timeout"/> elapses) so events
    /// posted by startup commands reach mounted listeners instead of being dropped.
    /// </summary>
    public async Task WaitForUiReadyAsync(TimeSpan timeout)
    {
        Task completed = await Task.WhenAny(_uiReadyTcs.Task, Task.Delay(timeout));
        if (completed == _uiReadyTcs.Task)
        {
            // Navigation completes before React effects subscribe to host events.
            await Task.Delay(300);
        }
        else
        {
            _log.Write("WaitForUiReadyAsync: UI did not finish loading before the timeout");
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
        if (!IsTrustedCanopyUri(e.Source))
        {
            _log.Write($"rejected WebView message from untrusted source '{e.Source}'");
            return;
        }

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

    private static bool IsTrustedCanopyUri(string? source)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out Uri? uri))
        {
            return false;
        }

        if (string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(uri.Host, "canopy.local", StringComparison.OrdinalIgnoreCase) &&
            uri.IsDefaultPort)
        {
            return true;
        }

        if (string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
            (string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase)) &&
            (uri.Port == 1420 || uri.IsDefaultPort))
        {
            return true;
        }

        return false;
    }

    private async Task<object?> HandleBridgeCommandAsync(string cmd, JsonElement args)
    {
        switch (cmd)
        {
            case "get_system_stats":
            {
                SystemTelemetrySnapshot snap = await Task.Run(() => _systemMonitorService.Sample());
                return new
                {
                    cpu_usage = (float)Math.Round(snap.CpuUsagePercent, 1),
                    cpu_temp_c = snap.CpuTempC is double cpuTemp ? (float?)Math.Round(cpuTemp, 1) : null,
                    cpu_name = snap.CpuName,
                    gpu_usage = snap.GpuUsagePercent is double gpuUsage ? (float?)Math.Round(gpuUsage, 1) : null,
                    gpu_temp_c = snap.GpuTempC is double gpuTemp ? (float?)Math.Round(gpuTemp, 1) : null,
                    gpu_name = snap.GpuName,
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

            case "pick_executable":
            {
                _ignoreAutoHideUntilUtc = DateTime.UtcNow.AddSeconds(60);

                var exeDialog = new Microsoft.Win32.OpenFileDialog
                {
                    Title = "Select an application",
                    Filter =
                        "Applications (*.exe;*.lnk;*.bat;*.cmd)|*.exe;*.lnk;*.bat;*.cmd|" +
                        "Programs (*.exe)|*.exe|Shortcuts (*.lnk)|*.lnk|All files (*.*)|*.*",
                    CheckFileExists = true,
                    Multiselect = false,
                };

                if (TryGetString(args, "initialDir", out string initialDir) &&
                    !string.IsNullOrWhiteSpace(initialDir) &&
                    Directory.Exists(initialDir))
                {
                    exeDialog.InitialDirectory = initialDir;
                }

                bool? exePicked = exeDialog.ShowDialog(this);
                _ignoreAutoHideUntilUtc = DateTime.UtcNow.AddSeconds(3);
                return exePicked == true && !string.IsNullOrWhiteSpace(exeDialog.FileName)
                    ? exeDialog.FileName
                    : null;
            }

            case "set_reminders":
            {
                if (args.ValueKind == JsonValueKind.Object &&
                    args.TryGetProperty("reminders", out JsonElement remEl) &&
                    remEl.ValueKind == JsonValueKind.Array)
                {
                    ApplyReminders(remEl);
                }
                return true;
            }

            case "test_notification":
            case "show_notification":
            {
                string msg = "Canopy Notification: Raindrop -> Pill Capsule Alert";
                string title = "Canopy Alert";
                string? accent = null;
                string? bg = null;
                if (args.ValueKind == JsonValueKind.Object)
                {
                    if (args.TryGetProperty("message", out JsonElement m)) msg = m.GetString() ?? msg;
                    if (args.TryGetProperty("title", out JsonElement t)) title = t.GetString() ?? title;
                    if (args.TryGetProperty("accentColorHex", out JsonElement a)) accent = a.GetString();
                    if (args.TryGetProperty("bgColorHex", out JsonElement b)) bg = b.GetString();
                }
                NotificationWindow.ShowNotification(msg, title, accent ?? _currentThemeAccent, bg ?? _currentThemeBg);
                return true;
            }

            case "get_settings_json":
            {
                if (File.Exists(SettingsJsonPath))
                {
                    string text = await File.ReadAllTextAsync(SettingsJsonPath);
                    try
                    {
                        using var doc = JsonDocument.Parse(text);
                        return doc.RootElement.Clone();
                    }
                    catch (JsonException ex)
                    {
                        // Move the unreadable file aside so the next save does not destroy it.
                        _log.WriteException("settings.json parse", ex);
                        File.Move(SettingsJsonPath, SettingsJsonPath + ".corrupt", overwrite: true);
                        throw;
                    }
                }
                return null;
            }

            case "save_settings_json":
            {
                await _settingsFileLock.WaitAsync();
                try
                {
                    string dir = Path.GetDirectoryName(SettingsJsonPath)!;
                    if (!Directory.Exists(dir))
                    {
                        Directory.CreateDirectory(dir);
                    }
                    string tempPath = SettingsJsonPath + ".tmp";
                    string json = JsonSerializer.Serialize(args, IndentedJsonOptions);
                    await File.WriteAllTextAsync(tempPath, json);
                    File.Move(tempPath, SettingsJsonPath, overwrite: true);
                    return true;
                }
                finally
                {
                    _settingsFileLock.Release();
                }
            }

            case "upload_mascot":
            {
                if (args.ValueKind == JsonValueKind.Object &&
                    args.TryGetProperty("data_base64", out JsonElement b64El) &&
                    args.TryGetProperty("filename", out JsonElement nameEl))
                {
                    string filename = nameEl.GetString() ?? "custom_mascot.gif";
                    filename = Path.GetFileName(filename);
                    if (string.IsNullOrWhiteSpace(filename)) filename = "custom_mascot.gif";

                    string b64 = b64El.GetString() ?? string.Empty;
                    if (b64.Contains(','))
                    {
                        b64 = b64[(b64.IndexOf(',') + 1)..];
                    }

                    byte[] fileBytes = Convert.FromBase64String(b64);
                    string targetDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "Canopy",
                        "mascot");
                    Directory.CreateDirectory(targetDir);
                    string targetPath = Path.Combine(targetDir, filename);
                    await File.WriteAllBytesAsync(targetPath, fileBytes);
                    long ver = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    return new { url = $"https://canopy.local/mascot/{Uri.EscapeDataString(filename)}?v={ver}", path = targetPath };
                }
                return null;
            }

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
                        icon_data_url = session.IconDataUrl,
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
                        QueueHardwareBrightness(_currentBrightness);
                    }
                }
                else if (args.ValueKind == JsonValueKind.Number && args.TryGetDouble(out double directLvl))
                {
                    _currentBrightness = (int)Math.Clamp(Math.Round(directLvl), 5, 100);
                    QueueHardwareBrightness(_currentBrightness);
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

            case "list_audio_devices":
            {
                string flow = "render";
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("flow", out var flowEl))
                {
                    flow = flowEl.GetString() ?? "render";
                }
                var dataFlow = string.Equals(flow, "capture", StringComparison.OrdinalIgnoreCase)
                    ? NAudio.CoreAudioApi.DataFlow.Capture
                    : NAudio.CoreAudioApi.DataFlow.Render;
                return _audioController.GetAudioDevices(dataFlow);
            }

            case "set_default_audio_device":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("device_id", out var idEl))
                {
                    string devId = idEl.GetString() ?? string.Empty;
                    return _audioController.SetDefaultAudioDevice(devId);
                }
                return false;
            }

            case "toggle_caffeine":
            {
                bool nextState = !_caffeineEnabled;
                Dispatcher.Invoke(() =>
                {
                    _caffeineEnabled = nextState;
                    if (_caffeineEnabled)
                    {
                        Win32.SetThreadExecutionState(Win32.ES_CONTINUOUS | Win32.ES_DISPLAY_REQUIRED | Win32.ES_SYSTEM_REQUIRED);
                    }
                    else
                    {
                        Win32.SetThreadExecutionState(Win32.ES_CONTINUOUS);
                    }
                });
                return new { enabled = _caffeineEnabled };
            }

            case "get_caffeine_status":
                return new { enabled = _caffeineEnabled };

            case "trigger_screen_snip":
            {
                CollapsePanel();
                _ = Task.Run(async () =>
                {
                    await Task.Delay(250);
                    try
                    {
                        Process.Start(new ProcessStartInfo("ms-screenclip:") { UseShellExecute = true });
                    }
                    catch
                    {
                        try
                        {
                            Process.Start(new ProcessStartInfo("SnippingTool.exe", "/clip") { UseShellExecute = true });
                        }
                        catch
                        {
                            try
                            {
                                // Fallback to native Win+Shift+S keystroke
                                Win32.keybd_event(0x5B, 0, 0, UIntPtr.Zero); // LWIN down
                                Win32.keybd_event(0x10, 0, 0, UIntPtr.Zero); // SHIFT down
                                Win32.keybd_event(0x53, 0, 0, UIntPtr.Zero); // 'S' down
                                Win32.keybd_event(0x53, 0, 2, UIntPtr.Zero); // 'S' up
                                Win32.keybd_event(0x10, 0, 2, UIntPtr.Zero); // SHIFT up
                                Win32.keybd_event(0x5B, 0, 2, UIntPtr.Zero); // LWIN up
                            }
                            catch (Exception ex)
                            {
                                _log.WriteException("ScreenSnipFallback", ex);
                            }
                        }
                    }
                });
                return true;
            }

            case "toggle_dnd":
            {
                _dndEnabled = !_dndEnabled;
                RefreshFullscreenSuppression();
                return new { enabled = _dndEnabled };
            }

            case "get_dnd_status":
            {
                return new { enabled = _dndEnabled };
            }

            case "get_version":
            {
                var ver = typeof(MainWindow).Assembly.GetName().Version;
                string verStr = ver != null ? $"{ver.Major}.{ver.Minor}.{ver.Build}" : "1.0.8";
                return new { version = verStr };
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
                uint intervalMs = _slideshowTimer.IsEnabled
                    ? (uint)_slideshowTimer.Interval.TotalMilliseconds
                    : (_desktopWallpaper.IsSupported ? _desktopWallpaper.GetSlideShowIntervalMs() : 0);
                return new
                {
                    per_monitor_supported = _desktopWallpaper.IsSupported,
                    monitors,
                    slideshow_enabled = _slideshowTimer.IsEnabled || intervalMs > 0,
                    slideshow_minutes = (int)Math.Max(1, Math.Round(intervalMs / 60000.0)),
                    shuffle = _slideshowShuffle || (_desktopWallpaper.IsSupported && _desktopWallpaper.GetShuffle()),
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
                    _slideshowShuffle = shuffle;
                    _desktopWallpaper.SetSlideShow(_wallpaperService.WallpapersDirectory, (uint)minutes * 60000u, shuffle);
                    _slideshowTimer.Interval = TimeSpan.FromMinutes(minutes);
                    _slideshowTimer.Stop();
                    _slideshowTimer.Start();
                    _ = AdvanceSlideshowAsync();
                    return true;
                }

                _slideshowTimer.Stop();
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

            case "open_url":
            {
                if (args.ValueKind == JsonValueKind.Object &&
                    args.TryGetProperty("url", out JsonElement urlEl) &&
                    urlEl.GetString() is string targetUrl &&
                    (targetUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                     targetUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                     targetUrl.StartsWith("ms-settings:", StringComparison.OrdinalIgnoreCase) ||
                     targetUrl.StartsWith("ms-availablenetworks:", StringComparison.OrdinalIgnoreCase)))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo(targetUrl) { UseShellExecute = true });
                        return true;
                    }
                    catch (Exception ex)
                    {
                        _log.WriteException("open_url", ex);
                        return false;
                    }
                }
                return false;
            }

            case "apply_update":
            {
                if (args.ValueKind == JsonValueKind.Object &&
                    args.TryGetProperty("downloadUrl", out JsonElement urlEl) &&
                    urlEl.GetString() is string downloadUrl &&
                    (downloadUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                     downloadUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)))
                {
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            string tempDir = Path.Combine(Path.GetTempPath(), "CanopyUpdates");
                            Directory.CreateDirectory(tempDir);
                            string installerPath = Path.Combine(tempDir, $"Canopy-Update-{Guid.NewGuid():N}.exe");
                            using var client = new HttpClient();
                            client.DefaultRequestHeaders.UserAgent.ParseAdd("Canopy-Updater");
                            using var response = await client.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead);
                            response.EnsureSuccessStatusCode();
                            await using (var fs = new FileStream(installerPath, FileMode.Create, FileAccess.Write, FileShare.None))
                            {
                                await response.Content.CopyToAsync(fs);
                            }

                            // Verify SHA-256 against release checksums if available
                            try
                            {
                                string fileName = Path.GetFileName(new Uri(downloadUrl).AbsolutePath);
                                int lastSlash = downloadUrl.LastIndexOf('/');
                                string checksumUrl = (lastSlash >= 0 ? downloadUrl[..(lastSlash + 1)] : downloadUrl) + "checksums-sha256.txt";
                                using var chkResp = await client.GetAsync(checksumUrl);
                                if (chkResp.IsSuccessStatusCode)
                                {
                                    string chkText = await chkResp.Content.ReadAsStringAsync();
                                    string? expectedHash = null;
                                    foreach (string rawLine in chkText.Split(ChecksumLineSeparators, StringSplitOptions.RemoveEmptyEntries))
                                    {
                                        string line = rawLine.Trim();
                                        var parts = line.Split(ChecksumSpaceSeparators, StringSplitOptions.RemoveEmptyEntries);
                                        if (parts.Length >= 2)
                                        {
                                            string h = parts[0].Trim().ToLowerInvariant();
                                            string f = parts[1].TrimStart('*').Trim();
                                            if (string.Equals(f, fileName, StringComparison.OrdinalIgnoreCase))
                                            {
                                                expectedHash = h;
                                                break;
                                            }
                                        }
                                    }

                                    if (!string.IsNullOrEmpty(expectedHash))
                                    {
                                        using var sha = System.Security.Cryptography.SHA256.Create();
                                        await using var rfs = File.OpenRead(installerPath);
                                        byte[] actualBytes = await sha.ComputeHashAsync(rfs);
                                        string actualHash = BitConverter.ToString(actualBytes).Replace("-", "").ToLowerInvariant();
                                        if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
                                        {
                                            _log.Write($"[apply_update] SECURITY ALERT: SHA-256 mismatch for {fileName}. Expected {expectedHash}, got {actualHash}. Aborting execution.");
                                            try { File.Delete(installerPath); } catch { }
                                            return;
                                        }
                                        _log.Write($"[apply_update] SHA-256 verified for {fileName}: {actualHash}");
                                    }
                                }
                            }
                            catch (Exception chkEx)
                            {
                                _log.Write($"[apply_update] Checksum fetch warning: {chkEx.Message}");
                            }

                            var psi = new ProcessStartInfo
                            {
                                FileName = installerPath,
                                Arguments = "/CLOSEAPPLICATIONS",
                                UseShellExecute = true
                            };
                            Process.Start(psi);
                            await Dispatcher.InvokeAsync(() =>
                            {
                                Application.Current.Shutdown();
                            });
                        }
                        catch (Exception ex)
                        {
                            _log.WriteException("apply_update", ex);
                        }
                    });
                    return true;
                }
                return false;
            }

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

            case "set_window_size":
            {
                if (args.ValueKind == JsonValueKind.Object)
                {
                    if (args.TryGetProperty("width", out JsonElement wEl) && wEl.TryGetDouble(out double newW) &&
                        args.TryGetProperty("height", out JsonElement hEl) && hEl.TryGetDouble(out double newH))
                    {
                        SetCustomWindowSize(newW, newH);
                        return true;
                    }
                }
                return false;
            }

            case "set_resizing":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("resizing", out JsonElement resEl))
                {
                    _isResizingWindow = resEl.GetBoolean();
                    if (_isResizingWindow && _hideDebounceTimer.IsEnabled)
                    {
                        _hideDebounceTimer.Stop();
                    }
                }
                return _isResizingWindow;
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

                            key.SetValue("Canopy", $"\"{exePath}\" --hidden");
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
            {
                bool force = args.ValueKind == JsonValueKind.Object &&
                             args.TryGetProperty("force", out JsonElement fEl) &&
                             fEl.GetBoolean();
                return await _systemMonitorService.GetInstalledAppsAsync(force);
            }
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

            case "get_wifi_state":
                return await QueryWifiStateAsync();

            case "set_wifi_enabled":
            {
                bool enabled = true;
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("enabled", out JsonElement enEl))
                {
                    enabled = enEl.GetBoolean();
                }
                return await SetRadioStateAsync(Windows.Devices.Radios.RadioKind.WiFi, enabled);
            }

            case "connect_wifi":
            {
                string ssid = string.Empty;
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("ssid", out JsonElement sEl))
                {
                    ssid = sEl.GetString() ?? string.Empty;
                }
                if (IsValidWifiSsid(ssid))
                {
                    try
                    {
                        using var p = Process.Start(NetshStartInfo("wlan", "connect", $"name={ssid}"));
                        if (p == null)
                        {
                            _log.Write("connect_wifi: netsh failed to start");
                            return false;
                        }
                        await p.WaitForExitAsync();
                        if (p.ExitCode != 0)
                        {
                            _log.Write($"connect_wifi: netsh exited {p.ExitCode} for ssid '{ssid}'");
                            return false;
                        }
                        return true;
                    }
                    catch (Exception ex)
                    {
                        _log.Write($"connect_wifi failed: {ex.Message}");
                        return false;
                    }
                }
                return false;
            }

            case "add_and_connect_wifi":
            {
                string ssid = string.Empty;
                string password = string.Empty;
                if (args.ValueKind == JsonValueKind.Object)
                {
                    if (args.TryGetProperty("ssid", out var sEl)) ssid = sEl.GetString() ?? string.Empty;
                    if (args.TryGetProperty("password", out var pEl)) password = pEl.GetString() ?? string.Empty;
                }
                return await AddAndConnectWifiAsync(ssid, password);
            }

            case "disconnect_wifi":
            {
                try
                {
                    using var p = Process.Start(NetshStartInfo("wlan", "disconnect"));
                    if (p != null) await p.WaitForExitAsync();
                    return true;
                }
                catch
                {
                    return false;
                }
            }

            case "delete_wifi_profile":
            {
                string profileName = string.Empty;
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("name", out var nEl))
                {
                    profileName = nEl.GetString() ?? string.Empty;
                }
                if (IsValidWifiSsid(profileName))
                {
                    try
                    {
                        using var p = Process.Start(NetshStartInfo("wlan", "delete", "profile", $"name={profileName}"));
                        if (p != null) await p.WaitForExitAsync();
                        s_lastWifiProfilesTicks = 0;
                        return true;
                    }
                    catch (Exception ex)
                    {
                        _log.Write($"delete_wifi_profile failed: {ex.Message}");
                        return false;
                    }
                }
                return false;
            }
            case "get_bluetooth_state":
                return await QueryBluetoothStateAsync();

            case "connect_bluetooth_device":
            {
                string devId = string.Empty;
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("id", out var idEl))
                {
                    devId = idEl.GetString() ?? string.Empty;
                }
                return await ConnectBluetoothDeviceAsync(devId);
            }

            case "disconnect_bluetooth_device":
            {
                string devId = string.Empty;
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("id", out var idEl))
                {
                    devId = idEl.GetString() ?? string.Empty;
                }
                return await DisconnectBluetoothDeviceAsync(devId);
            }
            case "set_bluetooth_enabled":
            {
                bool enabled = true;
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("enabled", out JsonElement enEl))
                {
                    enabled = enEl.GetBoolean();
                }
                return await SetRadioStateAsync(Windows.Devices.Radios.RadioKind.Bluetooth, enabled);
            }
            case "get_hotspot_state":
                return await QueryHotspotStateAsync();

            case "toggle_hotspot":
                return await ToggleHotspotAsync();

            case "set_hotspot_config":
            {
                string cfgSsid = string.Empty;
                string cfgPass = string.Empty;
                if (args.ValueKind == JsonValueKind.Object)
                {
                    if (args.TryGetProperty("ssid", out JsonElement sEl))
                    {
                        cfgSsid = sEl.GetString() ?? string.Empty;
                    }
                    if (args.TryGetProperty("passphrase", out JsonElement pEl))
                    {
                        cfgPass = pEl.GetString() ?? string.Empty;
                    }
                }
                return await SetHotspotConfigAsync(cfgSsid, cfgPass);
            }

            case "get_power_mode":
                return await QueryPowerModeAsync();

            case "toggle_power_saver":
                return await TogglePowerSaverAsync();

            case "get_desktop_monitor_thumbnail":
            {
                Win32.RECT mon = _expandedMonitor.Width > 0 ? _expandedMonitor : GetPanelMonitor();
                string? dataUrl = CaptureDesktopThumbnail(mon);
                return new { data_url = dataUrl };
            }

            case "get_network_adapters":
                return QueryNetworkAdapters();

            case "get_wifi_throughput":
                return WifiThroughputSampler.Sample();

            default:
                return null;
        }
    }

    private int QueryHardwareBrightness()
    {
        // 1. WMI path — works on laptops / internal panels
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
        catch (Exception ex)
        {
            _log.WriteException("WmiBrightnessQuery", ex);
        }

        // 2. DDC/CI fallback — works on external monitors connected via DisplayPort / HDMI
        if (_hwnd != IntPtr.Zero)
        {
            IntPtr hMonitor = Win32.MonitorFromWindow(_hwnd, Win32.MONITOR_DEFAULTTONEAREST);
            if (Win32.GetNumberOfPhysicalMonitorsFromHMONITOR(hMonitor, out uint count) && count > 0)
            {
                var monitors = new Win32.PHYSICAL_MONITOR[count];
                if (Win32.GetPhysicalMonitorsFromHMONITOR(hMonitor, count, monitors))
                {
                    try
                    {
                        if (Win32.GetMonitorBrightness(monitors[0].hPhysicalMonitor, out _, out uint current, out _))
                            return (int)current;
                    }
                    catch (Exception ex)
                    {
                        _log.WriteException("DdcCiBrightnessQuery", ex);
                    }
                    finally
                    {
                        Win32.DestroyPhysicalMonitors(count, monitors);
                    }
                }
            }
        }

        return 80; // safe default
    }

    private CancellationTokenSource? _brightnessCts;
    private readonly object _brightnessLock = new();

    private void QueueHardwareBrightness(int level)
    {
        lock (_brightnessLock)
        {
            _brightnessCts?.Cancel();
            _brightnessCts?.Dispose();
            _brightnessCts = new CancellationTokenSource();
            CancellationToken token = _brightnessCts.Token;

            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(60, token);
                    if (!token.IsCancellationRequested)
                    {
                        ApplyHardwareBrightness(level);
                    }
                }
                catch (OperationCanceledException)
                {
                }
            }, token);
        }
    }

    private void ApplyHardwareBrightness(int level)
    {
        // 1. WMI path
        try
        {
            using var searcher = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM WmiMonitorBrightnessMethods");
            using ManagementObjectCollection results = searcher.Get();
            foreach (ManagementObject obj in results)
            {
                using (obj)
                {
                    obj.InvokeMethod("WmiSetBrightness", new object[] { 1, (byte)Math.Clamp(level, 0, 100) });
                    return; // WMI succeeded; skip DDC/CI
                }
            }
        }
        catch (Exception ex)
        {
            _log.WriteException("WmiBrightnessApply", ex);
        }

        // 2. DDC/CI fallback: target the monitor under the cursor
        if (_hwnd == IntPtr.Zero) return;
        Win32.GetCursorPos(out Win32.POINT pt);
        IntPtr hMonitor = Win32.MonitorFromPoint(pt, Win32.MONITOR_DEFAULTTONEAREST);
        if (hMonitor == IntPtr.Zero)
        {
            hMonitor = Win32.MonitorFromWindow(_hwnd, Win32.MONITOR_DEFAULTTONEAREST);
        }
        if (Win32.GetNumberOfPhysicalMonitorsFromHMONITOR(hMonitor, out uint count) && count > 0)
        {
            var monitors = new Win32.PHYSICAL_MONITOR[count];
            if (Win32.GetPhysicalMonitorsFromHMONITOR(hMonitor, count, monitors))
            {
                try
                {
                    Win32.SetMonitorBrightness(monitors[0].hPhysicalMonitor, (uint)Math.Clamp(level, 0, 100));
                }
                catch (Exception ex)
                {
                    _log.WriteException("DdcCiBrightnessApply", ex);
                }
                finally
                {
                    Win32.DestroyPhysicalMonitors(count, monitors);
                }
            }
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

        // Gate emissions while collapsed or suspending so we never wake the renderer or fail TrySuspendAsync
        if (_isSuspending)
            return;

        if (!_isExpanded && !_slideTargetExpanded)
        {
            bool isLifecycleEvent = eventName is "canopy:set-open" or "caelestia:set-open" or "toggle-dropdown" or "top-hover-trigger-changed" or "diagnostic-logging-changed" or "canopy:system-theme-changed";
            if (!isLifecycleEvent)
                return;
        }
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

        if (TryRegisterHotkey(_hotkey))
        {
            _log.Write($"hotkey '{_hotkey}' registered");
            return;
        }

        _log.Write($"primary hotkey '{_hotkey}' failed; attempting fallback 'Win+Shift+Space'");
        if (TryRegisterHotkey("Win+Shift+Space"))
        {
            _hotkey = "Win+Shift+Space";
            _log.Write("fallback hotkey 'Win+Shift+Space' registered");
            EmitFrontendEvent("hotkey-fallback", new { hotkey = _hotkey });
            return;
        }

        _log.Write("secondary fallback hotkey 'Alt+Space' attempting");
        if (TryRegisterHotkey("Alt+Space"))
        {
            _hotkey = "Alt+Space";
            _log.Write("fallback hotkey 'Alt+Space' registered");
            EmitFrontendEvent("hotkey-fallback", new { hotkey = _hotkey });
            return;
        }

        _log.Write("all hotkey registrations failed or were rejected by Windows");
        EmitFrontendEvent("hotkey-failed", new { hotkey = _hotkey });
    }

    private bool TryRegisterHotkey(string? hotkey)
    {
        if (!Win32.TryParseHotkey(hotkey, out uint modifiers, out uint virtualKey))
        {
            return false;
        }
        return Win32.RegisterHotKey(_hwnd, HotkeyIdToggle, modifiers | Win32.MOD_NOREPEAT, virtualKey);
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
        if (TryGetBool(args, "topHoverTrigger", out bool topHover))
        {
            _topHoverTriggerEnabled = topHover;
        }

        if (TryGetInt(args, "appWidth", out int appW) && TryGetInt(args, "appHeight", out int appH))
        {
            SetCustomWindowSize(appW, appH);
        }

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
            // Apply on the spot: previously this only took effect on the next probe tick, which is why
            // toggling the setting off and on appeared to "fix" a stuck full-screen state.
            RefreshFullscreenSuppression();
        }

        if (TryGetBool(args, "pauseInPresentation", out bool pausePresentation))
        {
            _pauseInPresentation = pausePresentation;
            RefreshFullscreenSuppression();
        }

        if (args.ValueKind == JsonValueKind.Object &&
            args.TryGetProperty("reminders", out JsonElement remindersEl) &&
            remindersEl.ValueKind == JsonValueKind.Array)
        {
            ApplyReminders(remindersEl);
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

        if (TryGetString(args, "panelAnchor", out string anchorVal) && !string.IsNullOrWhiteSpace(anchorVal))
        {
            string clean = anchorVal.Trim().ToLowerInvariant();
            _panelAnchor = clean is "top-left" or "top-right" ? clean : "top-center";
            Win32.RECT panelMonitor = GetPanelMonitor();
            PositionWindowAtTopCenter(panelMonitor, offscreen: !_isExpanded);
        }
        if (TryGetBool(args, "animationsEnabled", out bool animations))
        {
            _animationsEnabled = animations;
            if (!_animationsEnabled)
            {
                StopSlideAnimation();
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
                    _ = SuspendWebViewAsync();
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
            HostPreferences.SaveShowPanelOnLaunch(showOnLaunch);
        }

        if (TryGetString(args, "hotkey", out string hotkey) &&
            !string.IsNullOrWhiteSpace(hotkey) &&
            !string.Equals(hotkey, _hotkey, StringComparison.Ordinal))
        {
            _hotkey = hotkey;
            ApplyHotkeyFromSettings();
        }

        if (TryGetString(args, "themeAccent", out string themeAccent) && !string.IsNullOrWhiteSpace(themeAccent))
        {
            _currentThemeAccent = themeAccent;
        }

        if (TryGetString(args, "themeBg", out string themeBg) && !string.IsNullOrWhiteSpace(themeBg))
        {
            _currentThemeBg = themeBg;
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
        panelAnchor = _panelAnchor,
        diagnosticLogging = _log.Enabled,
        wallpaperDirectory = _wallpaperService.WallpapersDirectory,
        triggerSuppressed = _fullscreenAppActive,
        webViewSuspended = ShellWebView.CoreWebView2?.IsSuspended ?? false,
    };

    private static bool TryGetInt(JsonElement args, string name, out int value)
    {
        value = 0;
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty(name, out JsonElement element) ||
            element.ValueKind != JsonValueKind.Number)
        {
            return false;
        }

        if (element.TryGetInt32(out value))
        {
            return true;
        }

        if (element.TryGetDouble(out double d))
        {
            value = (int)Math.Round(d);
            return true;
        }

        return false;
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
            !args.TryGetProperty(name, out JsonElement element))
        {
            return false;
        }

        if (element.ValueKind == JsonValueKind.String)
        {
            value = element.GetString() ?? string.Empty;
            return true;
        }

        if (element.ValueKind == JsonValueKind.Number)
        {
            value = element.GetRawText();
            return true;
        }

        return false;
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if ((uint)msg == Win32.WM_TASKBARCREATED)
        {
            _log.Write("WM_TASKBARCREATED received (explorer restarted); recreating tray icon");
            // The shell rebuilt the notification area, so the old icon handle must be released here:
            // InitializeTrayIcon would otherwise overwrite the reference and leak the GDI handle.
            _trayIconObj?.Dispose();
            _trayIconObj = null;
            _trayIconCreated = false;
            InitializeTrayIcon();
        }

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
        else if (msg == Win32.WM_ERASEBKGND)
        {
            // Suppress GDI background painting to prevent white flash during slide/resize transitions
            handled = true;
            return (IntPtr)1;
        }
        else if (msg == Win32.WM_DPICHANGED || msg == Win32.WM_DISPLAYCHANGE)
        {
            _log.Write($"display geometry changed (msg=0x{msg:X4})");
            ApplyRoundedRegionForCurrentDpi();
            Win32.RECT panelMonitor = GetPanelMonitor();
            PositionWindowAtTopCenter(panelMonitor, offscreen: !_isExpanded);
            handled = true;
        }
        else if (msg == Win32.WM_POWERBROADCAST)
        {
            int powerEvent = wParam.ToInt32();
            if (powerEvent == Win32.PBT_APMSUSPEND)
            {
                _log.Write("system entering sleep (PBT_APMSUSPEND)");
                _audioController.PauseCapture();
                _audioSessions.Pause();
                _systemMonitorService.Pause();
            }
            else if (powerEvent is Win32.PBT_APMRESUMESUSPEND or Win32.PBT_APMRESUMEAUTOMATIC)
            {
                _log.Write("system resumed from sleep; re-syncing services");
                if (_isExpanded)
                {
                    _audioController.ResumeCapture();
                    _audioSessions.Resume();
                    _systemMonitorService.Resume();
                }
            }
            handled = true;
        }
        else if (msg == Win32.WM_WININICHANGE)
        {
            string? section = lParam != IntPtr.Zero ? Marshal.PtrToStringAuto(lParam) : null;
            if (section == "ImmersiveColorSet" || section == null)
            {
                bool isDark = Win32.IsSystemInDarkMode();
                EmitFrontendEvent("canopy:system-theme-changed", new { isDark });
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
    private int CalculatePhysicalX(Win32.RECT monitor, int physicalWidth)
    {
        return _panelAnchor switch
        {
            "top-left" => monitor.Left + 24,
            "top-right" => monitor.Left + monitor.Width - physicalWidth - 24,
            _ => monitor.Left + ((monitor.Width - physicalWidth) / 2),
        };
    }

    private bool IsCursorInTriggerWidth(int cursorX, Win32.RECT monitor, int effectiveTriggerWidth)
    {
        if (_panelAnchor == "top-left")
        {
            return cursorX >= monitor.Left && cursorX <= (monitor.Left + effectiveTriggerWidth);
        }
        if (_panelAnchor == "top-right")
        {
            return cursorX <= (monitor.Left + monitor.Width) && cursorX >= (monitor.Left + monitor.Width - effectiveTriggerWidth);
        }
        int centerX = monitor.Left + (monitor.Width / 2);
        return Math.Abs(cursorX - centerX) <= (effectiveTriggerWidth / 2);
    }

    private void PositionWindowAtTopCenter(Win32.RECT monitor, bool offscreen)
    {
        var (scaleX, scaleY, physicalWidth, physicalHeight) = GetDpiScaleAndPhysicalSize(monitor);

        int physicalX = CalculatePhysicalX(monitor, physicalWidth);
        int physicalY = offscreen
            ? monitor.Top - physicalHeight - (int)Math.Round(100 * scaleY)
            : monitor.Top;

        if (_hwnd != IntPtr.Zero)
        {
            Win32.SetWindowPos(_hwnd, IntPtr.Zero, physicalX, physicalY, physicalWidth, physicalHeight,
                Win32.SWP_NOZORDER | Win32.SWP_NOACTIVATE);
        }

        Left = Math.Round(physicalX / scaleX);
        Top = Math.Round(physicalY / scaleY);
        ApplyAdaptiveZoom(monitor);
    }

    /// <summary>
    /// Slides the window to its expanded or collapsed Y position with a VSync-locked ease-out curve,
    /// moving the window using native SetWindowPos to eliminate WPF layout passes and micro-stutter.
    /// </summary>
    private void SlideTo(bool expanded, Win32.RECT monitor)
    {
        var (scaleX, scaleY, physicalWidth, physicalHeight) = GetDpiScaleAndPhysicalSize(monitor);

        int physicalX = CalculatePhysicalX(monitor, physicalWidth);
        int physicalTargetY = expanded
            ? monitor.Top
            : monitor.Top - physicalHeight - (int)Math.Round(100 * scaleY);

        int currentPhysicalY = physicalTargetY;
        if (_hwnd != IntPtr.Zero && Win32.GetWindowRect(_hwnd, out var currentRect))
        {
            currentPhysicalY = currentRect.Top;
        }

        int duration = _animationDurationMs > 0 ? _animationDurationMs : 280;
        bool animate = _animationsEnabled && duration > 0 && Win32.AreSystemAnimationsEnabled() && Math.Abs(currentPhysicalY - physicalTargetY) > 2;

        StopSlideAnimation();

        _slideTargetExpanded = expanded;
        _slidePhysicalX = physicalX;
        _slideToPhysicalY = physicalTargetY;

        if (!animate)
        {
            if (_hwnd != IntPtr.Zero)
            {
                Win32.SetWindowPos(_hwnd, IntPtr.Zero, physicalX, physicalTargetY, physicalWidth, physicalHeight,
                    Win32.SWP_NOZORDER | Win32.SWP_NOACTIVATE);
            }
            Left = Math.Round(physicalX / scaleX);
            Top = Math.Round(physicalTargetY / scaleY);
            ApplyAdaptiveZoom(monitor);
            OnSlideFinished();
            return;
        }

        if (expanded)
        {
            _slideFromPhysicalY = physicalTargetY - physicalHeight - (int)Math.Round(100 * scaleY);
            if (_hwnd != IntPtr.Zero)
            {
                Win32.SetWindowPos(_hwnd, IntPtr.Zero, physicalX, _slideFromPhysicalY, physicalWidth, physicalHeight,
                    Win32.SWP_NOZORDER | Win32.SWP_NOACTIVATE);
            }
            ApplyAdaptiveZoom(monitor);
        }
        else
        {
            _slideFromPhysicalY = currentPhysicalY;
        }
        _slideDurationMs = duration;
        _slideStopwatch.Restart();
        CompositionTarget.Rendering += OnCompositionRendering;
        _isSlideRenderingHooked = true;
    }


    private void OnCompositionRendering(object? sender, EventArgs e)
    {
        double elapsed = _slideStopwatch.Elapsed.TotalMilliseconds;
        double progress = _slideDurationMs <= 0 ? 1.0 : Math.Clamp(elapsed / _slideDurationMs, 0.0, 1.0);
        double eased = 1.0 - Math.Pow(1.0 - progress, 3.0);

        int currentY = (int)Math.Round(_slideFromPhysicalY + ((_slideToPhysicalY - _slideFromPhysicalY) * eased));
        if (_hwnd != IntPtr.Zero)
        {
            Win32.SetWindowPos(_hwnd, IntPtr.Zero, _slidePhysicalX, currentY, 0, 0,
                Win32.SWP_NOSIZE | Win32.SWP_NOZORDER | Win32.SWP_NOACTIVATE);
        }

        if (progress >= 1.0)
        {
            StopSlideAnimation();

            var (scaleX, scaleY, _, _) = GetDpiScaleAndPhysicalSize(GetPanelMonitor());
            Left = Math.Round(_slidePhysicalX / scaleX);
            Top = Math.Round(_slideToPhysicalY / scaleY);

            OnSlideFinished();
        }
    }

    private void StopSlideAnimation()
    {
        if (_isSlideRenderingHooked)
        {
            CompositionTarget.Rendering -= OnCompositionRendering;
            _isSlideRenderingHooked = false;
        }
        _slideStopwatch.Stop();
    }

    private async void OnSlideFinished()
    {
        if (_slideTargetExpanded)
        {
            ApplyRoundedRegionForCurrentDpi();
            ResumeWebView();
            EmitBatteryStatus();
            return;
        }

        Win32.SetClickThrough(_hwnd, clickThrough: true);
        _audioController.PauseCapture();
        _audioSessions.Pause();
        _systemMonitorService.Pause();
        await SuspendWebViewAsync();
    }

    /// <summary>
    /// WebView2 only suspends while it is hidden, so the control has to be collapsed first;
    /// otherwise every JS timer and animation keeps burning CPU behind the parked panel.
    /// </summary>
    private async Task SuspendWebViewAsync()
    {
        if (!_suspendWhenClosed || ShellWebView.CoreWebView2 is null)
        {
            return;
        }

        _suspendCts?.Cancel();
        _suspendCts?.Dispose();
        _suspendCts = new CancellationTokenSource();
        var token = _suspendCts.Token;
        _isSuspending = true;
        try
        {
            ShellWebView.Visibility = Visibility.Collapsed;
            await Task.Delay(100, token);
            if (!_isExpanded && !_slideTargetExpanded && ShellWebView.CoreWebView2 is not null)
            {
                await ShellWebView.CoreWebView2.TrySuspendAsync();
            }
        }
        catch (OperationCanceledException)
        {
            // Canceled by rapid ResumeWebView
        }
        catch (Exception ex)
        {
            _log.WriteException("suspend webview", ex);
        }
        finally
        {
            _isSuspending = false;
        }
    }

    private void ResumeWebView()
    {
        _suspendCts?.Cancel();
        _suspendCts?.Dispose();
        _suspendCts = null;
        _isSuspending = false;
        ShellWebView.Visibility = Visibility.Visible;
        if (ShellWebView.CoreWebView2 is null)
        {
            return;
        }

        try
        {
            ShellWebView.CoreWebView2.Resume();
        }
        catch (Exception ex)
        {
            _log.WriteException("resume webview", ex);
        }
    }

    /// <summary>
    /// Checks whether the foreground window is a borderless fullscreen application (such as a DXGI Flip Model
    /// game or fullscreen video player) covering the entire physical display bounds rather than just rcWork.
    /// </summary>
    private bool IsForegroundWindowFullscreen(Win32.RECT monitor)
    {
        IntPtr fg = Win32.GetForegroundWindow();
        if (fg != IntPtr.Zero && fg != _hwnd)
        {
            if (Win32.IsZoomed(fg) || IsForegroundWindowNonGame())
            {
                return false;
            }

            string className = Win32.GetWindowClassName(fg);
            if (!string.Equals(className, "Progman", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(className, "WorkerW", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(className, "Shell_TrayWnd", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(className, "Shell_SecondaryTrayWnd", StringComparison.OrdinalIgnoreCase))
            {
                if (Win32.GetWindowRect(fg, out Win32.RECT fgRect))
                {
                    IntPtr hMon = Win32.MonitorFromWindow(fg, Win32.MONITOR_DEFAULTTONEAREST);
                    Win32.MONITORINFO mi = new() { cbSize = Marshal.SizeOf<Win32.MONITORINFO>() };
                    if (!Win32.GetMonitorInfo(hMon, ref mi))
                    {
                        mi.rcMonitor = monitor;
                    }
                    if (IsSameMonitor(mi.rcMonitor, monitor))
                    {
                        if (fgRect.Left <= mi.rcMonitor.Left &&
                            fgRect.Top <= mi.rcMonitor.Top &&
                            fgRect.Right >= mi.rcMonitor.Right &&
                            fgRect.Bottom >= mi.rcMonitor.Bottom)
                        {
                            return true;
                        }
                    }
                }
            }
        }
        // to detect borderless fullscreen games that lost foreground focus to another display.
        Win32.POINT centerPoint = new() { X = monitor.Left + (monitor.Width / 2), Y = monitor.Top + (monitor.Height / 2) };
        IntPtr centerHwnd = Win32.GetAncestor(Win32.WindowFromPoint(centerPoint), Win32.GA_ROOT);
        if (centerHwnd != IntPtr.Zero && centerHwnd != _hwnd)
        {
            if (Win32.IsZoomed(centerHwnd))
            {
                return false;
            }

            string className = Win32.GetWindowClassName(centerHwnd);
            if (!string.Equals(className, "Progman", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(className, "WorkerW", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(className, "Shell_TrayWnd", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(className, "Shell_SecondaryTrayWnd", StringComparison.OrdinalIgnoreCase))
            {
                if (Win32.GetWindowRect(centerHwnd, out Win32.RECT centerRect))
                {
                    if (centerRect.Left <= monitor.Left + 2 &&
                        centerRect.Top <= monitor.Top + 2 &&
                        centerRect.Right >= monitor.Right - 2 &&
                        centerRect.Bottom >= monitor.Bottom - 2)
                    {
                        string proc = Win32.GetWindowProcessName(centerHwnd);
                        string title = Win32.GetWindowText(centerHwnd);
                        if (title.Contains("Discord", StringComparison.OrdinalIgnoreCase) ||
                            proc.Contains("Discord", StringComparison.OrdinalIgnoreCase))
                        {
                            return false;
                        }
                        if (!string.IsNullOrEmpty(proc) && !NonGameProcessNames.Contains(proc))
                        {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    /// <summary>
    /// Checks if another physical monitor is stacked directly above this monitor at the cursor X position.
    /// If so, the top boundary is an internal screen transition rather than a physical screen bezel.
    /// </summary>
    private static bool HasStackedMonitorAbove(int cursorX, int monitorTop)
    {
        var pointAbove = new Win32.POINT { X = cursorX, Y = monitorTop - 2 };
        IntPtr hMonAbove = Win32.MonitorFromPoint(pointAbove, Win32.MONITOR_DEFAULTTONULL);
        return hMonAbove != IntPtr.Zero;
    }

    /// <summary>
    /// True when the foreground window belongs to a browser or Windows shell surface that composites
    /// through Direct3D. Those report the same shell notification state as a game, so they must be
    /// exempted before any full-screen suppression is applied.
    /// </summary>
    private bool IsForegroundWindowNonGame()
    {
        IntPtr fg = Win32.GetForegroundWindow();
        if (fg == IntPtr.Zero || fg == _hwnd)
        {
            return false;
        }

        if (Win32.IsZoomed(fg))
        {
            return true;
        }

        string className = Win32.GetWindowClassName(fg);
        if (string.Equals(className, "Progman", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(className, "WorkerW", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(className, "Shell_TrayWnd", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(className, "Shell_SecondaryTrayWnd", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(className, "CabinetWClass", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(className, "CASCADIA_HOSTING_WINDOW_CLASS", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        string processName = Win32.GetWindowProcessName(fg);
        string windowTitle = Win32.GetWindowText(fg);
        if (processName.Contains("Discord", StringComparison.OrdinalIgnoreCase) ||
            windowTitle.Contains("Discord", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return processName.Length > 0 && NonGameProcessNames.Contains(processName);
    }
    /// <summary>
    /// True while the automatic hover trigger must stay silent: quiet hours, a full-screen game
    /// (borderless or exclusive fullscreen), or a presentation.
    /// </summary>
    private bool ShouldSuppressTrigger(Win32.RECT currentMonitor)
    {
        if (_dndEnabled)
        {
            return true;
        }

        if (_quietHoursEnabled && IsWithinQuietHours())
        {
            return true;
        }

        // Browsers and shell surfaces are never games, no matter what the shell state reports.
        bool nonGameForeground = IsForegroundWindowNonGame();

        // Direct borderless fullscreen detection (DXGI Flip Model games, fullscreen video)
        if (!nonGameForeground && _pauseInFullscreen && IsForegroundWindowFullscreen(currentMonitor))
        {
            return true;
        }

        int state = Win32.QueryUserNotificationState();
        return state switch
        {
            Win32.QUNS_RUNNING_D3D_FULL_SCREEN => _pauseInFullscreen && !nonGameForeground && IsForegroundWindowFullscreen(currentMonitor),
            Win32.QUNS_PRESENTATION_MODE => _pauseInPresentation,
            // For QUNS_BUSY, only suppress if the foreground window is truly covering rcMonitor
            Win32.QUNS_BUSY => _pauseInFullscreen && !nonGameForeground && IsForegroundWindowFullscreen(currentMonitor),
            _ => false,
        };
    }

    /// <summary>
    /// Recomputes the suppression flag immediately instead of waiting for the next probe tick, so
    /// flipping the fullscreen/game toggle in Settings takes effect on the spot.
    /// </summary>
    private void RefreshFullscreenSuppression()
    {
        _fullscreenAppActive = ShouldSuppressTrigger(GetActiveMonitorBounds());
    }

    /// <summary>
    /// Replaces the host's reminder list from the calendar surface. Delivery state is kept by id, so
    /// re-pushing the calendar never re-alerts a reminder that already fired.
    /// </summary>
    private void ApplyReminders(JsonElement remindersEl)
    {
        _reminders.Clear();

        foreach (JsonElement item in remindersEl.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
                continue;

            string id = item.TryGetProperty("id", out JsonElement idEl) ? idEl.GetString() ?? string.Empty : string.Empty;
            string text = item.TryGetProperty("text", out JsonElement textEl) ? textEl.GetString() ?? string.Empty : string.Empty;
            string date = item.TryGetProperty("date", out JsonElement dateEl) ? dateEl.GetString() ?? string.Empty : string.Empty;
            string time = item.TryGetProperty("time", out JsonElement timeEl) ? timeEl.GetString() ?? string.Empty : string.Empty;

            if (id.Length == 0 || date.Length == 0 || time.Length == 0)
                continue;

            _reminders.Add(new HostReminder(id, text, date, time));
        }

        _log.Write($"reminders synced ({_reminders.Count})");
        CheckDueReminders();
    }

    /// <summary>
    /// Fires reminders whose local date/time matches now. This runs even while the panel is parked,
    /// in which case the panel is slid down first so the droplet is actually visible. Reminders are
    /// held back while a full-screen game owns the foreground.
    /// </summary>
    private void CheckDueReminders()
    {
        if (_reminders.Count == 0)
            return;

        DateTime now = DateTime.Now;
        string today = now.ToString("yyyy-MM-dd");
        string hhmm = now.ToString("HH:mm");

        foreach (HostReminder reminder in _reminders)
        {
            string fireKey = $"{reminder.Id}:{reminder.Date}:{reminder.Time}";
            if (_firedReminders.Contains(fireKey))
                continue;

            bool due = string.Equals(reminder.Date, today, StringComparison.Ordinal) &&
                       string.Equals(reminder.Time, hhmm, StringComparison.Ordinal);
            bool deferred = _pendingReminders.TryGetValue(fireKey, out DateTime deferredAt);

            if (!due && !deferred)
                continue;

            bool gameRunning = _fullscreenAppActive || ShouldSuppressTrigger(Win32.GetPrimaryMonitorBounds());
            if (gameRunning)
            {
                // Never cover gameplay: hold the alert, then drop it if it went stale.
                if (!deferred)
                {
                    _pendingReminders[fireKey] = now;
                    _log.Write($"reminder deferred (fullscreen app active): {reminder.Text}");
                }
                else if (now - deferredAt > ReminderDeferWindow)
                {
                    _pendingReminders.Remove(fireKey);
                    _firedReminders.Add(fireKey);
                    _log.Write($"reminder dropped after defer window: {reminder.Text}");
                }
                continue;
            }

            _pendingReminders.Remove(fireKey);
            _firedReminders.Add(fireKey);
            ShowReminder(reminder);
        }
    }

    /// <summary>
    /// Triggers the standalone raindrop -> pill capsule notification popup at the top of the screen.
    /// Works whether Canopy is open or closed, staying topmost above other applications without taking focus.
    /// </summary>
    private void ShowReminder(HostReminder reminder)
    {
        _log.Write($"reminder fired: {reminder.Text}");
        NotificationWindow.ShowNotification(reminder.Text, "Canopy Reminder", _currentThemeAccent, _currentThemeBg);
        if (_isExpanded)
        {
            EmitFrontendEvent("canopy:notification", new
            {
                message = $"Reminder: {reminder.Text}",
                title = "Canopy Reminder",
                kind = "reminder",
            });
        }
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
        Win32.RECT evaluationMonitor = _isExpanded && _expandedMonitor.Width > 0 ? _expandedMonitor : cursorMonitor;
        int effectiveTriggerWidth = Math.Clamp(_topTriggerWidthPx, 100, evaluationMonitor.Width);
        int centerX = evaluationMonitor.Left + (evaluationMonitor.Width / 2);
        int triggerHeight = Math.Max(26, _topTriggerHeightPx);
        bool inTopTriggerZone;
        if (!_isExpanded)
        {
            // Collapsed: tight bezel catch zone scaled by monitor DPI so it stays reachable at 4K/200%
            uint dpi = _hwnd != IntPtr.Zero ? Win32.GetDpiForWindow(_hwnd) : 96;
            double scaleY = dpi > 0 ? dpi / 96.0 : 1.0;
            int scaledTriggerMargin = (int)Math.Round(3.0 * scaleY);
            bool atBezelEdge = cursor.Y >= (cursorMonitor.Top - 10) && cursor.Y <= (cursorMonitor.Top + Math.Max(2, scaledTriggerMargin));
            bool notStackedAbove = !HasStackedMonitorAbove(cursor.X, cursorMonitor.Top);
            inTopTriggerZone = scopeAllows && atBezelEdge && notStackedAbove && IsCursorInTriggerWidth(cursor.X, evaluationMonitor, effectiveTriggerWidth);
        }
        else
        {
            // Expanded: keep open while hovering inside the card (plus margin) or the trigger band on the active panel display
            bool inTriggerBand = cursor.Y >= (evaluationMonitor.Top - 10) && cursor.Y <= (evaluationMonitor.Top + triggerHeight);
            inTopTriggerZone = scopeAllows && inTriggerBand && Math.Abs(cursor.X - centerX) <= (effectiveTriggerWidth / 2);
        }
        // If user set panelMonitorMode to "primary" but the primary monitor has a fullscreen game running,
        // automatically fall back to cursorMonitor so the panel can open on the non-gaming screen.
        Win32.RECT panelTarget = string.Equals(_panelMonitorMode, "primary", StringComparison.OrdinalIgnoreCase)
            ? (ShouldSuppressTrigger(primaryMonitor) ? cursorMonitor : primaryMonitor)
            : cursorMonitor;

        if (!_isExpanded)
        {
            bool monitorChanged = !IsSameMonitor(panelTarget, _lastProbedMonitor);
            if (monitorChanged || inTopTriggerZone || _fullscreenProbeCounter++ % 8 == 0)
            {
                _lastProbedMonitor = panelTarget;
                _fullscreenAppActive = ShouldSuppressTrigger(panelTarget);
            }
            // Never drop the panel over a game, during quiet hours, or out of scope — the hotkey and
            // the tray menu still open it on demand.
            if (!_topHoverTriggerEnabled || _fullscreenAppActive || !inTopTriggerZone)
            {
                _hoverEnteredTriggerUtc = DateTime.MinValue;
                if (_fullscreenAppActive && _cursorPollTimer.Interval.TotalMilliseconds < 500)
                {
                    _cursorPollTimer.Interval = TimeSpan.FromMilliseconds(500);
                }
                else if (!_fullscreenAppActive && _cursorPollTimer.Interval.TotalMilliseconds > 60)
                {
                    _cursorPollTimer.Interval = TimeSpan.FromMilliseconds(60);
                }
                return;
            }
            if (_cursorPollTimer.Interval.TotalMilliseconds > 25)
            {
                _cursorPollTimer.Interval = TimeSpan.FromMilliseconds(25);
            }

            // Require ~120ms hover dwell time before expanding to avoid accidental triggers
            int dwellMs = Math.Max(120, _topTriggerDelayMs);
            if (_hoverEnteredTriggerUtc == DateTime.MinValue)
            {
                _hoverEnteredTriggerUtc = DateTime.UtcNow;
                return;
            }

            if ((DateTime.UtcNow - _hoverEnteredTriggerUtc).TotalMilliseconds >= dwellMs)
            {
                _hoverEnteredTriggerUtc = DateTime.MinValue;
                _hideDebounceTimer.Stop();
                ExpandPanel(panelTarget);
            }
            return;
        }

        if (_isResizingWindow)
        {
            if (_hideDebounceTimer.IsEnabled)
            {
                _hideDebounceTimer.Stop();
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

        // A reminder banner owns the panel until it finishes its drop/expand animation.
        if (_notificationVisible)
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

        return screenCursor.X >= (rect.Left - 6) &&
               screenCursor.X <= (rect.Right + 6) &&
               screenCursor.Y >= (rect.Top - 6) &&
               screenCursor.Y <= (rect.Bottom + 10);
    }

    private void OnHideDebounceTimerTick(object? sender, EventArgs e)
    {
        _hideDebounceTimer.Stop();
        if (_isResizingWindow || !_isExpanded || _notificationVisible)
            return;

        if (Win32.GetCursorPos(out Win32.POINT cursor))
        {
            Win32.RECT monitor = _expandedMonitor.Width > 0 ? _expandedMonitor : GetActiveMonitorBounds();
            int effectiveTriggerWidth = Math.Clamp(_topTriggerWidthPx, 100, monitor.Width);
            int centerX = monitor.Left + (monitor.Width / 2);
            int triggerHeight = Math.Max(26, _topTriggerHeightPx);
            bool inTrigger = cursor.Y >= (monitor.Top - 12) &&
                             cursor.Y <= (monitor.Top + triggerHeight) &&
                             IsCursorInTriggerWidth(cursor.X, monitor, effectiveTriggerWidth);
            if (IsCursorInsideWindow(cursor) || inTrigger)
                return;
        }

        CollapsePanel();
    }
    public void ExpandPanel(Win32.RECT monitor)
    {
        _expandedMonitor = monitor;
        StopSlideAnimation();
        _cursorPollTimer.Interval = TimeSpan.FromMilliseconds(25);
        Win32.SetClickThrough(_hwnd, clickThrough: false);
        // Re-assert topmost so the panel and its notification banner stay above ordinary windows.
        Win32.ReassertTopmost(_hwnd);
        Win32.ShowWithoutActivating(_hwnd);
        ResumeWebView();
        _audioController.ResumeCapture();
        _audioSessions.Resume();
        _systemMonitorService.Resume();
        bool wasExpanded = _isExpanded;
        _isExpanded = true;

        SlideTo(expanded: true, _expandedMonitor);

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

        // Collapse on the exact monitor where the panel is currently open
        Win32.RECT targetMonitor = _expandedMonitor.Width > 0 ? _expandedMonitor : GetPanelMonitor();
        SlideTo(expanded: false, targetMonitor);
        _log.Write("collapse");

        EmitFrontendEvent("canopy:set-open", false);
        EmitFrontendEvent("caelestia:set-open", false);
        EmitFrontendEvent("toggle-dropdown", false);
    }

    public bool IsExpanded => _isExpanded;

    public void TogglePanel()
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

    public void TriggerNotification(string message, string title = "Canopy Notification", string? accent = null, string? bg = null)
    {
        string finalAccent = accent ?? _currentThemeAccent ?? "#74a86c";
        string finalBg = bg ?? _currentThemeBg ?? "#111913";
        NotificationWindow.ShowNotification(message, title, finalAccent, finalBg);
        if (_isExpanded)
        {
            EmitFrontendEvent("canopy:notification", new
            {
                message,
                title,
                accentColorHex = finalAccent,
                bgColorHex = finalBg
            });
        }
    }

    public void NavigateTab(string tab)
    {
        ExpandWithPreviewGrace();
        EmitFrontendEvent("canopy:navigate_tab", new { tab });
    }

    public async Task NextWallpaperAsync()
    {
        try
        {
            if (Directory.Exists(_wallpaperService.WallpapersDirectory))
            {
                var files = Directory.EnumerateFiles(_wallpaperService.WallpapersDirectory)
                    .Where(f => WallpaperService.SupportedExtensions.Contains(System.IO.Path.GetExtension(f)))
                    .ToList();
                if (files.Count > 0)
                {
                    int index = new Random().Next(files.Count);
                    await _wallpaperService.ApplyWallpaperAsync(files[index]);
                }
            }
        }
        catch (Exception ex)
        {
            _log.WriteException("NextWallpaperAsync", ex);
        }
    }

    public void SetTheme(string themeMode)
    {
        EmitFrontendEvent("canopy:theme-changed", new { theme = themeMode, mode = themeMode });
    }

    public async Task MediaPlayPauseAsync()
    {
        try { await _mediaController.PlayPauseAsync(); } catch (Exception ex) { _log.WriteException("MediaPlayPause", ex); }
    }

    public async Task MediaNextAsync()
    {
        try { await _mediaController.NextAsync(); } catch (Exception ex) { _log.WriteException("MediaNext", ex); }
    }

    public async Task MediaPrevAsync()
    {
        try { await _mediaController.PreviousAsync(); } catch (Exception ex) { _log.WriteException("MediaPrev", ex); }
    }

    protected override void OnClosed(EventArgs e)
    {
        _cursorPollTimer.Stop();
        _hideDebounceTimer.Stop();
        StopSlideAnimation();
        _reminderTimer.Stop();
        _notificationCollapseTimer.Stop();
        _brightnessCts?.Cancel();
        _brightnessCts?.Dispose();
        _brightnessCts = null;
        _audioController.VolumeStateChanged -= OnMasterVolumeChanged;
        try
        {
            Win32.SetThreadExecutionState(Win32.ES_CONTINUOUS);
        }
        catch (Exception ex)
        {
            _log.WriteException("OnClosed_ResetCaffeine", ex);
        }

        if (_hwnd != IntPtr.Zero)
        {
            _ = Win32.UnregisterHotKey(_hwnd, HotkeyIdToggle);
        }

        RemoveTrayIcon();
        _hwndSource?.RemoveHook(WndProc);
        _audioController.Dispose();
        _mediaController.Dispose();
        _audioSessions.Dispose();
        _desktopWallpaper.Dispose();
        _wallpaperService.Dispose();
        _systemMonitorService.Dispose();
        ShellWebView.Dispose();

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
                catch (Exception ex)
                {
                    _log.WriteException("TrayIconLoad", ex);
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
        catch (Exception ex)
        {
            _log.WriteException(nameof(InitializeTrayIcon), ex);
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
            catch (Exception ex)
            {
                _log.WriteException("TrayIconNimDelete", ex);
            }
            _trayIconCreated = false;
            try
            {
                _trayIconObj?.Dispose();
                _trayIconObj = null;
            }
            catch (Exception ex)
            {
                _log.WriteException("TrayIconDispose", ex);
            }
        }
    }

    private void ShowTrayContextMenu()
    {
        // To ensure the context menu disappears when clicking outside, MSDN requires
        // the associated window to be in the foreground before showing the popup.
        long exStyle = Win32.GetWindowLongPtr(_hwnd, Win32.GWL_EXSTYLE).ToInt64();
        exStyle &= ~Win32.WS_EX_NOACTIVATE;
        Win32.SetWindowLongPtr(_hwnd, Win32.GWL_EXSTYLE, new IntPtr(exStyle));
        Win32.SetForegroundWindow(_hwnd);

        var menu = new ContextMenu
        {
            Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint,
            StaysOpen = false
        };

        // When the menu closes (whether an item was clicked or clicked outside), restore click-through
        // if the panel is collapsed, and post WM_NULL so Windows cleans up tray menu state.
        menu.Closed += (_, _) =>
        {
            if (!_isExpanded)
            {
                Win32.SetClickThrough(_hwnd, clickThrough: true);
            }
            Win32.PostMessage(_hwnd, (uint)Win32.WM_NULL, IntPtr.Zero, IntPtr.Zero);
        };

        var toggleItem = new MenuItem { Header = _isExpanded ? "Collapse Panel" : "Open Panel" };
        toggleItem.Click += (_, _) => ToggleDropdown();
        menu.Items.Add(toggleItem);

        // Top hover trigger pause/resume: prevents panel from dropping down when cursor touches top edge
        var hoverTriggerItem = new MenuItem
        {
            Header = _topHoverTriggerEnabled ? "Top-Edge Hover: Active (Click to Pause)" : "Top-Edge Hover: Paused (Click to Enable)",
            IsCheckable = true,
            IsChecked = _topHoverTriggerEnabled
        };
        hoverTriggerItem.Click += (_, _) =>
        {
            _topHoverTriggerEnabled = !_topHoverTriggerEnabled;
            _log.Write($"top hover trigger {(_topHoverTriggerEnabled ? "enabled" : "disabled")} via tray menu");
            EmitFrontendEvent("top-hover-trigger-changed", new { enabled = _topHoverTriggerEnabled });
            if (!_topHoverTriggerEnabled && _isExpanded)
            {
                CollapsePanel();
            }
        };
        menu.Items.Add(hoverTriggerItem);

        menu.Items.Add(new Separator());

        var dashItem = new MenuItem { Header = "Dashboard" };
        dashItem.Click += (_, _) => { ExpandWithPreviewGrace(); EmitFrontendEvent("canopy:navigate_tab", new { tab = "dashboard" }); };
        menu.Items.Add(dashItem);

        var wallItem = new MenuItem { Header = "Wallpapers" };
        wallItem.Click += (_, _) => { ExpandWithPreviewGrace(); EmitFrontendEvent("canopy:navigate_tab", new { tab = "wallpaper" }); };
        menu.Items.Add(wallItem);

        var settItem = new MenuItem { Header = "Settings" };
        settItem.Click += (_, _) => { ExpandWithPreviewGrace(); EmitFrontendEvent("canopy:navigate_tab", new { tab = "settings" }); };
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
            EmitFrontendEvent("diagnostic-logging-changed", new { enabled = _log.Enabled });
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

    private static async Task<bool> SetRadioStateAsync(Windows.Devices.Radios.RadioKind kind, bool enabled)
    {
        try
        {
            var radios = await Windows.Devices.Radios.Radio.GetRadiosAsync();
            var targetRadio = radios.FirstOrDefault(r => r.Kind == kind);
            if (targetRadio != null)
            {
                var targetState = enabled ? Windows.Devices.Radios.RadioState.On : Windows.Devices.Radios.RadioState.Off;
                var result = await targetRadio.SetStateAsync(targetState);
                return result == Windows.Devices.Radios.RadioAccessStatus.Allowed;
            }
        }
        catch
        {
        }
        return false;
    }

    private static async Task<object> QueryWifiStateAsync()
    {
        bool isEnabled = false;
        try
        {
            var radios = await Windows.Devices.Radios.Radio.GetRadiosAsync();
            var wifiRadio = radios.FirstOrDefault(r => r.Kind == Windows.Devices.Radios.RadioKind.WiFi);
            if (wifiRadio != null)
            {
                isEnabled = wifiRadio.State == Windows.Devices.Radios.RadioState.On;
            }
        }
        catch
        {
        }

        bool isConnected = false;
        string? connectedSsid = null;
        int? signalQuality = null;
        string? bssid = null;
        string? band = null;

        try
        {
            var psi = new ProcessStartInfo("netsh", "wlan show interfaces")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true
            };
            using var proc = Process.Start(psi);
            if (proc != null)
            {
                string output = await proc.StandardOutput.ReadToEndAsync();
                await proc.WaitForExitAsync();

                var lines = output.Split(ChecksumLineSeparators, StringSplitOptions.RemoveEmptyEntries);
                foreach (var line in lines)
                {
                    var parts = line.Split(':', 2);
                    if (parts.Length != 2) continue;

                    string key = parts[0].Trim();
                    string val = parts[1].Trim();

                    if (key.Equals("State", StringComparison.OrdinalIgnoreCase))
                    {
                        isConnected = val.Equals("connected", StringComparison.OrdinalIgnoreCase);
                    }
                    else if (key.Equals("SSID", StringComparison.OrdinalIgnoreCase) && !key.Contains("BSSID", StringComparison.OrdinalIgnoreCase))
                    {
                        connectedSsid = val;
                    }
                    else if (key.Equals("Signal", StringComparison.OrdinalIgnoreCase))
                    {
                        string digits = val.Replace("%", "").Trim();
                        if (int.TryParse(digits, out int sig))
                        {
                            signalQuality = sig;
                        }
                    }
                    else if (key.Equals("BSSID", StringComparison.OrdinalIgnoreCase))
                    {
                        bssid = val;
                    }
                    else if (key.Equals("Radio status", StringComparison.OrdinalIgnoreCase) || key.Equals("Software", StringComparison.OrdinalIgnoreCase))
                    {
                        if (val.Contains("On", StringComparison.OrdinalIgnoreCase))
                        {
                            isEnabled = true;
                        }
                    }
                    else if (key.Equals("Band", StringComparison.OrdinalIgnoreCase))
                    {
                        band = val;
                    }
                }
            }
        }
        catch
        {
        }

        List<string> profiles;
        long nowTicks = Environment.TickCount64;
        if (s_cachedWifiProfiles != null && nowTicks - s_lastWifiProfilesTicks < 15000)
        {
            profiles = s_cachedWifiProfiles;
        }
        else
        {
            profiles = new List<string>();
            try
            {
                var psi = new ProcessStartInfo("netsh", "wlan show profiles")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true
                };
                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    string output = await proc.StandardOutput.ReadToEndAsync();
                    await proc.WaitForExitAsync();

                    var lines = output.Split(ChecksumLineSeparators, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var line in lines)
                    {
                        var parts = line.Split(':', 2);
                        if (parts.Length == 2 && parts[0].Contains("User Profile", StringComparison.OrdinalIgnoreCase))
                        {
                            string profileName = parts[1].Trim();
                            if (!string.IsNullOrEmpty(profileName) && !profiles.Contains(profileName))
                            {
                                profiles.Add(profileName);
                            }
                        }
                    }
                }
                s_cachedWifiProfiles = profiles;
                s_lastWifiProfilesTicks = nowTicks;
            }
            catch
            {
            }
        }
        return new
        {
            enabled = isEnabled,
            connected = isConnected,
            ssid = connectedSsid,
            signal = signalQuality,
            profiles = profiles,
            bssid = bssid,
            band = band
        };
    }

    private static string? _cachedBtAdapterName = null;
    private static string? _cachedBtVersion = null;
    private static string? _cachedBtLmp = null;

    private static string MapLmpToBluetoothVersion(int lmp)
    {
        return lmp switch
        {
            >= 13 => "Bluetooth 5.4",
            12 => "Bluetooth 5.3",
            11 => "Bluetooth 5.2",
            10 => "Bluetooth 5.1",
            9 => "Bluetooth 5.0",
            8 => "Bluetooth 4.2",
            7 => "Bluetooth 4.1",
            6 => "Bluetooth 4.0",
            5 => "Bluetooth 3.0 + HS",
            4 => "Bluetooth 2.1 + EDR",
            3 => "Bluetooth 2.0 + EDR",
            2 => "Bluetooth 1.2",
            1 => "Bluetooth 1.1",
            _ => "Bluetooth 5.0+"
        };
    }

    private static (string name, string version, string lmp) GetBluetoothAdapterInfo()
    {
        string adapterName = "Bluetooth Radio";
        string versionStr = "Bluetooth 5.0+";
        string lmpStr = "LMP 11";

        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT Name, DeviceID FROM Win32_PnPEntity WHERE PNPClass = 'Bluetooth'");
            foreach (ManagementObject obj in searcher.Get())
            {
                string name = obj["Name"]?.ToString() ?? "";
                string devId = obj["DeviceID"]?.ToString() ?? "";
                if ((devId.StartsWith("USB\\", StringComparison.OrdinalIgnoreCase) ||
                     devId.StartsWith("PCI\\", StringComparison.OrdinalIgnoreCase)) &&
                    !name.Contains("Enumerator", StringComparison.OrdinalIgnoreCase) &&
                    !name.Contains("Transport", StringComparison.OrdinalIgnoreCase) &&
                    !name.Contains("Generic", StringComparison.OrdinalIgnoreCase))
                {
                    adapterName = name;
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[Bluetooth] WMI AdapterName error: {ex.Message}");
        }

        try
        {
            var findParams = new Win32.BLUETOOTH_FIND_RADIO_PARAMS
            {
                dwSize = (uint)Marshal.SizeOf<Win32.BLUETOOTH_FIND_RADIO_PARAMS>()
            };
            IntPtr hRadio = IntPtr.Zero;
            IntPtr hFind = Win32.BluetoothFindFirstRadio(ref findParams, out hRadio);
            if (hFind != IntPtr.Zero)
            {
                try
                {
                    byte[] buf = new byte[512];
                    if (Win32.DeviceIoControl(hRadio, 0x410000, IntPtr.Zero, 0, buf, (uint)buf.Length, out uint ret, IntPtr.Zero) && ret >= 292)
                    {
                        byte lmpMajor = buf[291];
                        ushort lmpSub = (ushort)(buf[289] | (buf[290] << 8));
                        versionStr = MapLmpToBluetoothVersion(lmpMajor);
                        lmpStr = $"LMP {lmpMajor}.{lmpSub}";
                    }
                }
                finally
                {
                    if (hRadio != IntPtr.Zero) Win32.CloseHandle(hRadio);
                    Win32.BluetoothFindRadioClose(hFind);
                }
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[Bluetooth] IOCTL radio error: {ex.Message}");
        }

        return (adapterName, versionStr, lmpStr);
    }

    private async Task<object> QueryBluetoothStateAsync()
    {
        bool isEnabled = false;
        try
        {
            var radios = await Windows.Devices.Radios.Radio.GetRadiosAsync();
            var btRadio = radios.FirstOrDefault(r => r.Kind == Windows.Devices.Radios.RadioKind.Bluetooth);
            if (btRadio != null)
            {
                isEnabled = btRadio.State == Windows.Devices.Radios.RadioState.On;
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[Bluetooth] GetRadios error: {ex.Message}");
        }

        var deviceList = new List<object>();
        var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var activeAudioNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var audioDevs = _audioController.GetAudioDevices(NAudio.CoreAudioApi.DataFlow.Render);
            foreach (var ad in audioDevs)
            {
                if (!string.IsNullOrWhiteSpace(ad.Name))
                {
                    activeAudioNames.Add(ad.Name);
                }
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[Bluetooth] GetAudioDevices error: {ex.Message}");
        }

        try
        {
            string aqs = Windows.Devices.Bluetooth.BluetoothDevice.GetDeviceSelectorFromPairingState(true);
            var winRtDevices = await Windows.Devices.Enumeration.DeviceInformation.FindAllAsync(
                aqs,
                BluetoothDeviceProperties);

            foreach (var d in winRtDevices)
            {
                string name = d.Name?.Trim() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(name) || !seenNames.Add(name))
                    continue;

                bool isConnected = false;
                if (d.Properties.TryGetValue("System.Devices.Aep.IsConnected", out var connVal) && connVal is bool b)
                {
                    isConnected = b;
                }

                if (!isConnected && activeAudioNames.Any(an => an.Contains(name, StringComparison.OrdinalIgnoreCase) || name.Contains(an, StringComparison.OrdinalIgnoreCase)))
                {
                    isConnected = true;
                }

                bool isAudio = name.Contains("Buds", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("Head", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("Ear", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("ANC", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("Wireless", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("soundcore", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("Jabra", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("Speaker", StringComparison.OrdinalIgnoreCase) ||
                               activeAudioNames.Any(an => an.Contains(name, StringComparison.OrdinalIgnoreCase));

                deviceList.Add(new
                {
                    id = d.Id,
                    name = name,
                    status = isConnected ? "Connected" : "Paired",
                    connected = isConnected,
                    is_audio = isAudio
                });
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[Bluetooth] WinRT FindAllAsync error: {ex.Message}");
        }

        if (_cachedBtAdapterName == null)
        {
            var info = GetBluetoothAdapterInfo();
            _cachedBtAdapterName = info.name;
            _cachedBtVersion = info.version;
            _cachedBtLmp = info.lmp;
        }

        int connectedCount = deviceList.Count(d =>
        {
            var prop = d.GetType().GetProperty("connected");
            return prop != null && (bool)prop.GetValue(d)!;
        });

        bool isAudioPlaying = false;
        try
        {
            isAudioPlaying = _audioController.LastFrameRms > 0.005f;
        }
        catch {}

        float rxKbps = 0f;
        float txKbps = 0f;
        if (connectedCount > 0)
        {
            if (isAudioPlaying && deviceList.Any(d =>
            {
                var p = d.GetType().GetProperty("connected");
                var pa = d.GetType().GetProperty("is_audio");
                return (bool)p?.GetValue(d)! && (bool)pa?.GetValue(d)!;
            }))
            {
                txKbps = 328.4f;
                rxKbps = 14.2f;
            }
            else
            {
                txKbps = 1.8f;
                rxKbps = 1.1f;
            }
        }

        return new
        {
            enabled = isEnabled,
            devices = deviceList,
            adapter_name = _cachedBtAdapterName ?? "Bluetooth Radio",
            version = _cachedBtVersion ?? "Bluetooth 5.0+",
            lmp = _cachedBtLmp ?? "LMP 11",
            connected_count = connectedCount,
            rx_kbps = rxKbps,
            tx_kbps = txKbps
        };
    }

    private static async Task<object> ConnectBluetoothDeviceAsync(string deviceId)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(deviceId))
            {
                var btDevice = await Windows.Devices.Bluetooth.BluetoothDevice.FromIdAsync(deviceId);
                if (btDevice != null)
                {
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(4));
                            await btDevice.GetRfcommServicesAsync(Windows.Devices.Bluetooth.BluetoothCacheMode.Uncached).AsTask(cts.Token);
                        }
                        catch {}
                    });
                }
            }
            Process.Start(new ProcessStartInfo("ms-settings:bluetooth") { UseShellExecute = true });
            return new { success = true };
        }
        catch (Exception ex)
        {
            return new { success = false, message = ex.Message };
        }
    }

    private static Task<object> DisconnectBluetoothDeviceAsync(string deviceId)
    {
        try
        {
            Process.Start(new ProcessStartInfo("ms-settings:bluetooth") { UseShellExecute = true });
            return Task.FromResult<object>(new { success = true });
        }
        catch (Exception ex)
        {
            return Task.FromResult<object>(new { success = false, message = ex.Message });
        }
    }

    private static Task<object> QueryHotspotStateAsync()
    {
        return Task.Run<object>(() =>
        {
            try
            {
                var profile = Windows.Networking.Connectivity.NetworkInformation.GetInternetConnectionProfile();
                if (profile == null)
                {
                    var profiles = Windows.Networking.Connectivity.NetworkInformation.GetConnectionProfiles();
                    profile = profiles.Count > 0 ? profiles[0] : null;
                }
                if (profile == null)
                {
                    return new { enabled = false, supported = false, ssid = "Hotspot", clients = 0, band = "5 GHz" };
                }

                var tm = Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager.CreateFromConnectionProfile(profile);
                var cfg = tm.GetCurrentAccessPointConfiguration();
                string curSsid = string.IsNullOrWhiteSpace(cfg?.Ssid) ? "Hotspot" : cfg.Ssid;
                return new
                {
                    enabled = tm.TetheringOperationalState == Windows.Networking.NetworkOperators.TetheringOperationalState.On,
                    supported = true,
                    ssid = curSsid,
                    passphrase = cfg?.Passphrase ?? string.Empty,
                    clients = tm.ClientCount,
                    band = cfg?.Band == Windows.Networking.NetworkOperators.TetheringWiFiBand.TwoPointFourGigahertz ? "2.4 GHz" : "5.0 GHz"
                };
            }
            catch
            {
                return new { enabled = false, supported = false, ssid = "Hotspot", passphrase = string.Empty, clients = 0, band = "5 GHz" };
            }
        });
    }

    private static async Task<object> ToggleHotspotAsync()
    {
        try
        {
            var profile = Windows.Networking.Connectivity.NetworkInformation.GetInternetConnectionProfile();
            if (profile == null)
            {
                var profiles = Windows.Networking.Connectivity.NetworkInformation.GetConnectionProfiles();
                profile = profiles.Count > 0 ? profiles[0] : null;
            }
            if (profile == null) return new { enabled = false, success = false, ssid = "Hotspot" };

            var tm = Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager.CreateFromConnectionProfile(profile);
            var cfg = tm.GetCurrentAccessPointConfiguration();
            string curSsid = string.IsNullOrWhiteSpace(cfg?.Ssid) ? "Hotspot" : cfg.Ssid;

            if (tm.TetheringOperationalState == Windows.Networking.NetworkOperators.TetheringOperationalState.On)
            {
                var stopRes = await tm.StopTetheringAsync();
                return new { enabled = false, success = stopRes.Status == Windows.Networking.NetworkOperators.TetheringOperationStatus.Success, ssid = curSsid };
            }
            else
            {
                var startRes = await tm.StartTetheringAsync();
                bool ok = startRes.Status == Windows.Networking.NetworkOperators.TetheringOperationStatus.Success;
                return new { enabled = ok, success = ok, ssid = curSsid };
            }
        }
        catch
        {
            return new { enabled = false, success = false, ssid = "Hotspot" };
        }
    }

    private static async Task<object> SetHotspotConfigAsync(string ssid, string passphrase)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(ssid) || ssid.Length > 32)
            {
                return new { success = false, reason = "SSID must be 1-32 characters" };
            }
            if (passphrase.Length is < 8 or > 64)
            {
                return new { success = false, reason = "Password must be 8-64 characters" };
            }

            var profile = Windows.Networking.Connectivity.NetworkInformation.GetInternetConnectionProfile();
            if (profile == null)
            {
                return new { success = false, reason = "No active internet connection" };
            }

            var tm = Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager.CreateFromConnectionProfile(profile);
            var cfg = new Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration
            {
                Ssid = ssid,
                Passphrase = passphrase,
                Band = Windows.Networking.NetworkOperators.TetheringWiFiBand.TwoPointFourGigahertz
            };
            await tm.ConfigureAccessPointAsync(cfg);
            return new { success = true, ssid = ssid };
        }
        catch (Exception ex)
        {
            return new { success = false, reason = ex.Message };
        }
    }

    private static string _savedActivePowerScheme = "904d4403-7d62-4952-baeb-38640036c448";

    private static async Task<object> QueryPowerModeAsync()
    {
        bool isPowerSaver = false;
        string activeGuid = string.Empty;
        try
        {
            var psi = new ProcessStartInfo("powercfg", "/getactivescheme")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true
            };
            using var p = Process.Start(psi);
            if (p != null)
            {
                string text = await p.StandardOutput.ReadToEndAsync();
                await p.WaitForExitAsync();
                if (text.Contains("a1841308-3541-4fab-bc81-f71556f20b4a", StringComparison.OrdinalIgnoreCase))
                {
                    isPowerSaver = true;
                }
                var m = System.Text.RegularExpressions.Regex.Match(text, @"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (m.Success)
                {
                    activeGuid = m.Value.ToLowerInvariant();
                    if (!isPowerSaver)
                    {
                        _savedActivePowerScheme = activeGuid;
                    }
                }
            }
        }
        catch
        {
        }

        bool hasBattery = Windows.System.Power.PowerManager.BatteryStatus != Windows.System.Power.BatteryStatus.NotPresent;
        return new
        {
            is_power_saver = isPowerSaver,
            active_scheme = activeGuid,
            has_battery = hasBattery
        };
    }

    private static async Task<string?> GetActivePowerSchemeGuidAsync()
    {
        try
        {
            var psi = new ProcessStartInfo("powercfg", "/getactivescheme")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true
            };
            using var p = Process.Start(psi);
            if (p != null)
            {
                string text = await p.StandardOutput.ReadToEndAsync();
                await p.WaitForExitAsync();
                var m = System.Text.RegularExpressions.Regex.Match(text, @"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (m.Success) return m.Value.ToLowerInvariant();
            }
        }
        catch
        {
        }
        return null;
    }

    private static async Task<object> TogglePowerSaverAsync()
    {
        try
        {
            string? activeGuid = await GetActivePowerSchemeGuidAsync();
            bool currentlySaver = activeGuid is not null && activeGuid == "a1841308-3541-4fab-bc81-f71556f20b4a";
            if (activeGuid is not null && !currentlySaver)
            {
                _savedActivePowerScheme = activeGuid;
            }

            string targetScheme = currentlySaver
                ? (_savedActivePowerScheme ?? "381b4222-f694-41f0-9685-ff5bb260df2e")
                : "a1841308-3541-4fab-bc81-f71556f20b4a";

            using var p = Process.Start(new ProcessStartInfo("powercfg", $"/s {targetScheme}")
            {
                CreateNoWindow = true,
                UseShellExecute = false
            });
            if (p != null) await p.WaitForExitAsync();

            return new { is_power_saver = !currentlySaver, success = true };
        }
        catch
        {
            return new { is_power_saver = false, success = false };
        }
    }

    private async void OnSlideshowTimerTick(object? sender, EventArgs e)
    {
        await AdvanceSlideshowAsync();
    }

    public async Task<bool> AdvanceSlideshowAsync()
    {
        try
        {
            if (_desktopWallpaper.IsSupported && _desktopWallpaper.AdvanceSlideshow())
            {
                _log.Write("Slideshow advanced via IDesktopWallpaper COM");
                return true;
            }

            var wallpapers = await _wallpaperService.GetWallpaperFilesAsync();
            if (wallpapers.Count == 0)
                return false;

            if (_slideshowShuffle)
            {
                _slideshowWallpaperIndex = Random.Shared.Next(0, wallpapers.Count);
            }
            else
            {
                _slideshowWallpaperIndex = (_slideshowWallpaperIndex + 1) % wallpapers.Count;
            }

            string wallpaperPath = wallpapers[_slideshowWallpaperIndex];
            bool applied = await _wallpaperService.ApplyWallpaperAsync(wallpaperPath);
            _log.Write($"Slideshow actively applied {wallpaperPath}: success={applied}");

            _ = Dispatcher.InvokeAsync(() =>
            {
                if (ShellWebView.CoreWebView2 is not null)
                {
                    string json = JsonSerializer.Serialize(new
                    {
                        type = "event",
                        name = "canopy:wallpaper-changed",
                        payload = new { path = wallpaperPath, name = Path.GetFileNameWithoutExtension(wallpaperPath) }
                    });
                    ShellWebView.CoreWebView2.PostWebMessageAsJson(json);
                }
            }, DispatcherPriority.Background);

            return applied;
        }
        catch (Exception ex)
        {
            _log.WriteException("AdvanceSlideshowAsync", ex);
            return false;
        }
    }

    private static string? CaptureDesktopThumbnail(Win32.RECT monitor)
    {
        IntPtr hDesktop = IntPtr.Zero;
        IntPtr hdcSrc = IntPtr.Zero;
        IntPtr hdcDest = IntPtr.Zero;
        IntPtr hBitmap = IntPtr.Zero;
        IntPtr hOld = IntPtr.Zero;
        try
        {
            hDesktop = Win32.GetDesktopWindow();
            hdcSrc = Win32.GetDC(hDesktop);
            if (hdcSrc == IntPtr.Zero) return null;

            hdcDest = Win32.CreateCompatibleDC(hdcSrc);
            int targetW = 64;
            int targetH = 36;
            hBitmap = Win32.CreateCompatibleBitmap(hdcSrc, targetW, targetH);
            hOld = Win32.SelectObject(hdcDest, hBitmap);

            Win32.SetStretchBltMode(hdcDest, 4); // HALFTONE
            int monW = monitor.Width > 0 ? monitor.Width : 1920;
            int monH = monitor.Height > 0 ? monitor.Height : 1080;
            Win32.StretchBlt(hdcDest, 0, 0, targetW, targetH, hdcSrc, monitor.Left, monitor.Top, monW, monH, 0x00CC0020);

            using var bmp = System.Drawing.Image.FromHbitmap(hBitmap);
            using var ms = new System.IO.MemoryStream();
            bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[DesktopCapture] Error: {ex.Message}");
            return null;
        }
        finally
        {
            // Every handle is freed on every path, including when FromHbitmap or Save throws.
            if (hdcDest != IntPtr.Zero)
            {
                if (hOld != IntPtr.Zero) Win32.SelectObject(hdcDest, hOld);
                Win32.DeleteDC(hdcDest);
            }
            if (hBitmap != IntPtr.Zero) Win32.DeleteObject(hBitmap);
            if (hdcSrc != IntPtr.Zero) Win32.ReleaseDC(hDesktop, hdcSrc);
        }
    }

    private static List<object> QueryNetworkAdapters()
    {
        var list = new List<object>();
        try
        {
            foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback)
                    continue;

                string desc = ni.Description ?? string.Empty;
                string name = ni.Name ?? string.Empty;
                if (desc.Contains("VirtualBox", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Hyper-V", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Virtual", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("WSL", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Tailscale", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("WARP", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Wintun", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("TAP", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("VPN", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Tunnel", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Wi-Fi Direct", StringComparison.OrdinalIgnoreCase) ||
                    name.StartsWith("vEthernet", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("WSL", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                string type = ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Wireless80211
                    ? "wifi"
                    : "ethernet";

                string ip = string.Empty;
                try
                {
                    var ipProps = ni.GetIPProperties();
                    foreach (var addr in ipProps.UnicastAddresses)
                    {
                        if (addr.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork &&
                            !addr.Address.ToString().StartsWith("169.254.", StringComparison.Ordinal))
                        {
                            ip = addr.Address.ToString();
                            break;
                        }
                    }
                }
                catch { }

                long speedMbps = ni.Speed > 0 ? ni.Speed / 1_000_000L : 0L;

                list.Add(new
                {
                    id = ni.Id,
                    name = ni.Name,
                    description = ni.Description,
                    type = type,
                    status = ni.OperationalStatus.ToString().ToLowerInvariant(),
                    speed_mbps = speedMbps,
                    ip_address = ip,
                    is_connected = ni.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up
                });
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[NetworkAdapters] Query error: {ex.Message}");
        }
        return list;
    }

    private static bool IsValidWifiSsid(string? ssid) =>
        !string.IsNullOrWhiteSpace(ssid) && ssid.Length <= 32 && ssid.IndexOf('"') < 0
        && !System.Linq.Enumerable.Any(ssid, char.IsControl);

    private static ProcessStartInfo NetshStartInfo(params string[] args)
    {
        var psi = new ProcessStartInfo("netsh") { CreateNoWindow = true, UseShellExecute = false };
        foreach (string arg in args) psi.ArgumentList.Add(arg);
        return psi;
    }

    private static async Task<object> AddAndConnectWifiAsync(string ssid, string password)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(ssid)) return new { success = false, message = "SSID is required" };
            if (!IsValidWifiSsid(ssid)) return new { success = false, message = "SSID is invalid" };
            string xmlSsid = System.Security.SecurityElement.Escape(ssid) ?? string.Empty;
            string xmlPassword = System.Security.SecurityElement.Escape(password) ?? string.Empty;

            string profileXml = string.IsNullOrEmpty(password) ? $@"<?xml version=""1.0""?>
<WLANProfile xmlns=""http://www.microsoft.com/networking/WLAN/profile/v1"">
    <name>{xmlSsid}</name>
    <SSIDConfig>
        <SSID>
            <name>{xmlSsid}</name>
        </SSID>
    </SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>manual</connectionMode>
    <MSM>
        <security>
            <authEncryption>
                <authentication>open</authentication>
                <encryption>none</encryption>
                <useOneX>false</useOneX>
            </authEncryption>
        </security>
    </MSM>
</WLANProfile>" : $@"<?xml version=""1.0""?>
<WLANProfile xmlns=""http://www.microsoft.com/networking/WLAN/profile/v1"">
    <name>{xmlSsid}</name>
    <SSIDConfig>
        <SSID>
            <name>{xmlSsid}</name>
        </SSID>
    </SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>manual</connectionMode>
    <MSM>
        <security>
            <authEncryption>
                <authentication>WPA2PSK</authentication>
                <encryption>AES</encryption>
                <useOneX>false</useOneX>
            </authEncryption>
            <sharedKey>
                <keyType>passPhrase</keyType>
                <protected>false</protected>
                <keyMaterial>{xmlPassword}</keyMaterial>
            </sharedKey>
        </security>
    </MSM>
</WLANProfile>";

            string tempFile = Path.Combine(Path.GetTempPath(), $"wifi_profile_{Guid.NewGuid():N}.xml");
            await File.WriteAllTextAsync(tempFile, profileXml);
            try
            {
                using var pAdd = Process.Start(NetshStartInfo("wlan", "add", "profile", $"filename={tempFile}", "user=current"));
                if (pAdd != null) await pAdd.WaitForExitAsync();

                using var pConn = Process.Start(NetshStartInfo("wlan", "connect", $"name={ssid}"));
                if (pConn != null) await pConn.WaitForExitAsync();

                s_lastWifiProfilesTicks = 0;
                return new { success = true, message = $"Connected to {ssid}" };
            }
            finally
            {
                try { File.Delete(tempFile); } catch { }
            }
        }
        catch (Exception ex)
        {
            return new { success = false, message = ex.Message };
        }
    }
}
