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

        MessageText.Text = message;
        if (!string.IsNullOrWhiteSpace(title))
        {
            TitleText.Text = title;
        }

        if (!string.IsNullOrWhiteSpace(accentColorHex))
        {
            try
            {
                var color = (Color)ColorConverter.ConvertFromString(accentColorHex);
                NotificationPill.BorderBrush = new SolidColorBrush(Color.FromArgb(180, color.R, color.G, color.B));
                if (NotificationPill.Effect is System.Windows.Media.Effects.DropShadowEffect dropShadow)
                {
                    dropShadow.Color = color;
                }
                IconBadge.Background = new SolidColorBrush(Color.FromArgb(50, color.R, color.G, color.B));
                IconBadge.BorderBrush = new SolidColorBrush(Color.FromArgb(120, color.R, color.G, color.B));
            }
            catch
            {
                // Keep default Catppuccin accent
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
            catch
            {
                // Fail open
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

        // Reassert topmost so it renders above ordinary application windows
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
        Win32.RECT monitor = Win32.GetPrimaryMonitorBounds();
        double dpi = 1.0;
        try
        {
            DpiScale dpiScale = VisualTreeHelper.GetDpi(this);
            if (dpiScale.DpiScaleX > 0) dpi = dpiScale.DpiScaleX;
        }
        catch
        {
        }

        double screenWidthDpi = monitor.Width / dpi;
        double screenLeftDpi = monitor.Left / dpi;
        double screenTopDpi = monitor.Top / dpi;

        Left = screenLeftDpi + (screenWidthDpi - ActualWidth) / 2.0;
        Top = screenTopDpi;
    }

    private void PlayRaindropToPillAnimation()
    {
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var bounce = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.35 };

        // 1. Drop down from bezel like a falling raindrop (Y: -60 -> 16)
        var dropAnim = new DoubleAnimation
        {
            From = -60,
            To = 16,
            Duration = TimeSpan.FromMilliseconds(260),
            EasingFunction = ease
        };
        PillTranslate.BeginAnimation(TranslateTransform.YProperty, dropAnim);

        // 2. Expand from small droplet circle into horizontal pill capsule (Scale: 0.25 -> 1.0)
        var expandX = new DoubleAnimation
        {
            From = 0.25,
            To = 1.0,
            BeginTime = TimeSpan.FromMilliseconds(200),
            Duration = TimeSpan.FromMilliseconds(320),
            EasingFunction = bounce
        };
        var expandY = new DoubleAnimation
        {
            From = 0.25,
            To = 1.0,
            BeginTime = TimeSpan.FromMilliseconds(200),
            Duration = TimeSpan.FromMilliseconds(280),
            EasingFunction = bounce
        };
        PillScale.BeginAnimation(ScaleTransform.ScaleXProperty, expandX);
        PillScale.BeginAnimation(ScaleTransform.ScaleYProperty, expandY);

        // 3. Fade in text and dismiss button as the pill expands
        var textFade = new DoubleAnimation
        {
            From = 0.0,
            To = 1.0,
            BeginTime = TimeSpan.FromMilliseconds(300),
            Duration = TimeSpan.FromMilliseconds(220)
        };
        TextContainer.BeginAnimation(OpacityProperty, textFade);

        var btnFade = new DoubleAnimation
        {
            From = 0.0,
            To = 0.75,
            BeginTime = TimeSpan.FromMilliseconds(320),
            Duration = TimeSpan.FromMilliseconds(200)
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
            To = -60,
            Duration = TimeSpan.FromMilliseconds(240),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
        };

        var fadeOut = new DoubleAnimation
        {
            To = 0.0,
            Duration = TimeSpan.FromMilliseconds(220)
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
        BeginAnimation(OpacityProperty, fadeOut);
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
