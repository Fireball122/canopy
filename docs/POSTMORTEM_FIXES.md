# Canopy: Issue Postmortem & Fix Summary

## Executive Overview
Following the release and initial user installation of the `Canopy-v1.0.0-x64.msi` package, three primary defects were identified and resolved:
1. **Clear / Invisible Dropdown on Launch** (WebView2 initialization failure).
2. **Clipped / Shrunk Viewport on High-DPI Displays** (Unscaled HWND vs. CSS viewport mismatch).
3. **Overly Large Dropdown Covering 60% of 1080p Screens** (Excessive physical scaling on 150% DPI).

All issues have been resolved, verified through screen buffer captures, committed to the repository, and packaged into `Canopy-v1.0.1-x64.msi`.

---

## 1. Problem: Dropdown Menu Clear and Not Working

### Symptoms
After installing via the MSI package, launching Canopy caused a transparent borderless frame to drop down from the top bezel with no visual content rendered inside it.

### Root Causes
1. **Missing Runtime Identifier in MSI Build Script**:
   In `installer/build-msi.ps1`, `dotnet publish` was invoked without specifying `-r win-x64`:
   ```powershell
   dotnet publish -c Release -o $PublishDir --self-contained false
   ```
   This produced multi-architecture runtime folders: `runtimes/win-x64/native`, `runtimes/win-x86/native`, and `runtimes/win-arm64/native`.
