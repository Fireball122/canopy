using System.Threading;
using System.Windows;
using System.Windows.Threading;

namespace CaelestiaWin;

public partial class App : Application
{
    private const string MutexName = @"Local\CaelestiaWin_ZeroNotchOverlay_SingleInstance_v1";
    private const string ExpandEventName = @"Local\CaelestiaWin_ZeroNotchOverlay_ExpandEvent_v1";

    private Mutex? _singleInstanceMutex;
    private EventWaitHandle? _expandEvent;
    private CancellationTokenSource? _ipcCts;
    private bool _ownsMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        DispatcherUnhandledException += OnDispatcherUnhandledException;

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

        var mainWindow = new MainWindow(startExpanded: true);
        MainWindow = mainWindow;
        mainWindow.Show();

        StartExpandSignalListener(mainWindow);
    }

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

    private static void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        try
        {
            System.IO.File.AppendAllText(
                System.IO.Path.Combine(AppContext.BaseDirectory, "error.log"),
                $"[{DateTime.Now:O}] {e.Exception}\r\n");
        }
        catch
        {
        }
        e.Handled = true;
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
