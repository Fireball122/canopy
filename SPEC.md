# Architecture Specification: Canopy

## 1. System Overview
Canopy is a high-performance Windows 11 desktop overlay application built with a dual-layer architecture:
1. **Native Host**: C# .NET 8 WPF application providing hardware integration, low-level Win32/COM interop, high-precision window management, WASAPI audio monitoring, and system metrics telemetry.
2. **Frontend View Layer**: React 18 + TypeScript + Vite + Tailwind CSS running inside Microsoft Edge WebView2, communicating with the host via asynchronous JSON IPC.

```
+-----------------------------------------------------------------------+
|                             Canopy Host                               |
|                     (C# .NET 8 WPF x64 Windows 11)                    |
|                                                                       |
|  +--------------------+  +---------------------+  +----------------+  |
|  | MainWindow.xaml.cs |  | SystemMonitorService|  | Interop & COM  |  |
|  | - VSync sliding    |  | - CPU/GPU/RAM       |  | - WASAPI Loop  |  |
|  | - Offscreen parked |  | - Network / Disk    |  | - SMTC Media   |  |
|  | - Sleep / Suspend  |  | - DiagnosticsLog    |  | - Wallpaper COM|  |
|  +---------+----------+  +----------+----------+  +--------+-------+  |
|            |                        |                      |          |
|            +------------------------+----------------------+          |
|                                     |                                 |
|                            WebView2 IPC Bridge                        |
|                     (PostWebMessageAsJson / RPC)                      |
+-------------------------------------+---------------------------------+
                                      |
+-------------------------------------v---------------------------------+
|                       Canopy Frontend View Layer                      |
|                  (React 18 + TypeScript + Vite HUD)                   |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  | hostBridge.ts (Single Source of Truth / RPC / Fallback Mocks)   |  |
|  +-----------------------------------------------------------------+  |
|  | SettingsContext.tsx (%LOCALAPPDATA%\Canopy\settings.json)       |  |
|  +-----------------------------------------------------------------+  |
|  | Views: Dashboard, Media, Performance, Apps, Wallpapers, etc.    |  |
|  | Shared Components: RadialGauge, VerticalSliders, ErrorBoundary |  |
+-----------------------------------------------------------------------+
```

---

## 2. File and Directory Contracts

### Native Host (.NET 8 WPF)
- `MainWindow.xaml.cs`:
  - Top-level window management, DPI awareness (`WM_DPICHANGED`), and multi-monitor geometry.
  - VSync sliding animation loop using `CompositionTarget.Rendering` or high-resolution dispatch timer.
  - IPC message router (`CoreWebView2.WebMessageReceived`) dispatching to subsystem handlers.
  - Lifecycle state machine: expanded, collapsed, and deep sleep transitions.
- `Interop/`:
  - `Win32.cs` & native wrappers: Window styles (`WS_EX_TOOLWINDOW`, `WS_EX_TOPMOST`), blur/mica composition, monitor enumeration (`GetMonitorInfo`).
  - Audio Loopback: WASAPI capture (`IAudioSessionManager2`, `ISimpleAudioVolume`, `NAudio`) per-app peak and volume control.
  - Media: System Media Transport Controls (SMTC) integration (`GlobalSystemMediaTransportControlsSessionManager`).
  - Wallpaper: Shell COM interface (`IDesktopWallpaper`) for setting background paths and multi-monitor layouts.
- `Services/`:
  - `SystemMonitorService.cs`: Hardware metric polling (CPU utilization, RAM usage, GPU load via performance counters or NVAPI/DXGI, network I/O, disk throughput).
  - `WallpaperService.cs`: Wallpaper thumbnail generation, cache management, and theme accent extraction.
  - `DiagnosticsLog.cs`: In-memory thread-safe circular ring buffer capturing diagnostic events, warnings, and errors for debug inspection.

### Frontend View Layer (React 18 + TypeScript)
- `src/services/hostBridge.ts`:
  - Single source of truth for all IPC bridge calls, typed request/response RPC, and event subscriptions.
  - Exposes typed functions (`hostBridge.invoke(action, payload)`) and listeners (`hostBridge.on(event, handler)`).
  - Must provide deterministic mock data fallbacks when `window.chrome?.webview` is absent so views can be developed and previewed standalone in browser / Cursor / Antigravity.
- `src/context/SettingsContext.tsx`:
  - Centralized settings schema and state store.
  - Backed by native host persistence at `%LOCALAPPDATA%\Canopy\settings.json`.
- `src/views/`:
  - Domain-specific views: `DashboardView`, `MediaView`, `PerformanceView`, `AppsView`, `WallpapersView`, `SettingsView`, `PowerView`.
  - Views must consume data strictly via context providers or `hostBridge.ts`.
- `src/components/`:
  - Reusable presentation components: `CanopyMascot`, `RadialGauge`, `VerticalSliders`, `ErrorBoundary`.
  - Presentation components must be pure or driven by explicit props.

---

## 3. Strict State Invariants

1. **Zero Visible Pixels When Collapsed**:
   - When collapsed/closed, no portion of the Canopy window may remain visible on screen ($Y \le \text{rcMonitor.Top} + 2\text{px}$, parked off-screen at $Y = -530\text{px}$).
   - Window borders, margins, or transparent hit-test areas must not intercept mouse clicks intended for underlying applications.
2. **Deep Sleep When Parked**:
   - Suspend WebView2 render/compositor activity via `TrySuspendAsync` when parked off-screen.
   - Pause WASAPI audio loopback sampling and peak calculation.
   - Throttle or pause `SystemMonitorService` polling timers while Canopy is collapsed.
3. **Zero Unhandled Exceptions**:
   - Native host: Background threads, async tasks, and event callbacks must catch exceptions, log to `DiagnosticsLog`, and prevent application crashes. Fatal errors must present clean diagnostics.
   - Frontend: Root and view boundaries must be protected by `ErrorBoundary` with fallback error cards instead of white-screening.

---

## 4. Banned Anti-Patterns

1. **BANNED: Silent Error Swallowing**:
   - `catch {}` or `catch (Exception) {}` without logging to `DiagnosticsLog` or presenting UI feedback is strictly prohibited.
2. **BANNED: `any` in TypeScript**:
   - `any` is disallowed. Use `unknown` with narrowing type guards, discriminated unions, or strict interface declarations.
3. **BANNED: Inline Styles for Layout**:
   - Layout geometry, flex, grid, spacing, and positioning must use Tailwind CSS utility classes.
   - Inline styles (`style={{ ... }}`) are permitted *only* for dynamic CSS variable bindings (e.g., extracted wallpaper accent colors) and calculated progress gauge transforms.
4. **BANNED: Bloated Components**:
   - Components or helper functions exceeding 60 lines should be decomposed into modular subcomponents or custom hooks.
5. **BANNED: Unbounded Intervals & Uncleaned Listeners**:
   - Every `setInterval`, `setTimeout`, `window.addEventListener`, and IPC event subscription must return an explicit cleanup function in React `useEffect`.
   - Every WPF event subscription or COM/WASAPI resource must implement proper lifecycle disposal (`IDisposable` or window closing hooks).
6. **BANNED: Blocking UI Thread**:
   - Synchronous blocking Win32 or COM calls, disk I/O, or heavy CPU calculations on the WPF UI thread are strictly prohibited. Use `Task.Run` or asynchronous APIs.
