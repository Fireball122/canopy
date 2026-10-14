# Canopy — Architecture, Subsystems & Distribution Specification

---

## 1. Executive Summary & Design Philosophy

**Canopy** is an open-source, lightweight Windows 11 desktop overlay application inspired by **Caelestia Shell** (Wayland / Hyprland) and **Hitodama**. It functions as a top-drop control panel that unifies hardware telemetry, media playback, real-time audio visualization, synchronized lyrics, a per-app volume mixer, a customizable app dock, and a visual wallpaper switcher.

```
       Screen Top Edge (Y = 0) [3440px wide display]
+-------------------------------------------------------------+
|        [ Bezel Hover Catch Zone: Y <= Top + 2px, 120ms ]    |
+-------------------------------------------------------------+
                              |
              (Cursor dwells at top bezel edge)
                              v
             +----------------------------------+
             |       Canopy Control Center      |
             |  [850px × 430px Floating Card]   |
             |                                  |
             |  * Digital Clock & Weather       |
             |  * CPU / RAM / GPU Telemetry     |
             |  * Master & Mic Volume Deck      |
             |  * Music Transport & Visualizer  |
             |  * Synced Lyrics (LRCLIB)        |
             |  * Quick Launch Dock (6 Slots)   |
             |  * Visual Wallpaper Switcher     |
             +----------------------------------+
```

### Core Tenets
1. **Zero-Notch / Zero Visible Idle Footprint:** When collapsed, Canopy occupies 0 visible pixels. There is no island, notch, status bar, or overlay line on screen.
2. **True Click-Through:** When closed, the window is translated off-screen (`Y = -530px`) and configured with `WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`. It never intercepts mouse clicks, obscures browser tabs, or interferes with games.
3. **Zero Idle Resource Drain:** When parked off-screen, the embedded Chromium engine (`CoreWebView2`) is suspended via `TrySuspendAsync()`, hidden (`Visibility = Collapsed`), and background WASAPI loopback capture, audio session enumerators, and hardware telemetry timers are paused, dropping CPU consumption down to **0.03s per 5s (~1% idle throttle)**.
4. **Game & Meeting Immunity:** Full-screen games (DirectX / Vulkan / DXGI Flip Model borderless) and presentation sessions are detected via the Windows Shell Notification API (`SHQueryUserNotificationState`) and foreground window bounds analysis (`rcMonitor` vs `rcWork`), automatically suppressing the hover trigger so the overlay never drops during gameplay or video playback.

---

## 2. Technical Stack & Dual-Layer Architecture

```mermaid
graph TD
    subgraph Host ["Native Windows Host (.NET 8.0 WPF)"]
        MW[MainWindow.xaml.cs\nWindowing, VSync Slide, IPC Switch]
        W32[Interop/Win32.cs\nP/Invoke & DWM API]
        AC[Interop/AudioController.cs\nWASAPI Loopback & 40-Band FFT]
        ASC[Interop/AudioSessionController.cs\nIAudioSessionManager2 Per-App Mixer]
        SMTC[Interop/SmtcMediaController.cs\nWindows Media Transport]
        WS[Services/WallpaperService.cs\nAsync Cache & Iris Reveal]
        DW[Interop/DesktopWallpaper.cs\nIDesktopWallpaper COM Engine]
        SMS[Services/SystemMonitorService.cs\nHardware Telemetry & App Launcher]
        LOG[Services/DiagnosticsLog.cs\nProcess-Wide Log Ring]
    end

    subgraph Bridge ["Chromium IPC Bridge"]
        WV2[Microsoft.Web.WebView2\nVirtual Host: https://canopy.local]
        RPC[window.chrome.webview.postMessage\nJSON-RPC: {id, cmd, args}]
        EVT[EmitFrontendEvent\nCustomEvent Dispatcher (Gated)]
    end

    subgraph Frontend ["UI Shell (React 18 + Vite + Tailwind CSS)"]
        APP[src/App.tsx\nDashboard, Hotkeys, Command Palette]
        HOOKS[src/hooks/\nusePlaybackClock, usePanelOpen]
        CTX[src/context/SettingsContext.tsx\nCanopySettings State & Host Sync]
        VIEWS[src/views/\nMedia, Settings, Wallpaper, Apps, Power, Performance]
        HB[src/services/hostBridge.ts\nTyped RPC Client]
    end

    MW <--> WV2
    WV2 <--> RPC
    WV2 <--> EVT
    RPC <--> HB
    EVT <--> APP
    HB <--> APP
    HB <--> VIEWS
```

