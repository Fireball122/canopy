#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
};
#[cfg(target_os = "windows")]
use winreg::enums::HKEY_CURRENT_USER;

#[tauri::command]
pub fn set_desktop_wallpaper(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let wide: Vec<u16> = std::ffi::OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                Some(wide.as_ptr() as *mut _),
                SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
            )
            .map_err(|e| format!("Failed to set desktop wallpaper: {}", e))?;
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn read_wallpaper_from_registry() -> std::io::Result<String> {
    winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Control Panel\\Desktop")?
        .get_value("Wallpaper")
}

#[tauri::command]
pub fn get_current_wallpaper() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        read_wallpaper_from_registry()
            .map_err(|e| format!("Failed to read current wallpaper from registry: {}", e))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(String::new())
    }
}
