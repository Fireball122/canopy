using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Canopy.Interop;

public sealed record MediaSessionSnapshot(
    string id,
    string app_name,
    string title,
    string artist,
    bool is_playing,
    bool is_current
);

public sealed record SmtcMediaSnapshot(
    string Title,
    string Artist,
    string Album,
    bool IsPlaying,
    double PositionSecs,
    double DurationSecs,
    string? ArtworkUrl,
    string SourceApp,
    IReadOnlyList<MediaSessionSnapshot> Sessions,
    bool? IsShuffleActive = null,
    int AutoRepeatMode = 0,
    double PositionAnchorAgeSecs = 0,
    double PlaybackRate = 1
);

/// <summary>
/// Queries Windows 11 GlobalSystemMediaTransportControlsSessionManager (SMTC) for track metadata,
/// active media sessions, timeline progress, and album artwork, with automatic Chromium/Brave
/// verification and fallback to native Win32 virtual media keys (0xB3, 0xB0, 0xB1).
/// </summary>
public sealed class SmtcMediaController : IDisposable
{
    public void Dispose()
    {
        _manager = null;
    }

    private GlobalSystemMediaTransportControlsSessionManager? _manager;
    private string? _selectedSessionId;
    private string? _lastArtworkKey;
    private string? _cachedArtworkDataUrl;

    // Timeline anchoring state: SMTC reports snapshots, so the shell projects them forward.
    private DateTimeOffset _timelineInstant = default;
    private double _lastAnchorAgeSecs = 0.0;
    private DateTimeOffset _lastAgeSampleUtc = default;

