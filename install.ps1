<#
.SYNOPSIS
    One-Line Installer for Canopy Desktop Control Center
.DESCRIPTION
    Installs Canopy to %LOCALAPPDATA%\Programs\Canopy, sets up desktop and start menu shortcuts,
    and launches the application.
.EXAMPLE
    irm https://raw.githubusercontent.com/Fireball122/canopy/main/install.ps1 | iex
#>

[CmdletBinding()]
param(
    [string]$Repo = "Fireball122/canopy",
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Canopy",
    [switch]$NoShortcut,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1: the progress bar slows Invoke-WebRequest down by an order of magnitude,
# and older Windows 10 builds only offer TLS 1.0/1.1, which GitHub and go.microsoft.com reject.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
# Null when piped through `irm ... | iex` (no script file), so only probe for a local build when set.
$ScriptPath = $MyInvocation.MyCommand.Path

# Colors and styling
function Write-Header {
    Write-Host @"
   ______                                    
  / ____/___ _____  ____  ____  __  __
 / /   / __ ``/ __ \/ __ \/ __ \/ / / /
/ /___/ /_/ / / / / /_/ / /_/ / /_/ / 
\____/\__,_/_/ /_/\____/ .___/\__, /  
                      /_/    /____/   
  Zero-Notch Top Hover Control Center
"@ -ForegroundColor Cyan
}

function Assert-ReleaseAssetChecksum {
    param(
        [Parameter(Mandatory)]$Release,
        [Parameter(Mandatory)]$Asset,
        [Parameter(Mandatory)][string]$Path
    )

    $checksumAsset = $Release.assets | Where-Object { $_.name -eq "checksums-sha256.txt" } | Select-Object -First 1
    if (-not $checksumAsset) {
        throw "The release does not provide checksums-sha256.txt; refusing to install an unverifiable package."
    }

    $checksumPath = Join-Path $env:TEMP ("Canopy-checksums-" + [guid]::NewGuid().ToString() + ".txt")
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $checksumAsset.browser_download_url -OutFile $checksumPath
        $expected = $null
        foreach ($line in Get-Content -LiteralPath $checksumPath) {
            if ($line -match '^\s*([a-fA-F0-9]{64})\s+\*?(.+?)\s*$' -and $matches[2].Trim() -eq $Asset.name) {
                $expected = $matches[1].ToLowerInvariant()
                break
            }
        }

        if (-not $expected) {
            throw "No checksum was published for $($Asset.name)."
        }

        $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
            throw "Checksum verification failed for $($Asset.name). The downloaded file was removed."
        }
    }
    finally {
        Remove-Item -LiteralPath $checksumPath -Force -ErrorAction SilentlyContinue
    }
}

function Test-WebView2Runtime {
    $programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
    $roots = @()
    if ($programFilesX86) { $roots += Join-Path $programFilesX86 "Microsoft\EdgeWebView\Application" }
    $roots += Join-Path $env:LOCALAPPDATA "Microsoft\EdgeWebView\Application"
    $runtimeRoots = $roots | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    return $null -ne ($runtimeRoots | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)
}

function Install-WebView2Runtime {
    if (Test-WebView2Runtime) {
        return
    }

    Write-Host ""
    Write-Host "[DEPENDENCY NOTICE]" -ForegroundColor Yellow
    Write-Host "Canopy requires the Microsoft Edge WebView2 Runtime to render its user interface." -ForegroundColor Yellow
    
    $isInteractive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    if ($isInteractive) {
        $choice = Read-Host "Would you like to install the WebView2 Runtime now? [Y/N] (default: Y)"
        if ($choice -match '^(n|no)$') {
            Write-Host ""
            Write-Host "[WARNING] Canopy cannot function without the Microsoft Edge WebView2 Runtime." -ForegroundColor Red
            Write-Host "Installation cancelled by user. Please install WebView2 before running Canopy." -ForegroundColor Red
            # throw, not exit: under `irm | iex` exit would close the user's PowerShell window.
            throw "Canopy installation cancelled: the Microsoft Edge WebView2 Runtime is required."
        }
    }

    Write-Host "==> Installing the Microsoft Edge WebView2 Runtime..." -ForegroundColor Cyan
    $bootstrapperPath = Join-Path $env:TEMP "MicrosoftEdgeWebView2Setup.exe"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $bootstrapperPath
        $signature = Get-AuthenticodeSignature -FilePath $bootstrapperPath
        if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "Microsoft") {
            throw "The downloaded WebView2 installer does not have a valid Microsoft signature."
        }

        $process = Start-Process -FilePath $bootstrapperPath -ArgumentList "/silent /install" -Wait -PassThru
        if (($process.ExitCode -notin 0, 3010) -or -not (Test-WebView2Runtime)) {
            throw "WebView2 Runtime installation failed with exit code $($process.ExitCode). Canopy will not work without it."
        }
    }
    finally {
        Remove-Item -LiteralPath $bootstrapperPath -Force -ErrorAction SilentlyContinue
    }
}

if ($Uninstall -or $env:CANOPY_UNINSTALL -eq "1" -or $env:CANOPY_UNINSTALL -eq "true") {
    Write-Host "==> Uninstalling Canopy..." -ForegroundColor Yellow
    Get-Process Canopy -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500

    # Remove Start Menu shortcut
    $startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Canopy.lnk"
    if (Test-Path $startMenu) { Remove-Item $startMenu -Force }

    # Remove Desktop shortcut (same folder lookup as install, so OneDrive-redirected desktops match)
    $desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "Canopy.lnk"
    if (Test-Path $desktop) { Remove-Item $desktop -Force }

    # Remove Startup key if registered
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Canopy" -ErrorAction SilentlyContinue

    # Remove install folder
    if (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force
    }

    # The env var form persists in the session; clear it so a later install one-liner installs.
    Remove-Item Env:CANOPY_UNINSTALL -ErrorAction SilentlyContinue
    Write-Host "==> Canopy has been successfully removed." -ForegroundColor Green
    return
}

