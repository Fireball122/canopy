#[cfg(target_os = "windows")]
fn with_endpoint_volume<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce(&windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume) -> Result<T, String>,
{
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create MMDeviceEnumerator: {}", e))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {}", e))?;

        let endpoint: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to activate IAudioEndpointVolume: {}", e))?;

        f(&endpoint)
    }
}

#[tauri::command]
pub fn get_master_volume() -> Result<f32, String> {
    #[cfg(target_os = "windows")]
    {
        with_endpoint_volume(|endpoint| unsafe {
            let scalar = endpoint
                .GetMasterVolumeLevelScalar()
                .map_err(|e| format!("Failed to read master volume scalar: {}", e))?;
            Ok((scalar.clamp(0.0, 1.0) * 100.0).round())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(68.0)
    }
}

#[tauri::command]
pub fn set_master_volume(level: f32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let scalar = if level > 1.0 {
            (level / 100.0).clamp(0.0, 1.0)
        } else if level > 0.0 && level < 1.0 {
            level.clamp(0.0, 1.0)
        } else {
            (level / 100.0).clamp(0.0, 1.0)
        };

        with_endpoint_volume(|endpoint| unsafe {
            endpoint
                .SetMasterVolumeLevelScalar(scalar, std::ptr::null())
                .map_err(|e| format!("Failed to set master volume scalar: {}", e))?;
            if scalar > 0.0 {
                let _ = endpoint.SetMute(false, std::ptr::null());
            }
            Ok(())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = level;
        Ok(())
    }
}
