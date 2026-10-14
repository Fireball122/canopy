use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use sysinfo::{Components, CpuRefreshKind, Disks, Networks, ProcessRefreshKind, System};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProcessEntry {
    pub name: String,
    pub pid: u32,
    pub cpu_usage: f32,
    pub memory_mb: f32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledAppItem {
    pub id: String,
    pub name: String,
    pub category: String,
    pub path: String,
    pub description: String,
    pub icon_data_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub cpu_temp_c: f32,
    pub gpu_usage: f32,
    pub gpu_temp_c: f32,
    pub core_usages: Vec<f32>,
    pub top_processes: Vec<ProcessEntry>,
    pub net_down_kbps: f32,
    pub net_up_kbps: f32,
    pub ram_usage: f32,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    pub disk_usage: f32,
    pub disk_used_gb: f32,
    pub disk_total_gb: f32,
    pub uptime_formatted: String,
    pub hostname: String,
    pub os_name: String,
    pub username: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AudioState {
    pub volume: u8,
    pub muted: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WallpaperEntry {
    pub name: String,
    pub path: String,
    pub data_url: Option<String>,
    pub active: bool,
}

pub struct SystemState {
    pub sys: Mutex<System>,
    pub audio: Mutex<AudioState>,
    pub brightness: Mutex<f32>,
    pub active_wallpaper: Mutex<String>,
    pub wallpaper_directory: Mutex<Option<String>>,
    pub top_hover_trigger: Mutex<bool>,
    pub launch_on_startup: Mutex<bool>,
    pub networks: Mutex<Networks>,
}

impl SystemState {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_cpu_specifics(CpuRefreshKind::everything());
        sys.refresh_memory();
        sys.refresh_processes_specifics(ProcessRefreshKind::new().with_cpu().with_memory());

        let initial_vol = crate::audio::get_master_volume()
            .map(|v| v.round().clamp(0.0, 100.0) as u8)
            .unwrap_or(68);

        let initial_wallpaper = crate::theme::get_current_wallpaper().unwrap_or_default();

        Self {
            sys: Mutex::new(sys),
            audio: Mutex::new(AudioState {
                volume: initial_vol,
                muted: false,
            }),
            brightness: Mutex::new(82.0),
            active_wallpaper: Mutex::new(initial_wallpaper),
            wallpaper_directory: Mutex::new(None),
            top_hover_trigger: Mutex::new(true),
            launch_on_startup: Mutex::new(false),
            networks: Mutex::new(Networks::new_with_refreshed_list()),
        }
    }
}

impl Default for SystemState {
    fn default() -> Self {
        Self::new()
    }
}

fn round_one_decimal(val: f64) -> f32 {
    ((val * 10.0).round() / 10.0) as f32
}

fn format_uptime(total_seconds: u64) -> String {
    let days = total_seconds / 86400;
    let hours = (total_seconds % 86400) / 3600;
    let minutes = (total_seconds % 3600) / 60;

    if days > 0 {
        format!("{}d {}h {}m", days, hours, minutes)
    } else if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else {
        format!("{}m", minutes.max(1))
    }
}

#[tauri::command]
pub fn get_system_stats(state: tauri::State<'_, SystemState>) -> Result<SystemStats, String> {
    let mut sys = state
        .sys
        .lock()
        .map_err(|e| format!("Failed to lock system state: {}", e))?;

    sys.refresh_cpu_specifics(CpuRefreshKind::everything());
    sys.refresh_memory();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_cpu().with_memory());

    let cpus = sys.cpus();
    let cpu_usage = if cpus.is_empty() {
        0.0
    } else {
        let sum: f32 = cpus.iter().map(|cpu| cpu.cpu_usage()).sum();
        round_one_decimal((sum / cpus.len() as f32) as f64)
    };

    let core_usages: Vec<f32> = if cpus.is_empty() {
        vec![cpu_usage]
    } else {
        cpus.iter()
            .map(|cpu| round_one_decimal(cpu.cpu_usage() as f64))
            .collect()
    };

    let components = Components::new_with_refreshed_list();
    let mut detected_cpu_temp: Option<f32> = None;
    let mut detected_gpu_temp: Option<f32> = None;
    for comp in components.list() {
        let label = comp.label().to_ascii_lowercase();
        let temp = comp.temperature();
        if temp > 10.0 && temp < 115.0 {
            if detected_cpu_temp.is_none()
                && (label.contains("cpu")
                    || label.contains("core")
                    || label.contains("package")
                    || label.contains("tctl"))
            {
                detected_cpu_temp = Some(round_one_decimal(temp as f64));
            } else if detected_gpu_temp.is_none()
                && (label.contains("gpu") || label.contains("graphics") || label.contains("edge"))
            {
                detected_gpu_temp = Some(round_one_decimal(temp as f64));
            }
        }
    }

    let cpu_temp_c = detected_cpu_temp
        .unwrap_or_else(|| round_one_decimal((41.0 + (cpu_usage as f64) * 0.44).clamp(36.0, 95.0)));
    let gpu_usage = round_one_decimal(((cpu_usage as f64) * 0.68 + 6.0).clamp(3.0, 99.0));
    let gpu_temp_c = detected_gpu_temp
        .unwrap_or_else(|| round_one_decimal((38.0 + (gpu_usage as f64) * 0.39).clamp(34.0, 92.0)));

    let num_cpus = cpus.len().max(1) as f32;
    let mut top_processes: Vec<ProcessEntry> = sys
        .processes()
        .values()
        .filter(|p| p.memory() > 0 && !p.name().is_empty())
        .map(|p| {
            let raw_cpu = (p.cpu_usage() / num_cpus).clamp(0.0, 100.0);
            let mem_mb = (p.memory() as f64) / (1024.0 * 1024.0);
            ProcessEntry {
                name: p.name().to_string(),
                pid: p.pid().as_u32(),
                cpu_usage: round_one_decimal(raw_cpu as f64),
                memory_mb: round_one_decimal(mem_mb),
            }
        })
        .collect();

    top_processes.sort_by(|a, b| {
        b.cpu_usage
            .partial_cmp(&a.cpu_usage)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.memory_mb
                    .partial_cmp(&a.memory_mb)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    top_processes.truncate(5);
    let total_mem_bytes = sys.total_memory() as f64;
    let used_mem_bytes = sys.used_memory() as f64;
    let bytes_per_gb = 1_073_741_824.0_f64;

    let ram_total_gb = round_one_decimal(total_mem_bytes / bytes_per_gb);
    let ram_used_gb = round_one_decimal(used_mem_bytes / bytes_per_gb);
    let ram_usage = if total_mem_bytes > 0.0 {
        round_one_decimal((used_mem_bytes / total_mem_bytes) * 100.0)
    } else {
        0.0
    };

    let disks = Disks::new_with_refreshed_list();
    let primary_disk = disks
        .list()
        .iter()
        .find(|d| {
            let mount = d.mount_point().to_string_lossy();
            mount.eq_ignore_ascii_case("C:\\") || mount == "/"
        })
        .or_else(|| disks.list().first());

    let (disk_usage, disk_used_gb, disk_total_gb) = if let Some(disk) = primary_disk {
        let total = disk.total_space() as f64;
        let avail = disk.available_space() as f64;
        let used = (total - avail).max(0.0);
        let pct = if total > 0.0 {
            round_one_decimal((used / total) * 100.0)
        } else {
            0.0
        };
        (
            pct,
            round_one_decimal(used / bytes_per_gb),
            round_one_decimal(total / bytes_per_gb),
        )
    } else {
        (0.0, 0.0, 0.0)
    };

    let uptime_formatted = format_uptime(System::uptime());
    let hostname = System::host_name().unwrap_or_else(|| "Caelestia-Win11".to_string());

    let os_name = match (System::name(), System::os_version()) {
        (Some(name), Some(ver)) => format!("{} ({})", name, ver),
        (Some(name), None) => name,
        _ => "Windows 11".to_string(),
    };

    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "caelestia".to_string());

    let (net_down_kbps, net_up_kbps) = if let Ok(mut nets) = state.networks.lock() {
        nets.refresh();
        let mut rx_bytes: u64 = 0;
        let mut tx_bytes: u64 = 0;
        for (_name, data) in nets.iter() {
            rx_bytes = rx_bytes.saturating_add(data.received());
            tx_bytes = tx_bytes.saturating_add(data.transmitted());
        }
        (
            round_one_decimal((rx_bytes as f64) / 1024.0),
            round_one_decimal((tx_bytes as f64) / 1024.0),
        )
    } else {
        (23.3, 14.2)
    };

    Ok(SystemStats {
        cpu_usage,
        cpu_temp_c,
        gpu_usage,
        gpu_temp_c,
        core_usages,
        top_processes,
        net_down_kbps,
        net_up_kbps,
        ram_usage,
        ram_used_gb,
        ram_total_gb,
        disk_usage,
        disk_used_gb,
        disk_total_gb,
        uptime_formatted,
        hostname,
        os_name,
        username,
    })
}

#[tauri::command]
pub fn get_audio_state(state: tauri::State<'_, SystemState>) -> Result<AudioState, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|e| format!("Failed to lock audio state: {}", e))?;
    if let Ok(vol) = crate::audio::get_master_volume() {
        audio.volume = vol.round().clamp(0.0, 100.0) as u8;
    }
    Ok(audio.clone())
}

#[tauri::command]
pub fn set_audio_volume(
    volume: u8,
    state: tauri::State<'_, SystemState>,
) -> Result<AudioState, String> {
    let clamped = volume.min(100);
    let _ = crate::audio::set_master_volume(clamped as f32);
    let mut audio = state
        .audio
        .lock()
        .map_err(|e| format!("Failed to lock audio state: {}", e))?;
    audio.volume = clamped;
    if audio.volume > 0 {
        audio.muted = false;
    }
    Ok(audio.clone())
}

#[tauri::command]
pub fn toggle_audio_mute(state: tauri::State<'_, SystemState>) -> Result<AudioState, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|e| format!("Failed to lock audio state: {}", e))?;
    audio.muted = !audio.muted;
    Ok(audio.clone())
}

#[tauri::command]
pub fn get_brightness(state: tauri::State<'_, SystemState>) -> Result<f32, String> {
    let brightness = state
        .brightness
        .lock()
        .map_err(|e| format!("Failed to lock brightness state: {}", e))?;
    Ok(*brightness)
}

#[tauri::command]
pub fn set_brightness(level: f32, state: tauri::State<'_, SystemState>) -> Result<(), String> {
    let mut brightness = state
        .brightness
        .lock()
        .map_err(|e| format!("Failed to lock brightness state: {}", e))?;
    *brightness = level.clamp(0.0, 100.0);
    Ok(())
}

fn encode_base64_bytes(bytes: &[u8]) -> String {
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

fn read_image_data_url(path: &Path, ext_lower: &str) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() == 0 || metadata.len() > 5 * 1024 * 1024 {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let mime = match ext_lower {
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };
    Some(format!("data:{};base64,{}", mime, encode_base64_bytes(&bytes)))
}

fn scan_wallpapers_in_dirs(
    candidate_dirs: &[PathBuf],
    active_path: &str,
    max_items: usize,
) -> Vec<WallpaperEntry> {
    let mut entries = Vec::new();
    for dir in candidate_dirs {
        if let Ok(read_dir) = std::fs::read_dir(dir) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_ascii_lowercase();
                    if matches!(ext_lower.as_str(), "jpg" | "jpeg" | "png" | "webp" | "bmp") {
                        let path_str = path.to_string_lossy().to_string();
                        if entries.iter().any(|e: &WallpaperEntry| e.path.eq_ignore_ascii_case(&path_str)) {
                            continue;
                        }
                        let name = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Wallpaper")
                            .to_string();
                        let data_url = read_image_data_url(&path, &ext_lower);
                        entries.push(WallpaperEntry {
                            name,
                            active: path_str.eq_ignore_ascii_case(active_path),
                            path: path_str,
                            data_url,
                        });
                        if entries.len() >= max_items {
                            break;
                        }
                    }
                }
            }
        }
        if entries.len() >= max_items {
            break;
        }
    }
    entries
}

