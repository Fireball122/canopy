use serde::{Deserialize, Serialize};
use std::sync::Mutex;

static SELECTED_SESSION_ID: Mutex<Option<String>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MediaSessionItem {
    pub id: String,
    pub app_name: String,
    pub title: String,
    pub artist: String,
    pub is_playing: bool,
    pub is_current: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    pub position_secs: f32,
    pub duration_secs: f32,
    pub artwork_url: Option<String>,
    pub source_app: String,
    pub sessions: Vec<MediaSessionItem>,
}

impl Default for MediaInfo {
    fn default() -> Self {
        Self {
            title: "No Media Playing".to_string(),
            artist: "Standby".to_string(),
            album: String::new(),
            is_playing: false,
            position_secs: 0.0,
            duration_secs: 0.0,
            artwork_url: None,
            source_app: "System Audio".to_string(),
            sessions: Vec::new(),
        }
    }
}

#[cfg(target_os = "windows")]
fn format_source_app_name(raw_id: &str) -> String {
    let trimmed = raw_id.trim();
    if trimmed.is_empty() {
        return "System Audio".to_string();
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("spotify") {
        return "Spotify".to_string();
    }
    if lower.contains("chrome") {
        return "Chrome".to_string();
    }
    if lower.contains("msedge") || lower.contains("microsoft.microsoftedge") {
        return "Edge".to_string();
    }
    if lower.contains("firefox") || lower.contains("mozilla") {
        return "Firefox".to_string();
    }
    if lower.contains("brave") {
        return "Brave".to_string();
    }
    if lower.contains("vivaldi") {
        return "Vivaldi".to_string();
    }
    if lower.contains("opera") {
        return "Opera".to_string();
    }
    if lower.contains("vlc") {
        return "VLC".to_string();
    }
    if lower.contains("foobar") {
        return "foobar2000".to_string();
    }
    if lower.contains("musicbee") {
        return "MusicBee".to_string();
    }
    if lower.contains("applemusic") || lower.contains("itunes") {
        return "Apple Music".to_string();
    }
    if lower.contains("tidal") {
        return "TIDAL".to_string();
    }
    if lower.contains("zunemusic") || lower.contains("music.ui") || lower.contains("windows.media") {
        return "Media Player".to_string();
    }

    let segment = trimmed
        .rsplit(['\\', '/', '!'])
        .next()
        .unwrap_or(trimmed)
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE");
    let mut chars = segment.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => "System Audio".to_string(),
    }
}

#[cfg(target_os = "windows")]
fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((bytes.len() + 2) / 3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn read_thumbnail_data_url(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    use windows::Storage::Streams::{DataReader, InputStreamOptions};

    let thumb_ref = props.Thumbnail().ok()?;
    let stream = thumb_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > 4 * 1024 * 1024 {
        return None;
    }

    let content_type = stream
        .ContentType()
        .ok()
        .map(|s| s.to_string_lossy())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "image/png".to_string());

    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader
        .SetInputStreamOptions(InputStreamOptions::ReadAhead)
        .ok()?;
    reader.LoadAsync(size as u32).ok()?.get().ok()?;

    let mut buffer = vec![0u8; size as usize];
    reader.ReadBytes(&mut buffer).ok()?;
    let _ = reader.Close();

    let b64 = encode_base64(&buffer);
    Some(format!("data:{};base64,{}", content_type, b64))
}

