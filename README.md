<p align="center">
  <img src="assets/banner.jpg" alt="Canopy Drop-Down Info Center Banner" width="100%" />
</p>

<p align="center">
  <img src="assets/logo.jpg" alt="Canopy Mascot Logo" width="140" style="border-radius: 50%;" />
</p>

<h1 align="center">🌿 Canopy — Drop-Down Info Center</h1>

<p align="center">
  <b>A dynamic wallpaper-adaptive Windows 11 desktop bar and expandable Bento command center.</b><br/>
  Featuring real-time hardware telemetry, live WASAPI audio spectrum, time-synced lyrics, SMTC playback control, wallpaper transitions, Start Menu app launcher, power controls, and an animated Capi mascot.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/.NET-8.0%20WPF%20%2B%20WebView2-512BD4?logo=dotnet&logoColor=white" alt=".NET 8" />
  <img src="https://img.shields.io/badge/Rust-Tauri%20v2-orange?logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/React-18%20%2B%20TypeScript-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Tailwind-CSS%203-38B2AC?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Platform-Windows%2011-0078D6?logo=windows&logoColor=white" alt="Windows 11" />
</p>

---

## 🌟 Major Features & Architecture

### 1. 🎨 Dynamic Wallpaper-Adaptive Theming (WCAG Contrast Engine)
- **Automatic Palette Extraction:** Continuously samples vibrant accent and dominant background colors from active wallpapers (`Services/WallpaperService.cs` & `src/services/palette.ts`).
- **Mathematical WCAG Ratio:** Enforces a minimum **4.5:1 text-to-background contrast ratio** using W3C luminance formulas across Dark, Light, and Auto modes.
- **Dynamic CSS Cascading:** All capsule sliders, glow rings, radial gauges, and icons update dynamically upon wallpaper rotation without static hardcoded tints.

### 2. 🖥️ Multi-Monitor Independent Circular Expand (Iris Wipe)
- Smooth hardware-accelerated **Iris Wipe (centered circular expand)** transitions rendered independently per display on dual- or multi-monitor setups.
- Supported by native Windows COM `IDesktopWallpaper` (`Interop/DesktopWallpaper.cs`) with per-monitor assignment and timed rotation.

### 3. 🎵 High-Fidelity Audio Spectrum & Synchronized Media
- **Real Logarithmic dB Visualizer:** WASAPI loopback audio spectrum capture with real decibel scaling ($-80\text{ dB} \dots -10\text{ dB}$) and attack/decay smoothing. Zero-level baseline in silence; zero artificial sine waves.
- **Anchored Playhead & Unified Monotonic Clock (`usePlaybackClock.ts`):** Eliminates SMTC drift across Chromium, Brave, YouTube, and Jellyfin streams, maintaining $<0.11\text{ s}$ accuracy.
- **Interactive Inline LRCLIB Lyrics:** Click `[ Lyrics ]` to crossfade transport controls into auto-scrolling synced lyrics with custom timing offset adjustment (`-2000ms` to `+2000ms`).
- **Per-App Volume Mixer:** Integrated `AudioSessionController.cs` for individual volume control of active Windows audio sessions.

### 4. 🚀 Zero-Margin Dropdown Shell & Low-Power Park
- **True Cubic Ease-Out Slide:** Smooth $Y$-axis sliding transition on top-edge hover or `Win + \`` global hotkey.
- **WebView2 Low-Power Suspension:** Suspends WebView2 rendering (`TrySuspendAsync`) while collapsed, delivering a **~26× CPU reduction (0.063s vs 1.62s)** while parked.
- **Fullscreen & Quiet Hours Suppression:** Automatically pauses hover drop-down triggers while playing fullscreen games or presentations.

### 5. 🍄 Capi Mascot & Interactive Bento Tabs
- **Dashboard (`src/App.tsx`):** Profile snapshot, uptime counter, media mini-card, vertical capsule sliders (Volume, Microphone, Brightness), 6-slot customizable Quick Launch dock, and animated Capi mascot.
- **Media (`src/views/MediaView.tsx`):** SMTC media player with dancing vinyl platter, radial visualizer spokes, and lyrics toggle.
- **Performance (`src/views/PerformanceView.tsx`):** Dual-arc concentric gauges for GPU, CPU, and RAM, plus real-time download and upload network throughput (KB/s & MB/s).
- **Apps (`src/views/AppsView.tsx`):** Fast Windows Start Menu application scanner with native shortcut icon extraction.
- **Wallpaper (`src/views/WallpaperView.tsx`):** Hero active preview card with 16:9 thumbnail gallery and 35 bundled high-res wallpapers (`Wallpapers/`).
- **Power (`src/views/PowerView.tsx`):** Themed sleep, restart, lock, and shutdown controls.
- **Settings (`src/views/SettingsView.tsx`):** Granular configuration with JSON backup export & import.

---

## 📁 Repository Structure

```text
Canopy/
├── assets/
│   ├── banner.jpg                    # Official Canopy Drop-Down Info Center Banner
│   ├── github logo.jpg               # Hero Banner (High-Res)
│   └── logo.jpg                      # Mascot Logo (Circular Avatar)
├── Wallpapers/                       # Bundled collection of 35 curated 4K & Ultrawide wallpapers
├── App.xaml / App.xaml.cs            # .NET 8 WPF application entry point
├── MainWindow.xaml / .cs             # Borderless WebView2 overlay window & Win32 IPC bridge
├── Canopy.csproj                     # .NET 8 Windows WPF project configuration
├── Interop/
│   ├── AudioController.cs            # Real WASAPI loopback audio spectrum capture
│   ├── AudioSessionController.cs     # Per-application audio session volume mixer
│   ├── DesktopWallpaper.cs           # Native Windows IDesktopWallpaper COM controller
│   ├── SmtcMediaController.cs        # Windows SMTC session manager & key event fallbacks
│   └── Win32.cs                      # Win32 API interop (Hotkeys, DWM, window bounds)
├── Services/
│   ├── DiagnosticsLog.cs             # Auto-rotating diagnostics logger
│   ├── SystemMonitorService.cs       # Hardware telemetry (CPU/GPU/RAM/Network/Apps)
│   └── WallpaperService.cs           # Wallpaper scanner & Iris Wipe transition engine
├── src/                              # React 18 + TypeScript + Tailwind CSS frontend
│   ├── components/                   # CalendarCard, CanopyMascot, RadialGauge, VerticalSliders
│   ├── hooks/                        # usePlaybackClock (monotonic SMTC clock), usePanelOpen
│   ├── services/                     # tauriBridge, palette (WCAG engine), weather (Open-Meteo)
│   └── views/                        # MediaView, PerformanceView, AppsView, WallpaperView, PowerView, SettingsView
├── src-tauri/                        # Rust / Tauri backend crate
├── dist/                             # Pre-built Vite production frontend bundle
├── release/                          # Pre-built Canopy.exe & Canopy.dll native host binaries
└── Start Canopy.bat                  # Desktop launcher script
```

---

## 🛠️ Building & Running

### Frontend
```bash
npm install
npm run build
```

### Native Host (.NET 8 WPF)
```bash
dotnet publish -c Release -o "%LOCALAPPDATA%\Canopy"
```

### Launching
Run `Start Canopy.bat` on your Desktop or execute:
```bash
"%LOCALAPPDATA%\Canopy\Canopy.exe" --expand
```
