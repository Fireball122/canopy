using System.Diagnostics;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using CaelestiaWin.Interop;
using CaelestiaWin.Services;

namespace CaelestiaWin;

public partial class App : Application
{
    private const string MutexName = @"Local\Canopy_ZeroNotchOverlay_SingleInstance_v1";
    private const string ExpandEventName = @"Local\Canopy_ZeroNotchOverlay_ExpandEvent_v1";
    private readonly DiagnosticsLog _log = new();
    private Mutex? _singleInstanceMutex;
    private EventWaitHandle? _expandEvent;
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
            _ipcCts = new CancellationTokenSource();
            CancellationToken token = _ipcCts.Token;

            _ = Task.Run(() =>
            {
                while (!token.IsCancellationRequested)
                {
                    int index = WaitHandle.WaitAny([_expandEvent, token.WaitHandle]);
                    if (index == 0)
                    {
                        mainWindow.Dispatcher.InvokeAsync(mainWindow.ExpandWithPreviewGrace);
                    }
                    else
                    {
                        break;
                    }
                }
            }, token);
        }
        catch (Exception ex)
        {
            _log.WriteException("expand signal listener", ex);
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
