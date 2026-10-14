using System.Collections.Concurrent;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using CaelestiaWin.Interop;

namespace CaelestiaWin.Services;

/// <summary>
/// Scans %USERPROFILE%\Pictures\Wallpapers, serves disk-cached JPEG thumbnails as data URLs,
/// and applies desktop wallpapers via SystemParametersInfo with a per-monitor iris-wipe reveal.
/// </summary>
public sealed class WallpaperService : IDisposable
{
    public const int ThumbnailDecodeWidth = 360;

    /// <summary>Maximum number of JPEG thumbnails kept on disk before the oldest are evicted.</summary>
    private const int ThumbnailCacheFileLimit = 500;

    private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".webp"
    };

    private readonly ConcurrentDictionary<string, BitmapSource> _thumbnailCache = new(StringComparer.OrdinalIgnoreCase);
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

    private string? GetOrCreateDiskThumbnailDataUrl(string filePath)
    {
        try
        {
            Directory.CreateDirectory(ThumbnailsCacheDirectory);
            long ticks = File.GetLastWriteTimeUtc(filePath).Ticks;
            string safeName = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(filePath.ToLowerInvariant())))[..16];
            string cacheFile = Path.Combine(ThumbnailsCacheDirectory, $"{safeName}_{ticks}.jpg");

            if (File.Exists(cacheFile))
            {
                byte[] cachedBytes = File.ReadAllBytes(cacheFile);
                return $"data:image/jpeg;base64,{Convert.ToBase64String(cachedBytes)}";
            }

            BitmapSource? bmp = GetOrDecodeThumbnail(filePath);
            if (bmp is not null)
            {
                var encoder = new JpegBitmapEncoder { QualityLevel = 82 };
                encoder.Frames.Add(BitmapFrame.Create(bmp));
                using var ms = new MemoryStream();
                encoder.Save(ms);
                byte[] bytes = ms.ToArray();
                File.WriteAllBytes(cacheFile, bytes);
                PruneThumbnailCache(safeName, cacheFile);
                return $"data:image/jpeg;base64,{Convert.ToBase64String(bytes)}";
            }
        }
        catch
        {
        }
        return null;
    }

    /// <summary>
    /// Keeps the on-disk thumbnail cache bounded: drops every stale variant of the wallpaper
    /// that was just re-encoded (its content or timestamp changed) and then evicts the oldest
    /// entries once the whole cache grows past <see cref="ThumbnailCacheFileLimit"/> files.
    /// </summary>
    private void PruneThumbnailCache(string safeName, string keepFile)
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
                catch
                {
                }
            }

            var cached = Directory.EnumerateFiles(ThumbnailsCacheDirectory, "*.jpg")
                .Select(f => (Path: f, Written: TryGetLastWriteUtc(f)))
                .ToList();

            if (cached.Count <= ThumbnailCacheFileLimit)
                return;

            foreach (var (path, _) in cached
                         .OrderBy(entry => entry.Written)
                         .Take(cached.Count - ThumbnailCacheFileLimit))
            {
                try
                {
                    File.Delete(path);
                }
                catch
                {
                }
            }
        }
        catch
        {
        }
    }

    private static DateTime TryGetLastWriteUtc(string filePath)
    {
        try
        {
            return File.GetLastWriteTimeUtc(filePath);
        }
        catch
        {
            return DateTime.MinValue;
        }
    }

    public WallpaperService()
    {
        string initialDir = TryLoadPersistedDirectory();
        if (string.IsNullOrWhiteSpace(initialDir) || !Directory.Exists(initialDir))
        {
            string picturesDir = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
            if (string.IsNullOrWhiteSpace(picturesDir))
            {
                picturesDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Pictures");
            }
            initialDir = Path.Combine(picturesDir, "Wallpapers");
        }

        WallpapersDirectory = initialDir;
        EnsureDirectoryAndSeedSamples();
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
        catch
        {
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
        catch
        {
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
        catch
        {
        }
    }

    private static void TrySavePersistedDirectory(string directoryPath)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Canopy");
            key?.SetValue("WallpaperDirectory", directoryPath);
        }
        catch
        {
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
        catch
        {
        }
    }

    private void EnsureDirectoryAndSeedSamples()
    {
        try
        {
            if (!Directory.Exists(WallpapersDirectory))
            {
                Directory.CreateDirectory(WallpapersDirectory);
            }

            bool hasImages = Directory.EnumerateFiles(WallpapersDirectory)
                .Any(f => SupportedExtensions.Contains(Path.GetExtension(f)));

            if (!hasImages)
            {
                SeedDefaultWallpapers();
            }
        }
        catch
        {
            // Ignore permission or IO edge cases
        }
    }

    /// <summary>
    /// Populates %USERPROFILE%\Pictures\Wallpapers on first run if empty so the carousel
    /// is immediately interactive. Copies Windows stock wallpapers if available, plus generated Caelestia gradients.
    /// </summary>
    private void SeedDefaultWallpapers()
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
                    string destPath = Path.Combine(WallpapersDirectory, destName);
                    if (!File.Exists(destPath))
                    {
                        File.Copy(src, destPath, overwrite: false);
                    }
                }
            }

            // Also generate sleek Canopy dark atmospheric wallpapers if fewer than 4 images exist
            int count = Directory.EnumerateFiles(WallpapersDirectory)
                .Count(f => SupportedExtensions.Contains(Path.GetExtension(f)));

            if (count < 4)
            {
                GenerateAtmosphericWallpaper(
                    Path.Combine(WallpapersDirectory, "Canopy-Obsidian-Aurora.png"),
                    Color.FromRgb(10, 12, 20),
                    Color.FromRgb(36, 24, 68),
                    Color.FromRgb(56, 189, 248));

                GenerateAtmosphericWallpaper(
                    Path.Combine(WallpapersDirectory, "Canopy-Hypr-Nebula.png"),
                    Color.FromRgb(13, 13, 18),
                    Color.FromRgb(76, 29, 149),
                    Color.FromRgb(236, 72, 153));

                GenerateAtmosphericWallpaper(
                    Path.Combine(WallpapersDirectory, "Canopy-Emerald-Void.png"),
                    Color.FromRgb(8, 15, 18),
                    Color.FromRgb(6, 78, 59),
                    Color.FromRgb(52, 211, 153));

                GenerateAtmosphericWallpaper(
                    Path.Combine(WallpapersDirectory, "Canopy-Solar-Eclipse.png"),
                    Color.FromRgb(16, 12, 14),
                    Color.FromRgb(124, 45, 18),
                    Color.FromRgb(251, 146, 60));
            }
        }
        catch
        {
            // Ignore seeding errors
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

    private BitmapSource? GetOrDecodeThumbnail(string fullPath)
    {
        try
        {
            if (!File.Exists(fullPath))
                return null;

            DateTime lastWrite = File.GetLastWriteTimeUtc(fullPath);
            string cacheKey = $"{fullPath}|{lastWrite.Ticks}";

            if (_thumbnailCache.TryGetValue(cacheKey, out BitmapSource? cached))
            {
                return cached;
            }

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

            _thumbnailCache[cacheKey] = bitmap;
            return bitmap;
        }
        catch
        {
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
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Instantly applies the selected image as the Windows desktop wallpaper via Win32 SystemParametersInfo.
    /// Returns immediately (no SPI_SETDESKWALLPAPER, no iris wipe, no WM_SETTINGCHANGE reload flicker)
    /// when the requested file is already the current desktop wallpaper.
    /// </summary>
    public async Task<bool> ApplyWallpaperAsync(string fullPath)
    {
        if (string.IsNullOrWhiteSpace(fullPath) || !File.Exists(fullPath))
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
            catch
            {
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
                        catch
                        {
                        }
                    }
                });
            }
            catch
            {
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
            double centerX = monW / 2.0;
            double centerY = monH / 2.0;
            double maxRadius = Math.Sqrt(centerX * centerX + centerY * centerY) + 120.0;

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

            // Centered circular expand (iris wipe) clip anchored at THIS monitor's center, starting at exactly 0.0
            var irisClip = new EllipseGeometry(new Point(centerX, centerY), 0.0, 0.0);
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

            overlay.SourceInitialized += (_, _) =>
            {
                IntPtr hwnd = new WindowInteropHelper(overlay).Handle;
                long exStyle = Win32.GetWindowLongPtr(hwnd, Win32.GWL_EXSTYLE).ToInt64();
                exStyle |= Win32.WS_EX_LAYERED | Win32.WS_EX_TRANSPARENT | Win32.WS_EX_TOOLWINDOW | Win32.WS_EX_NOACTIVATE;
                exStyle &= ~Win32.WS_EX_APPWINDOW;
                _ = Win32.SetWindowLongPtr(hwnd, Win32.GWL_EXSTYLE, new IntPtr(exStyle));

                _ = Win32.SetWindowPos(
                    hwnd,
                    Win32.HWND_BOTTOM,
                    0, 0, 0, 0,
                    Win32.SWP_NOMOVE | Win32.SWP_NOSIZE | Win32.SWP_NOACTIVATE | Win32.SWP_SHOWWINDOW);
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
        catch
        {
            return null;
        }
    }



    private static string GetImageResolution(string fullPath)
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
        catch
        {
        }

        return "1920 × 1080";
    }

    public Task<List<object>> GetWallpaperBridgeEntriesAsync()
    {
        return Task.Run(() =>
        {
            EnsureDirectoryAndSeedSamples();
            string current = Win32.GetCurrentDesktopWallpaper();
            var list = new List<object>();

            try
            {
                var files = Directory.EnumerateFiles(WallpapersDirectory)
                    .Where(f => SupportedExtensions.Contains(Path.GetExtension(f)))
                    .OrderBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase)
                    .ToList();

                foreach (string file in files)
                {
                    bool active = IsSameFile(file, current);

                    string? dataUrl = GetOrCreateDiskThumbnailDataUrl(file);

                    string resolution = GetImageResolution(file);
                    list.Add(new
                    {
                        name = Path.GetFileNameWithoutExtension(file),
                        path = file,
                        data_url = dataUrl,
                        resolution,
                        active
                    });
                }
            }
            catch
            {
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