#[tauri::command]
pub async fn get_media_info() -> Result<MediaInfo, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::{
            GlobalSystemMediaTransportControlsSession,
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        };

        let result = tokio::task::spawn_blocking(|| -> Result<MediaInfo, String> {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .map_err(|e| format!("Failed to request GSMTC manager: {}", e))?
                .get()
                .map_err(|e| format!("Failed to await GSMTC manager: {}", e))?;

            let current_session_opt = manager.GetCurrentSession().ok();
            let current_session_id = current_session_opt
                .as_ref()
                .and_then(|s| s.SourceAppUserModelId().ok())
                .map(|s| s.to_string_lossy())
                .unwrap_or_default();

            let mut raw_sessions: Vec<GlobalSystemMediaTransportControlsSession> = Vec::new();
            if let Ok(sessions_view) = manager.GetSessions() {
                let count = sessions_view.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(s) = sessions_view.GetAt(i) {
                        raw_sessions.push(s);
                    }
                }
            }

            if raw_sessions.is_empty() {
                if let Some(curr) = current_session_opt {
                    raw_sessions.push(curr);
                }
            }

            if raw_sessions.is_empty() {
                return Ok(MediaInfo::default());
            }

            let preferred_id = SELECTED_SESSION_ID
                .lock()
                .ok()
                .and_then(|g| g.clone());

            let mut session_ids: Vec<String> = Vec::with_capacity(raw_sessions.len());
            for (idx, s) in raw_sessions.iter().enumerate() {
                let sid = s
                    .SourceAppUserModelId()
                    .ok()
                    .map(|h| h.to_string_lossy())
                    .filter(|v| !v.is_empty())
                    .unwrap_or_else(|| format!("session-{}", idx));
                session_ids.push(sid);
            }

            let target_idx = preferred_id
                .as_deref()
                .and_then(|pref| {
                    session_ids.iter().position(|sid| {
                        sid.eq_ignore_ascii_case(pref)
                            || format_source_app_name(sid).eq_ignore_ascii_case(pref)
                    })
                })
                .or_else(|| {
                    if !current_session_id.is_empty() {
                        session_ids
                            .iter()
                            .position(|sid| sid == &current_session_id)
                    } else {
                        None
                    }
                })
                .unwrap_or(0);

            let mut sessions: Vec<MediaSessionItem> = Vec::with_capacity(raw_sessions.len());
            let mut active_title = "No Media Playing".to_string();
            let mut active_artist = "Unknown Artist".to_string();
            let mut active_album = String::new();
            let mut active_playing = false;
            let mut active_pos = 0.0_f32;
            let mut active_dur = 0.0_f32;
            let mut active_artwork: Option<String> = None;
            let mut active_app_name = "System Audio".to_string();

            for (idx, s) in raw_sessions.iter().enumerate() {
                let sid = session_ids[idx].clone();
                let app_name = format_source_app_name(&sid);
                let is_playing = s
                    .GetPlaybackInfo()
                    .and_then(|info| info.PlaybackStatus())
                    .map(|status| {
                        status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
                    })
                    .unwrap_or(false);

                let props_opt = s
                    .TryGetMediaPropertiesAsync()
                    .ok()
                    .and_then(|op| op.get().ok());

                let raw_title = props_opt
                    .as_ref()
                    .and_then(|p| p.Title().ok())
                    .map(|h| h.to_string_lossy())
                    .unwrap_or_default();
                let raw_artist = props_opt
                    .as_ref()
                    .and_then(|p| p.Artist().ok())
                    .map(|h| h.to_string_lossy())
                    .unwrap_or_default();

                let s_title = if raw_title.trim().is_empty() {
                    "No Media Playing".to_string()
                } else {
                    raw_title
                };
                let s_artist = if raw_artist.trim().is_empty() {
                    "Unknown Artist".to_string()
                } else {
                    raw_artist
                };

                if idx == target_idx {
                    active_title = s_title.clone();
                    active_artist = s_artist.clone();
                    active_playing = is_playing;
                    active_app_name = app_name.clone();
                    if let Some(p) = &props_opt {
                        active_album = p
                            .AlbumTitle()
                            .ok()
                            .map(|h| h.to_string_lossy())
                            .unwrap_or_default();
                        active_artwork = read_thumbnail_data_url(p);
                    }
                    if let Ok(timeline) = s.GetTimelineProperties() {
                        active_pos = timeline
                            .Position()
                            .map(|t| (t.Duration as f32 / 10_000_000.0).max(0.0))
                            .unwrap_or(0.0);
                        active_dur = timeline
                            .EndTime()
                            .map(|t| (t.Duration as f32 / 10_000_000.0).max(0.0))
                            .unwrap_or(0.0);
                    }
                }

                sessions.push(MediaSessionItem {
                    id: sid,
                    app_name,
                    title: s_title,
                    artist: s_artist,
                    is_playing,
                    is_current: idx == target_idx,
                });
            }

            Ok(MediaInfo {
                title: active_title,
                artist: active_artist,
                album: active_album,
                is_playing: active_playing,
                position_secs: active_pos,
                duration_secs: active_dur,
                artwork_url: active_artwork,
                source_app: active_app_name,
                sessions,
            })
        })
        .await
        .map_err(|e| format!("Media task join error: {}", e))?;

        return result;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(MediaInfo::default())
    }
}

