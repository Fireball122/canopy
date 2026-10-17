<p align="center">
  <img src="assets/banner.jpg" alt="Canopy Banner" width="100%" />
</p>

<p align="center">
  <img src="assets/logo.jpg" alt="Canopy Logo" width="110" style="border-radius: 50%;" />
</p>

<h1 align="center">Canopy</h1>

<p align="center">
  <strong>A clean, zero-notch desktop control center and wallpaper switcher for Windows 11.</strong><br>
  Slides down smoothly when you move your mouse to the top edge of your screen, then disappears completely when you don't need it.
</p>

<p align="center">
  <a href="https://github.com/Fireball122/canopy/releases/latest"><img src="https://img.shields.io/github/v/release/Fireball122/canopy?style=flat-square&color=8A2BE2" alt="Latest Release" /></a>
  <a href="https://github.com/Fireball122/canopy/releases"><img src="https://img.shields.io/badge/Platform-Windows_11_%7C_10-0078D4?style=flat-square&logo=windows" alt="Platform Windows" /></a>
  <a href="https://dotnet.microsoft.com/"><img src="https://img.shields.io/badge/.NET-8.0_WPF-512BD4?style=flat-square&logo=dotnet" alt=".NET 8" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/Frontend-React_18_%2B_Vite-61DAFB?style=flat-square&logo=react" alt="React 18" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Personal_Use_Only-orange?style=flat-square" alt="License" /></a>
</p>

---

## What is Canopy?

Canopy is an unobtrusive top-bar control hub inspired by clean Linux desktop setups (like Wayland, Hyprland, and Caelestia Shell). 

