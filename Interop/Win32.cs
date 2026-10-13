using System.Runtime.InteropServices;
using System.Text;

namespace CaelestiaWin.Interop;

public static class Win32
{
    // SystemParametersInfo constants
    public const int SPI_SETDESKWALLPAPER = 20;
    public const int SPI_GETDESKWALLPAPER = 0x0073;
    public const int SPIF_UPDATEINIFILE = 0x01;
    public const int SPIF_SENDCHANGE = 0x02;

    // Window Long constants
    public const int GWL_EXSTYLE = -20;
    public const long WS_EX_TRANSPARENT = 0x00000020L;
    public const long WS_EX_LAYERED = 0x00080000L;
    public const long WS_EX_TOOLWINDOW = 0x00000080L;
    public const long WS_EX_NOACTIVATE = 0x08000000L;

    public const long WS_EX_APPWINDOW = 0x00040000L;
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    // DWM Attributes (Windows 11)
    public const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
    public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    public const int DWMWA_SYSTEMBACKDROP_TYPE = 38;

    // DWM Backdrop Types
    public const int DWMSBT_AUTO = 0;
    public const int DWMSBT_NONE = 1;
    public const int DWMSBT_MAINWINDOW = 2;      // Mica
    public const int DWMSBT_TRANSIENTWINDOW = 3; // Acrylic
    public const int DWMSBT_TABBEDWINDOW = 4;    // Tabbed

    // DWM Corner Preferences
    public const int DWMWCP_DEFAULT = 0;
    public const int DWMWCP_DONOTROUND = 1;
    public const int DWMWCP_ROUND = 2;
    public const int DWMWCP_ROUNDSMALL = 3;

    // Virtual Key Codes
    public const int VK_LBUTTON = 0x01;
    public const int VK_RBUTTON = 0x02;
    public const int VK_MBUTTON = 0x04;

    public const int VK_SPACE = 0x20;
    public const int VK_OEM_3 = 0xC0; // Grave / Backquote (`)
    public const byte VK_MEDIA_NEXT_TRACK = 0xB0;
    public const byte VK_MEDIA_PREV_TRACK = 0xB1;
    public const byte VK_MEDIA_PLAY_PAUSE = 0xB3;

    // Hotkey Message & Modifiers
    public const int WM_HOTKEY = 0x0312;
    public const uint MOD_ALT = 0x0001;
    public const uint MOD_CONTROL = 0x0002;
    public const uint MOD_SHIFT = 0x0004;
    public const uint MOD_WIN = 0x0008;
    public const uint MOD_NOREPEAT = 0x4000;
    // Monitor Constants
    public const uint MONITOR_DEFAULTTOPRIMARY = 0x00000001;
    public const uint MONITOR_DEFAULTTONEAREST = 0x00000002;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public int Width => Right - Left;
        public int Height => Bottom - Top;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct FILETIME
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;

        public ulong ToUInt64() => ((ulong)dwHighDateTime << 32) | dwLowDateTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;

        public static MEMORYSTATUSEX Create() => new()
        {
            dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>()
        };
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int SystemParametersInfo(int uAction, int uParam, StringBuilder lpvParam, int fuWinIni);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

    public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex)
    {
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(hWnd, nIndex)
            : new IntPtr(GetWindowLong32(hWnd, nIndex));
    }

    public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong)
    {
        return IntPtr.Size == 8
            ? SetWindowLongPtr64(hWnd, nIndex, dwNewLong)
            : new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
    }

    [DllImport("dwmapi.dll", PreserveSig = true)]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetShellWindow();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetSystemTimes(out FILETIME lpIdleTime, out FILETIME lpKernelTime, out FILETIME lpUserTime);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public static void SendMediaKey(byte vk)
    {
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    /// <summary>
    /// Applies Windows 11 Immersive Dark Mode and Acrylic Backdrop attributes via DWM.
    /// </summary>
    public static void ApplyAcrylicBackdrop(IntPtr hwnd, bool enableAcrylic = true)
    {
        if (hwnd == IntPtr.Zero)
            return;

        int darkMode = 1;
        _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int));
        _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref darkMode, sizeof(int));

        int backdropType = enableAcrylic ? DWMSBT_TRANSIENTWINDOW : DWMSBT_NONE;
        _ = DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ref backdropType, sizeof(int));
    }

    /// <summary>
    /// Configures the window as a non-activating tool window and toggles click-through (WS_EX_TRANSPARENT).
    /// </summary>
    public static void SetClickThrough(IntPtr hwnd, bool clickThrough)
    {
        if (hwnd == IntPtr.Zero)
            return;

        long exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
        exStyle |= WS_EX_TOOLWINDOW;
        exStyle &= ~WS_EX_APPWINDOW;

        if (clickThrough)
        {
            exStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE;
        }
        else
        {
            exStyle &= ~WS_EX_TRANSPARENT;
            exStyle &= ~WS_EX_NOACTIVATE;
            exStyle &= ~WS_EX_LAYERED;
        }

        _ = SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(exStyle));
    }

    /// <summary>
    /// Checks whether any mouse button is currently pressed.
    /// </summary>
    public static bool IsAnyMouseButtonDown()
    {
        return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0 ||
               (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0 ||
               (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;
    }

    /// <summary>
    /// Retrieves the primary monitor physical screen bounds.
    /// </summary>
    public static RECT GetPrimaryMonitorBounds()
    {
        POINT origin = new() { X = 0, Y = 0 };
        IntPtr hMonitor = MonitorFromPoint(origin, MONITOR_DEFAULTTOPRIMARY);
        MONITORINFO mi = new() { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (GetMonitorInfo(hMonitor, ref mi))
        {
            return mi.rcMonitor;
        }

        return new RECT { Left = 0, Top = 0, Right = 1920, Bottom = 1080 };
    }

    /// <summary>
    /// Retrieves the currently configured desktop wallpaper path via Win32 SystemParametersInfo.
    /// </summary>
    public static string GetCurrentDesktopWallpaper()
    {
        StringBuilder sb = new(512);
        int result = SystemParametersInfo(SPI_GETDESKWALLPAPER, sb.Capacity, sb, 0);
        return result != 0 ? sb.ToString() : string.Empty;
    }
}
