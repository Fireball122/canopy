using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using Canopy.Interop;
using Canopy.Services;

namespace Canopy;

public partial class App : Application
{
    private const string MutexName = @"Local\Canopy_ZeroNotchOverlay_SingleInstance_v1";
    private const string ExpandEventName = @"Local\Canopy_ZeroNotchOverlay_ExpandEvent_v1";
    private const string TestNotifyEventName = @"Local\Canopy_ZeroNotchOverlay_TestNotifyEvent_v1";
    public const string ControlPipeName = "Canopy_Control_v1";
    private readonly DiagnosticsLog _log = new();
    private Mutex? _singleInstanceMutex;
    private EventWaitHandle? _expandEvent;
    private EventWaitHandle? _testNotifyEvent;
    private CancellationTokenSource? _ipcCts;
    private bool _ownsMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += (s, args) =>
        {
            _log.WriteException("AppDomain unhandled", args.ExceptionObject as Exception ?? new Exception(args.ExceptionObject?.ToString()));
            LogFatalError("AppDomain Unhandled", args.ExceptionObject);
        };
        TaskScheduler.UnobservedTaskException += (s, args) =>
        {
            _log.WriteException("Task unobserved", args.Exception);
            LogFatalError("Task Unobserved", args.Exception);
            args.SetObserved();
        };
        _singleInstanceMutex = new Mutex(initiallyOwned: true, MutexName, out _ownsMutex);
        if (!_ownsMutex)
        {
            string? commandToSend = null;
            if (HasArgument(e.Args, "--test-notify"))
            {
                commandToSend = "notify:Canopy Reminder|Raindrop to Pill Capsule alert working seamlessly!";
            }
            else if (HasArgument(e.Args, "--collapse"))
            {
                commandToSend = "collapse";
            }
            else if (HasArgument(e.Args, "--toggle"))
            {
                commandToSend = "toggle";
            }
            else if (HasArgument(e.Args, "--expand"))
            {
                commandToSend = "expand";
            }
            else if (HasArgument(e.Args, "--next-wallpaper"))
            {
                commandToSend = "next-wallpaper";
            }
            else
            {
                int notifyIdx = Array.FindIndex(e.Args, a => string.Equals(a, "--notify", StringComparison.OrdinalIgnoreCase));
                if (notifyIdx >= 0 && notifyIdx + 1 < e.Args.Length)
                {
                    string msg = e.Args[notifyIdx + 1];
                    string title = (notifyIdx + 2 < e.Args.Length && !e.Args[notifyIdx + 2].StartsWith("--", StringComparison.Ordinal)) ? e.Args[notifyIdx + 2] : "Canopy Notification";
                    commandToSend = $"notify:{title}|{msg}";
                }

                int tabIdx = Array.FindIndex(e.Args, a => string.Equals(a, "--tab", StringComparison.OrdinalIgnoreCase));
                if (tabIdx >= 0 && tabIdx + 1 < e.Args.Length)
                {
                    commandToSend = $"tab:{e.Args[tabIdx + 1]}";
                }

                int themeIdx = Array.FindIndex(e.Args, a => string.Equals(a, "--theme", StringComparison.OrdinalIgnoreCase));
                if (themeIdx >= 0 && themeIdx + 1 < e.Args.Length)
                {
                    commandToSend = $"theme:{e.Args[themeIdx + 1]}";
                }

                int cmdIdx = Array.FindIndex(e.Args, a => string.Equals(a, "--cmd", StringComparison.OrdinalIgnoreCase));
                if (cmdIdx >= 0 && cmdIdx + 1 < e.Args.Length)
                {
                    commandToSend = e.Args[cmdIdx + 1];
                }
            }

            if (commandToSend != null)
            {
                bool sent = SendRemoteCommandAsync(commandToSend, timeoutMs: 1200).GetAwaiter().GetResult();
                if (sent)
                {
                    Shutdown(0);
                    return;
                }
            }

            if (HasArgument(e.Args, "--test-notify"))
            {
                try
                {
                    using var notifyHandle = EventWaitHandle.OpenExisting(TestNotifyEventName);
                    notifyHandle.Set();
                }
                catch
                {
                }
                Shutdown(0);
                return;
            }

            // Hand the launch over to the instance that already owns the mutex. `--hidden` launches
            // (autostart) must not pop the panel, everything else does.
            BringExistingInstanceForward(requestExpand: !HasArgument(e.Args, "--hidden"));
            Shutdown(0);
            return;
        }

