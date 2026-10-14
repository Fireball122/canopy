using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;

namespace CaelestiaWin.Interop;

/// <summary>
/// Snapshot of a single WASAPI per-application audio session.
/// Serialised names match the frontend <c>AudioSessionEntry</c> contract.
/// </summary>
public sealed class AudioSessionInfo
{
    [JsonPropertyName("id")]
    public string Id { get; init; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    [JsonPropertyName("volume")]
    public float VolumePercent { get; init; }

    [JsonPropertyName("muted")]
    public bool Muted { get; init; }

    [JsonPropertyName("is_active")]
    public bool IsActive { get; init; }
}

/// <summary>
/// Enumerates and controls Windows per-application audio sessions (the Volume Mixer)
/// via classic CoreAudio COM interop (<c>IAudioSessionManager2</c> et al.) — deliberately
/// not NAudio's wrappers, so the caller owns every COM lifetime and the enumeration can
/// be made thread-safe against the host's UI thread.
/// </summary>
public sealed class AudioSessionController : IDisposable
{
    private const int ERender = 0;
    private const int ERoleMultimedia = 1;
    private const int ClsctxAll = 0x17; // INPROC_SERVER | INPROC_HANDLER | LOCAL_SERVER | REMOTE_SERVER

    private readonly object _lock = new();
    private bool _disposed;
    private volatile bool _isPaused;

    public void Pause() => _isPaused = true;
    public void Resume() => _isPaused = false;
    /// <summary>Most recent session-enumeration failure, or null when healthy.</summary>
    public string? LastError { get; private set; }

    /// <summary>Number of sessions returned by the most recent <see cref="GetSessions"/> call.</summary>
    public int LastSessionCount { get; private set; }

    public List<AudioSessionInfo> GetSessions()
    {
        if (_disposed || _isPaused)
            return new List<AudioSessionInfo>();
        var results = new List<AudioSessionInfo>();

        lock (_lock)
        {
            IAudioSessionManager2? manager = null;
            IAudioSessionEnumerator? enumerator = null;
            try
            {
                manager = CreateSessionManager();
                if (manager is null)
                    return results;

                int hr = manager.GetSessionEnumerator(out enumerator);
                if (hr < 0 || enumerator is null)
                {
                    LastError = $"GetSessionEnumerator failed (hr=0x{hr:X8})";
                    return results;
                }

                hr = enumerator.GetCount(out int count);
                if (hr < 0)
                {
                    LastError = $"GetCount failed (hr=0x{hr:X8})";
                    return results;
                }

                if (count <= 0)
                    return results;

                for (int i = 0; i < count; i++)
                {
                    IAudioSessionControl? control = null;
                    try
                    {
                        if (enumerator.GetSession(i, out control) < 0 || control is null)
                            continue;

                        var info = DescribeSession(control);
                        if (info is not null)
                            results.Add(info);
                    }
                    finally
                    {
                        ReleaseCom(control);
                    }
                }
            }
            catch (Exception ex)
            {
                // A malformed/expired session must never break the whole enumeration.
                LastError = "Session enumeration failed: " + ex.Message;
            }
            finally
            {
                ReleaseCom(enumerator);
                ReleaseCom(manager);
            }
        }

        LastSessionCount = results.Count;
        results.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        return results;
    }

    public bool SetSessionVolume(string id, float percent)
    {
        float scalar = Math.Clamp(percent / 100f, 0f, 1f);
        return ApplyToSession(id, control =>
        {
            if (control is ISimpleAudioVolume volume)
            {
                Guid ctx = Guid.Empty;
                return volume.SetMasterVolume(scalar, ref ctx) >= 0;
            }
            return false;
        });
    }

    public bool SetSessionMute(string id, bool muted)
    {
        return ApplyToSession(id, control =>
        {
            if (control is ISimpleAudioVolume volume)
            {
                Guid ctx = Guid.Empty;
                return volume.SetMute(muted, ref ctx) >= 0;
            }
            return false;
        });
    }

    private bool ApplyToSession(string id, Func<IAudioSessionControl, bool> action)
    {
        if (_disposed || string.IsNullOrEmpty(id))
            return false;

        lock (_lock)
        {
            IAudioSessionManager2? manager = null;
            IAudioSessionEnumerator? enumerator = null;
            try
            {
                manager = CreateSessionManager();
                if (manager is null)
                    return false;

                if (manager.GetSessionEnumerator(out enumerator) < 0 || enumerator is null)
                    return false;

                if (enumerator.GetCount(out int count) < 0)
                    return false;

                for (int i = 0; i < count; i++)
                {
                    IAudioSessionControl? control = null;
                    try
                    {
                        if (enumerator.GetSession(i, out control) < 0 || control is null)
                            continue;

                        if (GetSessionIdentifier(control) != id)
                            continue;

                        return action(control);
                    }
                    finally
                    {
                        ReleaseCom(control);
                    }
                }
            }
            catch
            {
                return false;
            }
            finally
            {
                ReleaseCom(enumerator);
                ReleaseCom(manager);
            }

            return false;
        }
    }

