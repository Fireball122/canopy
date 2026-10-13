using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using CaelestiaWin.Interop;
using CaelestiaWin.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace CaelestiaWin;

public partial class MainWindow : Window
{
    private const int HotkeyIdWinGrave = 9001;
    private const int HotkeyIdCtrlShiftSpace = 9002;

    // Top-screen trigger & debounce settings
    private const int TopTriggerWidthPx = 950;
    private const int TopTriggerHeightPx = 8;
    private const int HideDebounceMs = 300;

    private readonly AudioController _audioController;
    private readonly SystemMonitorService _systemMonitorService;
    private readonly WallpaperService _wallpaperService;
    private readonly SmtcMediaController _mediaController;

    private readonly DispatcherTimer _cursorPollTimer;
    private readonly DispatcherTimer _hideDebounceTimer;
    private readonly DispatcherTimer _offscreenHideTimer;

    private IntPtr _hwnd;
    private HwndSource? _hwndSource;
    private bool _isExpanded;
    private bool _isPinned;
    private bool _webViewReady;
    private readonly bool _startExpanded;
    private DateTime _ignoreAutoHideUntilUtc = DateTime.MinValue;
    private int _currentBrightness = 80;
    private bool _topHoverTriggerEnabled = true;

    public MainWindow(bool startExpanded = true)
    {
        _startExpanded = startExpanded;
        InitializeComponent();

        _audioController = new AudioController();
        _systemMonitorService = new SystemMonitorService();
        _wallpaperService = new WallpaperService();
        _mediaController = new SmtcMediaController();

        _cursorPollTimer = new DispatcherTimer(DispatcherPriority.Input)
        {
            Interval = TimeSpan.FromMilliseconds(25)
        };
        _cursorPollTimer.Tick += OnCursorPollTick;

        _hideDebounceTimer = new DispatcherTimer(DispatcherPriority.Normal)
        {
            Interval = TimeSpan.FromMilliseconds(HideDebounceMs)
        };
        _hideDebounceTimer.Tick += OnHideDebounceTimerTick;

        _offscreenHideTimer = new DispatcherTimer(DispatcherPriority.Normal)
        {
            Interval = TimeSpan.FromMilliseconds(320)
        };
        _offscreenHideTimer.Tick += OnOffscreenHideTimerTick;

        _ = Task.Run(() => _currentBrightness = QueryHardwareBrightness());
    }

    private void OnWindowSourceInitialized(object? sender, EventArgs e)
    {
        _hwnd = new WindowInteropHelper(this).Handle;
        _hwndSource = HwndSource.FromHwnd(_hwnd);
        _hwndSource?.AddHook(WndProc);

        // Apply WS_EX_TOOLWINDOW without WS_EX_LAYERED so WebView2 receives all clicks natively
        Win32.SetClickThrough(_hwnd, clickThrough: false);

        // Register Global Hotkeys: Win + Grave (`) and Ctrl + Shift + Space
        _ = Win32.RegisterHotKey(_hwnd, HotkeyIdWinGrave, Win32.MOD_WIN | Win32.MOD_NOREPEAT, Win32.VK_OEM_3);
        _ = Win32.RegisterHotKey(_hwnd, HotkeyIdCtrlShiftSpace, Win32.MOD_CONTROL | Win32.MOD_SHIFT | Win32.MOD_NOREPEAT, Win32.VK_SPACE);

        PositionWindowAtTopCenter(GetActiveMonitorBounds(), offscreen: !_startExpanded);
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

            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await ShellWebView.EnsureCoreWebView2Async(env);

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
                  window.__CAELESTIA_BRIDGE__ = {
                    invoke(cmd, args = {}) {
                      return new Promise((resolve, reject) => {
                        const id = seq++;
                        pending.set(id, { resolve, reject });
                        window.chrome.webview.postMessage(JSON.stringify({ id, cmd, args }));
                      });
                    }
                  };
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
            return localDist;

        string devDist = @"C:\Users\CEO\AppData\Local\Temp\Caelestia-Win\dist";
        if (Directory.Exists(devDist))
            return devDist;

        return AppContext.BaseDirectory;
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        int id = 0;
        try
        {
            string raw = e.TryGetWebMessageAsString();
            using JsonDocument doc = JsonDocument.Parse(raw);
            JsonElement root = doc.RootElement;

            id = root.TryGetProperty("id", out JsonElement idEl) ? idEl.GetInt32() : 0;
            string cmd = root.TryGetProperty("cmd", out JsonElement cmdEl) ? (cmdEl.GetString() ?? string.Empty) : string.Empty;
            JsonElement args = root.TryGetProperty("args", out JsonElement argsEl) ? argsEl : default;

            object? result = await HandleBridgeCommandAsync(cmd, args);
            SendRpcResponse(id, result, null);
        }
        catch (Exception ex)
        {
            SendRpcResponse(id, null, ex.Message);
        }
    }

