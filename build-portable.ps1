# build-portable.ps1 - Builds portable win-x64 ZIP package
param(
    # Defaults to <Version> in Canopy.csproj, the single source of truth for the release version.
    [string]$Version = "",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Version) {
    [xml]$csproj = Get-Content -LiteralPath (Join-Path $ScriptDir "Canopy.csproj") -Raw
    $Version = @($csproj.Project.PropertyGroup | ForEach-Object { $_.Version } | Where-Object { $_ })[0]
    if (-not $Version) { throw "Could not read <Version> from Canopy.csproj; pass -Version explicitly." }
    $Version = $Version.Trim()
}

$PublishDir = Join-Path $ScriptDir "bin\$Configuration\net8.0-windows10.0.19041.0\publish-portable"
$OutputDir = Join-Path $ScriptDir "dist-installer"

Write-Host "==> 1. Publishing Canopy v$Version portable ($Configuration)..." -ForegroundColor Cyan
if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

$dotnet = "$HOME/.dotnet/dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = "dotnet" }

& $dotnet publish "$ScriptDir\Canopy.csproj" -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=embedded "-p:Version=$Version" -o $PublishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

# Make sure app.ico is included
Copy-Item (Join-Path $ScriptDir "app.ico") (Join-Path $PublishDir "app.ico") -Force

# Mirror dist/ exactly. dotnet publish already copies it, and Copy-Item onto an existing
# directory nests the source inside it (publish\dist\dist), duplicating the whole bundle.
$distSource = Join-Path $ScriptDir "dist"
if (-not (Test-Path (Join-Path $distSource "index.html"))) {
    throw "Frontend bundle missing: dist\index.html not found. Run npm run build first."
}
$distDest = Join-Path $PublishDir "dist"
if (Test-Path $distDest) { Remove-Item $distDest -Recurse -Force }
Copy-Item $distSource $distDest -Recurse -Force

# Ensure x64 WebView2Loader.dll is in publish root alongside Canopy.exe for portable launch
$nativeLoader = Join-Path $PublishDir "runtimes\win-x64\native\WebView2Loader.dll"
$rootLoader = Join-Path $PublishDir "WebView2Loader.dll"
if ((Test-Path $nativeLoader) -and (-not (Test-Path $rootLoader))) {
    Copy-Item $nativeLoader $rootLoader -Force
}
# Create starter script
$starterBat = @"
@echo off
cd /d "%~dp0"
start "" "Canopy.exe"
exit /b 0
"@
Set-Content -Path (Join-Path $PublishDir "Start Canopy.bat") -Value $starterBat -Encoding ASCII

$ZipOutput = Join-Path $OutputDir "Canopy-v$Version-win-x64-portable.zip"
Write-Host "==> 2. Creating ZIP archive: $ZipOutput" -ForegroundColor Cyan
if (Test-Path $ZipOutput) { Remove-Item $ZipOutput -Force }
Compress-Archive -Path "$PublishDir\*" -DestinationPath $ZipOutput -CompressionLevel Optimal

Write-Host "==> SUCCESS: Created $ZipOutput" -ForegroundColor Green
$zipItem = Get-Item $ZipOutput
Write-Host ("Zip Size: {0:N2} MB" -f ($zipItem.Length / 1MB)) -ForegroundColor Green