    private static AudioSessionInfo? DescribeSession(IAudioSessionControl control)
    {
        var control2 = control as IAudioSessionControl2;
        string identifier = GetSessionIdentifier(control);

        AudioSessionState state = AudioSessionState.Inactive;
        if (control.GetState(out state) < 0)
            state = AudioSessionState.Inactive;

        if (state == AudioSessionState.Expired)
            return null;

        uint pid = 0;
        control2?.GetProcessId(out pid);

        if (string.IsNullOrEmpty(identifier))
        {
            identifier = pid > 0 ? $"pid_{pid}" : $"session_{control.GetHashCode()}";
        }

        float volumeScalar = 1f;
        bool muted = false;
        if (control is ISimpleAudioVolume volume)
        {
            if (volume.GetMasterVolume(out float v) >= 0)
                volumeScalar = v;
            if (volume.GetMute(out bool m) >= 0)
                muted = m;
        }

        string name = ResolveProcessDisplayName(control, pid, identifier);

        return new AudioSessionInfo
        {
            Id = identifier,
            Name = name,
            VolumePercent = Math.Clamp(volumeScalar * 100f, 0f, 100f),
            Muted = muted,
            IsActive = state == AudioSessionState.Active,
        };
    }

    private static string GetSessionIdentifier(IAudioSessionControl control)
    {
        try
        {
            if (control is IAudioSessionControl2 control2)
            {
                if (control2.GetSessionInstanceIdentifier(out string instanceId) >= 0 &&
                    !string.IsNullOrWhiteSpace(instanceId))
                {
                    return instanceId;
                }

                if (control2.GetSessionIdentifier(out string identifier) >= 0 &&
                    !string.IsNullOrWhiteSpace(identifier))
                {
                    return identifier;
                }
            }

            if (control.GetDisplayName(out string dn) >= 0 && !string.IsNullOrWhiteSpace(dn))
            {
                return dn.Trim();
            }
        }
        catch
        {
        }
        return string.Empty;
    }

    private static string ResolveProcessDisplayName(IAudioSessionControl control, uint pid, string identifier)
    {
        // 1. Explicit display name set on the session
        try
        {
            if (control.GetDisplayName(out string dn) >= 0 && !string.IsNullOrWhiteSpace(dn))
            {
                if (!dn.StartsWith("@"))
                    return dn.Trim();
            }
        }
        catch
        {
        }

        // 2. System sounds session
        try
        {
            if (control is IAudioSessionControl2 control2 && control2.IsSystemSoundsSession() == 0)
            {
                return "System Sounds";
            }
        }
        catch
        {
        }

        if (pid == 0)
            return "System Sounds";

        // 3. Query process name and description with fallback for sandboxed/child processes
        try
        {
            using var process = Process.GetProcessById((int)pid);

            try
            {
                string? description = process.MainModule?.FileVersionInfo?.FileDescription;
                if (!string.IsNullOrWhiteSpace(description))
                    return description.Trim();
            }
            catch
            {
                // AccessDenied is expected for sandboxed/child processes; fall through
            }

            if (!string.IsNullOrWhiteSpace(process.ProcessName))
            {
                string pName = process.ProcessName;
                if (char.IsLower(pName[0]))
                    pName = char.ToUpper(pName[0]) + pName.Substring(1);
                return pName;
            }
        }
        catch
        {
            // Process might be sandboxed or already exited
        }

        // 4. Extract executable name from identifier string (e.g. "...\\Spotify.exe%b...")
        if (!string.IsNullOrWhiteSpace(identifier))
        {
            int exeIdx = identifier.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
            if (exeIdx > 0)
            {
                int startIdx = identifier.LastIndexOf('\\', exeIdx);
                if (startIdx < 0) startIdx = identifier.LastIndexOf('/', exeIdx);
                int begin = startIdx >= 0 ? startIdx + 1 : 0;
                string extracted = identifier.Substring(begin, exeIdx - begin);
                if (!string.IsNullOrWhiteSpace(extracted))
                {
                    if (char.IsLower(extracted[0]))
                        extracted = char.ToUpper(extracted[0]) + extracted.Substring(1);
                    return extracted;
                }
            }
        }

        return pid > 0 ? $"Process ({pid})" : "Audio Stream";
    }


