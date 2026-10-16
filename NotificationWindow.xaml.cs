using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Canopy.Interop;

namespace Canopy;

public partial class NotificationWindow : Window
{
    private static NotificationWindow? s_current;
    private readonly DispatcherTimer _autoDismissTimer;
    private bool _isClosing;
    private bool _isHovered;
    private double _targetWidth = 380;
    private readonly TimeSpan _dismissDuration = TimeSpan.FromSeconds(6.0);
    private DateTime _dismissDueTime;
    private Storyboard? _countdownStoryboard;

    public NotificationWindow(string message, string? title = "Canopy Reminder", string? accentColorHex = null, string? bgColorHex = null)
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

        // Adaptive target width based on message length (clamped neatly)
        _targetWidth = Math.Clamp(340 + cleanMsg.Length * 2.8, 340, 520);

        // Apply theme colors (active theme from Canopy)
        ApplyTheme(accentColorHex, bgColorHex);

        _autoDismissTimer = new DispatcherTimer
        {
            Interval = _dismissDuration
        };
        _autoDismissTimer.Tick += (_, _) =>
        {
            if (!_isHovered && !_isClosing)
            {
                DismissWithAnimation();
            }
        };
    }

    private void ApplyTheme(string? accentColorHex, string? bgColorHex)
    {
        Color accentColor = Color.FromRgb(116, 168, 108); // Canopy Forest default

        if (!string.IsNullOrWhiteSpace(accentColorHex))
        {
            try
            {
                accentColor = (Color)ColorConverter.ConvertFromString(accentColorHex.Trim());
            }
            catch { }
        }

        var accentBrush = new SolidColorBrush(accentColor);
        accentBrush.Freeze();

        var borderBrush = new SolidColorBrush(Color.FromArgb(90, accentColor.R, accentColor.G, accentColor.B));
        borderBrush.Freeze();

        var softBadgeBrush = new SolidColorBrush(Color.FromArgb(45, accentColor.R, accentColor.G, accentColor.B));
        softBadgeBrush.Freeze();

        var badgeBorderBrush = new SolidColorBrush(Color.FromArgb(110, accentColor.R, accentColor.G, accentColor.B));
        badgeBorderBrush.Freeze();

        NotificationPill.BorderBrush = borderBrush;
        PillShadow.Color = accentColor;
        IconBadge.Background = softBadgeBrush;
        IconBadge.BorderBrush = badgeBorderBrush;
        BellPath.Fill = accentBrush;
        TitleText.Foreground = accentBrush;
        CountdownBar.Background = accentBrush;

        if (!string.IsNullOrWhiteSpace(bgColorHex))
        {
            try
            {
                var bg = (Color)ColorConverter.ConvertFromString(bgColorHex.Trim());
                var bgBrush = new SolidColorBrush(Color.FromArgb(240, bg.R, bg.G, bg.B));
                bgBrush.Freeze();
                NotificationPill.Background = bgBrush;
            }
            catch { }
        }
    }

    /// <summary>
    /// Displays a standalone, always-on-top raindrop -> pill capsule notification that drops down from
    /// the screen's top bezel and stays above active applications without stealing focus.
    /// Works across any monitor resolution, aspect ratio, or DPI scale.
    /// </summary>
    public static void ShowNotification(string message, string? title = "Canopy Reminder", string? accentColorHex = null, string? bgColorHex = null)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            try
            {
                if (s_current != null && !s_current._isClosing)
                {
                    s_current.Close();
                }

                var win = new NotificationWindow(message, title, accentColorHex, bgColorHex);
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

        // Apply WS_EX_TOOLWINDOW and WS_EX_NOACTIVATE so notification never steals focus or taskbar slot
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
        _dismissDueTime = DateTime.UtcNow.Add(_dismissDuration);
        _autoDismissTimer.Start();
    }

    private void CenterAtTopBezel()
    {
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

        double monitorLeftDip = monitor.Left / scaleX;
        double monitorWidthDip = monitor.Width / scaleX;
        double monitorTopDip = monitor.Top / scaleY;

        Left = monitorLeftDip + ((monitorWidthDip - Width) / 2.0);
        Top = monitorTopDip;
    }

    private void PlayRaindropToPillAnimation()
    {
        var easeOut = new CubicEase { EasingMode = EasingMode.EaseOut };

        // 1. Drop down from bezel as a pure liquid bead (Y: -70 -> 14). Bell icon is 100% hidden.
        var dropAnim = new DoubleAnimation
        {
            From = -70,
            To = 14,
            Duration = TimeSpan.FromMilliseconds(440),
            EasingFunction = easeOut
        };
        PillTranslate.BeginAnimation(TranslateTransform.YProperty, dropAnim);

        // 2. Zero-pause momentum transfer: begins bloom midway through drop (at 200ms)
        var expandWidth = new DoubleAnimation
        {
            From = 48,
            To = _targetWidth,
            BeginTime = TimeSpan.FromMilliseconds(200),
            Duration = TimeSpan.FromMilliseconds(520),
            EasingFunction = easeOut
        };
        NotificationPill.BeginAnimation(WidthProperty, expandWidth);

        // 3. Reveal Bell Icon Badge & Content as pill reaches ~80% expansion (at 380ms)
        var iconFade = new DoubleAnimation
        {
            From = 0.0,
            To = 1.0,
            BeginTime = TimeSpan.FromMilliseconds(380),
            Duration = TimeSpan.FromMilliseconds(260),
            EasingFunction = easeOut
        };
        IconBadge.BeginAnimation(OpacityProperty, iconFade);

        var iconScaleAnim = new DoubleAnimation
        {
            From = 0.5,
            To = 1.0,
            BeginTime = TimeSpan.FromMilliseconds(380),
            Duration = TimeSpan.FromMilliseconds(300),
            EasingFunction = easeOut
        };
        IconScale.BeginAnimation(ScaleTransform.ScaleXProperty, iconScaleAnim);
        IconScale.BeginAnimation(ScaleTransform.ScaleYProperty, iconScaleAnim);

        var textFade = new DoubleAnimation
        {
            From = 0.0,
            To = 1.0,
            BeginTime = TimeSpan.FromMilliseconds(380),
            Duration = TimeSpan.FromMilliseconds(260),
            EasingFunction = easeOut
        };
        TextContainer.BeginAnimation(OpacityProperty, textFade);

        var btnFade = new DoubleAnimation
        {
            From = 0.0,
            To = 0.85,
            BeginTime = TimeSpan.FromMilliseconds(420),
            Duration = TimeSpan.FromMilliseconds(240),
            EasingFunction = easeOut
        };
        DismissButton.BeginAnimation(OpacityProperty, btnFade);

        // 4. Smooth countdown bar shrinking across the bottom via controllable Storyboard
        var countdownAnim = new DoubleAnimation
        {
            From = _targetWidth,
            To = 0.0,
            BeginTime = TimeSpan.FromMilliseconds(420),
            Duration = _dismissDuration,
            FillBehavior = FillBehavior.HoldEnd
        };
        Storyboard.SetTarget(countdownAnim, CountdownBar);
        Storyboard.SetTargetProperty(countdownAnim, new PropertyPath(FrameworkElement.WidthProperty));

        _countdownStoryboard = new Storyboard();
        _countdownStoryboard.Children.Add(countdownAnim);
        _countdownStoryboard.Begin(this, isControllable: true);
    }

    /// <summary>
    /// Plays the exact symmetrical reverse animation:
    /// Content fades out -> Capsule width smoothly shrinks back into 48x48 centered circular bead -> Bead retracts up into bezel.
    /// Never turns into a rectangle.
    /// </summary>
    private void DismissWithAnimation()
    {
        if (_isClosing) return;
        _isClosing = true;
        _autoDismissTimer.Stop();
        _countdownStoryboard?.Stop(this);

        var easeOut = new CubicEase { EasingMode = EasingMode.EaseOut };
        var easeIn = new CubicEase { EasingMode = EasingMode.EaseIn };
        var easeInOut = new CubicEase { EasingMode = EasingMode.EaseInOut };

        // Step 1: Content, icon, and countdown fade out first (140ms)
        var fadeContent = new DoubleAnimation
        {
            To = 0.0,
            Duration = TimeSpan.FromMilliseconds(140),
            EasingFunction = easeOut
        };
        IconBadge.BeginAnimation(OpacityProperty, fadeContent);
        TextContainer.BeginAnimation(OpacityProperty, fadeContent);
        DismissButton.BeginAnimation(OpacityProperty, fadeContent);
        CountdownBar.BeginAnimation(OpacityProperty, fadeContent);

        // Step 2: Pill smoothly collapses width back to 48 (starts at 120ms)
        var collapseWidth = new DoubleAnimation
        {
            To = 48,
            BeginTime = TimeSpan.FromMilliseconds(120),
            Duration = TimeSpan.FromMilliseconds(360),
            EasingFunction = easeInOut
        };
        NotificationPill.BeginAnimation(WidthProperty, collapseWidth);

        // Step 3: Pure droplet bead retracts straight up into top bezel (starts at 460ms)
        var retractAnim = new DoubleAnimation
        {
            To = -70,
            BeginTime = TimeSpan.FromMilliseconds(460),
            Duration = TimeSpan.FromMilliseconds(340),
            EasingFunction = easeIn
        };

        retractAnim.Completed += (_, _) =>
        {
            try
            {
                Close();
            }
            catch { }
        };

        PillTranslate.BeginAnimation(TranslateTransform.YProperty, retractAnim);
    }

    private void OnDismissClick(object sender, RoutedEventArgs e)
    {
        DismissWithAnimation();
    }

    private void OnMouseEnterPill(object sender, MouseEventArgs e)
    {
        _isHovered = true;
        _autoDismissTimer.Stop();
        _countdownStoryboard?.Pause(this);
    }

    private void OnMouseLeavePill(object sender, MouseEventArgs e)
    {
        _isHovered = false;
        if (!_isClosing)
        {
            _countdownStoryboard?.Resume(this);
            // Resume with at least 2.5 seconds grace
            double remainingSeconds = Math.Max(2.5, (_dismissDueTime - DateTime.UtcNow).TotalSeconds);
            _autoDismissTimer.Interval = TimeSpan.FromSeconds(remainingSeconds);
            _autoDismissTimer.Start();
        }
    }
}