* **Target Runtime:** .NET 8.0 Windows Desktop (`net8.0-windows10.0.19041.0`)
* **Window Subsystem:** Windows Presentation Foundation (WPF) with `WindowChrome`
* **Web Runtime:** Evergreen Microsoft Edge WebView2 (`Microsoft.Web.WebView2 1.0.2903.40`)
* **Frontend Framework:** React 18.3.1, TypeScript 5.6.3, Vite 5.4.10, Tailwind CSS 3.4.14
* **Audio Interop:** NAudio 2.2.1 + Windows CoreAudio COM Interfaces (`IMMDeviceEnumerator`, `IAudioEndpointVolume`, `IAudioSessionManager2`)

---

## 3. Deep Dive: Core Subsystems

### 3.1. Windowing, GPU Alpha Clipping & VSync-Locked Motion
* **Window Metrics:** Width = `850px`, Height = `430px`, `WindowStyle="None"`, `AllowsTransparency="False"`, `Background="{x:Null}"`.
* **Extended Glass Frame:** Uses `WindowChrome` with `GlassFrameThickness="-1"` to extend the DWM composition frame across the entire HWND, allowing per-pixel transparency through WebView2's transparent background without the performance penalty of WPF's software-rendered `AllowsTransparency="True"`.
* **GPU-Composited Corner Clipping:** Rather than applying jagged GDI `SetWindowRgn` masks that break subpixel smoothing, Canopy relies on DWM hardware alpha composition. The root web container in `src/App.tsx` and `src/index.css` enforces `border-radius: 0 0 24px 24px; overflow: hidden;` with transparent `html, body` backgrounds, giving perfectly anti-aliased rounded bottom corners at all DPI scales.
* **VSync-Locked Physical Pixel Slide:** When summoned, `SlideTo()` drives animation frames via `CompositionTarget.Rendering`, firing on every display refresh cycle (60Hz, 120Hz, 144Hz, 240Hz, 360Hz). Physical positions are computed and applied directly with native Win32 `SetWindowPos(SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)`:
  $$t = \text{clamp}\left(\frac{\Delta t}{\text{duration}}, 0, 1\right), \quad \text{eased} = 1 - (1 - t)^3$$
  $$Y_{\text{physical}} = Y_{\text{start}} + (Y_{\text{target}} - Y_{\text{start}}) \times \text{eased}$$
  This bypasses WPF layout/measure passes and eliminates subpixel rounding jitter during motion. Windows accessibility setting `SPI_GETCLIENTAREAANIMATION` is strictly honored for instant snapping when animations are turned off.

### 3.2. Top-Edge Catch Zone, Auto-Hide & Game Suppression
* **Bezel-Only Catch Zone (Collapsed):** To prevent collisions with maximized browser tab strips, the collapsed detection band is restricted to the top bezel edge ($Y \le \text{rcMonitor.Top} + 2\text{px}$) with a required $\approx 120\text{ms}$ dwell time.
* **Stacked-Monitor Safety:** Evaluates `MonitorFromPoint(POINT { X = cursor.X, Y = monitor.Top - 2 }, MONITOR_DEFAULTTONULL)`. If an upper display is stacked above, the top edge represents an internal screen boundary rather than a bezel, suppressing accidental triggers.
* **Expanded Hover Rectangle:** When expanded, hover bounds cover the entire floating card rectangle (plus a margin) so the panel remains open while interacting with sliders and controls.
* **Auto-Hide Debounce:** Leaving the panel starts a $200\text{ms}$ debounce timer (`_hideDebounceTimer`). If the cursor does not re-enter, `CollapsePanel()` initiates the slide-out animation.
* **Borderless Game & Video Suppression:** `ShouldSuppressTrigger()` queries `SHQueryUserNotificationState`:
  * `QUNS_RUNNING_D3D_FULL_SCREEN` ($3$): Exclusive Direct3D full-screen game.
  * `QUNS_PRESENTATION_MODE` ($4$): Presentation mode active.
  * `QUNS_BUSY` ($2$): Verified against `GetWindowRect(fgHwnd)` vs. `rcMonitor` vs. `rcWork`.
  * **Direct Foreground Window Bounds Check:** If the foreground window covers the entire `rcMonitor` (such as borderless DXGI Flip Model games, VLC, or full-screen browser video), the trigger is suppressed. Standard maximized windows that only fill `rcWork` do not suppress the trigger.

