using System.Threading;
using System.Windows;
using System.Windows.Threading;
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
            // Signal the already-running instance to slide down the panel immediately
            try
            {
                using var existingEvent = EventWaitHandle.OpenExisting(ExpandEventName);
                existingEvent.Set();
            }
            catch
            {
                // Ignore if event handle is not yet created
            }

            Shutdown(0);
            return;
        }

        // `--hidden` starts parked (autostart / background launch), `--expand` and `--toggle`
        // open the panel on launch, which is what the desktop shortcut asks for.
        bool startHidden = HasArgument(e.Args, "--hidden");
        bool forceExpand = HasArgument(e.Args, "--expand") || HasArgument(e.Args, "--toggle");
        bool startExpanded = forceExpand || (!startHidden && HostPreferences.LoadShowPanelOnLaunch());

        _log.Write($"startup args [{string.Join(' ', e.Args)}] startExpanded={startExpanded}");

        var mainWindow = new MainWindow(startExpanded: startExpanded);
        MainWindow = mainWindow;
        mainWindow.Show();

        StartExpandSignalListener(mainWindow);
    }

    private static bool HasArgument(string[] args, string name) =>
        args.Any(arg => string.Equals(arg, name, StringComparison.OrdinalIgnoreCase));

    private void StartExpandSignalListener(MainWindow mainWindow)
    {
        try
        {
            _expandEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ExpandEventName);
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
        catch
        {
            // Ignore IPC setup failures
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
