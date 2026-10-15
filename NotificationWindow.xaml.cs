using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using CaelestiaWin.Interop;

namespace CaelestiaWin;

public partial class NotificationWindow : Window
{
    private static NotificationWindow? s_current;
    private readonly DispatcherTimer _autoDismissTimer;
    private bool _isClosing;
    private bool _isHovered;

    public NotificationWindow(string message, string? title = "Canopy Reminder", string? accentColorHex = null)
    {
        InitializeComponent();

        string cleanMsg = message.Trim();
        if (cleanMsg.StartsWith("Canopy Reminder: ", StringComparison.OrdinalIgnoreCase))
        {
            cleanMsg = cleanMsg.Substring("Canopy Reminder: ".Length).Trim();
        }
        else if (cleanMsg.StartsWith("Reminder: ", StringComparison.OrdinalIgnoreCase))
        {
            cleanMsg = cleanMsg.Substring("Reminder: ".Length).Trim();
        }
        MessageText.Text = cleanMsg;

        string cleanTitle = string.IsNullOrWhiteSpace(title) ? "REMINDER" : title.Trim().ToUpperInvariant();
        TitleText.Text = cleanTitle;
        if (!string.IsNullOrWhiteSpace(accentColorHex))
        {
            try
            {
                var color = (Color)ColorConverter.ConvertFromString(accentColorHex);
                NotificationPill.BorderBrush = new SolidColorBrush(color);
                if (NotificationPill.Effect is System.Windows.Media.Effects.DropShadowEffect dropShadow)
                {
                    dropShadow.Color = color;
                }
                IconBadge.Background = new SolidColorBrush(Color.FromArgb(50, color.R, color.G, color.B));
                IconBadge.BorderBrush = new SolidColorBrush(Color.FromArgb(140, color.R, color.G, color.B));
            }
            catch
            {
                // Keep default theme accent
            }
        }

        _autoDismissTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(6.5)
        };
        _autoDismissTimer.Tick += (_, _) =>
        {
            if (!_isHovered && !_isClosing)
            {
                DismissWithAnimation();
            }
        };
    }

    /// <summary>
    /// Displays a standalone, always-on-top raindrop -> pill capsule notification that drops down from
    /// the screen's top bezel and stays above active applications without stealing focus.
    /// Works across any monitor resolution, aspect ratio, or DPI scale.
    /// </summary>
    public static void ShowNotification(string message, string? title = "Canopy Reminder", string? accentColorHex = null)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            try
            {
                if (s_current != null && !s_current._isClosing)
                {
                    s_current.Close();
                }

                var win = new NotificationWindow(message, title, accentColorHex);
                s_current = win;
                win.Show();
            }
            catch (Exception ex)
            {
                try
                {
                    string p = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Canopy", "error.log");
                    System.IO.File.AppendAllText(p, $"[{DateTime.Now:O}] [ShowNotification Error] {ex}\r\n");
                }
                catch { }
            }
        });
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;

        // Apply WS_EX_TOOLWINDOW and WS_EX_NOACTIVATE so the notification never steals focus or taskbar slot
        long exStyle = Win32.GetWindowLongPtr(hwnd, Win32.GWL_EXSTYLE).ToInt64();
        exStyle |= Win32.WS_EX_TOOLWINDOW | Win32.WS_EX_NOACTIVATE;
        _ = Win32.SetWindowLongPtr(hwnd, Win32.GWL_EXSTYLE, new IntPtr(exStyle));

        CenterAtTopBezel();

        // Reassert topmost so it reliably renders above ordinary application windows
        Win32.ReassertTopmost(hwnd);
    }

    private void OnWindowLoaded(object sender, RoutedEventArgs e)
    {
        CenterAtTopBezel();
        PlayRaindropToPillAnimation();
        _autoDismissTimer.Start();
    }

    private void CenterAtTopBezel()
    {
        // 1. Resolve active monitor under cursor (or primary if cursor unavailable)
        Win32.RECT monitor = Win32.GetPrimaryMonitorBounds();
        if (Win32.GetCursorPos(out Win32.POINT cursor))
        {
            IntPtr hMon = Win32.MonitorFromPoint(cursor, Win32.MONITOR_DEFAULTTONEAREST);
            var mi = new Win32.MONITORINFO { cbSize = Marshal.SizeOf<Win32.MONITORINFO>() };
            if (Win32.GetMonitorInfo(hMon, ref mi))
            {
                monitor = mi.rcMonitor;
            }
        }

        // 2. Resolve DPI scale for this window
        double scaleX = 1.0;
        double scaleY = 1.0;
        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd != IntPtr.Zero)
        {
            uint dpi = Win32.GetDpiForWindow(hwnd);
            if (dpi > 0)
            {
                scaleX = dpi / 96.0;
                scaleY = dpi / 96.0;
            }
        }

        // 3. Convert physical monitor coordinates to DIPs
        double monitorLeftDip = monitor.Left / scaleX;
        double monitorWidthDip = monitor.Width / scaleX;
        double monitorTopDip = monitor.Top / scaleY;

        // 4. Exact horizontal center of monitor, flush with top bezel
        Left = monitorLeftDip + ((monitorWidthDip - Width) / 2.0);
        Top = monitorTopDip;
    }

    private void PlayRaindropToPillAnimation()
    {
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var bounce = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.22 };

        // 1. Drop down from bezel as a circular droplet (Y: -50 -> 10)
        var dropAnim = new DoubleAnimation
        {
            From = -50,
            To = 10,
            Duration = TimeSpan.FromMilliseconds(240),
            EasingFunction = ease
        };
        PillTranslate.BeginAnimation(TranslateTransform.YProperty, dropAnim);

        // 2. Expand width horizontally into a clean pill capsule (Width: 40 -> 360)
        var expandWidth = new DoubleAnimation
        {
            From = 40,
            To = 360,
            BeginTime = TimeSpan.FromMilliseconds(200),
            Duration = TimeSpan.FromMilliseconds(280),
            EasingFunction = bounce
        };
        NotificationPill.BeginAnimation(WidthProperty, expandWidth);

        // 3. Fade in text and dismiss button
        var textFade = new DoubleAnimation
        {
            From = 0.0,
            To = 1.0,
            BeginTime = TimeSpan.FromMilliseconds(280),
            Duration = TimeSpan.FromMilliseconds(200)
        };
        TextContainer.BeginAnimation(OpacityProperty, textFade);

        var btnFade = new DoubleAnimation
        {
            From = 0.0,
            To = 0.85,
            BeginTime = TimeSpan.FromMilliseconds(320),
            Duration = TimeSpan.FromMilliseconds(180)
        };
        DismissButton.BeginAnimation(OpacityProperty, btnFade);
    }

    private void DismissWithAnimation()
    {
        if (_isClosing) return;
        _isClosing = true;
        _autoDismissTimer.Stop();

        var slideUp = new DoubleAnimation
        {
            To = -50,
            Duration = TimeSpan.FromMilliseconds(200),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
        };

        var fadeOut = new DoubleAnimation
        {
            To = 0.0,
            Duration = TimeSpan.FromMilliseconds(200)
        };

        slideUp.Completed += (_, _) =>
        {
            try
            {
                Close();
            }
            catch
            {
            }
        };

        PillTranslate.BeginAnimation(TranslateTransform.YProperty, slideUp);
        NotificationPill.BeginAnimation(OpacityProperty, fadeOut);
    }

    private void OnDismissClick(object sender, RoutedEventArgs e)
    {
        DismissWithAnimation();
    }

    private void OnMouseEnterPill(object sender, MouseEventArgs e)
    {
        _isHovered = true;
    }

    private void OnMouseLeavePill(object sender, MouseEventArgs e)
    {
        _isHovered = false;
        // Resume timer with a 2-second grace after user leaves
        _autoDismissTimer.Stop();
        _autoDismissTimer.Interval = TimeSpan.FromSeconds(2.0);
        _autoDismissTimer.Start();
    }
}