    private async Task<GlobalSystemMediaTransportControlsSessionManager?> GetManagerAsync()
    {
        if (_manager is not null)
            return _manager;

        try
        {
            _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            return _manager;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsSelfWebViewSession(string? rawId)
    {
        if (string.IsNullOrWhiteSpace(rawId))
            return false;

        return rawId.Contains("Canopy", StringComparison.OrdinalIgnoreCase) ||
               rawId.Contains("Caelestia", StringComparison.OrdinalIgnoreCase) ||
               rawId.Contains("msedgewebview2", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsChromiumSession(string? rawId)
    {
        if (string.IsNullOrWhiteSpace(rawId))
            return false;

        return rawId.Contains("Brave", StringComparison.OrdinalIgnoreCase) ||
               rawId.Contains("Chrome", StringComparison.OrdinalIgnoreCase) ||
               rawId.Contains("msedge", StringComparison.OrdinalIgnoreCase) ||
               rawId.Contains("Vivaldi", StringComparison.OrdinalIgnoreCase) ||
               rawId.Contains("Opera", StringComparison.OrdinalIgnoreCase) ||
               rawId.Contains("Arc", StringComparison.OrdinalIgnoreCase) ||
               rawId.Contains("Zen", StringComparison.OrdinalIgnoreCase);
    }

    private static string FormatAppName(string? sourceAppUserModelId)
    {
        if (string.IsNullOrWhiteSpace(sourceAppUserModelId))
            return "System Media";

        string raw = sourceAppUserModelId.Trim();
        if (raw.Contains("Jellyfin", StringComparison.OrdinalIgnoreCase)) return "Jellyfin";
        if (raw.Contains("Plex", StringComparison.OrdinalIgnoreCase)) return "Plex";
        if (raw.Contains("Brave", StringComparison.OrdinalIgnoreCase)) return "Brave";
        if (raw.Contains("Spotify", StringComparison.OrdinalIgnoreCase)) return "Spotify";
        if (raw.Contains("Feishin", StringComparison.OrdinalIgnoreCase)) return "Feishin";
        if (raw.Contains("Chrome", StringComparison.OrdinalIgnoreCase)) return "Chrome";
        if (raw.Contains("msedge", StringComparison.OrdinalIgnoreCase)) return "Edge";
        if (raw.Contains("Firefox", StringComparison.OrdinalIgnoreCase)) return "Firefox";
        if (raw.Contains("Vivaldi", StringComparison.OrdinalIgnoreCase)) return "Vivaldi";
        if (raw.Contains("Opera", StringComparison.OrdinalIgnoreCase)) return "Opera";
        if (raw.Contains("Arc", StringComparison.OrdinalIgnoreCase)) return "Arc";
        if (raw.Contains("Zen", StringComparison.OrdinalIgnoreCase)) return "Zen";
        if (raw.Contains("ZuneMusic", StringComparison.OrdinalIgnoreCase) || raw.Contains("MediaPlayer", StringComparison.OrdinalIgnoreCase)) return "Media Player";
        if (raw.Contains("VLC", StringComparison.OrdinalIgnoreCase)) return "VLC";

        string fileName = System.IO.Path.GetFileNameWithoutExtension(raw);
        return string.IsNullOrWhiteSpace(fileName) ? raw : fileName;
    }

    public void SelectSession(string? sessionId)
    {
        _selectedSessionId = string.IsNullOrWhiteSpace(sessionId) ? null : sessionId;
    }

    public async Task<IReadOnlyList<MediaSessionSnapshot>> GetSessionsAsync()
    {
        var list = new List<MediaSessionSnapshot>();
        try
        {
            var manager = await GetManagerAsync();
            if (manager is null)
                return list;

            var targetSession = ResolveTargetSession(manager);
            string? targetId = targetSession?.SourceAppUserModelId;
            var allSessions = manager.GetSessions();
            if (allSessions is null)
                return list;

            foreach (var s in allSessions)
            {
                try
                {
                    string id = s.SourceAppUserModelId ?? "system";
                    if (IsSelfWebViewSession(id))
                        continue;

                    string appName = FormatAppName(id);
                    var props = await s.TryGetMediaPropertiesAsync();
                    var playback = s.GetPlaybackInfo();
                    bool playing = playback?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                    bool isSelected = string.Equals(id, targetId, StringComparison.OrdinalIgnoreCase);

                    list.Add(new MediaSessionSnapshot(
                        id: id,
                        app_name: appName,
                        title: !string.IsNullOrWhiteSpace(props?.Title) ? props.Title : "Idle",
                        artist: !string.IsNullOrWhiteSpace(props?.Artist) ? props.Artist : appName,
                        is_playing: playing,
                        is_current: isSelected));
                }
                catch
                {
                }
            }
        }
        catch
        {
        }

        return list;
    }

    private GlobalSystemMediaTransportControlsSession? ResolveTargetSession(GlobalSystemMediaTransportControlsSessionManager manager)
    {
        try
        {
            var sessions = manager.GetSessions();
            if (!string.IsNullOrWhiteSpace(_selectedSessionId) && sessions is not null)
            {
                foreach (var s in sessions)
                {
                    string sid = s.SourceAppUserModelId ?? string.Empty;
                    if (string.Equals(sid, _selectedSessionId, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(FormatAppName(sid), _selectedSessionId, StringComparison.OrdinalIgnoreCase))
                    {
                        return s;
                    }
                }
            }

            // Prefer any non-self session that is actively playing
            if (sessions is not null)
            {
                foreach (var s in sessions)
                {
                    string sid = s.SourceAppUserModelId ?? string.Empty;
                    if (IsSelfWebViewSession(sid))
                        continue;

                    if (s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                        return s;
                }
            }

            var current = manager.GetCurrentSession();
            if (current is not null && !IsSelfWebViewSession(current.SourceAppUserModelId))
                return current;

            if (sessions is not null)
            {
                foreach (var s in sessions)
                {
                    if (!IsSelfWebViewSession(s.SourceAppUserModelId))
                        return s;
                }
            }
        }
        catch
        {
        }

        return null;
    }

    public async Task<SmtcMediaSnapshot> GetMediaInfoAsync()
    {
        try
        {
            var manager = await GetManagerAsync();
            if (manager is null)
            {
                return new SmtcMediaSnapshot("No media", "Idle", string.Empty, false, 0.0, 1.0, null, "System Audio", []);
            }

            var sessions = await GetSessionsAsync();
            var session = ResolveTargetSession(manager);
            if (session is null)
            {
                return new SmtcMediaSnapshot("No media", "Idle", string.Empty, false, 0.0, 1.0, null, "System Audio", sessions);
            }

            string sourceApp = FormatAppName(session.SourceAppUserModelId);
            var props = await session.TryGetMediaPropertiesAsync();
            string title = !string.IsNullOrWhiteSpace(props?.Title) ? props.Title : "No Media Playing";
            string artist = !string.IsNullOrWhiteSpace(props?.Artist) ? props.Artist : "Idle";
            string album = !string.IsNullOrWhiteSpace(props?.AlbumTitle) ? props.AlbumTitle : string.Empty;

            var playback = session.GetPlaybackInfo();
            bool isPlaying = playback?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            bool? isShuffle = playback?.IsShuffleActive;
            int repeatMode = playback?.AutoRepeatMode is Windows.Media.MediaPlaybackAutoRepeatMode arm ? (int)arm : 0;
            double positionSecs = 0.0;
            double durationSecs = 0.0;
            double anchorAgeSecs = 0.0;
            try
            {
                var timeline = session.GetTimelineProperties();
                if (timeline is not null && timeline.EndTime.TotalSeconds > 1.5)
                {
                    positionSecs = Math.Max(0.0, timeline.Position.TotalSeconds);
                    durationSecs = timeline.EndTime.TotalSeconds;
                    anchorAgeSecs = ResolveAnchorAgeSecs(timeline.LastUpdatedTime, isPlaying, DateTimeOffset.UtcNow);
                }
            }
            catch
            {
            }

            double playbackRate = playback?.PlaybackRate ?? 1.0;
            if (playbackRate <= 0 || double.IsNaN(playbackRate))
                playbackRate = 1.0;

            string artworkKey = $"{sourceApp}|{title}|{artist}|{album}";
            string? artworkUrl = _cachedArtworkDataUrl;

            if (!string.Equals(artworkKey, _lastArtworkKey, StringComparison.Ordinal))
            {
                _lastArtworkKey = artworkKey;
                artworkUrl = await TryReadThumbnailDataUrlAsync(props?.Thumbnail);
                _cachedArtworkDataUrl = artworkUrl;
            }

            return new SmtcMediaSnapshot(title, artist, album, isPlaying, positionSecs, durationSecs, artworkUrl, sourceApp, sessions, isShuffle, repeatMode, anchorAgeSecs, playbackRate);
        }
        catch
        {
            return new SmtcMediaSnapshot("No media", "Idle", string.Empty, false, 0.0, 1.0, null, "System Audio", [], false, 0);
        }
    }

    /// <summary>
    /// Elapsed *playing* time since the app's timeline position was published.
    ///
    /// SMTC timelines are snapshots, not clocks: Chromium publishes a position state once at
    /// playback start and then leaves both <c>Position</c> and <c>LastUpdatedTime</c> frozen, so
    /// this age is the only thing that turns a dead snapshot into a live playhead. Ages are carried
    /// forward between reads but only advance while the transport is playing, so a pause freezes the
    /// playhead where it stopped instead of inflating it by the length of the pause.
    /// </summary>
    private double ResolveAnchorAgeSecs(DateTimeOffset instant, bool isPlaying, DateTimeOffset nowUtc)
    {
        if (instant == default)
        {
            _timelineInstant = default;
            _lastAnchorAgeSecs = 0.0;
            _lastAgeSampleUtc = nowUtc;
            return 0.0;
        }

        double age;
        if (instant != _timelineInstant)
        {
            // The app just re-published. A playing app has been running since that instant; a paused
            // one is describing where it stopped, so nothing has elapsed yet.
            _timelineInstant = instant;
            age = isPlaying ? (nowUtc - instant).TotalSeconds : 0.0;
        }
        else
        {
            // Nothing new: carry the age forward, counting only the time the transport played.
            age = _lastAnchorAgeSecs + (isPlaying ? (nowUtc - _lastAgeSampleUtc).TotalSeconds : 0.0);
        }

        // Reject anchors from the future or implausibly old ones (clock skew, corrupt payloads).
        double clamped = age is > 0 and < 86_400 ? age : 0.0;
        _lastAnchorAgeSecs = clamped;
        _lastAgeSampleUtc = nowUtc;
        return clamped;
    }

    /// <summary>
    /// Live playhead for the Media Session convention <c>position + elapsed * rate</c>: the app's
    /// last reported position advanced by the playing time that has elapsed since it was reported.
    /// </summary>
    public static double AnchorPosition(double positionSecs, double anchorAgeSecs, double playbackRate)
    {
        double rate = playbackRate > 0 ? playbackRate : 1.0;
        return positionSecs + anchorAgeSecs * rate;
    }

    private static async Task<string?> TryReadThumbnailDataUrlAsync(IRandomAccessStreamReference? thumbRef)
    {
        if (thumbRef is null)
            return null;

        try
        {
            using IRandomAccessStreamWithContentType stream = await thumbRef.OpenReadAsync();
            if (stream.Size == 0 || stream.Size > 2_000_000)
                return null;

            using var reader = new DataReader(stream);
            uint size = (uint)stream.Size;
            await reader.LoadAsync(size);
            byte[] bytes = new byte[size];
            reader.ReadBytes(bytes);

            string mime = string.IsNullOrWhiteSpace(stream.ContentType) ? "image/png" : stream.ContentType;
            return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        }
        catch
        {
            return null;
        }
    }

    public Task PlayPauseAsync()
    {
        return Task.Run(async () =>
        {
            try
            {
                var manager = await GetManagerAsync();
                var session = manager is not null ? ResolveTargetSession(manager) : null;
                if (session is not null)
                {
                    string appId = session.SourceAppUserModelId ?? string.Empty;
                    var beforeStatus = session.GetPlaybackInfo()?.PlaybackStatus;
                    bool wasPlaying = beforeStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

                    // Chromium's system_media_controls_win.cc explicitly handles Play & Pause buttons;
                    // try explicit Play/Pause first, then TogglePlayPause.
                    bool ok = wasPlaying
                        ? await session.TryPauseAsync()
                        : await session.TryPlayAsync();

                    if (!ok)
                    {
                        ok = await session.TryTogglePlayPauseAsync();
                    }

                    if (ok && IsChromiumSession(appId))
                    {
                        await Task.Delay(140);
                        var afterStatus = session.GetPlaybackInfo()?.PlaybackStatus;
                        if (afterStatus != beforeStatus)
                            return;
                    }
                    else if (ok)
                    {
                        return;
                    }
                }
            }
            catch
            {
            }

            // Fallback to native Windows virtual media key VK_MEDIA_PLAY_PAUSE (0xB3)
            Win32.SendMediaKey(Win32.VK_MEDIA_PLAY_PAUSE);
        });
    }

    public Task NextAsync()
    {
        return Task.Run(async () =>
        {
            try
            {
                var manager = await GetManagerAsync();
                var session = manager is not null ? ResolveTargetSession(manager) : null;
                if (session is not null)
                {
                    string appId = session.SourceAppUserModelId ?? string.Empty;
                    var controls = session.GetPlaybackInfo()?.Controls;
                    bool isNextEnabled = controls?.IsNextEnabled == true;
                    string? beforeTitle = (await session.TryGetMediaPropertiesAsync())?.Title;

                    bool ok = await session.TrySkipNextAsync();
                    if (ok && (!IsChromiumSession(appId) || isNextEnabled))
                    {
                        if (IsChromiumSession(appId))
                        {
                            await Task.Delay(150);
                            string? afterTitle = (await session.TryGetMediaPropertiesAsync())?.Title;
                            if (!string.Equals(beforeTitle, afterTitle, StringComparison.Ordinal))
                                return;
                        }
                        else
                        {
                            return;
                        }
                    }
                }
            }
            catch
            {
            }

            // Fallback to native Windows virtual media key VK_MEDIA_NEXT_TRACK (0xB0)
            Win32.SendMediaKey(Win32.VK_MEDIA_NEXT_TRACK);
        });
    }

    public Task PreviousAsync()
    {
        return Task.Run(async () =>
        {
            try
            {
                var manager = await GetManagerAsync();
                var session = manager is not null ? ResolveTargetSession(manager) : null;
                if (session is not null)
                {
                    string appId = session.SourceAppUserModelId ?? string.Empty;
                    var controls = session.GetPlaybackInfo()?.Controls;
                    bool isPrevEnabled = controls?.IsPreviousEnabled == true;
                    string? beforeTitle = (await session.TryGetMediaPropertiesAsync())?.Title;

                    bool ok = await session.TrySkipPreviousAsync();
                    if (ok && (!IsChromiumSession(appId) || isPrevEnabled))
                    {
                        if (IsChromiumSession(appId))
                        {
                            await Task.Delay(150);
                            string? afterTitle = (await session.TryGetMediaPropertiesAsync())?.Title;
                            if (!string.Equals(beforeTitle, afterTitle, StringComparison.Ordinal))
                                return;
                        }
                        else
                        {
                            return;
                        }
                    }
                }
            }
            catch
            {
            }

            // Fallback to native Windows virtual media key VK_MEDIA_PREV_TRACK (0xB1)
            Win32.SendMediaKey(Win32.VK_MEDIA_PREV_TRACK);
        });
    }

    public Task SeekAsync(double positionSeconds)
    {
        return Task.Run(async () =>
        {
            try
            {
                var manager = await GetManagerAsync();
                var session = manager is not null ? ResolveTargetSession(manager) : null;
                if (session is not null)
                {
                    long ticks = TimeSpan.FromSeconds(Math.Max(0.0, positionSeconds)).Ticks;
                    _ = await session.TryChangePlaybackPositionAsync(ticks);
                }
            }
            catch
            {
            }
        });
    }

    public async Task<bool?> ToggleShuffleAsync()
    {
        try
        {
            var manager = await GetManagerAsync();
            var session = manager is not null ? ResolveTargetSession(manager) : null;
            if (session is not null)
            {
                bool current = session.GetPlaybackInfo()?.IsShuffleActive ?? false;
                bool next = !current;
                bool ok = await session.TryChangeShuffleActiveAsync(next);
                if (ok) return next;
            }
        }
        catch
        {
        }
        return null;
    }

    public async Task<int> CycleRepeatModeAsync()
    {
        try
        {
            var manager = await GetManagerAsync();
            var session = manager is not null ? ResolveTargetSession(manager) : null;
            if (session is not null)
            {
                var current = session.GetPlaybackInfo()?.AutoRepeatMode ?? Windows.Media.MediaPlaybackAutoRepeatMode.None;
                var next = current switch
                {
                    Windows.Media.MediaPlaybackAutoRepeatMode.None => Windows.Media.MediaPlaybackAutoRepeatMode.List,
                    Windows.Media.MediaPlaybackAutoRepeatMode.List => Windows.Media.MediaPlaybackAutoRepeatMode.Track,
                    _ => Windows.Media.MediaPlaybackAutoRepeatMode.None
                };
                bool ok = await session.TryChangeAutoRepeatModeAsync(next);
                if (ok) return (int)next;
            }
        }
        catch
        {
        }
        return 0;
    }
}
