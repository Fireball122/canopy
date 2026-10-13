# Canopy (`Caelestia-Win`)

**Canopy** is a dynamic wallpaper-adaptive Windows 11 desktop bar and expandable Bento command overlay inspired by Caelestia Hyprland. Built with a dual-host architecture (**C# / .NET 8 WPF + WebView2** native host and **Rust / Tauri** backend) paired with a **React 18 + TypeScript + Tailwind CSS + Vite** frontend.

---

## Key Features & Latest Architectural Upgrades

### 1. Dual-Monitor Independent Circular Expand (Iris Wipe) Transitions
- When applying a wallpaper, transitions reveal via a smooth centered circular expand (iris wipe) per monitor rather than a crossfade or unified stretch across multi-monitor setups.
- Hardware-accelerated animation rendered independently on each display with smooth easing (200–300ms).

### 2. Bundled Wallpapers Library (`Wallpapers/`)
- Includes 35 curated high-resolution wallpapers (4K & ultrawide) synced directly from the desktop collection.
- Seamlessly scanned by the Wallpaper Carousel and Hero Showcase Card.

### 3. Media Tab Overhaul, Jellyfin Live Timeline & Lyrics
- Fixed timeline tracking for Jellyfin, Spotify, and YouTube: accurate live progress (`current_time` / `duration`) and scrubbing.
- Automatic time-synced lyrics fetching via LRCLIB (`https://lrclib.net`) with smooth auto-scroll.
- Music-reactive radial frequency visualizer with dancing vinyl animation and animated Bongo Cat mascot (or "No GIF" mode in Settings).

### 4. Zero-Margin Seamless Window Framing & Matching Radii
- Window and canvas bounds set to exact `850 × 430px`, eliminating the transparent outer perimeter border and ghost shadow.
- Uniform border radii and matched corner styling across outer container and inner Bento cards.

### 5. Dynamic Theme Palette with WCAG Mathematical Contrast Engine
- Automatically samples dominant and accent palettes from the active Windows desktop wallpaper (`Services/WallpaperService.cs` & `src/services/palette.ts`).
- W3C luminance and mathematical contrast ratio calculations guarantee minimum 4.5:1 text-to-background contrast.
- Fully dynamic theme color cascading: Vertical sliders (Volume, Microphone, Brightness), icons, glow rings, and active indicators update instantly upon wallpaper rotation.

### 6. Performance Telemetry & Windows App Launcher
- Concentric dual-arc gauges for GPU, CPU, and RAM load/temperature.
- Live **Network Traffic** (real-time download and upload throughput in KB/s & MB/s).
- Expandable CPU per-core utilization drawer and top process resource monitor.
- System-wide Start Menu application scanner with native shortcut icon extraction.

---

## Project Structure

```text
Canopy/
├── App.xaml / App.xaml.cs            # .NET 8 WPF application entry point
├── MainWindow.xaml / .cs             # Borderless WebView2 overlay window, Win32 hotkeys & IPC bridge
├── Caelestia-Win.csproj              # .NET 8 Windows project configuration
├── Interop/                          # Native Win32 P/Invoke, CoreAudio & Windows SMTC media controllers
├── Services/                         # SystemMonitorService, WallpaperService (Iris Wipe)
├── Models/                           # Wallpaper metadata models
├── Wallpapers/                       # Bundled collection of 35 high-res desktop wallpapers
├── src/                              # React 18 + TypeScript + Tailwind CSS frontend
├── src-tauri/                        # Rust / Tauri backend crate
├── dist/                             # Pre-built Vite production frontend bundle
├── release/                          # Pre-built Canopy.exe & Canopy.dll native host binaries
└── Start Canopy.bat                  # Desktop launcher script
```

---

## Building & Running

### Frontend
```bash
npm install
npm run build
```

### Native Host (.NET 8 WPF)
```bash
dotnet publish -c Release -o "C:\Users\CEO\AppData\Local\Canopy"
```

### Desktop Launcher
Execute `Start Canopy.bat` on your Desktop or run:
```bash
"C:\Users\CEO\AppData\Local\Canopy\Canopy.exe" --expand
```