    private async Task<object?> HandleBridgeCommandAsync(string cmd, JsonElement args)
    {
        // Any interactive command from inside the UI extends the auto-hide grace window slightly
        _ignoreAutoHideUntilUtc = DateTime.UtcNow.AddMilliseconds(400);

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
                return new
                {
                    title = media.Title,
                    artist = media.Artist,
                    album = media.Album,
                    is_playing = media.IsPlaying,
                    position_secs = (float)Math.Round(media.PositionSecs, 1),
                    duration_secs = (float)Math.Round(media.DurationSecs, 1),
                    artwork_url = media.ArtworkUrl,
                    source_app = media.SourceApp,
                    sessions = media.Sessions
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

            case "get_audio_state":
                return new
                {
                    volume = (int)Math.Round(_audioController.GetMasterVolumePercent()),
                    muted = _audioController.GetMute()
                };

            case "set_audio_volume":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("volume", out JsonElement volEl))
                {
                    float vol = (float)volEl.GetDouble();
                    _audioController.SetMasterVolumePercent(vol);
                }
                return null;
            }

            case "toggle_audio_mute":
            {
                bool muted = _audioController.ToggleMute();
                return new
                {
                    volume = (int)Math.Round(_audioController.GetMasterVolumePercent()),
                    muted
                };
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

            case "get_current_wallpaper":
            {
                return Win32.GetCurrentDesktopWallpaper();
            }

            case "pick_wallpaper_folder":
            {
                _ignoreAutoHideUntilUtc = DateTime.UtcNow.AddSeconds(60);
                var dialog = new OpenFolderDialog
                {
                    Title = "Select Canopy Wallpaper Folder",
                    InitialDirectory = Directory.Exists(_wallpaperService.WallpapersDirectory)
                        ? _wallpaperService.WallpapersDirectory
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
                        if (key is not null)
                        {
                            if (enabled)
                            {
                                string exePath = Environment.ProcessPath ?? @"C:\Users\CEO\AppData\Local\Canopy\Canopy.exe";
                                key.SetValue("Canopy", $"\"{exePath}\"");
                            }
                            else
                            {
                                key.DeleteValue("Canopy", throwOnMissingValue: false);
                            }
                        }
                    }
                    catch
                    {
                    }
                }
                return null;
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
                if (launched && _isExpanded && !_isPinned)
                {
                    CollapsePanel();
                }
                return launched;
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

            case "set_pinned":
            {
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("pinned", out JsonElement pinEl))
                {
                    _isPinned = pinEl.GetBoolean();
                }
                return _isPinned;
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
            foreach (ManagementObject obj in searcher.Get())
            {
                return Convert.ToInt32(obj["CurrentBrightness"]);
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
            foreach (ManagementObject obj in searcher.Get())
            {
                obj.InvokeMethod("WmiSetBrightness", new object[] { 1, (byte)Math.Clamp(level, 0, 100) });
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

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == Win32.WM_HOTKEY)
        {
            int id = wParam.ToInt32();
            if (id is HotkeyIdWinGrave or HotkeyIdCtrlShiftSpace)
            {
                ToggleDropdown();
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
        ExpandPanel(GetActiveMonitorBounds());
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

    private void PositionWindowAtTopCenter(Win32.RECT monitor, bool offscreen)
    {
        DpiScale dpi = VisualTreeHelper.GetDpi(this);
        double scaleX = dpi.DpiScaleX > 0 ? dpi.DpiScaleX : 1.0;
        double scaleY = dpi.DpiScaleY > 0 ? dpi.DpiScaleY : 1.0;

        double monitorLeftDip = monitor.Left / scaleX;
        double monitorTopDip = monitor.Top / scaleY;
        double monitorWidthDip = monitor.Width / scaleX;

        Left = Math.Round(monitorLeftDip + ((monitorWidthDip - Width) / 2.0));
        Top = offscreen ? Math.Round(monitorTopDip - Height - 100) : Math.Round(monitorTopDip);
    }

    private void OnCursorPollTick(object? sender, EventArgs e)
    {
        if (!Win32.GetCursorPos(out Win32.POINT cursor))
            return;

        Win32.RECT monitor = GetActiveMonitorBounds();
        int centerX = monitor.Left + (monitor.Width / 2);

        bool inTopTriggerZone =
            cursor.Y >= monitor.Top &&
            cursor.Y <= monitor.Top + TopTriggerHeightPx &&
            Math.Abs(cursor.X - centerX) <= (TopTriggerWidthPx / 2);

        if (!_isExpanded)
        {
            if (_topHoverTriggerEnabled && inTopTriggerZone && !Win32.IsAnyMouseButtonDown())
            {
                _hideDebounceTimer.Stop();
                ExpandPanel(monitor);
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

        if (_isPinned || DateTime.UtcNow < _ignoreAutoHideUntilUtc)
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

        return screenCursor.X >= (rect.Left - 16) &&
               screenCursor.X <= (rect.Right + 16) &&
               screenCursor.Y >= (rect.Top - 8) &&
               screenCursor.Y <= (rect.Bottom + 16);
    }

    private void OnHideDebounceTimerTick(object? sender, EventArgs e)
    {
        _hideDebounceTimer.Stop();
        if (!_isExpanded || _isPinned)
            return;

        if (Win32.GetCursorPos(out Win32.POINT cursor) && IsCursorInsideWindow(cursor))
            return;

        CollapsePanel();
    }

    public void ExpandPanel(Win32.RECT monitor)
    {
        _offscreenHideTimer.Stop();
        PositionWindowAtTopCenter(monitor, offscreen: false);
        Win32.SetClickThrough(_hwnd, clickThrough: false);

        _isExpanded = true;
        EmitFrontendEvent("caelestia:set-open", true);
        EmitFrontendEvent("toggle-dropdown", true);
    }

    public void CollapsePanel()
    {
        if (!_isExpanded)
            return;

        _isExpanded = false;
        EmitFrontendEvent("caelestia:set-open", false);
        EmitFrontendEvent("toggle-dropdown", false);

        _offscreenHideTimer.Stop();
        _offscreenHideTimer.Start();
    }

    private void OnOffscreenHideTimerTick(object? sender, EventArgs e)
    {
        _offscreenHideTimer.Stop();
        if (!_isExpanded)
        {
            Win32.SetClickThrough(_hwnd, clickThrough: true);
            PositionWindowAtTopCenter(GetActiveMonitorBounds(), offscreen: true);
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        _cursorPollTimer.Stop();
        _hideDebounceTimer.Stop();
        _offscreenHideTimer.Stop();

        if (_hwnd != IntPtr.Zero)
        {
            _ = Win32.UnregisterHotKey(_hwnd, HotkeyIdWinGrave);
            _ = Win32.UnregisterHotKey(_hwnd, HotkeyIdCtrlShiftSpace);
        }

        _hwndSource?.RemoveHook(WndProc);
        _audioController.Dispose();
        _wallpaperService.Dispose();
        _systemMonitorService.Dispose();
        ShellWebView.Dispose();

        base.OnClosed(e);
    }
}
