#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod media;
mod system;
mod theme;

use audio::{get_master_volume, set_master_volume};
use media::{get_media_info, media_next, media_play_pause, media_prev};
use system::{
    apply_wallpaper, get_audio_state, get_brightness, get_system_stats, get_wallpapers,
    run_terminal_command, set_audio_volume, set_brightness, set_dropdown_open, toggle_audio_mute,
    SystemState,
};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, Position};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn main() {
    tauri::Builder::default()
        .manage(SystemState::new())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("toggle-dropdown", ());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Position horizontally centered at y: 0 on the primary monitor
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let screen_size = monitor.size();
                    let win_size = window
                        .outer_size()
                        .unwrap_or(PhysicalSize::new(860, 430));
                    let x = (screen_size.width as i32 - win_size.width as i32) / 2;
                    let _ = window.set_position(Position::Physical(PhysicalPosition { x, y: 0 }));
                }

                // Apply WS_EX_TOOLWINDOW so Canopy never appears in Alt+Tab
                #[cfg(target_os = "windows")]
                {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{
                        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_APPWINDOW,
                        WS_EX_TOOLWINDOW,
                    };

                    if let Ok(hwnd_raw) = window.hwnd() {
                        let hwnd = HWND(hwnd_raw.0 as _);
                        unsafe {
                            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                            let updated_style = (ex_style & !(WS_EX_APPWINDOW.0 as isize))
                                | (WS_EX_TOOLWINDOW.0 as isize);
                            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, updated_style);
                        }
                    }
                }
            }

            // Register global shortcuts: Super+Backquote (Win + `) and Ctrl+Shift+Space
            let win_grave = Shortcut::new(Some(Modifiers::SUPER), Code::Backquote);
            let ctrl_shift_space =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

            let _ = app.global_shortcut().register(win_grave);
            let _ = app.global_shortcut().register(ctrl_shift_space);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_stats,
            get_media_info,
            media_play_pause,
            media_next,
            media_prev,
            media::get_media_sessions,
            media::select_media_session,
            get_master_volume,
            set_master_volume,
            get_brightness,
            set_brightness,
            get_audio_state,
            set_audio_volume,
            toggle_audio_mute,
            get_wallpapers,
            apply_wallpaper,
            system::pick_wallpaper_folder,
            system::set_wallpaper_directory,
            system::set_top_hover_trigger,
            system::set_launch_on_startup,
            system::get_installed_apps,
            system::launch_app,
            theme::set_desktop_wallpaper,
            theme::get_current_wallpaper,
            run_terminal_command,
            set_dropdown_open
        ])
        .run(tauri::generate_context!())
        .expect("error while running Canopy Tauri application");
}
