# Canopy (`Caelestia-Win`)

**Canopy** is a dynamic wallpaper-adaptive Windows 11 desktop bar and expandable Bento command overlay inspired by Caelestia Hyprland. Built with a dual-host architecture (**C# / .NET 8 WPF + WebView2** native host and **Rust / Tauri** backend) paired with a **React 18 + TypeScript + Tailwind CSS + Vite** frontend.

---

## Key Features

### 1. Dynamic Wallpaper-Adaptive Theming
- Automatically samples dominant and accent palettes from the active Windows desktop wallpaper (`Services/WallpaperService.cs` & `src/services/palette.ts`).
- Supports **Auto**, **Dark**, and **Light** theme modes with smooth CSS custom property transitions.
- **Featured Wallpaper Showcase & Carousel** (`src/views/WallpaperView.tsx`) with instant wallpaper switching, custom directory scanning, and live color swatch previews.

### 2. Seven Navigation Tabs & Expandable Overlay Bar
- **Compact Pill Bar** docked at the top center of the primary display (`Win + \`` hotkey or top-edge hover trigger).
- **Dashboard (`src/App.tsx`)**: Unified Bento grid with quick profile/uptime summary, live media mini-player, radial system gauges, weather snapshot, interactive calendar, and self-contained vertical volume/mic/brightness capsule sliders (`src/components/VerticalSliders.tsx`).
- **Media (`src/views/MediaView.tsx`)**:
  - Windows SMTC live session integration (`Interop/SmtcMediaController.cs`) with album art, play/pause/skip, and timeline scrubbing.
  - Music-reactive radial spectrum visualizer, spinning vinyl platter, and Bongo Cat / custom uploaded GIF widget (`src/components/BongoCat.tsx`).
  - Interactive **`[ Lyrics ]`** toggle with live time-synced lyrics fetched from `lrclib.net`.
- **Performance (`src/views/PerformanceView.tsx`)**:
  - Concentric dual-arc gauges for **GPU**, **CPU**, and **Memory** load + temperature.
  - Real-time **Network Traffic** (`↓ Download` / `↑ Upload` throughput in KB/s & MB/s) sampled from active network adapters.
  - Expandable per-core CPU load drawer and top processes table.
- **Apps (`src/views/AppsView.tsx`)**:
  - Optional toggleable **`[ Apps ]`** tab scanning installed Windows applications & Start Menu shortcuts with search, category filtering, and one-click native launch.
- **Wallpaper (`src/views/WallpaperView.tsx`)**:
  - Hero active wallpaper showcase card + horizontal preview carousel.
- **Weather (`src/App.tsx` & `src/services/weather.ts`)**:
  - Live Open-Meteo integration with current conditions, daily Low–High range bar, 2×2 atmospheric card (**Feels Like**, **Humidity**, **Wind Speed**, **UV Index** with risk badge), and multi-day forecast.
- **Settings (`src/views/SettingsView.tsx`)**:
  - Centralized persistence for all preferences: temperature unit (`°C`/`°F`), clock format (`12H`/`24H`), brightness slider toggle, Apps tab toggle, custom mascot GIF URL/file upload, top-edge hover trigger, and Windows startup registration.

---

## Project Structure

```text
Canopy/
├── App.xaml / App.xaml.cs            # .NET 8 WPF application entry point
├── MainWindow.xaml / .cs             # Borderless WebView2 overlay window, Win32 hotkeys & IPC bridge
├── Caelestia-Win.csproj              # .NET 8 Windows project configuration
├── Interop/                          # Native Win32 P/Invoke, CoreAudio & Windows SMTC media controllers
├── Services/                         # SystemMonitorService (CPU/GPU/RAM/Net/Apps) & WallpaperService
├── Models/                           # Wallpaper metadata models
├── src/                              # React 18 + TypeScript + Tailwind CSS frontend
│   ├── components/                   # BongoCat, CalendarCard, RadialGauge, VerticalSliders
│   ├── context/                      # SettingsContext (persistent user configuration)
│   ├── services/                     # tauriBridge, weather (Open-Meteo), palette extractor
│   └── views/                        # MediaView, PerformanceView, AppsView, WallpaperView, SettingsView
├── src-tauri/                        # Rust / Tauri backend crate (system, media, audio, theme)
├── dist/                             # Pre-built Vite production frontend bundle
├── release/                          # Pre-built Canopy.exe & Canopy.dll native host binaries
└── Start Canopy.bat                  # Desktop launcher script
```

---

## Building & Running

### Frontend (`dist/`)
```bash
npm install
npm run build
```

### Native Host (`.NET 8 WebView2`)
```bash
dotnet publish -c Release -o "C:\Users\CEO\AppData\Local\Canopy"
```

### Launching
Run `Start Canopy.bat` or execute:
```bash
C:\Users\CEO\AppData\Local\Canopy\Canopy.exe --expand
```