#[tauri::command]
pub async fn get_media_sessions() -> Result<Vec<MediaSessionItem>, String> {
    let info = get_media_info().await?;
    Ok(info.sessions)
}

#[tauri::command]
pub async fn select_media_session(session_id: String) -> Result<(), String> {
    let mut guard = SELECTED_SESSION_ID
        .lock()
        .map_err(|e| format!("Failed to lock media session selector: {}", e))?;
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        *guard = None;
    } else {
        *guard = Some(trimmed.to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_media_key(
    vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
) -> Result<(), String> {
    use std::mem::size_of;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    };

    unsafe {
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: KEYBD_EVENT_FLAGS(0),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];

        let sent = SendInput(&inputs, size_of::<INPUT>() as i32);
        if sent == 0 {
            return Err("SendInput failed to dispatch media key".to_string());
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn is_chromium_session(raw_id: &str) -> bool {
    let lower = raw_id.to_ascii_lowercase();
    lower.contains("brave")
        || lower.contains("chrome")
        || lower.contains("msedge")
        || lower.contains("vivaldi")
        || lower.contains("opera")
        || lower.contains("arc")
        || lower.contains("zen")
}

#[tauri::command]
pub async fn media_play_pause() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::{
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        };
        use windows::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_PLAY_PAUSE;

        let handled = tokio::task::spawn_blocking(|| -> bool {
            if let Ok(req) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
                if let Ok(manager) = req.get() {
                    if let Ok(session) = manager.GetCurrentSession() {
                        let app_id = session
                            .SourceAppUserModelId()
                            .ok()
                            .map(|s| s.to_string_lossy())
                            .unwrap_or_default();
                        let before = session.GetPlaybackInfo().ok().and_then(|p| p.PlaybackStatus().ok());
                        let was_playing = before
                            == Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing);

                        let ok = if was_playing {
                            session.TryPauseAsync().ok().and_then(|op| op.get().ok()).unwrap_or(false)
                        } else {
                            session.TryPlayAsync().ok().and_then(|op| op.get().ok()).unwrap_or(false)
                        } || session
                            .TryTogglePlayPauseAsync()
                            .ok()
                            .and_then(|op| op.get().ok())
                            .unwrap_or(false);

                        if ok && !is_chromium_session(&app_id) {
                            return true;
                        }
                        if ok && is_chromium_session(&app_id) {
                            std::thread::sleep(std::time::Duration::from_millis(140));
                            let after = session.GetPlaybackInfo().ok().and_then(|p| p.PlaybackStatus().ok());
                            if after != before {
                                return true;
                            }
                        }
                    }
                }
            }
            false
        })
        .await
        .unwrap_or(false);

        if !handled {
            send_media_key(VK_MEDIA_PLAY_PAUSE)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn media_next() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
        use windows::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_NEXT_TRACK;

        let handled = tokio::task::spawn_blocking(|| -> bool {
            if let Ok(req) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
                if let Ok(manager) = req.get() {
                    if let Ok(session) = manager.GetCurrentSession() {
                        let app_id = session
                            .SourceAppUserModelId()
                            .ok()
                            .map(|s| s.to_string_lossy())
                            .unwrap_or_default();
                        let ok = session
                            .TrySkipNextAsync()
                            .ok()
                            .and_then(|op| op.get().ok())
                            .unwrap_or(false);
                        if ok && !is_chromium_session(&app_id) {
                            return true;
                        }
                    }
                }
            }
            false
        })
        .await
        .unwrap_or(false);

        if !handled {
            send_media_key(VK_MEDIA_NEXT_TRACK)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn media_prev() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
        use windows::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_PREV_TRACK;

        let handled = tokio::task::spawn_blocking(|| -> bool {
            if let Ok(req) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
                if let Ok(manager) = req.get() {
                    if let Ok(session) = manager.GetCurrentSession() {
                        let app_id = session
                            .SourceAppUserModelId()
                            .ok()
                            .map(|s| s.to_string_lossy())
                            .unwrap_or_default();
                        let ok = session
                            .TrySkipPreviousAsync()
                            .ok()
                            .and_then(|op| op.get().ok())
                            .unwrap_or(false);
                        if ok && !is_chromium_session(&app_id) {
                            return true;
                        }
                    }
                }
            }
            false
        })
        .await
        .unwrap_or(false);

        if !handled {
            send_media_key(VK_MEDIA_PREV_TRACK)?;
        }
    }
    Ok(())
}
