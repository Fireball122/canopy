using System.Collections.Concurrent;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using Canopy.Interop;

namespace Canopy.Services;

/// <summary>
/// Scans %USERPROFILE%\Pictures\Wallpapers, serves disk-cached JPEG thumbnails as data URLs,
/// and applies desktop wallpapers via SystemParametersInfo with a per-monitor iris-wipe reveal.
/// </summary>
public sealed class WallpaperService : IDisposable
{
    public const int ThumbnailDecodeWidth = 360;

    /// <summary>Maximum number of JPEG thumbnails kept on disk before the oldest are evicted.</summary>
    private const int ThumbnailCacheFileLimit = 500;

    public static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".webp"
    };

    // Resolution is header-only metadata keyed by path and invalidated by last-write time, so repeat
    // get_wallpapers calls don't reopen every image in the folder.
    private readonly ConcurrentDictionary<string, (long Ticks, string Resolution)> _resolutionCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _applyLock = new();
    private Task _applyTail = Task.CompletedTask;
    private int _applyGeneration;
    private readonly string _defaultWallpapersDirectory;
    private bool _disposed;

    public string WallpapersDirectory { get; private set; }

    private static readonly string PersistFilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Canopy",
        "wallpaper_folder.txt");
    private static readonly string ThumbnailsCacheDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Canopy",
        "thumbnails");

    private static string GetThumbnailCachePath(string filePath, long ticks, out string safeName)
    {
        safeName = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(filePath.ToLowerInvariant())))[..16];
        return Path.Combine(ThumbnailsCacheDirectory, $"{safeName}_{ticks}.jpg");
    }

    private static string? GetOrCreateDiskThumbnailDataUrl(string filePath, string cacheFile, string safeName, out bool created)
    {
        created = false;
        try
        {
            if (File.Exists(cacheFile))
            {
                byte[] cachedBytes = File.ReadAllBytes(cacheFile);
                // An empty entry is an interrupted write; fall through and re-encode it.
                if (cachedBytes.Length > 0)
                    return $"data:image/jpeg;base64,{Convert.ToBase64String(cachedBytes)}";
            }

            BitmapSource? bmp = DecodeThumbnail(filePath);
            if (bmp is null)
                return null;

            var encoder = new JpegBitmapEncoder { QualityLevel = 82 };
            encoder.Frames.Add(BitmapFrame.Create(bmp));
            byte[] bytes;
            using (var ms = new MemoryStream())
            {
                encoder.Save(ms);
                bytes = ms.ToArray();
            }

            // A failed cache write still returns the freshly encoded thumbnail.
            created = TryWriteThumbnailAtomically(cacheFile, bytes);
            if (created)
                DeleteStaleThumbnailVariants(safeName, cacheFile);
            return $"data:image/jpeg;base64,{Convert.ToBase64String(bytes)}";
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] GetOrCreateDiskThumbnailDataUrl error: {ex.Message}");
        }
        return null;
    }

    /// <summary>
    /// Write-then-rename so overlapping scans (panel mount + wallpaper view) or a crash mid-write can
    /// never leave a truncated JPEG under the final name, which would then be served forever.
    /// </summary>
    private static bool TryWriteThumbnailAtomically(string cacheFile, byte[] bytes)
    {
        string tempFile = $"{cacheFile}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllBytes(tempFile, bytes);
            File.Move(tempFile, cacheFile, overwrite: true);
            return true;
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] Thumbnail cache write error: {ex.Message}");
            try
            {
                File.Delete(tempFile);
            }
            catch (Exception deleteEx)
            {
                DiagnosticsLog.Log($"[WallpaperService] Thumbnail temp cleanup error: {deleteEx.Message}");
            }
            return false;
        }
    }

    /// <summary>Drops every older variant of a wallpaper whose content or timestamp changed.</summary>
    private static void DeleteStaleThumbnailVariants(string safeName, string keepFile)
    {
        try
        {
            foreach (string stale in Directory.EnumerateFiles(ThumbnailsCacheDirectory, $"{safeName}_*.jpg"))
            {
                if (string.Equals(stale, keepFile, StringComparison.OrdinalIgnoreCase))
                    continue;

                try
                {
                    File.Delete(stale);
                }
                catch (Exception ex)
                {
                    DiagnosticsLog.Log($"[WallpaperService] Delete stale thumbnail warning: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] DeleteStaleThumbnailVariants error: {ex.Message}");
        }
    }

    /// <summary>
    /// Keeps the on-disk cache bounded at <see cref="ThumbnailCacheFileLimit"/> files (or the current
    /// folder's size, if larger), evicting oldest-first among entries the current folder doesn't use.
    /// Runs once per scan: it used to re-enumerate the whole cache after every new thumbnail (quadratic
    /// on first open), and a folder bigger than the cap evicted and re-encoded its own thumbnails on
    /// every open.
    /// </summary>
    private static void EvictOldThumbnails(HashSet<string> inUse)
    {
        try
        {
            var evictable = new List<(string Path, DateTime Written)>();
            int total = 0;
            foreach (string file in Directory.EnumerateFiles(ThumbnailsCacheDirectory, "*.jpg"))
            {
                total++;
                if (!inUse.Contains(file))
                    evictable.Add((file, TryGetLastWriteUtc(file)));
            }

            int excess = total - Math.Max(ThumbnailCacheFileLimit, inUse.Count);
            if (excess <= 0)
                return;

            foreach (var (path, _) in evictable.OrderBy(entry => entry.Written).Take(excess))
            {
                try
                {
                    File.Delete(path);
                }
                catch (Exception ex)
                {
                    DiagnosticsLog.Log($"[WallpaperService] Evict old thumbnail warning: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] EvictOldThumbnails error: {ex.Message}");
        }
    }

    private static DateTime TryGetLastWriteUtc(string filePath)
    {
        try
        {
            return File.GetLastWriteTimeUtc(filePath);
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] TryGetLastWriteUtc error: {ex.Message}");
            return DateTime.MinValue;
        }
    }

    public WallpaperService()
    {
        string picturesDir = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
        if (string.IsNullOrWhiteSpace(picturesDir))
        {
            picturesDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Pictures");
        }
        _defaultWallpapersDirectory = Path.Combine(picturesDir, "Wallpapers");

        string initialDir = TryLoadPersistedDirectory();
        WallpapersDirectory = string.IsNullOrWhiteSpace(initialDir) || !Directory.Exists(initialDir)
            ? _defaultWallpapersDirectory
            : initialDir;
        EnsureDirectoryAndSeedSamples(WallpapersDirectory);
    }

    private static string TryLoadPersistedDirectory()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Canopy");
            string? regPath = key?.GetValue("WallpaperDirectory")?.ToString();
            if (!string.IsNullOrWhiteSpace(regPath) && Directory.Exists(regPath))
            {
                return regPath;
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] Registry load error: {ex.Message}");
        }

        try
        {
            if (File.Exists(PersistFilePath))
            {
                string text = File.ReadAllText(PersistFilePath).Trim();
                if (!string.IsNullOrWhiteSpace(text) && Directory.Exists(text))
                {
                    return text;
                }
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] File load error: {ex.Message}");
        }

        return string.Empty;
    }

    public void SetWallpapersDirectory(string directoryPath)
    {
        if (string.IsNullOrWhiteSpace(directoryPath))
            return;

        try
        {
            if (!Directory.Exists(directoryPath))
                Directory.CreateDirectory(directoryPath);

            WallpapersDirectory = directoryPath;
            TrySavePersistedDirectory(directoryPath);
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] SetWallpapersDirectory error: {ex.Message}");
        }
    }

    private static void TrySavePersistedDirectory(string directoryPath)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Canopy");
            key?.SetValue("WallpaperDirectory", directoryPath);
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] Registry save error: {ex.Message}");
        }

        try
        {
            string? dir = Path.GetDirectoryName(PersistFilePath);
            if (!string.IsNullOrWhiteSpace(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.WriteAllText(PersistFilePath, directoryPath);
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] File save error: {ex.Message}");
        }
    }

    private void EnsureDirectoryAndSeedSamples(string directory)
    {
        // Only Canopy's own default folder is created and seeded. A folder the user picked is theirs:
        // an empty one used to be filled with copied Windows stock images and generated PNGs on the
        // next get_wallpapers call.
        if (!IsSameDirectory(directory, _defaultWallpapersDirectory))
            return;

        try
        {
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            bool hasImages = Directory.EnumerateFiles(directory)
                .Any(f => SupportedExtensions.Contains(Path.GetExtension(f)));

            if (!hasImages)
            {
                SeedDefaultWallpapers(directory);
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] EnsureDirectoryAndSeedSamples error: {ex.Message}");
        }
    }

    private static bool IsSameDirectory(string first, string second)
    {
        if (string.IsNullOrWhiteSpace(first) || string.IsNullOrWhiteSpace(second))
            return false;

        try
        {
            return string.Equals(
                Path.TrimEndingDirectorySeparator(Path.GetFullPath(first)),
                Path.TrimEndingDirectorySeparator(Path.GetFullPath(second)),
                StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] IsSameDirectory error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Populates %USERPROFILE%\Pictures\Wallpapers on first run if empty so the carousel
    /// is immediately interactive. Copies Windows stock wallpapers if available, plus generated Caelestia gradients.
    /// </summary>
    private static void SeedDefaultWallpapers(string directory)
    {
        try
        {
            string windowsWallpapersRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "Web",
                "Wallpaper");

            if (Directory.Exists(windowsWallpapersRoot))
            {
                var stockFiles = Directory.EnumerateFiles(windowsWallpapersRoot, "*.*", SearchOption.AllDirectories)
                    .Where(f => SupportedExtensions.Contains(Path.GetExtension(f)))
                    .Take(4)
                    .ToList();

                foreach (string src in stockFiles)
                {
                    string destName = Path.GetFileName(src);
                    string destPath = Path.Combine(directory, destName);
                    if (!File.Exists(destPath))
                    {
                        File.Copy(src, destPath, overwrite: false);
                    }
                }
            }

            // Also generate sleek Canopy dark atmospheric wallpapers if fewer than 4 images exist
            int count = Directory.EnumerateFiles(directory)
                .Count(f => SupportedExtensions.Contains(Path.GetExtension(f)));

            if (count < 4)
            {
                GenerateAtmosphericWallpaper(
                    Path.Combine(directory, "Canopy-Obsidian-Aurora.png"),
                    Color.FromRgb(10, 12, 20),
                    Color.FromRgb(36, 24, 68),
                    Color.FromRgb(56, 189, 248));

                GenerateAtmosphericWallpaper(
                    Path.Combine(directory, "Canopy-Hypr-Nebula.png"),
                    Color.FromRgb(13, 13, 18),
                    Color.FromRgb(76, 29, 149),
                    Color.FromRgb(236, 72, 153));

                GenerateAtmosphericWallpaper(
                    Path.Combine(directory, "Canopy-Emerald-Void.png"),
                    Color.FromRgb(8, 15, 18),
                    Color.FromRgb(6, 78, 59),
                    Color.FromRgb(52, 211, 153));

                GenerateAtmosphericWallpaper(
                    Path.Combine(directory, "Canopy-Solar-Eclipse.png"),
                    Color.FromRgb(16, 12, 14),
                    Color.FromRgb(124, 45, 18),
                    Color.FromRgb(251, 146, 60));
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] SeedDefaultWallpapers error: {ex.Message}");
        }
    }

    private static void GenerateAtmosphericWallpaper(string outputPath, Color baseDark, Color midTone, Color accentGlow)
    {
        if (File.Exists(outputPath))
            return;

        const int width = 1920;
        const int height = 1080;

        var visual = new DrawingVisual();
        using (DrawingContext dc = visual.RenderOpen())
        {
            var bgBrush = new LinearGradientBrush(baseDark, midTone, new Point(0, 0), new Point(1, 1));
            dc.DrawRectangle(bgBrush, null, new Rect(0, 0, width, height));

            var glowBrush = new RadialGradientBrush
            {
                GradientOrigin = new Point(0.68, 0.35),
                Center = new Point(0.68, 0.35),
                RadiusX = 0.55,
                RadiusY = 0.55,
                GradientStops = new GradientStopCollection
                {
                    new(Color.FromArgb(145, accentGlow.R, accentGlow.G, accentGlow.B), 0.0),
                    new(Color.FromArgb(45, midTone.R, midTone.G, midTone.B), 0.55),
                    new(Color.FromArgb(0, baseDark.R, baseDark.G, baseDark.B), 1.0)
                }
            };
            dc.DrawRectangle(glowBrush, null, new Rect(0, 0, width, height));
        }

        var rtb = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(visual);
        rtb.Freeze();

        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(rtb));

        using FileStream fs = File.Create(outputPath);
        encoder.Save(fs);
    }

    private static BitmapImage? DecodeThumbnail(string fullPath)
    {
        try
        {
            using var stream = new FileStream(
                fullPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);

            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            bitmap.DecodePixelWidth = ThumbnailDecodeWidth;
            bitmap.StreamSource = stream;
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] DecodeThumbnail error: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Compares two wallpaper paths case-insensitively after canonicalising them with
    /// <see cref="Path.GetFullPath(string)"/>, tolerant of malformed or empty inputs.
    /// </summary>
    private static bool IsSameFile(string? first, string? second)
    {
        if (string.IsNullOrWhiteSpace(first) || string.IsNullOrWhiteSpace(second))
            return false;

        try
        {
            return string.Equals(
                Path.GetFullPath(first),
                Path.GetFullPath(second),
                StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] IsSameFile error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Instantly applies the selected image as the Windows desktop wallpaper via Win32 SystemParametersInfo.
    /// Returns immediately (no SPI_SETDESKWALLPAPER, no iris wipe, no WM_SETTINGCHANGE reload flicker)
    /// when the requested file is already the current desktop wallpaper.
    /// </summary>
    public Task<bool> ApplyWallpaperAsync(string fullPath)
    {
        if (string.IsNullOrWhiteSpace(fullPath) || !File.Exists(fullPath))
            return Task.FromResult(false);

        // Rapid picks used to run overlapping applies whose SystemParametersInfo calls could land out
        // of order (a slower decode of an earlier pick finishing last), leaving the desktop on an image
        // the UI no longer marks active, with stacked iris overlays. Applies now run one at a time and
        // a request superseded while queued is skipped.
        lock (_applyLock)
        {
            int generation = ++_applyGeneration;
            Task<bool> run = ApplyAfterAsync(_applyTail, fullPath, generation);
            _applyTail = run;
            return run;
        }
    }

    private async Task<bool> ApplyAfterAsync(Task previous, string fullPath, int generation)
    {
        try
        {
            await previous.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] Previous wallpaper apply failed: {ex.Message}");
        }

        // A newer pick is queued behind this one; it is what ends up on the desktop, so this request
        // is satisfied rather than failed.
        if (generation != Volatile.Read(ref _applyGeneration))
            return true;

        return await ApplyWallpaperCoreAsync(fullPath).ConfigureAwait(false);
    }

    private async Task<bool> ApplyWallpaperCoreAsync(string fullPath)
    {
        if (!File.Exists(fullPath))
            return false;

        string previousPath = Win32.GetCurrentDesktopWallpaper();

        if (IsSameFile(fullPath, previousPath))
            return true;

        var overlays = new List<Window>();

        // Reveal the new wallpaper via an independent centered circular expand (iris wipe) per monitor
        if (!string.IsNullOrWhiteSpace(previousPath) &&
            File.Exists(previousPath) &&
            !IsSameFile(previousPath, fullPath) &&
            Application.Current is not null)
        {
            try
            {
                // Pre-decode both images asynchronously on background thread so the UI thread has ZERO decode lag
                var (bmpOld, bmpNew) = await Task.Run(() =>
                {
                    BitmapImage LoadBmp(string path)
                    {
                        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                        var bmp = new BitmapImage();
                        bmp.BeginInit();
                        bmp.CacheOption = BitmapCacheOption.OnLoad;
                        bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
                        bmp.DecodePixelWidth = 1920;
                        bmp.StreamSource = stream;
                        bmp.EndInit();
                        bmp.Freeze();
                        return bmp;
                    }
                    return (LoadBmp(previousPath), LoadBmp(fullPath));
                }).ConfigureAwait(false);

                await Application.Current.Dispatcher.InvokeAsync(() =>
                {
                    var monitors = Win32.GetAllMonitors();
                    foreach (var mon in monitors)
                    {
                        var win = CreateDesktopIrisWipeWindow(bmpOld, bmpNew, mon);
                        if (win is not null)
                        {
                            overlays.Add(win);
                        }
                    }
                });
            }
            catch (Exception ex)
            {
                DiagnosticsLog.Log($"[WallpaperService] Iris wipe prep error: {ex.Message}");
            }
        }

        // Wait 560ms for the circular expansion animation to complete across each monitor
        if (overlays.Count > 0)
        {
            await Task.Delay(560).ConfigureAwait(false);
        }

        bool applied = await Task.Run(() =>
        {
            int result = Win32.SystemParametersInfo(
                Win32.SPI_SETDESKWALLPAPER,
                0,
                fullPath,
                Win32.SPIF_UPDATEINIFILE | Win32.SPIF_SENDCHANGE);

            return result != 0;
        }).ConfigureAwait(false);

        if (overlays.Count > 0 && Application.Current is not null)
        {
            try
            {
                await Application.Current.Dispatcher.InvokeAsync(() =>
                {
                    foreach (var w in overlays)
                    {
                        try
                        {
                            w.Close();
                        }
                        catch (Exception ex)
                        {
                            DiagnosticsLog.Log($"[WallpaperService] Iris window close error: {ex.Message}");
                        }
                    }
                });
            }
            catch (Exception ex)
            {
                DiagnosticsLog.Log($"[WallpaperService] Iris window cleanup error: {ex.Message}");
            }
        }

        return applied;
    }

    private static Window? CreateDesktopIrisWipeWindow(
        BitmapImage bmpOld,
        BitmapImage bmpNew,
        Win32.RECT mon)
    {
        try
        {
            double monW = Math.Max(100, mon.Width);
            double monH = Math.Max(100, mon.Height);

            var grid = new Grid();
            var oldImage = new Image
            {
                Source = bmpOld,
                Stretch = Stretch.UniformToFill,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch
            };
            var newImage = new Image
            {
                Source = bmpNew,
                Stretch = Stretch.UniformToFill,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch
            };

            // Start with a zero-radius clip; geometry and radii will be calibrated to exact DPI on SourceInitialized
            var irisClip = new EllipseGeometry(new Point(monW / 2.0, monH / 2.0), 0.0, 0.0);
            newImage.Clip = irisClip;

            grid.Children.Add(oldImage);
            grid.Children.Add(newImage);

            var overlay = new Window
            {
                WindowStyle = WindowStyle.None,
                AllowsTransparency = true,
                Background = Brushes.Transparent,
                ResizeMode = ResizeMode.NoResize,
                ShowInTaskbar = false,
                ShowActivated = false,
                Focusable = false,
                Topmost = false,
                Left = mon.Left,
                Top = mon.Top,
                Width = monW,
                Height = monH,
                Opacity = 1.0,
                IsHitTestVisible = false,
                Content = grid
            };

            double maxRadius = Math.Sqrt(monW * monW + monH * monH) + 120.0;

            overlay.SourceInitialized += (_, _) =>
            {
                IntPtr hwnd = new WindowInteropHelper(overlay).Handle;
                long exStyle = Win32.GetWindowLongPtr(hwnd, Win32.GWL_EXSTYLE).ToInt64();
                exStyle |= Win32.WS_EX_LAYERED | Win32.WS_EX_TRANSPARENT | Win32.WS_EX_TOOLWINDOW | Win32.WS_EX_NOACTIVATE;
                exStyle &= ~Win32.WS_EX_APPWINDOW;
                _ = Win32.SetWindowLongPtr(hwnd, Win32.GWL_EXSTYLE, new IntPtr(exStyle));

                uint dpi = Win32.GetDpiForWindow(hwnd);
                double scale = dpi > 0 ? dpi / 96.0 : 1.0;

                // Calibrate WPF window DIP dimensions
                double dipWidth = mon.Width / scale;
                double dipHeight = mon.Height / scale;
                overlay.Width = dipWidth;
                overlay.Height = dipHeight;

                double dipCenterX = dipWidth / 2.0;
                double dipCenterY = dipHeight / 2.0;
                irisClip.Center = new Point(dipCenterX, dipCenterY);
                maxRadius = Math.Sqrt(dipCenterX * dipCenterX + dipCenterY * dipCenterY) + 120.0;

                // Explicitly position the native HWND in physical pixels across monitor boundaries
                _ = Win32.SetWindowPos(
                    hwnd,
                    Win32.HWND_BOTTOM,
                    mon.Left, mon.Top, mon.Width, mon.Height,
                    Win32.SWP_NOACTIVATE | Win32.SWP_SHOWWINDOW);
            };

            // Start the circular expansion animation strictly when the window is composited on screen,
            // using EaseInOut so the small origin circle is distinctly visible from 0px before accelerating outward!
            overlay.ContentRendered += (_, _) =>
            {
                var anim = new DoubleAnimation(0.0, maxRadius, TimeSpan.FromMilliseconds(560))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut }
                };
                irisClip.BeginAnimation(EllipseGeometry.RadiusXProperty, anim);
                irisClip.BeginAnimation(EllipseGeometry.RadiusYProperty, anim);
            };

            overlay.Show();
            return overlay;
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] CreateDesktopIrisWipeWindow error: {ex.Message}");
            return null;
        }
    }



    private string GetImageResolution(string fullPath, long ticks)
    {
        if (_resolutionCache.TryGetValue(fullPath, out var cached) && cached.Ticks == ticks)
            return cached.Resolution;

        string resolution = ReadImageResolution(fullPath);
        _resolutionCache[fullPath] = (ticks, resolution);
        return resolution;
    }

    private static string ReadImageResolution(string fullPath)
    {
        try
        {
            using var stream = new FileStream(
                fullPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);
            var decoder = BitmapDecoder.Create(
                stream,
                BitmapCreateOptions.DelayCreation,
                BitmapCacheOption.None);
            if (decoder.Frames.Count > 0)
            {
                var frame = decoder.Frames[0];
                if (frame.PixelWidth > 0 && frame.PixelHeight > 0)
                {
                    return $"{frame.PixelWidth} × {frame.PixelHeight}";
                }
            }
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] GetImageResolution error: {ex.Message}");
        }

        return "1920 × 1080";
    }

    private void PruneResolutionCache(List<string> currentFiles)
    {
        if (_resolutionCache.Count <= currentFiles.Count)
            return;

        var current = new HashSet<string>(currentFiles, StringComparer.OrdinalIgnoreCase);
        foreach (string path in _resolutionCache.Keys)
        {
            if (!current.Contains(path))
                _resolutionCache.TryRemove(path, out _);
        }
    }

    private static void TryEnsureThumbnailDirectory()
    {
        try
        {
            Directory.CreateDirectory(ThumbnailsCacheDirectory);
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[WallpaperService] Thumbnail cache directory error: {ex.Message}");
        }
    }

    /// <summary>
    /// Sorted wallpaper file paths of the current folder. Runs on the thread pool: seeding and
    /// enumeration touch the disk, which must not happen on the WPF UI thread (slideshow tick).
    /// </summary>
    public Task<List<string>> GetWallpaperFilesAsync()
    {
        string directory = WallpapersDirectory;
        return Task.Run(() =>
        {
            try
            {
                EnsureDirectoryAndSeedSamples(directory);
                return Directory.EnumerateFiles(directory)
                    .Where(f => SupportedExtensions.Contains(Path.GetExtension(f)))
                    .OrderBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }
            catch (Exception ex)
            {
                DiagnosticsLog.Log($"[WallpaperService] GetWallpaperFiles error: {ex.Message}");
                return new List<string>();
            }
        });
    }

    public Task<List<object>> GetWallpaperBridgeEntriesAsync()
    {
        string directory = WallpapersDirectory;
        return Task.Run(() =>
        {
            EnsureDirectoryAndSeedSamples(directory);
            string current = Win32.GetCurrentDesktopWallpaper();
            var list = new List<object>();

            try
            {
                var files = Directory.EnumerateFiles(directory)
                    .Where(f => SupportedExtensions.Contains(Path.GetExtension(f)))
                    .Where(f =>
                    {
                        try
                        {
                            return (File.GetAttributes(f) & FileAttributes.Offline) == 0;
                        }
                        catch (Exception ex)
                        {
                            DiagnosticsLog.Log($"[WallpaperService] GetAttributes error: {ex.Message}");
                            return true;
                        }
                    })
                    .OrderBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase)
                    .ToList();

                TryEnsureThumbnailDirectory();
                var thumbnailsInUse = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                bool createdAny = false;

                foreach (string file in files)
                {
                    bool active = IsSameFile(file, current);
                    long ticks = TryGetLastWriteUtc(file).Ticks;
                    string cacheFile = GetThumbnailCachePath(file, ticks, out string safeName);
                    thumbnailsInUse.Add(cacheFile);

                    string? dataUrl = GetOrCreateDiskThumbnailDataUrl(file, cacheFile, safeName, out bool created);
                    createdAny |= created;

                    string resolution = GetImageResolution(file, ticks);
                    list.Add(new
                    {
                        name = Path.GetFileNameWithoutExtension(file),
                        path = file,
                        data_url = dataUrl,
                        resolution,
                        active
                    });
                }

                if (createdAny)
                    EvictOldThumbnails(thumbnailsInUse);
                PruneResolutionCache(files);
            }
            catch (Exception ex)
            {
                DiagnosticsLog.Log($"[WallpaperService] GetWallpaperBridgeEntries error: {ex.Message}");
            }

            return list;
        });
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
    }
}
