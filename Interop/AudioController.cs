using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Dsp;
using NAudio.Wave;
namespace Canopy.Interop;

public sealed class AudioVolumeStateChangedEventArgs(float volumePercent, bool isMuted) : EventArgs
{
    public float VolumePercent { get; } = volumePercent;
    public bool IsMuted { get; } = isMuted;
}

/// <summary>
/// Wraps Windows CoreAudio APIs (MMDeviceEnumerator / IAudioEndpointVolume via NAudio.CoreAudioApi)
/// for real-time master volume/mute control, microphone control, and live 40-band WASAPI Loopback FFT spectrum analysis.
/// </summary>
public sealed class AudioController : IDisposable, IMMNotificationClient
{
    private const int FftLength = 512;
    private const int FftOrder = 9; // 2^9 = 512
    private const int SpectrumBands = 40;

    private readonly object _syncLock = new();
    private MMDeviceEnumerator? _enumerator;
    private MMDevice? _device;
    private AudioEndpointVolume? _endpointVolume;
    private MMDevice? _micDevice;
    private AudioEndpointVolume? _micEndpointVolume;

    private readonly List<WasapiLoopbackCapture> _loopbackCaptures = new();
    private readonly float[] _sampleBuffer = new float[FftLength];
    private int _sampleBufferPos;
    private readonly Complex[] _fftBuffer = new Complex[FftLength];
    private readonly float[] _spectrumBands = new float[SpectrumBands];
    private readonly object _spectrumLock = new();
    private int _decimateCounter;
    private bool _disposed;
    private volatile bool _isCapturePaused;
    // Diagnostics: last failure surfaced to the host instead of being swallowed by catch {}.
    private volatile string? _lastError;
    private long _lastRestartTick;
    private float _lastFrameRms;

    // Spectrum dB window: magnitudes at/below -80 dB map to 0, at/above -10 dB map to 1.
    private const float SpectrumFloorDb = -80.0f;
    private const float SpectrumCeilDb = -10.0f;

    public event EventHandler<AudioVolumeStateChangedEventArgs>? VolumeStateChanged;

    public bool IsAvailable { get; private set; }

    /// <summary>Most recent capture/FFT failure, or null when healthy. Never thrown into the audio callback.</summary>
    public string? LastError
    {
        get => _lastError;
        private set => _lastError = value;
    }

    /// <summary>True while the WASAPI loopback capture loop is running.</summary>
    public bool IsCaptureRunning
    {
        get
        {
            lock (_syncLock)
            {
                return _loopbackCaptures.Count > 0;
            }
        }
    }

    /// <summary>RMS of the most recent captured frame (0..1); 0 indicates digital silence.</summary>
    public float LastFrameRms => _lastFrameRms;

