<p align="center">
  <img src="assets/banner.jpg" alt="Canopy — Drop-Down Info Center Banner" width="100%" />
</p>

<p align="center">
  <img src="assets/logo.jpg" alt="Canopy Logo" width="130" style="border-radius: 50%;" />
</p>

# Canopy

<div align="center">

[![Release](https://img.shields.io/github/v/release/canopy-shell/canopy?style=for-the-badge&color=8A2BE2)](https://github.com/canopy-shell/canopy/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows_11_%7C_10-0078D4?style=for-the-badge&logo=windows)](https://github.com/canopy-shell/canopy)
[![Runtime](https://img.shields.io/badge/.NET-8.0_WPF-512BD4?style=for-the-badge&logo=dotnet)](https://dotnet.microsoft.com/)
[![Frontend](https://img.shields.io/badge/React-18.3_%2B_Vite-61DAFB?style=for-the-badge&logo=react)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**Fluid Zero-Notch Top Hover Desktop Control Center & Wallpaper Switcher for Windows 11.**

*Inspired by Caelestia Shell (Wayland/Hyprland) and Hitodama.*

</div>

---

## Showcase

<div align="center">

```
             Top Edge of Screen (Y = 0)
+---------------------------------------------------+
|               [ Top Hover Zone ]                  |
+---------------------------------------------------+
                         |
                 (Move mouse to top)
                         v
   +---------------------------------------------+
   |  Canopy Floating Frosted Glass Control Hub  |
   |                                             |
   |  * Digital Clock & Weather Widget           |
   |  * Live CPU / RAM / GPU Hardware Gauges     |
   |  * Master Volume & Microphone Controls      |
   |  * 40-Band WASAPI Spectrum Visualizer       |
   |  * Synced Lyrics (LRCLIB Monotonic Clock)   |
   |  * Per-App Volume Mixer                     |
   |  * 6-Slot Quick Launch Dock                 |
   |  * Per-Monitor Wallpaper Carousel           |
   +---------------------------------------------+
```

> *Add `assets/demo.gif` or a video here demonstrating hover slide-down, media playback, and wallpaper switching.*

</div>

---

## Quick Install

### Option A: One-Line PowerShell Command (Recommended)

Open **PowerShell** and run:

```powershell
irm https://raw.githubusercontent.com/canopy-shell/canopy/main/install.ps1 | iex
```

* **No Administrator / UAC prompt required:** Installs per-user to `%LOCALAPPDATA%\Programs\Canopy`.
* Creates Start Menu and Desktop shortcuts.
* Automatically strips Windows SmartScreen marks (`Unblock-File`).

To cleanly uninstall:
```powershell
$env:CANOPY_UNINSTALL=1; irm https://raw.githubusercontent.com/canopy-shell/canopy/main/install.ps1 | iex
```

---

### Option B: Windows Package Manager (`winget`)

```cmd
winget install CanopyShell.Canopy
```

---

### Option C: Standalone Downloads

Grab the latest binaries directly from [**GitHub Releases**](https://github.com/canopy-shell/canopy/releases/latest):
* **`Canopy-v1.0.0-x64.msi`** (~8.2 MB): Native Windows Installer. Registers in *Settings $\to$ Installed Apps*.
* **`Canopy-v1.0.0-win-x64-portable.zip`** (~72 MB): Single-file self-contained executable. Unzip and run anywhere.

---

## Core Features

### 1. Zero-Notch & Zero Idle Footprint
When collapsed, Canopy occupies **0 visible pixels**. There is no island, notch, status bar, or overlay line on screen. The window is parked off-screen with `WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE` so standard desktop clicks, window dragging, and browser tabs work with zero interference.

### 2. 0% CPU Deep Sleep (WebView2 Suspension)
When the panel slides off-screen:
* The WebView2 Chromium engine is immediately suspended (`TrySuspendAsync()`).
* Real-time WASAPI loopback audio capture and 40-band FFT calculations pause.
* Per-app audio session enumeration and hardware telemetry timers sleep.
* **Idle resource usage drops to ~0% CPU (< 0.03s per 5s).**

### 3. VSync-Locked Motion & Anti-Aliased Glass
* Slides smoothly along the Y-axis using an ease-out cubic curve ($1 - (1-t)^3$) synced to your monitor's native refresh rate (60Hz, 120Hz, 144Hz, 240Hz+) via `CompositionTarget.Rendering`.
* Bottom corners curve at $24\text{px}$ using DWM GPU hardware alpha compositing without jagged GDI staircasing at any DPI scale.

### 4. Game & Presentation Suppression
* Automatically detects full-screen 3D games (DirectX / Vulkan) and presentation displays via `SHQueryUserNotificationState`.
* Analyzes foreground window bounds (`rcMonitor` vs `rcWork`) to suppress hover activation over borderless windowed games (DXGI Flip Model) and full-screen video players while keeping standard maximized windows interactive.
* Multi-monitor safe: ignores top boundaries shared with stacked upper monitors.

### 5. High-Resolution Audio Visualizer
* Real-time 40-band audio spectrum analyzer powered by NAudio WASAPI loopback capture and complex 512-point FFT.
* Calibrated $-80\text{ dB} \dots -10\text{ dB}$ logarithmic mapping with asymmetric temporal smoothing.
* Includes radial spoke visualizer, linear bars, and wave modes.

### 6. Synchronized Lyrics & Anchored Playhead
* Real-time synchronized lyrics fetched automatically from the **LRCLIB** database.
* Anchored monotonic playback clock resolves the frozen SMTC playhead bug in Chromium and Spotify.
* Adjustable lyric sync offset ($\pm 2000\text{ms}$) with auto-scrolling line highlighting.

### 7. Per-App Volume Mixer
* Integrated Windows Volume Mixer powered by CoreAudio COM interfaces (`IAudioSessionManager2`).
* Adjust volume or mute individual running applications (Discord, Spotify, games, browser tabs).

### 8. Visual Wallpaper Engine & Per-Monitor Carousel
* Asynchronously decodes wallpaper images from `%USERPROFILE%\Pictures\Wallpapers` into $160\text{px}$ cached thumbnails.
* Instant wallpaper switching via Win32 `SystemParametersInfo` with no-op deduplication to prevent screen flicker.
* Adaptive theming: extracts dominant colors from the current wallpaper and updates UI glass accent colors dynamically.
* Experimental per-monitor assignment and desktop slideshow support via `IDesktopWallpaper`.

---

## Default Controls & Hotkeys

| Action | Control / Hotkey | Description |
|---|---|---|
| **Toggle Panel** | `Win + ` ` | Slides the control center down or collapses it immediately. Configurable in Settings. |
| **Hover Summon** | Move mouse to top bezel edge | Dwell for 120ms at screen top ($Y \le 2\text{px}$) to slide down the panel. |
| **Auto-Hide** | Move mouse outside panel | Automatically slides off-screen after a 200ms debounce. |
| **Click Outside** | Left click desktop | Immediately collapses the panel without triggering background clicks. |
| **Pause Top Hover** | Right-click tray icon $\to$ `Top-Edge Hover: Active` | Temporarily disables the top-edge hover trigger. |
| **Quick Launcher** | Click dock icon or press slot key | Launches assigned applications or custom command paths. |
| **Command Palette** | Press any letter on Dashboard | Opens search overlay to switch tabs, launch apps, or execute power actions. |

---

## Building from Source

### Prerequisites
* Windows 10 (version 19041+) or Windows 11
* [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
* [Node.js 20+](https://nodejs.org/) & npm
* [WiX Toolset v4](https://wixtoolset.org/) (optional, for `.msi` packaging: `dotnet tool install --global wix --version 4.0.5`)

### Quick Build
```bash
# 1. Clone repository
git clone https://github.com/canopy-shell/canopy.git
cd canopy

# 2. Install frontend dependencies
npm ci

# 3. Build & run (Release mode)
dotnet build -c Release
dotnet run -c Release --no-build
```

### Packaging Installers Locally
```powershell
# Build native WiX v4 MSI installer (dist-installer/Canopy-v1.0.0-x64.msi)
.\installer\build-msi.ps1 -Version "1.0.0"

# Build portable self-contained ZIP (dist-installer/Canopy-v1.0.0-win-x64-portable.zip)
.\build-portable.ps1 -Version "1.0.0"
```

For release distribution instructions and CI/CD details, see [**`RELEASE_GUIDE.md`**](RELEASE_GUIDE.md).

For deep architectural and subsystem details, see [**`docs/ARCHITECTURE.md`**](docs/ARCHITECTURE.md).

---

## License

Distributed under the **MIT License**. See `LICENSE` for details.
