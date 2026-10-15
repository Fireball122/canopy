using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;

namespace CaelestiaWin.Interop;

/// <summary>
/// A single physical display as reported by the shell's <c>IDesktopWallpaper</c> interface.
/// </summary>
public sealed class MonitorWallpaper
{
    /// <summary>Opaque monitor device path used as the handle for wallpaper assignment.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>Human-friendly display label (display index plus native resolution).</summary>
    [JsonPropertyName("label")]
    public required string Label { get; init; }

    /// <summary>Path of the image currently shown on this monitor, or empty when unknown.</summary>
    [JsonPropertyName("path")]
    public string Path { get; init; } = string.Empty;
}

/// <summary>
/// Thin wrapper over the documented Windows 8+ COM interface <c>IDesktopWallpaper</c>
/// (<c>CLSID_DesktopWallpaper</c>) for per-monitor wallpaper assignment and slideshow control.
/// <para>
/// The shell owns slideshow advancement: once a slideshow is configured through
/// <c>SetSlideshow</c> + <c>SetSlideshowOptions</c> Windows rotates the images itself at the
/// interval it was given, so this type never calls <c>AdvanceSlideshow</c> and needs no timer thread.
/// </para>
/// <para>
/// Every public member swallows COM/IO failures, and the whole controller degrades to
/// <see cref="IsSupported"/> == <c>false</c> when the interface is unavailable, letting the host
/// fall back to the classic <c>SystemParametersInfo</c> path. No member throws across the API,
/// so the controller is safe to drive straight from the UI thread.
/// </para>
/// </summary>
public sealed class DesktopWallpaperController : IDisposable
{
    private static readonly Guid ClsidDesktopWallpaper = new("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD");
    private static readonly Guid IidShellItem = new("43826D1E-E718-42EE-BC55-A1E261C37BFE");
    private static readonly Guid IidShellItemArray = new("B63EA76D-1F85-456F-A19C-48159EFA858B");

    private const int DsoShuffleImages = 0x01;
    private const int DssSlideshow = 0x02;
    private const uint DefaultSlideshowIntervalMs = 30 * 60 * 1000;

    private IDesktopWallpaper? _desktopWallpaper;
    private bool _disposed;

    /// <summary>True when <c>IDesktopWallpaper</c> was created and answers a probe call.</summary>
    public bool IsSupported { get; }

    public DesktopWallpaperController()
    {
        try
        {
            Type? comType = Type.GetTypeFromCLSID(ClsidDesktopWallpaper, throwOnError: false);
            if (comType is not null && Activator.CreateInstance(comType) is IDesktopWallpaper wallpaper)
            {
                _desktopWallpaper = wallpaper;

                // Confirm the interface actually responds before advertising support.
                IsSupported = wallpaper.GetMonitorDevicePathCount(out _) >= 0;
            }
        }
        catch
        {
            IsSupported = false;
        }

        if (!IsSupported)
        {
            ReleaseComObject(ref _desktopWallpaper);
        }
    }

    /// <summary>
    /// Enumerates every monitor in shell order and reports its device path, label and current image.
    /// Returns an empty list when the interface is unavailable.
    /// </summary>
    public List<MonitorWallpaper> GetMonitors()
    {
        var result = new List<MonitorWallpaper>();
        IDesktopWallpaper? wallpaper = _desktopWallpaper;
        if (wallpaper is null)
            return result;

        try
        {
            if (wallpaper.GetMonitorDevicePathCount(out uint count) < 0)
                return result;

            for (uint index = 0; index < count; index++)
            {
                if (wallpaper.GetMonitorDevicePathAt(index, out IntPtr idPtr) < 0 || idPtr == IntPtr.Zero)
                    continue;

                string id;
                try
                {
                    id = Marshal.PtrToStringUni(idPtr) ?? string.Empty;
                }
                finally
                {
                    Marshal.FreeCoTaskMem(idPtr);
                }

                if (id.Length == 0)
                    continue;

                result.Add(new MonitorWallpaper
                {
                    Id = id,
                    Label = BuildLabel(index, wallpaper, id),
                    Path = GetMonitorWallpaper(id) ?? string.Empty
                });
            }
        }
        catch
        {
        }

        return result;
    }

