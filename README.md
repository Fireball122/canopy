# Canopy (`Caelestia-Win`)

**Canopy** is a dynamic wallpaper-adaptive Windows 11 desktop bar and expandable Bento command overlay inspired by Caelestia Hyprland. Built with a dual-host architecture (**C# / .NET 8 WPF + WebView2** native host and **Rust / Tauri** backend) paired with a **React 18 + TypeScript + Tailwind CSS + Vite** frontend.

---

## Latest Upgrades & Architectural Refinements

### 1. Zero-Margin Seamless Window Framing
- Aligned the WPF window bounds (`MainWindow.xaml`) and CSS `.canopy-shell` to an exact **850 × 430px** footprint.
- Eliminated Windows 11 DWM non-client glass border dead zones and removed ghost drop shadows for a razor-sharp, seamless overlay.
- Cursor hit-testing precisely bounds the visible card with 0px perimeter dead-zones.

### 2. Wallpaper-Adaptive Theming with WCAG Mathematical Contrast Engine
- Automatic palette extraction from active Windows wallpapers (`Services/WallpaperService.cs` & `src/services/palette.ts`).
- W3C luminance and mathematical contrast ratio calculations guarantee minimum 4.5:1 text-to-background contrast across dark, light, and auto modes.
- Fully dynamic theme color cascading: Vertical sliders (Volume, Microphone, Brightness), icons, glow rings, and active indicators update instantly upon wallpaper rotation.

### 3. Media Controls, Live LRCLIB Lyrics & WASAPI Audio Spectrum
- Real-time Windows SMTC session tracking with fallback to native virtual media keys (`VK_MEDIA_*`) for Chromium/Brave browsers.
- **Interactive Inline Lyrics:** Seamless crossfade toggle between media controls and time-synced lyrics queried live from `lrclib.net`.
- **True WASAPI Audio Visualizer:** High-fidelity audio spectrum frequency analysis responding dynamically to live system audio output.
- **Custom Mascot Widget:** Support for animated Bongo Cat or custom user-uploaded animated GIF mascots.

### 4. Performance & Telemetry Dashboard
- Concentric dual-arc gauges for GPU, CPU, and RAM load/temperature.
- Live **Network Traffic** (real-time download and upload throughput in KB/s & MB/s).
- Expandable CPU per-core utilization drawer and top process resource monitor.

### 5. Windows Apps & Browser Launcher
- System-wide scanning of both `%ProgramData%` and `%AppData%` Start Menu trees.
- Native application icon extraction and auto-detection of default browsers (Brave, Chrome, Firefox, Edge, Zen, Arc, Vivaldi).

### 6. Minimalist Wallpaper Showcase & Gallery
- Hero showcase card displaying the active wallpaper with live theme swatch preview.
- Clean 16:9 thumbnail gallery with smooth hover zoom effects and instant wallpaper application.

### 7. Interactive Calendar & Time Selector Modal
- Repositioned notification badges that cleanly align inside date selection rings.
- Dedicated interactive time selector popover with 12-hour scrolling, minute selector, and AM/PM toggle.

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