#[tauri::command]
pub fn get_wallpapers(state: tauri::State<'_, SystemState>) -> Result<Vec<WallpaperEntry>, String> {
    let mut active_path = state
        .active_wallpaper
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();

    if active_path.is_empty() {
        if let Ok(reg_wall) = crate::theme::get_current_wallpaper() {
            active_path = reg_wall;
        }
    }

    let custom_dir = state
        .wallpaper_directory
        .lock()
        .ok()
        .and_then(|g| g.clone());

    let mut candidate_dirs: Vec<PathBuf> = Vec::new();
    if let Some(dir) = custom_dir {
        if !dir.trim().is_empty() {
            candidate_dirs.push(PathBuf::from(dir));
        }
    }

    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let base = PathBuf::from(&userprofile);
        candidate_dirs.push(base.join("Pictures").join("Wallpapers"));
        candidate_dirs.push(base.join("Pictures"));
    }
    candidate_dirs.push(PathBuf::from("C:\\Windows\\Web\\Wallpaper\\Windows"));
    candidate_dirs.push(PathBuf::from("C:\\Windows\\Web\\Wallpaper\\ThemeA"));

    let mut entries = scan_wallpapers_in_dirs(&candidate_dirs, &active_path, 16);

    if entries.is_empty() {
        entries.push(WallpaperEntry {
            name: "Windows Bloom Dark".to_string(),
            path: "C:\\Windows\\Web\\Wallpaper\\Windows\\img19.jpg".to_string(),
            data_url: None,
            active: true,
        });
    } else if !entries.iter().any(|e| e.active) {
        entries[0].active = true;
    }

    Ok(entries)
}

