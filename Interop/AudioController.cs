using System.Collections.Concurrent;
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

    private sealed class DeviceCaptureState
    {
        public readonly float[] SampleBuffer = new float[FftLength];
        public int SampleBufferPos;
        public int DecimateCounter;
        public readonly Complex[] FftBuffer = new Complex[FftLength];
    }

    private readonly List<WasapiLoopbackCapture> _loopbackCaptures = new();
    private readonly ConcurrentDictionary<WasapiLoopbackCapture, DeviceCaptureState> _captureStates = new();
    private readonly float[] _spectrumBands = new float[SpectrumBands];
    private readonly object _spectrumLock = new();
    private volatile bool _disposed;
    private volatile bool _isCapturePaused;
    // Diagnostics: last failure surfaced to the host instead of being swallowed by catch {}.
    private volatile string? _lastError;
    private int _restartAttempt;
    private int _restartPending;
    private int _defaultChangeGeneration;
    private int _pendingRenderChange;
    private float _lastFrameRms;

    // Serialises capture (re)starts: a device switch raises OnDefaultDeviceChanged (once per role)
    // and RecordingStopped at the same moment, and unsynchronised starts each added a capture.
    private readonly object _captureGate = new();
    // Endpoint the running loopback capture records. Owned separately from _device: overwriting
    // _device here orphaned the MMDevice that owns _endpointVolume, and its finalizer then disposed
    // the live endpoint volume (notifications stopped, later calls hit a released RCW).
    private MMDevice? _captureDevice;

    // Hann window and band edges depend only on constants: built once instead of recomputing 512
    // cosines and 80 Math.Pow calls on every FFT frame (~94 frames/s at 48 kHz).
    private static readonly float[] HannWindow = BuildHannWindow();
    private static readonly (int[] Start, int[] End) BandBins = BuildBandBins();

    private static float[] BuildHannWindow()
    {
        var window = new float[FftLength];
        for (int i = 0; i < FftLength; i++)
        {
            window[i] = 0.5f * (1.0f - MathF.Cos(2.0f * MathF.PI * i / (FftLength - 1)));
        }
        return window;
    }

    // Perceptual (power 2.2) band split over the lower half of the FFT. Same mapping as before the
    // tables were hoisted: each band covers [start, end) with at least one bin.
    private static (int[] Start, int[] End) BuildBandBins()
    {
        int maxBin = FftLength / 2;
        var start = new int[SpectrumBands];
        var end = new int[SpectrumBands];
        for (int b = 0; b < SpectrumBands; b++)
        {
            double lowFrac = Math.Pow((double)b / SpectrumBands, 2.2);
            double highFrac = Math.Pow((double)(b + 1) / SpectrumBands, 2.2);
            start[b] = Math.Clamp((int)(lowFrac * maxBin), 0, maxBin - 1);
            end[b] = Math.Clamp((int)(highFrac * maxBin), start[b] + 1, maxBin);
        }
        return (start, end);
    }

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
                // Register before probing for a default endpoint: returning early on "no device"
                // skipped registration, so an endpoint plugged in later never re-initialised audio.
                _enumerator.RegisterEndpointNotificationCallback(this);
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
        _ = Task.Run(StartCaptureInternal);
    }

    private void StartCaptureInternal()
    {
        lock (_captureGate)
        {
            if (_disposed || _isCapturePaused)
                return;

            try
            {
                StopAllCaptures("Restart");

                // A private enumerator: the shared _enumerator is disposed and replaced by
                // InitializeEndpoint on other threads, which raced this method mid-use.
                using var enumerator = new MMDeviceEnumerator();
                if (!enumerator.HasDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia))
                {
                    // Nothing to record; OnDefaultDeviceChanged restarts capture when an endpoint appears.
                    LastError = "No default render endpoint for loopback capture";
                    return;
                }

                MMDevice device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                WasapiLoopbackCapture? capture = null;
                try
                {
                    capture = new WasapiLoopbackCapture(device);
                    _captureStates[capture] = new DeviceCaptureState();
                    capture.DataAvailable += OnLoopbackDataAvailable;
                    capture.RecordingStopped += OnLoopbackRecordingStopped;
                    capture.StartRecording();
                }
                catch (Exception ex)
                {
                    DiagnosticsLog.Log($"[AudioController] Loopback capture start error: {ex.Message}");
                    LastError = "Loopback capture start failed: " + ex.Message;
                    if (capture is not null)
                    {
                        _captureStates.TryRemove(capture, out _);
                        DisposeCaptures([capture], device, "Start failure");
                    }
                    else
                    {
                        device.Dispose();
                    }

                    // A default endpoint exists but would not start (typically mid device switch):
                    // retry with backoff instead of leaving the spectrum dead.
                    ScheduleCaptureRestart();
                    return;
                }

                bool keep;
                lock (_syncLock)
                {
                    keep = !_disposed && !_isCapturePaused;
                    if (keep)
                    {
                        _loopbackCaptures.Add(capture);
                        _captureDevice = device;
                    }
                }

                if (!keep)
                {
                    // Paused or disposed while starting: never leave an orphaned capture running.
                    _captureStates.TryRemove(capture, out _);
                    DisposeCaptures([capture], device, "Superseded");
                    return;
                }

                LastError = null;
            }
            catch (Exception ex)
            {
                LastError = "Loopback capture init failed: " + ex.Message;
                DiagnosticsLog.Log($"[AudioController] Loopback capture init failed: {ex.Message}");
                ScheduleCaptureRestart();
            }
        }
    }

    /// <summary>Detaches every running capture (and the endpoint it records) and stops it synchronously.</summary>
    private void StopAllCaptures(string context)
    {
        var (captures, device) = DetachCaptures();
        DisposeCaptures(captures, device, context);
    }

    private (List<WasapiLoopbackCapture> Captures, MMDevice? Device) DetachCaptures()
    {
        lock (_syncLock)
        {
            var captures = new List<WasapiLoopbackCapture>(_loopbackCaptures);
            _loopbackCaptures.Clear();
            _captureStates.Clear();
            MMDevice? device = _captureDevice;
            _captureDevice = null;
            return (captures, device);
        }
    }

    private void DisposeCaptures(List<WasapiLoopbackCapture> captures, MMDevice? device, string context)
    {
        foreach (var cap in captures)
        {
            cap.DataAvailable -= OnLoopbackDataAvailable;
            cap.RecordingStopped -= OnLoopbackRecordingStopped;
            try { cap.StopRecording(); } catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] {context} StopRecording warning: {ex.Message}"); }
            try { cap.Dispose(); } catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] {context} Dispose warning: {ex.Message}"); }
        }

        try { device?.Dispose(); } catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] {context} device dispose warning: {ex.Message}"); }
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

        // Coalesce instead of dropping: the former 750 ms debounce discarded a failure that landed
        // just after a restart (e.g. the restarted capture dying on a still-switching device),
        // leaving the spectrum dead until the panel was reopened.
        if (Interlocked.CompareExchange(ref _restartPending, 1, 0) != 0)
            return;

        int attempt = Interlocked.Increment(ref _restartAttempt);
        int delayMs = Math.Min(3000, 200 * (1 << Math.Min(attempt, 4)));
        _ = Task.Run(async () =>
        {
            await Task.Delay(delayMs).ConfigureAwait(false);
            Interlocked.Exchange(ref _restartPending, 0);
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
        // Detaching under the lock stops spectrum updates immediately; the stop/dispose itself joins
        // the NAudio capture thread, so it runs off the caller's (UI) thread.
        var (captures, device) = DetachCaptures();
        if (captures.Count > 0 || device is not null)
        {
            _ = Task.Run(() => DisposeCaptures(captures, device, "Pause"));
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

        // Already capturing (repeated expand): restarting would only tear down a healthy stream.
        if (!_isCapturePaused && IsCaptureRunning)
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

            if (sender is not WasapiLoopbackCapture capture || !_captureStates.TryGetValue(capture, out var state))
                return;

            // Audio is flowing again: reset restart backoff only now, not on StartRecording success,
            // so a capture that dies right after starting keeps backing off instead of looping at 400 ms.
            if (Volatile.Read(ref _restartAttempt) != 0)
                Interlocked.Exchange(ref _restartAttempt, 0);

            var wf = capture.WaveFormat;
            if (wf is null) return;
            int channels = Math.Max(1, wf.Channels);
            int bitsPerSample = wf.BitsPerSample;
            int bytesPerSample = bitsPerSample / 8;
            if (bytesPerSample <= 0) bytesPerSample = 4;
            int frameSize = bytesPerSample * channels;
            int frames = e.BytesRecorded / frameSize;
            bool isFloat = wf.Encoding == WaveFormatEncoding.IeeeFloat || bytesPerSample == 4;

            // Downsample high-resolution audio (192kHz/96kHz) to ~48kHz for fine frequency FFT resolution
            int decimateFactor = Math.Max(1, (int)Math.Round(wf.SampleRate / 48000.0));

            for (int i = 0; i < frames; i++)
            {
                if (++state.DecimateCounter % decimateFactor != 0)
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

                state.SampleBuffer[state.SampleBufferPos++] = mono;
                if (state.SampleBufferPos >= FftLength)
                {
                    state.SampleBufferPos = 0;
                    ComputeFftSpectrum(state);
                }
            }
        }
        catch (Exception ex)
        {
            LastError = "Loopback data error: " + ex.Message;
        }
    }

    private void ComputeFftSpectrum(DeviceCaptureState state)
    {
        try
        {
            // Apply the Hann window into the FFT input and take the frame RMS from the raw
            // (unwindowed) capture samples in the same pass.
            float sumSq = 0.0f;
            for (int i = 0; i < FftLength; i++)
            {
                float sample = state.SampleBuffer[i];
                sumSq += sample * sample;
                state.FftBuffer[i].X = sample * HannWindow[i];
                state.FftBuffer[i].Y = 0.0f;
            }
            float frameRms = MathF.Sqrt(sumSq / FftLength);
            _lastFrameRms = frameRms;

            FastFourierTransform.FFT(true, FftOrder, state.FftBuffer);

            lock (_spectrumLock)
            {
                for (int b = 0; b < SpectrumBands; b++)
                {
                    int startBin = BandBins.Start[b];
                    int endBin = BandBins.End[b];

                    float bandMag = 0.0f;
                    for (int bin = startBin; bin < endBin; bin++)
                    {
                        float real = state.FftBuffer[bin].X;
                        float imag = state.FftBuffer[bin].Y;
                        float mag = MathF.Sqrt(real * real + imag * imag);
                        if (mag > bandMag)
                            bandMag = mag;
                    }

                    float db = 20.0f * MathF.Log10(MathF.Max(bandMag, 1e-7f));
                    float currentVal = Math.Clamp((db - SpectrumFloorDb) / (SpectrumCeilDb - SpectrumFloorDb), 0.0f, 1.0f);

                    if (frameRms < 1e-5f)
                    {
                        currentVal = 0.0f;
                    }

                    // Smooth attack and decay across active audio streams
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
        RaiseVolumeStateChanged(percent, data.Muted);
    }

    /// <summary>Raised from CoreAudio callback / thread-pool threads: a throwing handler must not escape.</summary>
    private void RaiseVolumeStateChanged(float percent, bool muted)
    {
        try
        {
            VolumeStateChanged?.Invoke(this, new AudioVolumeStateChangedEventArgs(percent, muted));
        }
        catch (Exception ex)
        {
            DiagnosticsLog.Log($"[AudioController] VolumeStateChanged handler error: {ex.Message}");
        }
    }

    /// <summary>
    /// Runs <paramref name="action"/> against the cached render (or microphone) endpoint volume.
    /// A failure — typically AUDCLNT_E_DEVICE_INVALIDATED after an unplug or format change, which
    /// used to escape GetMute/GetMicMute or leave the stale endpoint cached forever — rebuilds the
    /// endpoints once and retries against the current default device.
    /// </summary>
    private bool TryWithEndpoint(bool microphone, string operation, Action<AudioEndpointVolume> action)
    {
        lock (_syncLock)
        {
            // The render endpoint is rebuilt when missing (the existing recovery path). The microphone
            // is not: a machine without a mic would rebuild every endpoint on each status query, and
            // OnDefaultDeviceChanged re-initialises when one appears.
            if (!microphone && _endpointVolume is null)
                InitializeEndpoint();

            for (int attempt = 0; attempt < 2; attempt++)
            {
                AudioEndpointVolume? endpoint = microphone ? _micEndpointVolume : _endpointVolume;
                if (endpoint is null)
                    return false;

                try
                {
                    action(endpoint);
                    return true;
                }
                catch (Exception ex)
                {
                    DiagnosticsLog.Log($"[AudioController] {operation} failed (attempt {attempt + 1}): {ex.Message}");
                    if (attempt == 0)
                        InitializeEndpoint();
                }
            }

            return false;
        }
    }

    private static void ApplyVolume(AudioEndpointVolume endpoint, float scalar)
    {
        endpoint.MasterVolumeLevelScalar = scalar;
        if (scalar > 0.001f && endpoint.Mute)
        {
            endpoint.Mute = false;
        }
    }

    public float GetMasterVolumePercent()
    {
        float percent = 0f;
        _ = TryWithEndpoint(false, "GetMasterVolume", ep => percent = Math.Clamp(ep.MasterVolumeLevelScalar * 100f, 0f, 100f));
        return percent;
    }

    public void SetMasterVolumePercent(float volumePercent)
    {
        float scalar = Math.Clamp(volumePercent / 100f, 0f, 1f);
        _ = TryWithEndpoint(false, "SetMasterVolume", ep => ApplyVolume(ep, scalar));
    }

    public bool GetMute()
    {
        bool muted = false;
        _ = TryWithEndpoint(false, "GetMute", ep => muted = ep.Mute);
        return muted;
    }

    public void SetMute(bool mute)
    {
        _ = TryWithEndpoint(false, "SetMute", ep => ep.Mute = mute);
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
        float percent = 75f;
        _ = TryWithEndpoint(true, "GetMicVolume", ep => percent = Math.Clamp(ep.MasterVolumeLevelScalar * 100f, 0f, 100f));
        return percent;
    }

    public void SetMicVolumePercent(float volumePercent)
    {
        float scalar = Math.Clamp(volumePercent / 100f, 0f, 1f);
        _ = TryWithEndpoint(true, "SetMicVolume", ep => ApplyVolume(ep, scalar));
    }

    public bool GetMicMute()
    {
        bool muted = false;
        _ = TryWithEndpoint(true, "GetMicMute", ep => muted = ep.Mute);
        return muted;
    }

    public void SetMicMute(bool mute)
    {
        _ = TryWithEndpoint(true, "SetMicMute", ep => ep.Mute = mute);
    }

    public bool ToggleMicMute()
    {
        bool next = !GetMicMute();
        SetMicMute(next);
        return next;
    }

    /// <summary>Pushes the (new) default endpoint's state to listeners after a device switch.</summary>
    private void RaiseCurrentVolumeState()
    {
        float percent = 0f;
        bool muted = false;
        bool read;
        lock (_syncLock)
        {
            AudioEndpointVolume? endpoint = _endpointVolume;
            if (endpoint is null)
                return;
            try
            {
                percent = Math.Clamp(endpoint.MasterVolumeLevelScalar * 100f, 0f, 100f);
                muted = endpoint.Mute;
                read = true;
            }
            catch (Exception ex)
            {
                DiagnosticsLog.Log($"[AudioController] Read volume after device change failed: {ex.Message}");
                read = false;
            }
        }

        if (read)
            RaiseVolumeStateChanged(percent, muted);
    }

    private void CleanupDeviceNoLock()
    {
        // Every step is isolated and every field is cleared even when a release throws (NAudio's
        // AudioEndpointVolume.Dispose throws on a failed unregister). Previously one throw aborted the
        // cleanup with the stale objects still cached, so each later re-initialisation threw again.
        if (_endpointVolume is not null)
        {
            try { _endpointVolume.OnVolumeNotification -= OnEndpointVolumeNotification; } catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] Volume notification unsubscribe error: {ex.Message}"); }
            _endpointVolume = null;
        }

        _micEndpointVolume = null;
        MMDevice? micDevice = _micDevice;
        _micDevice = null;
        try { micDevice?.Dispose(); } catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] Mic device dispose error: {ex.Message}"); }

        MMDevice? device = _device;
        _device = null;
        try { device?.Dispose(); } catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] Render device dispose error: {ex.Message}"); }

        MMDeviceEnumerator? enumerator = _enumerator;
        _enumerator = null;
        if (enumerator is not null)
        {
            try { enumerator.UnregisterEndpointNotificationCallback(this); } catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] Unregister callback error: {ex.Message}"); }
            try { enumerator.Dispose(); } catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] Enumerator dispose error: {ex.Message}"); }
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
        StopAllCaptures("Dispose");

        lock (_syncLock)
        {
            CleanupDeviceNoLock();
        }
    }

    // IMMNotificationClient implementation for automatic endpoint hotplugging
    public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
    {
        bool render = flow == DataFlow.Render && role is Role.Multimedia or Role.Console;
        // The default communications mic changing used to be ignored, leaving mic controls bound to
        // the previous (possibly unplugged) device.
        bool microphone = flow == DataFlow.Capture && role == Role.Communications;
        if (!render && !microphone)
            return;

        if (render)
            Interlocked.Exchange(ref _pendingRenderChange, 1);

        // Windows raises one notification per role, so a single switch arrives as a burst that used
        // to re-initialise (and restart capture) once per notification; only the last one acts.
        int generation = Interlocked.Increment(ref _defaultChangeGeneration);
        _ = Task.Run(async () =>
        {
            await Task.Delay(180).ConfigureAwait(false); // Let OS audio session settle
            if (_disposed || generation != Volatile.Read(ref _defaultChangeGeneration))
                return;

            bool restartCapture = Interlocked.Exchange(ref _pendingRenderChange, 0) != 0;
            InitializeEndpoint();
            // The frontend only reads master volume at startup; without this the slider keeps
            // showing the previous device's level after switching outputs.
            RaiseCurrentVolumeState();
            if (restartCapture)
                StartCaptureInternal();
        });
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
            catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] GetDefaultAudioEndpoint in devices warning: {ex.Message}"); }

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
                catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] Add device entry warning: {ex.Message}"); }
            }
        }
        catch (Exception ex) { DiagnosticsLog.Log($"[AudioController] GetAudioDevices error: {ex.Message}"); }
        return list;
    }

    public bool SetDefaultAudioDevice(string deviceId)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return false;
        object? policyClient = null;
        try
        {
            policyClient = new _PolicyConfigClient();
            var policyConfig = (IPolicyConfig)policyClient;
            int hr1 = policyConfig.SetDefaultEndpoint(deviceId, Role.Multimedia);
            int hr2 = policyConfig.SetDefaultEndpoint(deviceId, Role.Console);
            int hr3 = policyConfig.SetDefaultEndpoint(deviceId, Role.Communications);
            if (hr3 != 0)
                DiagnosticsLog.Log($"[AudioController] SetDefaultEndpoint(Communications) hr=0x{hr3:X8}");
            return hr1 == 0 || hr2 == 0;
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
            return false;
        }
        finally
        {
            // One RCW per call; release it now instead of leaving it to the finalizer thread.
            if (policyClient is not null && Marshal.IsComObject(policyClient))
                Marshal.ReleaseComObject(policyClient);
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