Instead of cluttering your desktop with widgets or pinned taskbars, Canopy stays completely invisible until you nudge the top edge of your monitor or press a keyboard shortcut (`Win + ` `). 

When summoned, it glides down with an anti-aliased frosted glass panel containing your media controls, synchronized lyrics, audio visualizer, hardware telemetry, quick launcher, and wallpaper manager.

<p align="center">
  <video src="https://github.com/Fireball122/canopy/releases/download/v1.0.2/test.mp4" controls="controls" muted="muted" width="100%">
    Your browser does not support the video tag.
  </video>
</p>

---

## Download & Install

### Method 1: Windows Setup Wizard (Recommended)
Download the latest Windows setup wizard from [**Releases**](https://github.com/Fireball122/canopy/releases/latest):
* **`Canopy-v1.0.4-Setup.exe`**: Official branded setup wizard. Checks for dependencies (WebView2), configures desktop & startup auto-run options, and installs without requiring administrator privileges.
* **`Canopy-v1.0.4-x64.msi`**: Enterprise Windows Installer (MSI) package for automated network deployments and silent upgrades.

### Method 2: Portable ZIP
Grab **`Canopy-v1.0.4-win-x64-portable.zip`** from [**Releases**](https://github.com/Fireball122/canopy/releases/latest). Unzip it anywhere and double-click `Start Canopy.bat` or `Canopy.exe`. Zero registry changes required.
### Method 3: One-Line PowerShell
Run this in PowerShell (no admin privileges required; installs cleanly to `%LOCALAPPDATA%\Programs\Canopy`):

```powershell
irm https://raw.githubusercontent.com/Fireball122/canopy/main/install.ps1 | iex
```

To uninstall via PowerShell:
```powershell
$env:CANOPY_UNINSTALL=1; irm https://raw.githubusercontent.com/Fireball122/canopy/main/install.ps1 | iex
```

---

## Key Features

* **Zero Idle CPU (Deep Sleep)**: When closed, the underlying WebView2 browser engine and audio capture threads suspend immediately. Background CPU usage stays at virtually 0.0%.
* **Zero Notch / No Dead Zones**: When collapsed, Canopy takes up 0 pixels on screen. Clicking the top of open browser tabs, game windows, or title bars works naturally.
* **Full-Screen Game & Presentation Immunity**: Automatically detects when a full-screen game (DirectX / Vulkan) or video player is running and suppresses the hover trigger so your gameplay is never interrupted.
* **Music Player with Synced Lyrics**: Real-time media playback display powered by Windows Media Transport (SMTC) with synchronized line-by-line lyrics fetched via LRCLIB and monotonic timekeeping.
* **WASAPI Audio Visualizer**: 40-band multi-endpoint loopback audio spectrum analyzer featuring radial spoke, linear bars, and wave visualization modes.
* **Per-App Volume Mixer**: Control or mute individual audio streams (Discord, Spotify, games, browser) directly from the panel.
* **Wallpaper Engine & Adaptive Theming**: Browse your wallpaper folder, set desktop wallpapers with an iris-wipe animation, and watch Canopy automatically extract dominant color palettes to tint its frosted glass accents.
* **Interactive Mascot**: Includes Capi the animated companion with music-reactive dancing and support for custom GIF uploads and URLs.
* **Quick Launch Dock & Search**: 6 customizable dock slots for your favorite applications, plus a built-in search palette.
* **Locked Aspect Ratio Scaling**: Adjust the UI size from 75% to 135% via a single slider in Settings while keeping the clean 850x430 aspect ratio intact.

---

## Default Controls & Shortcuts

| Action | How to Trigger |
| :--- | :--- |
| **Open / Close Panel** | `Win + ` ` *(configurable in Settings)* |
| **Hover Summon** | Move your mouse to the top center edge of the screen and pause for ~120ms |
| **Auto-Collapse** | Move your mouse outside the panel or click anywhere on your desktop |
| **Quick Search** | Start typing any letter while on the Dashboard tab |
| **Disable Hover** | Right-click the system tray icon and uncheck `Top-Edge Hover: Active` |
| **Open Settings** | Click the gear icon in the top right or select Settings from the tray |

---

## Building from Source

If you want to build Canopy yourself or tweak the code:

### Requirements
* Windows 10 (version 19041+) or Windows 11
* [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
* [Node.js 20+](https://nodejs.org/) & npm

### Build Steps

1. **Clone the repo:**
   ```bash
   git clone https://github.com/Fireball122/canopy.git
   cd canopy
   ```

2. **Install frontend dependencies & build bundle:**
   ```bash
   npm ci
   npm run build
   ```

3. **Compile and run the native .NET host:**
   ```bash
   dotnet build -c Release
   dotnet run -c Release --no-build
   ```

4. **Package local installer (optional):**
   ```powershell
   # Builds dist-installer/Canopy-v1.0.4-Setup.exe (requires Inno Setup 6)
   .\installer\build-setup-exe.ps1
   ```
---

## Architecture Overview

Canopy uses a lightweight hybrid architecture:
* **Native Backend (.NET 8 WPF / C#)**: Handles Win32 window management, mouse hover detection hooks, CoreAudio / WASAPI audio capture, Windows SMTC media transport, hardware telemetry, and DWM composition.
* **Frontend UI (React 18 + Vite + Tailwind CSS)**: Renders the frosted glass interface inside a hardware-accelerated Microsoft WebView2 runtime with strict types and zero external network tracking.

For more technical details, check out [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Contributing & Feedback

Bug reports, feature requests, and pull requests are always welcome! Feel free to open an issue on GitHub.

## License & Terms of Use

Canopy is provided for **personal, non-commercial use**:

* **Personal Use**: You are free to download, run, inspect, and modify the source code for your own personal, private, and non-commercial purposes.
* **Commercial Restrictions**: Commercial distribution, monetization, selling, or business use of this software or derivative works is strictly prohibited.
* **Redistribution**: Public mirroring or re-hosting (e.g. binary releases, app stores, or third-party mirrors) requires prior written consent from the author.
* **Proprietary Assets**: All project logos, character mascots, and UI artwork are proprietary and copyright &copy; 2026 3Dinfinity8. All rights reserved.

See the [LICENSE](LICENSE) file for the full terms and contact information.