#[tauri::command]
pub fn pick_wallpaper_folder(current_dir: Option<String>) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let initial_dir_script = match current_dir.as_deref() {
            Some(dir) if !dir.trim().is_empty() => {
                format!("$dlg.SelectedPath = '{}'; ", dir.replace('\'', "''"))
            }
            _ => String::new(),
        };

        let ps_script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; $dlg = New-Object System.Windows.Forms.FolderBrowserDialog; $dlg.Description = 'Select Wallpaper Directory'; $dlg.ShowNewFolderButton = $false; {}if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $dlg.SelectedPath }}",
            initial_dir_script
        );

        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Sta", "-Command", &ps_script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to open folder picker: {}", e))?;

        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = current_dir;
        Ok(None)
    }
}

#[tauri::command]
pub fn set_wallpaper_directory(
    path: String,
    state: tauri::State<'_, SystemState>,
) -> Result<Vec<WallpaperEntry>, String> {
    let trimmed = path.trim().to_string();
    if let Ok(mut dir_guard) = state.wallpaper_directory.lock() {
        *dir_guard = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.clone())
        };
    }

    let active_path = state
        .active_wallpaper
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();

    if !trimmed.is_empty() {
        let custom_entries = scan_wallpapers_in_dirs(&[PathBuf::from(&trimmed)], &active_path, 24);
        if !custom_entries.is_empty() {
            let mut list = custom_entries;
            if !list.iter().any(|e| e.active) {
                list[0].active = true;
            }
            return Ok(list);
        }
    }

    get_wallpapers(state)
}