        // `--hidden` starts parked (autostart / background launch), `--expand` and `--toggle`
        // open the panel on launch, which is what the desktop shortcut asks for.
        bool startHidden = HasArgument(e.Args, "--hidden");
        bool forceExpand = HasArgument(e.Args, "--expand") || HasArgument(e.Args, "--toggle");
        bool startExpanded = forceExpand || (!startHidden && HostPreferences.LoadShowPanelOnLaunch());

        _log.Write($"startup args [{string.Join(' ', e.Args)}] startExpanded={startExpanded}");

        // The signal handle must exist before the first window is shown. It used to be created after
        // Show(), so a quick second launch (double-clicking the shortcut) found no handle, silently
        // gave up, and looked like "Canopy will not open".
        TryCreateExpandEvent();

        var mainWindow = new MainWindow(startExpanded: startExpanded);
        MainWindow = mainWindow;
        mainWindow.Show();

        StartExpandSignalListener(mainWindow);

        if (HasArgument(e.Args, "--test-notify"))
        {
            Dispatcher.InvokeAsync(async () =>
            {
                await Task.Delay(500);
                NotificationWindow.ShowNotification(
                    "Canopy Reminder: Raindrop to Pill Capsule alert working seamlessly!",
                    "Canopy Reminder");
            });
        }
    }

    private static bool HasArgument(string[] args, string name) =>
        args.Any(arg => string.Equals(arg, name, StringComparison.OrdinalIgnoreCase));

    private void TryCreateExpandEvent()
    {
        try
        {
            _expandEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ExpandEventName);
            _testNotifyEvent = new EventWaitHandle(false, EventResetMode.AutoReset, TestNotifyEventName);
        }
        catch (Exception ex)
        {
            _log.WriteException("expand event creation", ex);
        }
    }

    /// <summary>
    /// Signals the running instance to slide the panel down. Retries while the other instance is still
    /// starting up, then falls back to raising the existing panel window directly.
    /// </summary>
    private static void BringExistingInstanceForward(bool requestExpand)
    {
        if (!requestExpand)
        {
            return;
        }

        for (int attempt = 0; attempt < 25; attempt++)
        {
            try
            {
                using var existingEvent = EventWaitHandle.OpenExisting(ExpandEventName);
                existingEvent.Set();
                return;
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                // The other instance has not created the handle yet; wait and try again.
                Thread.Sleep(100);
            }
            catch
            {
                break;
            }
        }

        // Last resort: the signal could not be delivered, so surface the existing panel window.
        foreach (Process process in Process.GetProcessesByName("Canopy"))
        {
            try
            {
                IntPtr hwnd = Win32.FindTopLevelWindow((uint)process.Id, "Canopy");
                if (hwnd == IntPtr.Zero)
                {
                    continue;
                }

                Win32.ShowWithoutActivating(hwnd);
                _ = Win32.SetForegroundWindow(hwnd);
                return;
            }
            catch
            {
                // Process exited mid-enumeration; nothing to recover.
            }
            finally
            {
                process.Dispose();
            }
        }
    }
    private void StartExpandSignalListener(MainWindow mainWindow)
    {
        try
        {
            _expandEvent ??= new EventWaitHandle(false, EventResetMode.AutoReset, ExpandEventName);
            _testNotifyEvent ??= new EventWaitHandle(false, EventResetMode.AutoReset, TestNotifyEventName);
            _ipcCts = new CancellationTokenSource();
            CancellationToken token = _ipcCts.Token;

            _ = Task.Run(() =>
            {
                while (!token.IsCancellationRequested)
                {
                    int index = WaitHandle.WaitAny([_expandEvent, _testNotifyEvent, token.WaitHandle]);
                    if (index == 0)
                    {
                        mainWindow.Dispatcher.InvokeAsync(mainWindow.ExpandWithPreviewGrace);
                    }
                    else if (index == 1)
                    {
                        mainWindow.Dispatcher.InvokeAsync(() =>
                        {
                            try
                            {
                                NotificationWindow.ShowNotification(
                                    "Canopy Reminder: Raindrop to Pill Capsule alert working seamlessly!",
                                    "Canopy Reminder");
                            }
                            catch (Exception ex)
                            {
                                LogFatalError("TestNotify IPC", ex);
                            }
                        });
                    }
                    else
                    {
                        break;
                    }
                }
            }, token);
            StartControlPipeServer(mainWindow, token);
        }
        catch (Exception ex)
        {
            _log.WriteException("expand signal listener", ex);
        }
    }
    public static async Task<bool> SendRemoteCommandAsync(string command, int timeoutMs = 800)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", ControlPipeName, PipeDirection.Out);
            await client.ConnectAsync(timeoutMs);
            using var writer = new StreamWriter(client) { AutoFlush = true };
            await writer.WriteLineAsync(command);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void StartControlPipeServer(MainWindow mainWindow, CancellationToken token)
    {
        _ = Task.Run(async () =>
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(
                        ControlPipeName,
                        PipeDirection.In,
                        NamedPipeServerStream.MaxAllowedServerInstances,
                        PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous);

                    await server.WaitForConnectionAsync(token);
                    using var reader = new StreamReader(server);
                    string? line = await reader.ReadLineAsync(token);
                    if (!string.IsNullOrWhiteSpace(line))
                    {
                        _ = mainWindow.Dispatcher.InvokeAsync(() => ExecuteControlCommand(mainWindow, line));
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _log.WriteException("ControlPipeServer", ex);
                    await Task.Delay(250, token);
                }
            }
        }, token);
    }

    private static void ExecuteControlCommand(MainWindow mainWindow, string command)
    {
        string cmd = command.Trim();
        if (cmd.Equals("expand", StringComparison.OrdinalIgnoreCase))
        {
            mainWindow.ExpandWithPreviewGrace();
        }
        else if (cmd.Equals("collapse", StringComparison.OrdinalIgnoreCase))
        {
            mainWindow.CollapsePanel();
        }
        else if (cmd.Equals("toggle", StringComparison.OrdinalIgnoreCase))
        {
            mainWindow.TogglePanel();
        }
        else if (cmd.StartsWith("notify:", StringComparison.OrdinalIgnoreCase))
        {
            string payload = cmd.Substring(7);
            string[] parts = payload.Split('|', 2);
            string title = parts.Length > 1 ? parts[0] : "Canopy Notification";
            string msg = parts.Length > 1 ? parts[1] : parts[0];
            mainWindow.TriggerNotification(msg, title);
        }
        else if (cmd.StartsWith("tab:", StringComparison.OrdinalIgnoreCase))
        {
            string tab = cmd.Substring(4).Trim();
            mainWindow.NavigateTab(tab);
        }
        else if (cmd.Equals("next-wallpaper", StringComparison.OrdinalIgnoreCase))
        {
            _ = mainWindow.NextWallpaperAsync();
        }
        else if (cmd.StartsWith("theme:", StringComparison.OrdinalIgnoreCase))
        {
            string theme = cmd.Substring(6).Trim();
            mainWindow.SetTheme(theme);
        }
        else if (cmd.Equals("media-play-pause", StringComparison.OrdinalIgnoreCase) || cmd.Equals("media-play", StringComparison.OrdinalIgnoreCase))
        {
            _ = mainWindow.MediaPlayPauseAsync();
        }
        else if (cmd.Equals("media-next", StringComparison.OrdinalIgnoreCase))
        {
            _ = mainWindow.MediaNextAsync();
        }
        else if (cmd.Equals("media-prev", StringComparison.OrdinalIgnoreCase))
        {
            _ = mainWindow.MediaPrevAsync();
        }
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        _log.WriteException("dispatcher unhandled", e.Exception);
        LogFatalError("Dispatcher Unhandled", e.Exception);
        e.Handled = true;
    }

    private static void LogFatalError(string category, object? exceptionObject)
    {
        try
        {
            string dir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Canopy");
            System.IO.Directory.CreateDirectory(dir);
            string path = System.IO.Path.Combine(dir, "error.log");
            System.IO.File.AppendAllText(path, $"[{DateTime.Now:O}] [{category}] {exceptionObject}\r\n");
        }
        catch
        {
        }
    }
    protected override void OnExit(ExitEventArgs e)
    {
        _ipcCts?.Cancel();
        _ipcCts?.Dispose();
        _expandEvent?.Dispose();
        _testNotifyEvent?.Dispose();

        if (_singleInstanceMutex is not null)
        {
            if (_ownsMutex)
            {
                try
                {
                    _singleInstanceMutex.ReleaseMutex();
                }
                catch
                {
                    // Ignore release exceptions on shutdown
                }
            }

            _singleInstanceMutex.Dispose();
            _singleInstanceMutex = null;
        }

        base.OnExit(e);
    }
}