### 3.3. Idle Resource Hardening & Gated IPC
* **WebView2 Suspension:** Upon collapse completion, `ShellWebView.Visibility = Visibility.Collapsed` is set, followed by a $100\text{ms}$ delay before `TrySuspendAsync()` is awaited.
* **Gated IPC:** While collapsed or suspending, `EmitFrontendEvent` drops non-lifecycle events (volume, battery, mic telemetry) to ensure no IPC message wakes the suspended renderer.
* **Paused Polling:** Background WASAPI loopback capture (`AudioController.PauseCapture()`), per-app session enumeration (`AudioSessionController.Pause()`), and telemetry timers (`SystemMonitorService.Pause()`) are stopped immediately on collapse and resumed on expansion.

### 3.4. System Tray Notification Icon (Hidden Icons)
* **Dismissal on Click-Out:** Built using native `Shell_NotifyIconW`. To fix the classic Win32 tray bug where popup menus do not dismiss on outside clicks:
  1. `ShowTrayContextMenu()` strips `WS_EX_NOACTIVATE` from the HWND.
  2. Brings the window to the foreground with `Win32.SetForegroundWindow(_hwnd)`.
  3. Displays `ContextMenu` anchored to `PlacementMode.MousePoint` with `StaysOpen = false`.
  4. On `menu.Closed`, restores `WS_EX_NOACTIVATE` / click-through and posts `WM_NULL` to the message pump per MSDN guidelines.
* **Hover Dropdown Toggle:** The tray context menu includes a checkable item:
  * `[✓] Top-Edge Hover: Active (Click to Pause)`
  * Toggling it disables `_topHoverTriggerEnabled`, collapses the panel, and emits `top-hover-trigger-changed` to keep the React settings interface synchronized.

### 3.5. Audio Spectrum & Real-Time FFT Engine
* **WASAPI Loopback Capture:** Captures output audio directly from the default render endpoint (`WasapiLoopbackCapture`) without virtual audio cables.
* **FFT Calibration:**
  1. Samples 512 points at $48\text{ kHz}$ downsampled through a Hann window:
     $$w(i) = 0.5 \times \left(1 - \cos\left(\frac{2\pi i}{N - 1}\right)\right)$$
  2. Executes forward complex FFT via `FastFourierTransform.FFT`.
  3. Maps 256 unique output bins logarithmically across 40 frequency bands.
  4. Converts peak band magnitudes to decibels ($20 \cdot \log_{10}$) mapped over a calibrated dynamic range of $-80\text{ dB} \dots -10\text{ dB} \to 0.0 \dots 1.0$.
  5. Applies asymmetric temporal smoothing (fast attack $\alpha = 0.65$, slow decay $\beta = 0.28$).
* **Reactive Visualization:** Feeds the `RadialGauge` 40-spoke circular visualizer, linear audio bars, and harmonic wave modes.

### 3.6. Per-App Volume Mixer (`AudioSessionController`)
* Uses native COM interfaces (`IMMDeviceEnumerator`, `IAudioSessionManager2`, `IAudioSessionEnumerator`, `IAudioSessionControl2`, `ISimpleAudioVolume`).
* Enumerates all running Windows audio sessions (Spotify, Discord, browser, games).
* Resolves process names from session PIDs (`FileVersionInfo.FileDescription`).
* Provides individual volume sliders and mute toggles per application in the Media view.

### 3.7. Media Synchronization & Synced Lyrics Engine
* **The Frozen Playhead Problem:** Windows SMTC often publishes a track's `position_secs` once on track start (e.g., $0.019\text{s}$) and never updates it again during playback in apps like Brave/Chromium.
* **Anchored Playhead Resolution:**
  1. `SmtcMediaController.cs` tracks `PositionAnchorAgeSecs` and `PlaybackRate`.
  2. The host computes $\text{AnchorPosition} = \text{pos} + (\text{age} \times \text{rate})$, freezing time whenever playback is paused.
  3. `usePlaybackClock.ts` maintains a shared high-resolution clock advanced by `performance.now()` deltas and resyncs whenever the host value drifts by $>0.75\text{s}$.
  4. **Drift was reduced from $>500\text{s}$ to $<0.11\text{s}$.**