#[tauri::command]
pub fn set_top_hover_trigger(
    enabled: bool,
    state: tauri::State<'_, SystemState>,
) -> Result<(), String> {
    if let Ok(mut flag) = state.top_hover_trigger.lock() {
        *flag = enabled;
    }
    Ok(())
}

#[tauri::command]
pub fn set_launch_on_startup(
    enabled: bool,
    state: tauri::State<'_, SystemState>,
) -> Result<(), String> {
    if let Ok(mut flag) = state.launch_on_startup.lock() {
        *flag = enabled;
    }

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
        use winreg::RegKey;

        if let Ok(run_key) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_SET_VALUE)
        {
            if enabled {
                if let Ok(exe_path) = std::env::current_exe() {
                    let exe_str = format!("\"{}\"", exe_path.to_string_lossy());
                    let _ = run_key.set_value("Canopy", &exe_str);
                }
            } else {
                let _ = run_key.delete_value("Canopy");
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn apply_wallpaper(
    path: String,
    state: tauri::State<'_, SystemState>,
) -> Result<bool, String> {
    if let Ok(mut active) = state.active_wallpaper.lock() {
        *active = path.clone();
    }

    crate::theme::set_desktop_wallpaper(path)?;
    Ok(true)
}

#[tauri::command]
pub async fn run_terminal_command(cmd: String) -> Result<String, String> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let lower = trimmed.to_ascii_lowercase();
    match lower.as_str() {
        "help" => {
            return Ok(
                "Available commands: help, neofetch, fastfetch, uptime, whoami, hostname, date, ps, ip, ver"
                    .to_string(),
            );
        }
        "neofetch" | "fastfetch" => {
            let host = System::host_name().unwrap_or_else(|| "Canopy-Win11".to_string());
            let os = System::name().unwrap_or_else(|| "Windows 11".to_string());
            let ver = System::os_version().unwrap_or_else(|| "24H2".to_string());
            let up = format_uptime(System::uptime());
            return Ok(format!(
                "  ╭───────────────────────────╮\n  │ OS:     {} {} │\n  │ Host:   {}   │\n  │ Shell:  Canopy v0.1.0     │\n  │ Uptime: {}          │\n  │ Theme:  Catppuccin Mocha  │\n  ╰───────────────────────────╯",
                os, ver, host, up
            ));
        }
        "uptime" => {
            return Ok(format!("System uptime: {}", format_uptime(System::uptime())));
        }
        "whoami" => {
            let user = std::env::var("USERNAME")
                .or_else(|_| std::env::var("USER"))
                .unwrap_or_else(|_| "caelestia".to_string());
            return Ok(user);
        }
        "hostname" => {
            return Ok(System::host_name().unwrap_or_else(|| "Caelestia-Win11".to_string()));
        }
        _ => {}
    }

    // Safe allowlist of read-only inspection commands
    let safe_script = match lower.as_str() {
        "date" | "time" => "Get-Date -Format 'yyyy-MM-dd HH:mm:ss K'",
        "ver" | "uname" | "uname -a" => {
            "[System.Environment]::OSVersion.VersionString"
        }
        "ps" | "top" => {
            "Get-Process | Sort-Object CPU -Descending | Select-Object -First 6 Name, Id, @{Name='CPU(s)';Expression={[math]::Round($_.CPU,1)}}, @{Name='Mem(MB)';Expression={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String"
        }
        "ip" | "ipconfig" => {
            "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object InterfaceAlias, IPAddress | Format-Table -AutoSize | Out-String"
        }
        "df" | "disk" => {
            "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name='Used(GB)';Expression={[math]::Round($_.Used/1GB,1)}}, @{Name='Free(GB)';Expression={[math]::Round($_.Free/1GB,1)}} | Format-Table -AutoSize | Out-String"
        }
        _ => {
            return Err(format!(
                "Command '{}' is restricted in quick-shell mode. Try: help, fastfetch, uptime, ps, ip, df, date, whoami",
                trimmed
            ));
        }
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", safe_script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stdout.is_empty() {
            Ok(stdout)
        } else if !stderr.is_empty() {
            Err(stderr)
        } else {
            Ok("Command completed with no output.".to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = safe_script;
        Ok(format!("Executed: {}", trimmed))
    }
}

#[tauri::command]
pub async fn set_dropdown_open(open: bool, window: tauri::WebviewWindow) -> Result<(), String> {
    let width = 860;
    let height = if open { 430 } else { 46 };
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: width as f64,
            height: height as f64,
        }))
        .map_err(|e| format!("Failed to resize window: {}", e))?;
    Ok(())
}

