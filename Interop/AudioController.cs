using NAudio.CoreAudioApi;
using NAudio.Dsp;
using NAudio.Wave;

namespace CaelestiaWin.Interop;

public sealed class AudioVolumeStateChangedEventArgs(float volumePercent, bool isMuted) : EventArgs
{
    public float VolumePercent { get; } = volumePercent;
    public bool IsMuted { get; } = isMuted;
}

/// <summary>
/// Wraps Windows CoreAudio APIs (MMDeviceEnumerator / IAudioEndpointVolume via NAudio.CoreAudioApi)
/// for real-time master volume/mute control, microphone control, and live 40-band WASAPI Loopback FFT spectrum analysis.
/// </summary>
public sealed class AudioController : IDisposable
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

    private WasapiLoopbackCapture? _loopbackCapture;
    private readonly float[] _sampleBuffer = new float[FftLength];
    private int _sampleBufferPos;
    private readonly Complex[] _fftBuffer = new Complex[FftLength];
    private readonly float[] _spectrumBands = new float[SpectrumBands];
    private readonly object _spectrumLock = new();
    private bool _disposed;

    public event EventHandler<AudioVolumeStateChangedEventArgs>? VolumeStateChanged;

    public bool IsAvailable { get; private set; }

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

                // Also initialize default communications microphone if available
                if (_enumerator.HasDefaultAudioEndpoint(DataFlow.Capture, Role.Communications))
                {
                    try
                    {
                        _micDevice = _enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
                        _micEndpointVolume = _micDevice.AudioEndpointVolume;
                    }
                    catch
                    {
                    }
                }

                IsAvailable = true;
            }
            catch
            {
                IsAvailable = false;
            }
        }
    }

    private void StartWasapiLoopbackSpectrum()
    {
        Task.Run(() =>
        {
            try
            {
                var capture = new WasapiLoopbackCapture();
                capture.DataAvailable += OnLoopbackDataAvailable;
                capture.RecordingStopped += (_, _) =>
                {
                    capture.Dispose();
                };
                capture.StartRecording();
                _loopbackCapture = capture;
            }
            catch
            {
                // Loopback capture unavailable (e.g. no audio output hardware installed)
            }
        });
    }

    private void OnLoopbackDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded <= 0 || _disposed)
            return;

        int bytesPerSample = 4; // 32-bit IEEE float in WasapiLoopback
        int channels = _loopbackCapture?.WaveFormat.Channels ?? 2;
        int frameSize = bytesPerSample * channels;
        int frames = e.BytesRecorded / frameSize;

        for (int i = 0; i < frames; i++)
        {
            int offset = i * frameSize;
            float left = BitConverter.ToSingle(e.Buffer, offset);
            float right = channels > 1 ? BitConverter.ToSingle(e.Buffer, offset + bytesPerSample) : left;
            float mono = (left + right) * 0.5f;

            _sampleBuffer[_sampleBufferPos++] = mono;
            if (_sampleBufferPos >= FftLength)
            {
                _sampleBufferPos = 0;
                ComputeFftSpectrum();
            }
        }
    }

    private void ComputeFftSpectrum()
    {
        // Apply Hann window and populate FFT complex input buffer
        for (int i = 0; i < FftLength; i++)
        {
            float window = 0.5f * (1.0f - MathF.Cos(2.0f * MathF.PI * i / (FftLength - 1)));
            _fftBuffer[i].X = _sampleBuffer[i] * window;
            _fftBuffer[i].Y = 0.0f;
        }

        FastFourierTransform.FFT(true, FftOrder, _fftBuffer);

        float peak = 0.0f;
        try
        {
            peak = _device?.AudioMeterInformation?.MasterPeakValue ?? 0.0f;
        }
        catch
        {
        }

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

                float magSum = 0.0f;
                int count = 0;
                for (int bin = startBin; bin < endBin; bin++)
                {
                    float real = _fftBuffer[bin].X;
                    float imag = _fftBuffer[bin].Y;
                    magSum += MathF.Sqrt(real * real + imag * imag);
                    count++;
                }

                float avgMag = count > 0 ? magSum / count : 0.0f;
                // Boost treble bins slightly to match human hearing curves
                float trebleEq = 1.0f + (b / (float)SpectrumBands) * 2.2f;
                float currentVal = Math.Clamp(avgMag * 12.0f * trebleEq, 0.0f, 1.0f);

                if (peak > 0.005f)
                {
                    currentVal = Math.Max(currentVal, peak * 0.25f);
                }
                else
                {
                    currentVal = 0.0f;
                }

                // Smooth attack and decay
                if (currentVal > _spectrumBands[b])
                {
                    _spectrumBands[b] = _spectrumBands[b] * 0.4f + currentVal * 0.6f;
                }
                else
                {
                    _spectrumBands[b] = _spectrumBands[b] * 0.75f + currentVal * 0.25f;
                }
            }
        }
    }

    /// <summary>
    /// Returns a snapshot of the live 40-band audio frequency spectrum in [0.0, 1.0].
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

        _enumerator?.Dispose();
        _enumerator = null;
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
        try
        {
            _loopbackCapture?.StopRecording();
            _loopbackCapture?.Dispose();
        }
        catch
        {
        }

        lock (_syncLock)
        {
            CleanupDeviceNoLock();
        }
    }
}