    public AudioController()
    {
        InitializeEndpoint();
        StartWasapiLoopbackSpectrum();
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
                _enumerator.RegisterEndpointNotificationCallback(this);
                // Also initialize default communications microphone if available
                if (_enumerator.HasDefaultAudioEndpoint(DataFlow.Capture, Role.Communications))
                {
                    try
                    {
                        _micDevice = _enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
                        _micEndpointVolume = _micDevice.AudioEndpointVolume;
                    }
                    catch (Exception ex)
                    {
                        LastError = "Microphone endpoint init failed: " + ex.Message;
                    }
                }

                IsAvailable = true;
            }
            catch (Exception ex)
            {
                IsAvailable = false;
                LastError = "Audio endpoint init failed: " + ex.Message;
            }
        }
    }

    private void StartWasapiLoopbackSpectrum()
    {
        Task.Run(StartCaptureInternal);
    }

    private void StartCaptureInternal()
    {
        if (_disposed || _isCapturePaused)
            return;
        try
        {
            List<WasapiLoopbackCapture> previous;
            lock (_syncLock)
            {
                previous = new List<WasapiLoopbackCapture>(_loopbackCaptures);
                _loopbackCaptures.Clear();
            }

            foreach (var cap in previous)
            {
                cap.DataAvailable -= OnLoopbackDataAvailable;
                cap.RecordingStopped -= OnLoopbackRecordingStopped;
                try { cap.StopRecording(); } catch { }
                try { cap.Dispose(); } catch { }
            }

            if (_enumerator is null) return;

            var newCaptures = new List<WasapiLoopbackCapture>();
            var endpoints = _enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
            foreach (var dev in endpoints)
            {
                try
                {
                    var capture = new WasapiLoopbackCapture(dev);
                    capture.DataAvailable += OnLoopbackDataAvailable;
                    capture.RecordingStopped += OnLoopbackRecordingStopped;
                    capture.StartRecording();
                    newCaptures.Add(capture);
                }
                catch
                {
                }
            }

            if (newCaptures.Count == 0 && _device is not null)
            {
                try
                {
                    var capture = new WasapiLoopbackCapture(_device);
                    capture.DataAvailable += OnLoopbackDataAvailable;
                    capture.RecordingStopped += OnLoopbackRecordingStopped;
                    capture.StartRecording();
                    newCaptures.Add(capture);
                }
                catch { }
            }

            lock (_syncLock)
            {
                _loopbackCaptures.AddRange(newCaptures);
            }

            LastError = null;
        }
        catch (Exception ex)
        {
            LastError = "Loopback capture init failed: " + ex.Message;
            ScheduleCaptureRestart();
        }
    }

    private void OnLoopbackRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (_disposed)
            return;

        if (e.Exception is not null)
        {
            LastError = "Loopback recording stopped: " + e.Exception.Message;
        }

        // The capture loop died (device change/removal/error): restart it so the
        // spectrum keeps reporting instead of silently freezing at its last snapshot.
        ScheduleCaptureRestart();
    }

    private void ScheduleCaptureRestart()
    {
        if (_disposed || _isCapturePaused)
            return;
        long now = Environment.TickCount64;
        if (now - Interlocked.Read(ref _lastRestartTick) < 750)
            return;
        Interlocked.Exchange(ref _lastRestartTick, now);

        _ = Task.Run(async () =>
        {
            await Task.Delay(300);
            if (!_disposed)
            {
                StartCaptureInternal();
            }
        });
    }

    /// <summary>
    /// Pauses WASAPI loopback capture and spectrum calculation while the panel is collapsed,
    /// stopping audio processing and dropping CPU wakeups.
    /// </summary>
    public void PauseCapture()
    {
        _isCapturePaused = true;
        List<WasapiLoopbackCapture> capturesToStop;
        lock (_syncLock)
        {
            capturesToStop = new List<WasapiLoopbackCapture>(_loopbackCaptures);
            _loopbackCaptures.Clear();
        }

        foreach (var cap in capturesToStop)
        {
            cap.DataAvailable -= OnLoopbackDataAvailable;
            cap.RecordingStopped -= OnLoopbackRecordingStopped;
            try { cap.StopRecording(); } catch { }
            try { cap.Dispose(); } catch { }
        }

        lock (_spectrumLock)
        {
            Array.Clear(_spectrumBands, 0, _spectrumBands.Length);
            _lastFrameRms = 0;
        }
    }

    /// <summary>
    /// Resumes WASAPI loopback capture when the panel expands.
    /// </summary>
    public void ResumeCapture()
    {
        if (_disposed)
            return;

        _isCapturePaused = false;
        StartWasapiLoopbackSpectrum();
    }
    private void OnLoopbackDataAvailable(object? sender, WaveInEventArgs e)
    {
        try
        {
            if (e.BytesRecorded <= 0 || _disposed)
                return;

        var capture = sender as WasapiLoopbackCapture;
        var wf = capture?.WaveFormat;
        if (wf is null) return;
        int channels = Math.Max(1, wf.Channels);
        int bitsPerSample = wf.BitsPerSample;
        int bytesPerSample = bitsPerSample / 8;
        if (bytesPerSample <= 0) bytesPerSample = 4;
        int frameSize = bytesPerSample * channels;
        int frames = e.BytesRecorded / frameSize;
        bool isFloat = wf.Encoding == WaveFormatEncoding.IeeeFloat;

        // Downsample high-resolution audio (192kHz/96kHz) to ~48kHz for fine frequency FFT resolution
        int decimateFactor = Math.Max(1, (int)Math.Round(wf.SampleRate / 48000.0));

        for (int i = 0; i < frames; i++)
        {
            if (++_decimateCounter % decimateFactor != 0)
                continue;

            int offset = i * frameSize;
            float left;
            float right;

            if (isFloat && bytesPerSample == 4 && offset + bytesPerSample <= e.Buffer.Length)
            {
                left = BitConverter.ToSingle(e.Buffer, offset);
                right = (channels > 1 && offset + frameSize <= e.Buffer.Length)
                    ? BitConverter.ToSingle(e.Buffer, offset + bytesPerSample)
                    : left;
            }
            else if (bytesPerSample == 2 && offset + bytesPerSample <= e.Buffer.Length)
            {
                left = BitConverter.ToInt16(e.Buffer, offset) / 32768.0f;
                right = (channels > 1 && offset + frameSize <= e.Buffer.Length)
                    ? BitConverter.ToInt16(e.Buffer, offset + bytesPerSample) / 32768.0f
                    : left;
            }
            else
            {
                left = 0f;
                right = 0f;
            }

            if (float.IsNaN(left) || float.IsInfinity(left)) left = 0f;
            if (float.IsNaN(right) || float.IsInfinity(right)) right = 0f;

            float mono = (left + right) * 0.5f;

            _sampleBuffer[_sampleBufferPos++] = mono;
            if (_sampleBufferPos >= FftLength)
            {
                _sampleBufferPos = 0;
                ComputeFftSpectrum();
            }
        }
        }
        catch (Exception ex)
        {
            LastError = "Loopback data error: " + ex.Message;
        }
    }

    private void ComputeFftSpectrum()
    {
        try
        {
            // Apply Hann window and populate FFT complex input buffer
            for (int i = 0; i < FftLength; i++)
            {
                float window = 0.5f * (1.0f - MathF.Cos(2.0f * MathF.PI * i / (FftLength - 1)));
                _fftBuffer[i].X = _sampleBuffer[i] * window;
                _fftBuffer[i].Y = 0.0f;
            }

            // Frame RMS from the raw (unwindowed) capture samples: used to gate digital
            // silence to exactly zero and as the level reference when no peak meter exists.
            float sumSq = 0.0f;
            for (int i = 0; i < FftLength; i++)
            {
                sumSq += _sampleBuffer[i] * _sampleBuffer[i];
            }
            float frameRms = MathF.Sqrt(sumSq / FftLength);
            _lastFrameRms = frameRms;

            FastFourierTransform.FFT(true, FftOrder, _fftBuffer);

            lock (_spectrumLock)
            {
                // Map 256 unique FFT bins logarithmically across 40 frequency bands
                int maxBin = FftLength / 2;
                for (int b = 0; b < SpectrumBands; b++)
                {
                    double lowFrac = Math.Pow((double)b / SpectrumBands, 2.2);
                    double highFrac = Math.Pow((double)(b + 1) / SpectrumBands, 2.2);

                    int startBin = Math.Clamp((int)(lowFrac * maxBin), 0, maxBin - 1);
                    int endBin = Math.Clamp((int)(highFrac * maxBin), startBin + 1, maxBin);

                    // Real per-band magnitude (peak bin in the band). NAudio's un-normalised
                    // FFT puts a full-scale sine near 0.235, so magnitudes are far below 1.0
                    // and must be mapped logarithmically rather than scaled linearly.
                    float bandMag = 0.0f;
                    for (int bin = startBin; bin < endBin; bin++)
                    {
                        float real = _fftBuffer[bin].X;
                        float imag = _fftBuffer[bin].Y;
                        float mag = MathF.Sqrt(real * real + imag * imag);
                        if (mag > bandMag)
                            bandMag = mag;
                    }

                    float db = 20.0f * MathF.Log10(MathF.Max(bandMag, 1e-7f));
                    float currentVal = Math.Clamp((db - SpectrumFloorDb) / (SpectrumCeilDb - SpectrumFloorDb), 0.0f, 1.0f);

                    // No synthetic floor: true silence must read 0, not a constant bump.
                    // (MasterPeakValue is unreliable on loopback devices, so the captured
                    //  signal's own RMS is the authority here.)
                    if (frameRms < 1e-5f)
                    {
                        currentVal = 0.0f;
                    }

                    // Smooth attack and decay
                    if (currentVal > _spectrumBands[b])
                    {
                        _spectrumBands[b] = _spectrumBands[b] * 0.20f + currentVal * 0.80f;
                    }
                    else
                    {
                        _spectrumBands[b] = _spectrumBands[b] * 0.60f + currentVal * 0.40f;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            LastError = "FFT spectrum error: " + ex.Message;
        }
    }

    /// <summary>
    /// Returns a snapshot of the live 40-band audio frequency spectrum in [0.0, 1.0].
    /// True silence reads ~0; every band tracks its own frequency content.
    /// </summary>
    public float[] GetAudioSpectrum()
    {
        var result = new float[SpectrumBands];
        lock (_spectrumLock)
        {
            Array.Copy(_spectrumBands, result, SpectrumBands);
        }
        return result;
    }

    private void OnEndpointVolumeNotification(AudioVolumeNotificationData data)
    {
        float percent = Math.Clamp(data.MasterVolume * 100f, 0f, 100f);
        VolumeStateChanged?.Invoke(this, new AudioVolumeStateChangedEventArgs(percent, data.Muted));
    }

    public float GetMasterVolumePercent()
    {
        lock (_syncLock)
        {
            if (_endpointVolume is null)
                InitializeEndpoint();

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

    public void SetMasterVolumePercent(float volumePercent)
    {
        float scalar = Math.Clamp(volumePercent / 100f, 0f, 1f);
        lock (_syncLock)
        {
            if (_endpointVolume is null)
                InitializeEndpoint();

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
            }
        }
    }

    public bool GetMute()
    {
        lock (_syncLock)
        {
            if (_endpointVolume is null)
                InitializeEndpoint();

            return _endpointVolume?.Mute ?? false;
        }
    }

    public void SetMute(bool mute)
    {
        lock (_syncLock)
        {
            if (_endpointVolume is null)
                InitializeEndpoint();

            if (_endpointVolume is not null)
            {
                try
                {
                    _endpointVolume.Mute = mute;
                }
                catch
                {
                }
            }
        }
    }

    public bool ToggleMute()
    {
        bool nextState = !GetMute();
        SetMute(nextState);
        return nextState;
    }

    // Microphone Controls
    public float GetMicVolumePercent()
    {
        lock (_syncLock)
        {
            if (_micEndpointVolume is null)
                return 75f;

            try
            {
                return Math.Clamp(_micEndpointVolume.MasterVolumeLevelScalar * 100f, 0f, 100f);
            }
            catch
            {
                return 75f;
            }
        }
    }

    public void SetMicVolumePercent(float volumePercent)
    {
        float scalar = Math.Clamp(volumePercent / 100f, 0f, 1f);
        lock (_syncLock)
        {
            if (_micEndpointVolume is null)
                return;

            try
            {
                _micEndpointVolume.MasterVolumeLevelScalar = scalar;
                if (scalar > 0.001f && _micEndpointVolume.Mute)
                {
                    _micEndpointVolume.Mute = false;
                }
            }
            catch
            {
            }
        }
    }

    public bool GetMicMute()
    {
        lock (_syncLock)
        {
            return _micEndpointVolume?.Mute ?? false;
        }
    }

    public void SetMicMute(bool mute)
    {
        lock (_syncLock)
        {
            if (_micEndpointVolume is not null)
            {
                try
                {
                    _micEndpointVolume.Mute = mute;
                }
                catch
                {
                }
            }
        }
    }

    public bool ToggleMicMute()
    {
        bool next = !GetMicMute();
        SetMicMute(next);
        return next;
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
            }
            _endpointVolume = null;
        }

        _micEndpointVolume = null;
        _micDevice?.Dispose();
        _micDevice = null;

        _device?.Dispose();
        _device = null;

        if (_enumerator is not null)
        {
            try { _enumerator.UnregisterEndpointNotificationCallback(this); } catch { }
            _enumerator.Dispose();
            _enumerator = null;
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
        List<WasapiLoopbackCapture> capturesToDispose;
        lock (_syncLock)
        {
            capturesToDispose = new List<WasapiLoopbackCapture>(_loopbackCaptures);
            _loopbackCaptures.Clear();
        }

        foreach (var cap in capturesToDispose)
        {
            cap.DataAvailable -= OnLoopbackDataAvailable;
            cap.RecordingStopped -= OnLoopbackRecordingStopped;
            try { cap.StopRecording(); } catch { }
            try { cap.Dispose(); } catch { }
        }

        lock (_syncLock)
        {
            CleanupDeviceNoLock();
        }
    }

    // IMMNotificationClient implementation for automatic endpoint hotplugging
    public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
    {
        if (flow == DataFlow.Render && role is Role.Multimedia or Role.Console)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(180); // Let OS audio session settle
                InitializeEndpoint();
                StartWasapiLoopbackSpectrum();
            });
        }
    }

    public void OnDeviceStateChanged(string deviceId, DeviceState newState) { }
    public void OnDeviceAdded(string pwstrDeviceId) { }
    public void OnDeviceRemoved(string deviceId) { }
    public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key) { }

    public record AudioDeviceInfo(string Id, string Name, bool IsDefault, string Flow);

    public List<AudioDeviceInfo> GetAudioDevices(DataFlow dataFlow = DataFlow.Render)
    {
        var list = new List<AudioDeviceInfo>();
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            string defaultId = string.Empty;
            try
            {
                var defaultDevice = enumerator.GetDefaultAudioEndpoint(dataFlow, Role.Multimedia);
                defaultId = defaultDevice?.ID ?? string.Empty;
            }
            catch { }

            var devices = enumerator.EnumerateAudioEndPoints(dataFlow, DeviceState.Active);
            foreach (var dev in devices)
            {
                try
                {
                    bool isDefault = !string.IsNullOrEmpty(defaultId) &&
                                     string.Equals(dev.ID, defaultId, StringComparison.OrdinalIgnoreCase);
                    list.Add(new AudioDeviceInfo(
                        Id: dev.ID,
                        Name: dev.FriendlyName,
                        IsDefault: isDefault,
                        Flow: dataFlow == DataFlow.Render ? "render" : "capture"
                    ));
                }
                catch { }
            }
        }
        catch { }
        return list;
    }

    public bool SetDefaultAudioDevice(string deviceId)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return false;
        try
        {
            var policyConfig = (IPolicyConfig)new _PolicyConfigClient();
            int hr1 = policyConfig.SetDefaultEndpoint(deviceId, Role.Multimedia);
            int hr2 = policyConfig.SetDefaultEndpoint(deviceId, Role.Console);
            int hr3 = policyConfig.SetDefaultEndpoint(deviceId, Role.Communications);
            return hr1 == 0 || hr2 == 0;
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
            return false;
        }
    }
}

[ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig
{
    [PreserveSig] int GetMixFormat();
    [PreserveSig] int GetDeviceFormat();
    [PreserveSig] int ResetDeviceFormat();
    [PreserveSig] int SetDeviceFormat();
    [PreserveSig] int GetProcessingPeriod();
    [PreserveSig] int SetProcessingPeriod();
    [PreserveSig] int GetShareMode();
    [PreserveSig] int SetShareMode();
    [PreserveSig] int GetPropertyValue();
    [PreserveSig] int SetPropertyValue();
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string wszDeviceId, Role eRole);
    [PreserveSig] int SetEndpointVisibility();
}

[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
internal class _PolicyConfigClient
{
}