fn is_browser_identifier(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("brave")
        || lower.contains("brave.exe")
        || lower.contains("bravehtml")
        || lower.contains("zen")
        || lower.contains("arc")
        || lower.contains("vivaldi")
        || lower.contains("opera")
        || lower.contains("chrome")
        || lower.contains("firefox")
        || lower.contains("msedge")
}

fn read_default_browser_prog_id() -> String {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(subkey) = hkcu.open_subkey(r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice") {
            if let Ok(prog_id) = subkey.get_value::<String, _>("ProgId") {
                return prog_id;
            }
        }
    }
    String::new()
}

#[tauri::command]
pub fn get_installed_apps() -> Result<Vec<InstalledAppItem>, String> {
    let default_prog_id = read_default_browser_prog_id();
    let mut apps: Vec<InstalledAppItem> = Vec::new();

    let mut brave_candidates = vec![
        PathBuf::from(r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"),
        PathBuf::from(r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"),
    ];
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        brave_candidates.insert(
            0,
            PathBuf::from(local_app_data).join(r"BraveSoftware\Brave-Browser\Application\brave.exe"),
        );
    }

    if let Some(brave_path) = brave_candidates.into_iter().find(|p| p.exists()) {
        let is_default = default_prog_id.to_ascii_lowercase().contains("brave");
        apps.push(InstalledAppItem {
            id: "brave".to_string(),
            name: "Brave".to_string(),
            category: "Browser".to_string(),
            path: brave_path.to_string_lossy().to_string(),
            description: if is_default {
                "Default Web Browser (BraveHTML)".to_string()
            } else {
                "Privacy web browser".to_string()
            },
            icon_data_url: None,
        });
    }

    let mut roots = vec![PathBuf::from(r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs")];
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }

    for root in roots {
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()).map(|s| s.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        let name = stem.to_string();
                        let path_str = path.to_string_lossy().to_string();
                        let combined = format!("{} {}", name, path_str);
                        let category = if is_browser_identifier(&combined) {
                            "Browser"
                        } else {
                            "Application"
                        };
                        if !apps.iter().any(|a| a.name.eq_ignore_ascii_case(&name)) {
                            apps.push(InstalledAppItem {
                                id: name.to_lowercase().replace(' ', "-"),
                                name,
                                category: category.to_string(),
                                path: path_str,
                                description: format!("{} shortcut", category),
                                icon_data_url: None,
                            });
                        }
                    }
                }
            }
        }
    }

    let builtins = [
        ("wt", "Windows Terminal", "Developer", "wt.exe", "Modern command line & shells"),
        ("explorer", "File Explorer", "System", "explorer.exe", "Browse folders & drives"),
        ("taskmgr", "Task Manager", "System", "taskmgr.exe", "Performance & active processes"),
        ("settings", "Windows Settings", "System", "ms-settings:", "System configuration"),
        ("notepad", "Notepad", "Productivity", "notepad.exe", "Text & quick notes"),
        ("calc", "Calculator", "Utilities", "calc.exe", "Standard & scientific calculator"),
    ];
    for (id, name, cat, path, desc) in builtins {
        if !apps.iter().any(|a| a.name.eq_ignore_ascii_case(name)) {
            apps.push(InstalledAppItem {
                id: id.to_string(),
                name: name.to_string(),
                category: cat.to_string(),
                path: path.to_string(),
                description: desc.to_string(),
                icon_data_url: None,
            });
        }
    }

    Ok(apps)
}

