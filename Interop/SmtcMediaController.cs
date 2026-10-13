using Windows.Media.Control;
using Windows.Storage.Streams;

namespace CaelestiaWin.Interop;

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
    IReadOnlyList<MediaSessionSnapshot> Sessions
);

/// <summary>
/// Queries Windows 11 GlobalSystemMediaTransportControlsSessionManager (SMTC) for track metadata,
/// active media sessions, timeline progress, and album artwork, with infallible Win32 virtual media keys.
/// </summary>
public sealed class SmtcMediaController
{
    private GlobalSystemMediaTransportControlsSessionManager? _manager;
    private string? _selectedSessionId;
    private string? _lastArtworkKey;
    private string? _cachedArtworkDataUrl;

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

    private static string FormatAppName(string? sourceAppUserModelId)
    {
        if (string.IsNullOrWhiteSpace(sourceAppUserModelId))
            return "System Media";

        string raw = sourceAppUserModelId.Trim();
        if (raw.Contains("Spotify", StringComparison.OrdinalIgnoreCase)) return "Spotify";
        if (raw.Contains("Feishin", StringComparison.OrdinalIgnoreCase)) return "Feishin";
        if (raw.Contains("Chrome", StringComparison.OrdinalIgnoreCase)) return "Chrome";
        if (raw.Contains("msedge", StringComparison.OrdinalIgnoreCase)) return "Edge";
        if (raw.Contains("Firefox", StringComparison.OrdinalIgnoreCase)) return "Firefox";
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

            var current = manager.GetCurrentSession();
            string? currentId = current?.SourceAppUserModelId;
            var allSessions = manager.GetSessions();
            if (allSessions is null)
                return list;

            foreach (var s in allSessions)
            {
                try
                {
                    string id = s.SourceAppUserModelId ?? "system";
                    string appName = FormatAppName(id);
                    var props = await s.TryGetMediaPropertiesAsync();
                    var playback = s.GetPlaybackInfo();
                    bool playing = playback?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                    bool isSelected = !string.IsNullOrWhiteSpace(_selectedSessionId)
                        ? string.Equals(id, _selectedSessionId, StringComparison.OrdinalIgnoreCase)
                        : string.Equals(id, currentId, StringComparison.OrdinalIgnoreCase);

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
            if (!string.IsNullOrWhiteSpace(_selectedSessionId))
            {
                var sessions = manager.GetSessions();
                if (sessions is not null)
                {
                    foreach (var s in sessions)
                    {
                        if (string.Equals(s.SourceAppUserModelId, _selectedSessionId, StringComparison.OrdinalIgnoreCase))
                            return s;
                    }
                }
            }
        }
        catch
        {
        }

        return manager.GetCurrentSession();
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

            double positionSecs = 0.0;
            double durationSecs = 1.0;
            try
            {
                var timeline = session.GetTimelineProperties();
                if (timeline is not null)
                {
                    positionSecs = Math.Max(0.0, timeline.Position.TotalSeconds);
                    durationSecs = Math.Max(1.0, timeline.EndTime.TotalSeconds);
                }
            }
            catch
            {
            }

            string artworkKey = $"{sourceApp}|{title}|{artist}|{album}";
            string? artworkUrl = _cachedArtworkDataUrl;

            if (!string.Equals(artworkKey, _lastArtworkKey, StringComparison.Ordinal))
            {
                _lastArtworkKey = artworkKey;
                artworkUrl = await TryReadThumbnailDataUrlAsync(props?.Thumbnail);
                _cachedArtworkDataUrl = artworkUrl;
            }

            return new SmtcMediaSnapshot(title, artist, album, isPlaying, positionSecs, durationSecs, artworkUrl, sourceApp, sessions);
        }
        catch
        {
            return new SmtcMediaSnapshot("No media", "Idle", string.Empty, false, 0.0, 1.0, null, "System Audio", []);
        }
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

    public async Task PlayPauseAsync()
    {
        try
        {
            var manager = await GetManagerAsync();
            var session = manager is not null ? ResolveTargetSession(manager) : null;
            if (session is not null)
            {
                bool ok = await session.TryTogglePlayPauseAsync();
                if (ok) return;
            }
        }
        catch
        {
        }
        Win32.SendMediaKey(Win32.VK_MEDIA_PLAY_PAUSE);
    }

    public async Task NextAsync()
    {
        try
        {
            var manager = await GetManagerAsync();
            var session = manager is not null ? ResolveTargetSession(manager) : null;
            if (session is not null)
            {
                bool ok = await session.TrySkipNextAsync();
                if (ok) return;
            }
        }
        catch
        {
        }
        Win32.SendMediaKey(Win32.VK_MEDIA_NEXT_TRACK);
    }

    public async Task PreviousAsync()
    {
        try
        {
            var manager = await GetManagerAsync();
            var session = manager is not null ? ResolveTargetSession(manager) : null;
            if (session is not null)
            {
                bool ok = await session.TrySkipPreviousAsync();
                if (ok) return;
            }
        }
        catch
        {
        }
        Win32.SendMediaKey(Win32.VK_MEDIA_PREV_TRACK);
    }
}