* **Synced Lyrics Display:** Fetches time-synced `.lrc` lyrics from the **LRCLIB** database (with built-in offline fallbacks). Evaluates the active line using $\text{clampedPosition} - (\text{lyricOffsetMs} / 1000)$. Advances lines using the `canopyLyricRise` CSS transition and auto-scrolls the view smoothly.

### 3.8. Wallpaper Switcher & Experimental Per-Monitor Engine
* **High-Performance Carousel:** Decodes images asynchronously into small $160\text{px}$ in-memory thumbnails with SHA-based disk caching in `%LOCALAPPDATA%\Canopy\thumbnails`.
* **Flicker-Free Desktop Apply:** Employs `SystemParametersInfo(SPI_SETDESKWALLPAPER)` with a path normalization check (`IsSameFile`) to prevent desktop reload flicker when re-clicking the active wallpaper.
* **Per-Monitor Wallpaper & Slideshow (Experimental):**
  * Interops with the Windows 8+ `IDesktopWallpaper` COM interface (`DesktopWallpaper.cs`).
  * Enables independent wallpaper assignment per connected monitor ID (`\\?\DISPLAY#...`).
  * Configures native Windows desktop slideshows with custom intervals ($5 \dots 1440\text{ min}$) and random shuffle.
  * When disabled, `StopSlideShow()` pins each monitor to its current image.

---

## 4. Packaging, Distribution & Deployment Architecture

```
                         GitHub Repository Root
                                   |
         +-------------------------+-------------------------+
         |                         |                         |
         v                         v                         v
   One-Line Install           Native Installer          GitHub Actions
    (install.ps1)            (WiX Toolset v4)        (.github/workflows)
         |                         |                         |
         v                         v                         v
%LOCALAPPDATA%\Programs    Canopy-v1.0.0-x64.msi     Automated Releases
 (No UAC / Admin needed)   (Desktop/Start Shortcuts)  (MSI, ZIP, Checksums)
```

### 4.1. Method A: One-Line PowerShell Install Command
Designed for rapid terminal installation:

```powershell
irm https://raw.githubusercontent.com/<YOUR-USERNAME>/canopy/main/install.ps1 | iex
```

* **Zero Elevation:** Installs to `%LOCALAPPDATA%\Programs\Canopy` without UAC prompts.
* **SmartScreen ADS Stripping:** Automatically runs `Unblock-File` on downloaded and unpacked archives to strip `Zone.Identifier` stream tags.
* **Clean Uninstallation:**
  ```powershell
  $env:CANOPY_UNINSTALL=1; irm https://raw.githubusercontent.com/<YOUR-USERNAME>/canopy/main/install.ps1 | iex
  ```

### 4.2. Method B: Native Windows MSI Installer (`.msi`)
Primary installer built with **WiX Toolset v4.0.5**:
* **Source Definition:** `installer/Canopy.wxs`
* **Build Script:** `installer/build-msi.ps1`
* **Output:** `dist-installer/Canopy-v1.0.0-x64.msi` (~$8.2\text{ MB}$)
* Per-user scope, registered in `Settings -> Apps -> Installed Apps`, with Start Menu and Desktop shortcuts.

### 4.3. Method C: Portable Self-Contained Release (`.zip`)
Single-file self-contained .NET 8 package:
* **Build Script:** `build-portable.ps1`
* **Optimization Flags:** `-p:EnableCompressionInSingleFile=true -p:DebugType=embedded`
* **Output:** `dist-installer/Canopy-v1.0.0-win-x64-portable.zip` (~$72\text{ MB}$)
* Unzip and run anywhere with zero .NET or external dependencies.

### 4.4. Method D: Windows Package Manager (`winget`)
* **Manifest:** `winget/canopy.yaml`
* Allows terminal users to install via `winget install CanopyShell.Canopy`.

---

## 5. Automated CI/CD: GitHub Actions Workflow

`.github/workflows/release.yml` handles automated cross-compilation and release drafting whenever a Git tag (`v*.*.*`) is pushed:
* Explicit `permissions: contents: write` at both workflow and job level.
* Compiles Vite frontend (`npm ci && npm run build`).
* Compiles .NET 8 WPF application for `win-x64`.
* Builds native `.msi` via WiX v4.
* Packages compressed `.zip` portable bundle.
* Computes SHA-256 hashes (`checksums-sha256.txt`).
* Publishes GitHub Release with assets attached.