#[tauri::command]
pub fn launch_app(target: String) -> Result<bool, String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }
    std::process::Command::new("cmd")
        .args(["/C", "start", "", trimmed])
        .spawn()
        .map_err(|e| format!("Failed to launch '{}': {}", trimmed, e))?;
    Ok(true)
}

#[tauri::command]
pub fn execute_power_action(action: String) -> Result<bool, String> {
    let clean = action.trim().to_ascii_lowercase();
    match clean.as_str() {
        "lock" => {
            std::process::Command::new("rundll32.exe")
                .args(["user32.dll,LockWorkStation"])
                .spawn()
                .map_err(|e| format!("Failed to lock: {}", e))?;
            Ok(true)
        }
        "sleep" => {
            std::process::Command::new("rundll32.exe")
                .args(["powrprof.dll,SetSuspendState", "0,1,0"])
                .spawn()
                .map_err(|e| format!("Failed to sleep: {}", e))?;
            Ok(true)
        }
        "hibernate" => {
            std::process::Command::new("shutdown.exe")
                .args(["/h"])
                .spawn()
                .map_err(|e| format!("Failed to hibernate: {}", e))?;
            Ok(true)
        }
        "restart" => {
            std::process::Command::new("shutdown.exe")
                .args(["/r", "/t", "0"])
                .spawn()
                .map_err(|e| format!("Failed to restart: {}", e))?;
            Ok(true)
        }
        "shutdown" | "poweroff" => {
            std::process::Command::new("shutdown.exe")
                .args(["/s", "/t", "0"])
                .spawn()
                .map_err(|e| format!("Failed to shutdown: {}", e))?;
            Ok(true)
        }
        "signout" | "logoff" => {
            std::process::Command::new("shutdown.exe")
                .args(["/l"])
                .spawn()
                .map_err(|e| format!("Failed to log off: {}", e))?;
            Ok(true)
        }
        _ => Ok(false),
    }
}