2. **Flattened WiX v4 Directory Hierarchy**:
   `installer/build-msi.ps1` generated WiX directory fragments by putting all subdirectories directly into `<DirectoryRef Id="INSTALLFOLDER">` rather than nesting them under their respective `$parentId`:
   - `runtimes/win-arm64/native/WebView2Loader.dll` was mapped to `INSTALLFOLDER\native\WebView2Loader.dll`, overwriting the x64 binary with an ARM64 binary.
   - `dist/assets` was mapped to `INSTALLFOLDER\assets\` instead of `INSTALLFOLDER\dist\assets\`.
   - `runtimes/win/lib/net8.0/System.Management.dll` was mapped to `INSTALLFOLDER\net8.0\`.
3. **Runtime Loader Exception**:
   Because Canopy.exe is a 64-bit application running inside a transparent WPF glass chrome (`AllowsTransparency="False"`, `Background="{x:Null}"`), loading the mismatched ARM64 `WebView2Loader.dll` failed:
   ```
   System.BadImageFormatException: An attempt was made to load a program with an incorrect format. (0x8007000B)
      at Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateCoreWebView2EnvironmentWithOptions(...)
      at CaelestiaWin.MainWindow.InitializeWebViewAsync()
   ```
   Because WebView2 threw an unhandled initialization exception, `dist/index.html` never loaded and the dropped window remained completely clear/invisible.

### Solutions Applied
1. **Targeted `-r win-x64` in `installer/build-msi.ps1`**:
   Ensured that only 64-bit native binaries are resolved and emitted.
2. **Ensured Dual Native Loader Placement**:
   Explicitly copies `WebView2Loader.dll` to both the root application directory and `runtimes\win-x64\native\`.
3. **Fixed WiX Directory Generator**:
   Wrapped each `<Directory>` in `<DirectoryRef Id="$parentId">` to preserve multi-level directory structures (`dist\assets`, `runtimes\win-x64\native`).
4. **Remediated Installed Program Files**:
   Restored native x64 `WebView2Loader.dll`, `dist\assets\`, and `System.Management.dll` in `%LOCALAPPDATA%\Programs\Canopy\`.

---

## 2. Problem: Content Clipped and Cropped on High-DPI Displays

### Symptoms
When the dropdown window opened, only the left two-thirds of the interface was visible. The volume slider was cut in half, the entire media player card was off-screen, and the calendar was truncated at the bottom.

### Root Causes
1. **Display Scaling**: The system runs at 150% Windows scaling ($144\text{ DPI}$).
2. **Fixed HWND Sizing**:
   In `MainWindow.xaml.cs`, `PositionWindowAtTopCenter()` and `SlideTo()` called Win32 `SetWindowPos` with `SWP_NOSIZE` and dimensions `(0, 0)`:
   ```csharp
   Win32.SetWindowPos(_hwnd, IntPtr.Zero, physicalX, physicalY, 0, 0,
       Win32.SWP_NOSIZE | Win32.SWP_NOZORDER | Win32.SWP_NOACTIVATE);
   ```
   The physical HWND was never sized to match the DPI scale and remained stuck at the initial unscaled $850 \times 430\text{ physical pixels}$.
3. **CSS Viewport Truncation**:
   Inside WebView2 at `devicePixelRatio = 1.5`, $850\text{ physical px} / 1.5 = \mathbf{567\text{ CSS px}}$ and $430\text{ physical px} / 1.5 = \mathbf{287\text{ CSS px}}$.
   The frontend design requires $850 \times 430\text{ CSS px}$ ($165\text{px} + 340\text{px} + 92\text{px} + 185\text{px} + \text{margins} = 828\text{px}$ minimum).
   The viewport squished the content and clipped the remaining 33%.

### Solutions Applied
1. Added `GetDpiForWindow(IntPtr hWnd)` P/Invoke to `Interop/Win32.cs` to resolve PerMonitorV2 scale factors accurately.
2. Removed `SWP_NOSIZE` from `PositionWindowAtTopCenter` and `SlideTo`, explicitly sizing the HWND to match display DPI.
3. Added `WM_DPICHANGED` (`0x02E0`) handling in `WndProc` to dynamically update dimensions and rounded corner regions when moved across displays.

---

## 3. Problem: Dropdown Too Large on 1080p Screens

### Symptoms
Scaling the window directly by $1.5\times$ created a $1275 \times 645\text{ px}$ window. On a 1080p display ($1920 \times 1080$), a $645\text{px}$ high card occupied **$59.7\%$ of the entire monitor height**, covering more than half the screen and overwhelming the desktop.

### Root Causes
While 850 DIPs on a 4K display or 100% 1080p display occupies ~40% of vertical space, 150% scaling on a 1080p display has only $720\text{ DIPs}$ of total vertical screen space. A full 430 DIP card is disproportionately large on lower-resolution high-DPI panels.

### Solutions Applied
1. **Vertical Bounds Ceiling ($48\%$ of Screen Height)**:
   In `MainWindow.xaml.cs`, `GetDpiScaleAndPhysicalSize` calculates physical height from `BaseDesignHeight = 430.0` and caps it at at most $48\%$ of the monitor height:
   ```csharp
   int targetPhysicalHeight = (int)Math.Round(BaseDesignHeight * scaleY);
   if (monitor.Height > 0 && targetPhysicalHeight > (int)Math.Round(monitor.Height * 0.48))
   {
       targetPhysicalHeight = (int)Math.Round(monitor.Height * 0.48);
   }
   int targetPhysicalWidth = (int)Math.Round(targetPhysicalHeight * (BaseDesignWidth / BaseDesignHeight));
   ```
   On a 1080p panel, this produces **$1024 \times 518\text{ physical pixels}$** ($53.3\%$ width, $48.0\%$ height), leaving the bottom $52\%$ of the desktop open and unobstructed.
2. **Adaptive Dynamic WebView2 Zoom Factor**:
   Synchronizes `ShellWebView.ZoomFactor` to scale the $850 \times 430$ layout into the $1024 \times 518$ physical window:
   ```csharp
   double targetZoom = (double)physicalWidth / (scaleX * BaseDesignWidth);
   ShellWebView.ZoomFactor = Math.Clamp(targetZoom, 0.4, 2.0);
   ```
   At $\text{targetZoom} \approx 0.803$, the effective CSS viewport is exactly $850.0 \times 430.0\text{ px}$. All 4 bento zones, 8 navigation tabs, sliders, and media player fit with zero cropping, crisp font rendering, and balanced proportions.

---

## Deliverables & Artifacts
- **Repository Commits**:
  - `bf36692`: Fixed `installer/build-msi.ps1` architecture targeting (`-r win-x64`) and WiX directory hierarchy.
  - `7fd8d64`: Added `GetDpiForWindow` and physical window sizing to prevent High-DPI viewport cropping.
  - `82cc98a`: Implemented $48\%$ height ceiling and adaptive `ZoomFactor` scaling.
- **Installer Package**:
  - `Canopy-v1.0.1-x64.msi` ($8.14\text{ MB}$) compiled with WiX v4 and copied to `Downloads/`.
