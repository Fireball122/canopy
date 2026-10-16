# scripts/record-demo-1080p.ps1
# Automated, professional 60 FPS 1080p demo recording on secondary monitor (DISPLAY2)

param(
    [string]$OutputPath = "C:\Users\CEO\Desktop\canopy-demo-1080p.mp4",
    [int]$CountdownSec = 3
)

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  CANOPY: AUTOMATED 1080p SHOWCASE RECORDER" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Resolve Display 2
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screen = [System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.DeviceName -eq "\\.\DISPLAY2" }
if (-not $screen) {
    Write-Warning "DISPLAY2 not found! Falling back to screen with 1920 width."
    $screen = [System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.Bounds.Width -eq 1920 } | Select-Object -First 1
}

if (-not $screen) {
    throw "Could not locate 1080p display."
}

$bx = $screen.Bounds.X
$by = $screen.Bounds.Y
$bw = $screen.Bounds.Width
$bh = $screen.Bounds.Height
$centerX = $bx + [int]($bw / 2)

Write-Host "[INFO] Target Display: $($screen.DeviceName) ($bw x $bh at offset $bx, $by)" -ForegroundColor Yellow
Write-Host "[INFO] Output File: $OutputPath" -ForegroundColor Yellow

# 2. Check Canopy process
$canopy = Get-Process Canopy -ErrorAction SilentlyContinue
if (-not $canopy) {
    Write-Host "[INFO] Starting Canopy..." -ForegroundColor Yellow
    Start-Process "$env:LOCALAPPDATA\Canopy\Canopy.exe"
    Start-Sleep -Seconds 2
}

# 3. Locate ffmpeg
$ffmpeg = "C:\Users\CEO\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"
if (-not (Test-Path $ffmpeg)) {
    $ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($ffmpegCmd) { $ffmpeg = $ffmpegCmd.Source } else { throw "FFmpeg not found." }
}

# 4. Compile Mouse Helpers
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DemoMouse {
    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const int MOUSEEVENTF_LEFTDOWN = 0x02;
    public const int MOUSEEVENTF_LEFTUP = 0x04;
    public static void Click() {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        System.Threading.Thread.Sleep(80);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
}
"@ -ErrorAction SilentlyContinue

function Move-Cursor([double]$x1, [double]$y1, [double]$x2, [double]$y2, [int]$durationMs) {
    $steps = [Math]::Max(10, [int]($durationMs / 12))
    for ($i = 0; $i -le $steps; $i++) {
        $t = [double]$i / [double]$steps
        # Smooth cosine interpolation
        $ease = (1.0 - [Math]::Cos($t * [Math]::PI)) / 2.0
        $x = [int][Math]::Round($x1 + ($x2 - $x1) * $ease)
        $y = [int][Math]::Round($y1 + ($y2 - $y1) * $ease)
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
        Start-Sleep -Milliseconds 12
    }
}

# 5. Countdown
for ($i = $CountdownSec; $i -gt 0; $i--) {
    Write-Host "Recording starting in $i seconds..." -ForegroundColor Magenta
    Start-Sleep -Seconds 1
}

# 6. Start ffmpeg with explicit duration so moov atom is always written cleanly
if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }

$ffArgs = @(
    "-t", "26",
    "-f", "gdigrab",
    "-framerate", "60",
    "-offset_x", "$bx",
    "-offset_y", "$by",
    "-video_size", "${bw}x${bh}",
    "-i", "desktop",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    "$OutputPath"
)

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ffmpeg
$psi.Arguments = $ffArgs -join " "
$psi.UseShellExecute = false
$psi.CreateNoWindow = true

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "[REC] Started FFmpeg 60 FPS recording (PID: $($proc.Id), 26s duration)..." -ForegroundColor Green
try {
    # Phase 1: Clean desktop rest (2s)
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($centerX, 500)
    Start-Sleep -Milliseconds 2000

    # Phase 2: Nudge top bezel notch smoothly (reveal Canopy)
    Write-Host "[STAGE 1] Triggering Canopy notch drop-down..." -ForegroundColor Cyan
    Move-Cursor $centerX 500 $centerX 0 700
    Start-Sleep -Milliseconds 1200

    # Phase 3: Dashboard overview & Media glance
    Write-Host "[STAGE 2] Highlighting Dashboard & audio visualizer..." -ForegroundColor Cyan
    Move-Cursor $centerX 0 ($bx + 540) 250 800
    Start-Sleep -Milliseconds 2200

    # Phase 4: Click Media Tab (Vinyl + Spectrum + Dancing Companion)
    Write-Host "[STAGE 3] Switching to Media tab (reactive vinyl, lyrics, visualizer)..." -ForegroundColor Cyan
    $mediaTabX = $bx + 720
    Move-Cursor ($bx + 540) 250 $mediaTabX 25 600
    Start-Sleep -Milliseconds 150
    [DemoMouse]::Click()
    Start-Sleep -Milliseconds 3000

    # Phase 5: Click Wallpaper Tab (Wallpaper Switcher & Adaptive Colors)
    Write-Host "[STAGE 4] Switching to Wallpaper tab (dynamic theming)..." -ForegroundColor Cyan
    $wallpaperTabX = $bx + 960
    Move-Cursor $mediaTabX 25 $wallpaperTabX 25 500
    Start-Sleep -Milliseconds 150
    [DemoMouse]::Click()
    Start-Sleep -Milliseconds 2800

    # Phase 6: Return to Dashboard and Collapse
    Write-Host "[STAGE 5] Returning to Dashboard and collapsing..." -ForegroundColor Cyan
    $dashTabX = $bx + 640
    Move-Cursor $wallpaperTabX 25 $dashTabX 25 400
    Start-Sleep -Milliseconds 150
    [DemoMouse]::Click()
    Start-Sleep -Milliseconds 600

    # Move cursor down to trigger smooth slide-up
    Move-Cursor $dashTabX 25 $centerX 600 700
    Start-Sleep -Milliseconds 2000

    # Phase 7: Raindrop-to-Pill Notification Showcase (Closed state)
    Write-Host "[STAGE 6] Firing native Raindrop-to-Pill Notification (Closed state)..." -ForegroundColor Cyan
    Start-Process -FilePath "$env:LOCALAPPDATA\Canopy\Canopy.exe" -ArgumentList "--test-notify"
    Start-Sleep -Milliseconds 4500

    # Phase 8: Final clean desktop hold
    Start-Sleep -Milliseconds 1500
    Write-Host "[STAGE 7] Demonstration sequence complete!" -ForegroundColor Green

} finally {
    if (-not $proc.HasExited) {
        Write-Host "[REC] Waiting for FFmpeg to complete cleanly..." -ForegroundColor Yellow
        $proc.WaitForExit(10000)
    }
}
if (Test-Path $OutputPath) {
    $sizeMb = [Math]::Round(((Get-Item $OutputPath).Length / 1MB), 2)
    Write-Host "[SUCCESS] Showcase video generated: $OutputPath ($sizeMb MB)" -ForegroundColor Green
} else {
    Write-Error "Failed to generate video file."
}
