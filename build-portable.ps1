# build-portable.ps1 - Builds portable win-x64 ZIP package
param(
    [string]$Version = "1.0.2",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublishDir = Join-Path $ScriptDir "bin\$Configuration\net8.0-windows10.0.19041.0\publish-portable"
$OutputDir = Join-Path $ScriptDir "dist-installer"

Write-Host "==> 1. Publishing Canopy portable ($Configuration)..." -ForegroundColor Cyan
if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

$dotnet = "$HOME/.dotnet/dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = "dotnet" }

& $dotnet publish "$ScriptDir\Canopy.csproj" -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=embedded -o $PublishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

# Make sure app.ico is included
Copy-Item (Join-Path $ScriptDir "app.ico") (Join-Path $PublishDir "app.ico") -Force

# Ensure dist/ frontend bundle is included in portable payload
$distSource = Join-Path $ScriptDir "dist"
$distDest = Join-Path $PublishDir "dist"
if (Test-Path $distSource) {
    Copy-Item $distSource $distDest -Recurse -Force
}

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