Write-Header
Install-WebView2Runtime

# 1. Check if running from local repo build or downloading from GitHub
$resolvedLocalZip = $null
if ($ScriptPath) {
    $localZip = Join-Path (Split-Path -Parent $ScriptPath) "dist-installer\Canopy-*-portable.zip"
    $resolvedLocalZip = Get-Item $localZip -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$downloadedPath = $null
if ($resolvedLocalZip) {
    Write-Host "==> Using local portable package: $($resolvedLocalZip.FullName)" -ForegroundColor Green
    $zipPath = $resolvedLocalZip.FullName
} else {
    Write-Host "==> Fetching latest release from GitHub: $Repo..." -ForegroundColor Cyan
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    
    try {
        $release = Invoke-RestMethod -UseBasicParsing -Uri $apiUrl -Headers @{ "User-Agent" = "Canopy-Installer" }
        $asset = $release.assets | Where-Object { $_.name -like "*portable.zip" -or $_.name -like "*win-x64*.zip" } | Select-Object -First 1
        
        if (-not $asset) {
            # Fallback to MSI asset if no zip
            $asset = $release.assets | Where-Object { $_.name -like "*.msi" } | Select-Object -First 1
        }
        
        if (-not $asset) {
            throw "No suitable Windows release asset found in $Repo release."
        }
        
        $downloadUrl = $asset.browser_download_url
        $zipPath = Join-Path $env:TEMP $asset.name
        $downloadedPath = $zipPath
        Write-Host "==> Downloading $($asset.name)..." -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $zipPath
        Assert-ReleaseAssetChecksum -Release $release -Asset $asset -Path $zipPath
        Unblock-File -Path $zipPath -ErrorAction SilentlyContinue
    } catch {
        if ($downloadedPath) { Remove-Item -LiteralPath $downloadedPath -Force -ErrorAction SilentlyContinue }
        Write-Host "Please download the installer directly from https://github.com/$Repo/releases" -ForegroundColor Yellow
        throw "Could not fetch release asset: $_"
    }
}

# 2. Terminate the running instance only now that the package is verified, so a failed download
# does not leave the user without Canopy.
$running = Get-Process Canopy -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "==> Closing active Canopy instance for update..." -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Milliseconds 800
}

# 3. Install to target directory
Write-Host "==> Installing to $InstallDir..." -ForegroundColor Cyan
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$installedViaMsi = $false
if ($zipPath -like "*.msi") {
    Write-Host "==> Running MSI installer..." -ForegroundColor Cyan
    $msiProcess = Start-Process msiexec.exe -ArgumentList "/i `"$zipPath`" /qn" -Wait -PassThru
    if ($msiProcess.ExitCode -notin 0, 3010) {
        throw "MSI installation failed with exit code $($msiProcess.ExitCode)."
    }
    $installedViaMsi = $true
} else {
    Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
    Get-ChildItem -Path $InstallDir -Recurse | Unblock-File -ErrorAction SilentlyContinue
}
if ($downloadedPath) {
    Remove-Item -LiteralPath $downloadedPath -Force -ErrorAction SilentlyContinue
}

# 4. Create Shortcuts (Start Menu & Desktop)
$exePath = Join-Path $InstallDir "Canopy.exe"
$icoPath = Join-Path $InstallDir "app.ico"

if (-not (Test-Path $exePath)) {
    # Check subfolder in case zip contained a root folder
    $subExe = Get-ChildItem -Path $InstallDir -Filter "Canopy.exe" -Recurse | Select-Object -First 1
    if ($subExe) {
        $exePath = $subExe.FullName
        $InstallDir = $subExe.DirectoryName
        $icoPath = Join-Path $InstallDir "app.ico"
    }
}

if (-not (Test-Path $exePath)) {
    throw "Canopy.exe was not found after installation."
}

if (-not $installedViaMsi) {
    $WshShell = New-Object -ComObject WScript.Shell

    # Start Menu Shortcut
    $programsDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
    $startShortcutPath = Join-Path $programsDir "Canopy.lnk"
    $shortcut = $WshShell.CreateShortcut($startShortcutPath)
    $shortcut.TargetPath = $exePath
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.Description = "Canopy - Zero-Notch Top Hover Control Center"
    if (Test-Path $icoPath) { $shortcut.IconLocation = "$icoPath,0" }
    $shortcut.Save()

    # Desktop Shortcut (if not disabled)
    if (-not $NoShortcut) {
        $desktopPath = [Environment]::GetFolderPath("Desktop")
        $deskShortcutPath = Join-Path $desktopPath "Canopy.lnk"
        $dShortcut = $WshShell.CreateShortcut($deskShortcutPath)
        $dShortcut.TargetPath = $exePath
        $dShortcut.WorkingDirectory = $InstallDir
        $dShortcut.Description = "Canopy - Zero-Notch Top Hover Control Center"
        if (Test-Path $icoPath) { $dShortcut.IconLocation = "$icoPath,0" }
        $dShortcut.Save()
    }
}

Write-Host "==> Shortcuts created!" -ForegroundColor Green

# 5. Launch application
Write-Host "==> Launching Canopy..." -ForegroundColor Cyan
Start-Process -FilePath $exePath

Write-Host @"

  ==============================================================
    Canopy is installed and running!
    - Summon: Move mouse to the TOP CENTER of your screen
    - Hotkey: Press Win + ``
    - Settings: Right-click the Canopy icon in the taskbar tray
  ==============================================================

"@ -ForegroundColor Green