    private IAudioSessionManager2? CreateSessionManager()
    {
        IMMDeviceEnumerator? enumerator = null;
        IMMDevice? device = null;
        try
        {
            enumerator = CreateDeviceEnumerator();
            if (enumerator is null)
            {
                LastError = "CoCreateInstance(MMDeviceEnumerator) failed";
                return null;
            }

            int hr = enumerator.GetDefaultAudioEndpoint(ERender, ERoleMultimedia, out device);
            if (hr < 0 || device is null)
            {
                LastError = $"GetDefaultAudioEndpoint failed (hr=0x{hr:X8})";
                return null;
            }

            Guid iid = typeof(IAudioSessionManager2).GUID;
            hr = device.Activate(ref iid, ClsctxAll, IntPtr.Zero, out object? managerObj);
            if (hr < 0 || managerObj is null)
            {
                LastError = $"Activate(IAudioSessionManager2) failed (hr=0x{hr:X8})";
                return null;
            }

            // Activate hands back a distinct RCW for IAudioSessionManager2; the device and
            // enumerator are no longer needed and can be released immediately.
            return managerObj as IAudioSessionManager2;
        }
        finally
        {
            ReleaseCom(device);
            ReleaseCom(enumerator);
        }
    }

    private static void ReleaseCom(object? comObject)
    {
        if (comObject is null || !Marshal.IsComObject(comObject))
            return;

        try
        {
            Marshal.ReleaseComObject(comObject);
        }
        catch
        {
        }
    }

    public void Dispose()
    {
        _disposed = true;
    }

    // ---------------------------------------------------------------------
    // Classic CoreAudio COM interop
    // ---------------------------------------------------------------------

    // MMDeviceEnumerator coclass. Activated via Type.GetTypeFromCLSID rather than a
    // [ComImport] coclass, because the CLR keys ComImport coclasses by CLSID globally and
    // NAudio already declares one with this identical GUID — declaring our own makes
    // `new` hand back NAudio's type and the interface cast fails.
    private static readonly Guid ClsidMMDeviceEnumerator = new("BCDE0395-E52F-467C-8E3D-C4579291692E");

    private static IMMDeviceEnumerator? CreateDeviceEnumerator()
    {
        Type? comType = Type.GetTypeFromCLSID(ClsidMMDeviceEnumerator);
        if (comType is null)
            return null;

        object? instance = Activator.CreateInstance(comType);
        return instance as IMMDeviceEnumerator;
    }

    private enum AudioSessionState
    {
        Inactive = 0,
        Active = 1,
        Expired = 2,
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice? endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object? instance);
        [PreserveSig] int OpenPropertyStore(int stgmAccess, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        // IAudioSessionManager
        [PreserveSig] int GetAudioSessionControl(ref Guid audioSessionGuid, int streamFlags, out IAudioSessionControl? sessionControl);
        [PreserveSig] int GetSimpleAudioVolume(ref Guid audioSessionGuid, int streamFlags, out ISimpleAudioVolume? audioVolume);
        // IAudioSessionManager2
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator? sessionEnum);
        [PreserveSig] int RegisterSessionNotification(IntPtr sessionNotification);
        [PreserveSig] int UnregisterSessionNotification(IntPtr sessionNotification);
        [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr duckNotification);
        [PreserveSig] int UnregisterDuckNotification(IntPtr duckNotification);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int sessionCount);
        [PreserveSig] int GetSession(int sessionIndex, [MarshalAs(UnmanagedType.Interface)] out IAudioSessionControl? session);
    }

    [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl
    {
        [PreserveSig] int GetState(out AudioSessionState state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(ref Guid groupingParam, ref Guid eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    }

    // Declared self-contained (base IAudioSessionControl methods repeated) rather than via
    // interface inheritance: with [ComImport] + PreserveSig, CLR interface inheritance does
    // not reliably place the derived methods after the base vtable slots, which silently
    // shifts GetSessionIdentifier/GetProcessId onto the wrong functions.
    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out AudioSessionState state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(ref Guid groupingParam, ref Guid eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionIdentifier);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionInstanceIdentifier);
        [PreserveSig] int GetProcessId(out uint processId);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute(bool mute, ref Guid eventContext);
        [PreserveSig] int GetMute(out bool mute);
    }
}
