using System.IO;

namespace CaelestiaWin.Services;

/// <summary>
/// Append-only diagnostic log for the windowed host, which has no console.
/// Writes are no-ops until <see cref="Enabled"/> is switched on from the settings surface,
/// so an idle install never touches the disk.
/// </summary>
public sealed class DiagnosticsLog
{
    private const long MaxBytes = 2L * 1024 * 1024;

    private readonly object _gate = new();
    private readonly string _filePath;

    public DiagnosticsLog()
    {
        string directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Canopy");
        try
        {
            Directory.CreateDirectory(directory);
        }
        catch
        {
            // Fall back to the install directory if the profile is not writable.
        }

        _filePath = Path.Combine(directory, "canopy.log");
    }

    public string FilePath => _filePath;

    private static bool _enabled;

    /// <summary>
    /// Process-wide switch so every logger instance agrees on whether logging is on.
    /// </summary>
    public bool Enabled
    {
        get => _enabled;
        set => _enabled = value;
    }

    public void Write(string message)
    {
        if (!Enabled)
        {
            return;
        }

        try
        {
            lock (_gate)
            {
                var info = new FileInfo(_filePath);
                if (info.Exists && info.Length > MaxBytes)
                {
                    File.Move(_filePath, _filePath + ".1", overwrite: true);
                }

                File.AppendAllText(_filePath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // Diagnosing must never break the app.
        }
    }

    public void WriteException(string context, Exception exception) => Write($"{context}: {exception}");
}
