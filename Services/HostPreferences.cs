using Microsoft.Win32;

namespace CaelestiaWin.Services;

/// <summary>
/// Stores the small set of host settings needed before WebView2 and its local storage are available.
/// </summary>
public static class HostPreferences
{
    private const string RegistryPath = @"Software\CanopyShell\Canopy";
    private const string ShowPanelOnLaunchValue = "ShowPanelOnLaunch";

    public static bool LoadShowPanelOnLaunch()
    {
        try
        {
            using RegistryKey? key = Registry.CurrentUser.OpenSubKey(RegistryPath, writable: false);
            object? value = key?.GetValue(ShowPanelOnLaunchValue);
            return value switch
            {
                int number => number != 0,
                string text when bool.TryParse(text, out bool enabled) => enabled,
                _ => true,
            };
        }
        catch
        {
            return true;
        }
    }

    public static void SaveShowPanelOnLaunch(bool enabled)
    {
        try
        {
            using RegistryKey? key = Registry.CurrentUser.CreateSubKey(RegistryPath, writable: true);
            key?.SetValue(ShowPanelOnLaunchValue, enabled ? 1 : 0, RegistryValueKind.DWord);
        }
        catch
        {
            // A non-writable profile should not prevent the settings UI from responding.
        }
    }
}