    /// <summary>Assigns an image to a single monitor identified by its device path.</summary>
    public bool SetMonitorWallpaper(string monitorId, string fullPath)
    {
        IDesktopWallpaper? wallpaper = _desktopWallpaper;
        if (wallpaper is null || string.IsNullOrWhiteSpace(monitorId) || string.IsNullOrWhiteSpace(fullPath))
            return false;

        if (!File.Exists(fullPath))
            return false;

        try
        {
            return wallpaper.SetWallpaper(monitorId, fullPath) >= 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Returns the image currently assigned to a monitor, or <c>null</c> when unknown.</summary>
    public string? GetMonitorWallpaper(string monitorId)
    {
        IDesktopWallpaper? wallpaper = _desktopWallpaper;
        if (wallpaper is null || string.IsNullOrWhiteSpace(monitorId))
            return null;

        try
        {
            if (wallpaper.GetWallpaper(monitorId, out IntPtr pathPtr) < 0 || pathPtr == IntPtr.Zero)
                return null;

            try
            {
                return Marshal.PtrToStringUni(pathPtr);
            }
            finally
            {
                Marshal.FreeCoTaskMem(pathPtr);
            }
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Configures the shell slideshow over every image in <paramref name="directory"/> and records
    /// how often it should rotate. Windows itself advances the slideshow from that point on, so no
    /// background thread is started here.
    /// </summary>
    public bool SetSlideShow(string directory, uint intervalMs, bool shuffle)
    {
        IDesktopWallpaper? wallpaper = _desktopWallpaper;
        if (wallpaper is null || string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            return false;

        uint tick = intervalMs == 0 ? DefaultSlideshowIntervalMs : intervalMs;
        object? items = null;
        try
        {
            items = CreateShellItemArray(directory);
            if (items is null)
                return false;

            if (wallpaper.SetSlideshow(items) < 0)
                return false;

            int options = shuffle ? DsoShuffleImages : 0;
            return wallpaper.SetSlideshowOptions(options, tick) >= 0;
        }
        catch
        {
            return false;
        }
        finally
        {
            ReleaseComObject(ref items);
        }
    }

    /// <summary>
    /// Leaves slideshow mode by pinning every monitor to the image it is currently showing, so the
    /// desktop freezes on one picture. Does nothing when no slideshow is running.
    /// </summary>
    public void StopSlideShow()
    {
        IDesktopWallpaper? wallpaper = _desktopWallpaper;
        if (wallpaper is null || !IsSlideshowRunning(wallpaper))
            return;

        foreach (MonitorWallpaper monitor in GetMonitors())
        {
            if (monitor.Path.Length == 0)
                continue;

            try
            {
                if (wallpaper.SetWallpaper(monitor.Id, monitor.Path) >= 0)
                    continue;
            }
            catch
            {
            }

            try
            {
                wallpaper.SetWallpaper(null, monitor.Path);
            }
            catch
            {
            }
        }
    }

    /// <summary>Interval, in milliseconds, recorded for the current slideshow (0 when unknown).</summary>
    public uint GetSlideShowIntervalMs()
    {
        IDesktopWallpaper? wallpaper = _desktopWallpaper;
        if (wallpaper is null)
            return 0;

        try
        {
            return wallpaper.GetSlideshowOptions(out _, out uint tick) >= 0 ? tick : 0;
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>True when the current slideshow shuffles its images.</summary>
    public bool GetShuffle()
    {
        IDesktopWallpaper? wallpaper = _desktopWallpaper;
        if (wallpaper is null)
            return false;

        try
        {
            return wallpaper.GetSlideshowOptions(out int options, out _) >= 0 && (options & DsoShuffleImages) != 0;
        }
        catch
        {
            return false;
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;

        ReleaseComObject(ref _desktopWallpaper);
    }

    private static string BuildLabel(uint index, IDesktopWallpaper wallpaper, string monitorId)
    {
        string label = $"Display {index + 1}";

        try
        {
            if (wallpaper.GetMonitorRECT(monitorId, out Win32.RECT rect) >= 0 && rect.Width > 0 && rect.Height > 0)
            {
                label += $" · {rect.Width} × {rect.Height}";
            }
        }
        catch
        {
        }

        return label;
    }

    private static object? CreateShellItemArray(string directory)
    {
        object? shellItem = null;
        try
        {
            Guid iidItem = IidShellItem;
            if (SHCreateItemFromParsingName(directory, IntPtr.Zero, ref iidItem, out shellItem) < 0 || shellItem is null)
                return null;

            Guid iidArray = IidShellItemArray;
            if (SHCreateShellItemArrayFromShellItem(shellItem, ref iidArray, out object? array) < 0)
                return null;

            return array;
        }
        catch
        {
            return null;
        }
        finally
        {
            ReleaseComObject(ref shellItem);
        }
    }

    /// <summary>True when the desktop wallpaper is currently being run as a slideshow.</summary>
    private static bool IsSlideshowRunning(IDesktopWallpaper wallpaper)
    {
        try
        {
            return wallpaper.GetStatus(out int state) >= 0 && (state & DssSlideshow) != 0;
        }
        catch
        {
            return false;
        }
    }

    private static void ReleaseComObject<T>(ref T? comObject) where T : class
    {
        T? local = comObject;
        comObject = null;

        if (local is null)
            return;

        try
        {
            if (Marshal.IsComObject(local))
                Marshal.FinalReleaseComObject(local);
        }
        catch
        {
        }
    }

    [ComImport]
    [Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDesktopWallpaper
    {
        [PreserveSig]
        int SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string? monitorId, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);

        [PreserveSig]
        int GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string? monitorId, out IntPtr wallpaper);

        [PreserveSig]
        int GetMonitorDevicePathAt(uint monitorIndex, out IntPtr monitorId);

        [PreserveSig]
        int GetMonitorDevicePathCount(out uint count);

        [PreserveSig]
        int GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorId, out Win32.RECT displayRect);

        [PreserveSig]
        int SetBackgroundColor(uint color);

        [PreserveSig]
        int GetBackgroundColor(out uint color);

        [PreserveSig]
        int SetPosition(int position);

        [PreserveSig]
        int GetPosition(out int position);

        [PreserveSig]
        int SetSlideshow([MarshalAs(UnmanagedType.IUnknown)] object items);

        [PreserveSig]
        int GetSlideshow([MarshalAs(UnmanagedType.IUnknown)] out object items);

        [PreserveSig]
        int SetSlideshowOptions(int options, uint slideshowTick);

        [PreserveSig]
        int GetSlideshowOptions(out int options, out uint slideshowTick);

        [PreserveSig]
        int AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string? monitorId, int direction);

        [PreserveSig]
        int GetStatus(out int state);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr pbc,
        ref Guid riid,
        [MarshalAs(UnmanagedType.IUnknown)] out object? shellItem);

    [DllImport("shell32.dll")]
    private static extern int SHCreateShellItemArrayFromShellItem(
        [MarshalAs(UnmanagedType.IUnknown)] object psi,
        ref Guid riid,
        [MarshalAs(UnmanagedType.IUnknown)] out object? shellItemArray);
}
