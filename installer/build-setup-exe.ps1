# build-setup-exe.ps1 - Compiles the branded graphical setup wizard (.exe) using Inno Setup
param(
    # Defaults to <Version> in Canopy.csproj, the single source of truth for the release version.
    [string]$Version = "",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path

if (-not $Version) {
    [xml]$csproj = Get-Content -LiteralPath (Join-Path $ProjectRoot "Canopy.csproj") -Raw
    $Version = @($csproj.Project.PropertyGroup | ForEach-Object { $_.Version } | Where-Object { $_ })[0]
    if (-not $Version) { throw "Could not read <Version> from Canopy.csproj; pass -Version explicitly." }
    $Version = $Version.Trim()
}

$PublishDir = Join-Path $ProjectRoot "bin\$Configuration\net8.0-windows10.0.19041.0\publish-msi"
$OutputDir = Join-Path $ProjectRoot "dist-installer"

Write-Host "==> 1. Publishing Canopy v$Version ($Configuration)..." -ForegroundColor Cyan
if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

$dotnet = "$HOME/.dotnet/dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = "dotnet" }

# No SkipFrontendBuild: the csproj BuildFrontend target rebuilds dist/ when any frontend source is
# newer than dist\index.html, so a standalone run never packages a stale or missing UI bundle.
& $dotnet publish "$ProjectRoot\Canopy.csproj" -c $Configuration -r win-x64 -o $PublishDir --self-contained true "-p:Version=$Version"
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

Copy-Item (Join-Path $ProjectRoot "app.ico") (Join-Path $PublishDir "app.ico") -Force

# Mirror dist/ exactly. dotnet publish already copies it, and Copy-Item onto an existing
# directory nests the source inside it (publish\dist\dist), duplicating the whole bundle.
$distSource = Join-Path $ProjectRoot "dist"
if (-not (Test-Path (Join-Path $distSource "index.html"))) {
    throw "Frontend bundle missing: dist\index.html not found. Run npm run build first."
}
$distDest = Join-Path $PublishDir "dist"
if (Test-Path $distDest) { Remove-Item $distDest -Recurse -Force }
Copy-Item $distSource $distDest -Recurse -Force

# Ensure x64 WebView2Loader.dll is in both root and runtimes\win-x64\native for robust native loading
$nativeLoader = Join-Path $PublishDir "runtimes\win-x64\native\WebView2Loader.dll"
$rootLoader = Join-Path $PublishDir "WebView2Loader.dll"
if ((Test-Path $nativeLoader) -and (-not (Test-Path $rootLoader))) {
    Copy-Item $nativeLoader $rootLoader -Force
} elseif ((Test-Path $rootLoader) -and (-not (Test-Path $nativeLoader))) {
    $nativeDir = Join-Path $PublishDir "runtimes\win-x64\native"
    if (-not (Test-Path $nativeDir)) { New-Item -ItemType Directory -Path $nativeDir -Force | Out-Null }
    Copy-Item $rootLoader $nativeLoader -Force
}
Write-Host "==> 2. Compiling branded Canopy-v$Version-Setup.exe with Inno Setup..." -ForegroundColor Cyan

$iscc = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) {
    $iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
}
if (-not (Test-Path $iscc)) {
    $iscc = "C:\Program Files\Inno Setup 6\ISCC.exe"
}
if (-not (Test-Path $iscc)) {
    $cmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        $iscc = $cmd.Source
    }
}

if (-not $iscc -or -not (Test-Path $iscc)) {
    throw "Inno Setup compiler (ISCC.exe) not found. Please install JRSoftware.InnoSetup via winget."
}

# Pass the publish directory explicitly so -Configuration Debug packages what was just published.
& $iscc "/DMyAppVersion=$Version" "/DMySourceDir=$PublishDir" (Join-Path $ScriptDir "setup.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed" }

$exeOutput = Join-Path $OutputDir "Canopy-v$Version-Setup.exe"
Write-Host "==> SUCCESS: Created $exeOutput" -ForegroundColor Green
$exeItem = Get-Item $exeOutput
Write-Host ("Installer Size: {0:N2} MB" -f ($exeItem.Length / 1MB)) -ForegroundColor Green
