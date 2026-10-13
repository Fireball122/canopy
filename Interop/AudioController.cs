using NAudio.CoreAudioApi;

namespace CaelestiaWin.Interop;

public sealed class AudioVolumeStateChangedEventArgs(float volumePercent, bool isMuted) : EventArgs
{
    public float VolumePercent { get; } = volumePercent;
    public bool IsMuted { get; } = isMuted;
}

/// <summary>
/// Wraps Windows CoreAudio APIs (MMDeviceEnumerator / IAudioEndpointVolume via NAudio.CoreAudioApi)
/// for real-time system master volume and mute control.
/// </summary>
public sealed class AudioController : IDisposable
{
    private readonly object _syncLock = new();
    private MMDeviceEnumerator? _enumerator;
    private MMDevice? _device;
    private AudioEndpointVolume? _endpointVolume;
    private bool _disposed;

    public event EventHandler<AudioVolumeStateChangedEventArgs>? VolumeStateChanged;

    public bool IsAvailable { get; private set; }

    public AudioController()
    {
        InitializeEndpoint();
    }

    private void InitializeEndpoint()
    {
        lock (_syncLock)
        {
            try
            {
                CleanupDeviceNoLock();

                _enumerator = new MMDeviceEnumerator();
                if (!_enumerator.HasDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia))
                {
                    IsAvailable = false;
                    return;
                }

                _device = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                _endpointVolume = _device.AudioEndpointVolume;
                _endpointVolume.OnVolumeNotification += OnEndpointVolumeNotification;
                IsAvailable = true;
            }
            catch
            {
                IsAvailable = false;
            }
        }
    }

    private void OnEndpointVolumeNotification(AudioVolumeNotificationData data)
    {
        float percent = Math.Clamp(data.MasterVolume * 100f, 0f, 100f);
        VolumeStateChanged?.Invoke(this, new AudioVolumeStateChangedEventArgs(percent, data.Muted));
    }

    /// <summary>
    /// Gets the current master volume in [0, 100].
    /// </summary>
    public float GetMasterVolumePercent()
    {
        lock (_syncLock)
        {
            if (_endpointVolume is null)
            {
                InitializeEndpoint();
            }

            if (_endpointVolume is null)
                return 0f;

            try
            {
                return Math.Clamp(_endpointVolume.MasterVolumeLevelScalar * 100f, 0f, 100f);
            }
            catch
            {
                InitializeEndpoint();
                return _endpointVolume is not null
                    ? Math.Clamp(_endpointVolume.MasterVolumeLevelScalar * 100f, 0f, 100f)
                    : 0f;
            }
        }
    }

    /// <summary>
    /// Sets the system master volume immediately using CoreAudio IAudioEndpointVolume.
    /// </summary>
    /// <param name="volumePercent">Volume percentage in [0, 100].</param>
    public void SetMasterVolumePercent(float volumePercent)
    {
        float scalar = Math.Clamp(volumePercent / 100f, 0f, 1f);

        lock (_syncLock)
        {
            if (_endpointVolume is null)
            {
                InitializeEndpoint();
            }

            if (_endpointVolume is null)
                return;

            try
            {
                _endpointVolume.MasterVolumeLevelScalar = scalar;
                if (scalar > 0.001f && _endpointVolume.Mute)
                {
                    _endpointVolume.Mute = false;
                }
            }
            catch
            {
                InitializeEndpoint();
                if (_endpointVolume is not null)
                {
                    try
                    {
                        _endpointVolume.MasterVolumeLevelScalar = scalar;
                    }
                    catch
                    {
                        // Ignore transient device switches
                    }
                }
            }
        }
    }

    /// <summary>
    /// Gets the current system master audio mute state.
    /// </summary>
    public bool GetMute()
    {
        lock (_syncLock)
        {
            if (_endpointVolume is null)
            {
                InitializeEndpoint();
            }

            if (_endpointVolume is null)
                return false;

            try
            {
                return _endpointVolume.Mute;
            }
            catch
            {
                InitializeEndpoint();
                return _endpointVolume?.Mute ?? false;
            }
        }
    }

    /// <summary>
    /// Sets the system master audio mute state.
    /// </summary>
    public void SetMute(bool mute)
    {
        lock (_syncLock)
        {
            if (_endpointVolume is null)
            {
                InitializeEndpoint();
            }

            if (_endpointVolume is null)
                return;

            try
            {
                _endpointVolume.Mute = mute;
            }
            catch
            {
                InitializeEndpoint();
                if (_endpointVolume is not null)
                {
                    try
                    {
                        _endpointVolume.Mute = mute;
                    }
                    catch
                    {
                        // Ignore transient device switches
                    }
                }
            }
        }
    }

    /// <summary>
    /// Toggles the master audio mute state and returns the new state.
    /// </summary>
    public bool ToggleMute()
    {
        bool nextState = !GetMute();
        SetMute(nextState);
        return nextState;
    }

    private void CleanupDeviceNoLock()
    {
        if (_endpointVolume is not null)
        {
            try
            {
                _endpointVolume.OnVolumeNotification -= OnEndpointVolumeNotification;
            }
            catch
            {
                // Ignore cleanup exceptions
            }
            _endpointVolume = null;
        }

        _device?.Dispose();
        _device = null;

        _enumerator?.Dispose();
        _enumerator = null;
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        lock (_syncLock)
        {
            CleanupDeviceNoLock();
            _disposed = true;
        }
    }
}
