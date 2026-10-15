# build-msi.ps1 - Compiles a native Windows Installer (.msi) using WiX v4
param(
    [string]$Version = "1.0.1",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "MSI versions must use major.minor.patch numbers, for example 1.2.3."
}
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PublishDir = Join-Path $ProjectRoot "bin\$Configuration\net8.0-windows10.0.19041.0\publish-msi"
$OutputDir = Join-Path $ProjectRoot "dist-installer"
$GeneratedWxs = Join-Path $ScriptDir "GeneratedFiles.wxs"

Write-Host "==> 1. Building the frontend..." -ForegroundColor Cyan
Push-Location $ProjectRoot
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
}
finally {
    Pop-Location
}

Write-Host "==> 2. Publishing Canopy ($Configuration)..." -ForegroundColor Cyan
if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

$dotnet = "$HOME/.dotnet/dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = "dotnet" }

& $dotnet publish "$ProjectRoot\Canopy.csproj" -c $Configuration -r win-x64 -o $PublishDir --self-contained true -p:SkipFrontendBuild=true
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

Copy-Item (Join-Path $ProjectRoot "app.ico") (Join-Path $PublishDir "app.ico") -Force

# Ensure dist/ frontend bundle is explicitly included in MSI payload
$distSource = Join-Path $ProjectRoot "dist"
$distDest = Join-Path $PublishDir "dist"
if (Test-Path $distSource) {
    Copy-Item $distSource $distDest -Recurse -Force
}

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
Write-Host "==> 3. Generating WiX components for payload..." -ForegroundColor Cyan
$allFiles = Get-ChildItem -Path $PublishDir -Recurse -File | Sort-Object FullName

function Get-StableHash([string]$Text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text.ToLowerInvariant()))
    }
    finally {
        $sha.Dispose()
    }
}

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">')
[void]$sb.AppendLine('  <Fragment>')
[void]$sb.AppendLine('    <ComponentGroup Id="ProductComponents">')

$fileIndex = 0
foreach ($file in $allFiles) {
    $fileIndex++
    $relPath = $file.FullName.Substring($PublishDir.Length).TrimStart('\', '/')
    $relDir = Split-Path -Parent $relPath
    $dirId = "INSTALLFOLDER"
    
    if ($relDir) {
        # Normalize directory path to ID
        $cleanDir = $relDir -replace '[\\/]', '_' -replace '[^a-zA-Z0-9_]', ''
        $dirId = "DIR_" + $cleanDir
    }

    $identity = $relPath.Replace('\', '/').ToLowerInvariant()
    $hash = Get-StableHash $identity
    $hashText = ([System.BitConverter]::ToString($hash)).Replace('-', '')
    $compGuid = ([guid]::new([byte[]]$hash[0..15])).ToString().ToUpperInvariant()
    $componentId = "cmp_" + $hashText.Substring(0, 20)
    $fileId = "fil_" + $hashText.Substring(0, 20)

    [void]$sb.AppendLine("      <Component Id=`"$componentId`" Directory=`"$dirId`" Guid=`"$compGuid`">")
    [void]$sb.AppendLine("        <File Id=`"$fileId`" Source=`"$($file.FullName)`" KeyPath=`"yes`" />")
    [void]$sb.AppendLine("      </Component>")
}

[void]$sb.AppendLine('    </ComponentGroup>')
[void]$sb.AppendLine('  </Fragment>')

# Directory tree for subdirectories (preserving exact parent-child hierarchy)
$subDirs = Get-ChildItem -Path $PublishDir -Recurse -Directory | Sort-Object FullName
if ($subDirs) {
    [void]$sb.AppendLine('  <Fragment>')
    
    foreach ($dir in $subDirs) {
        $relPath = $dir.FullName.Substring($PublishDir.Length).TrimStart('\', '/')
        $parentPath = Split-Path -Parent $relPath
        $dirName = $dir.Name
        $cleanDir = $relPath -replace '[\\/]', '_' -replace '[^a-zA-Z0-9_]', ''
        $dirId = "DIR_" + $cleanDir
        
        $parentId = if ($parentPath) { "DIR_" + ($parentPath -replace '[\\/]', '_' -replace '[^a-zA-Z0-9_]', '') } else { "INSTALLFOLDER" }
        [void]$sb.AppendLine("    <DirectoryRef Id=`"$parentId`">")
        [void]$sb.AppendLine("      <Directory Id=`"$dirId`" Name=`"$dirName`" />")
        [void]$sb.AppendLine('    </DirectoryRef>')
    }
    
    [void]$sb.AppendLine('  </Fragment>')
}

[void]$sb.AppendLine('</Wix>')

Set-Content -Path $GeneratedWxs -Value $sb.ToString() -Encoding UTF8

Write-Host "==> 4. Checking WiX Toolset..." -ForegroundColor Cyan
$wix = "$HOME/.dotnet/tools/wix.exe"
if (-not (Test-Path $wix)) {
    $wixCmd = Get-Command "wix" -ErrorAction SilentlyContinue
    if ($wixCmd) { $wix = $wixCmd.Source }
}

$MsiOutput = Join-Path $OutputDir "Canopy-v$Version-x64.msi"
Write-Host "==> 5. Building MSI Installer with WiX: $MsiOutput" -ForegroundColor Cyan

& $wix build (Join-Path $ScriptDir "Canopy.wxs") "$GeneratedWxs" `
    -arch x64 `
    -d SourceDir="$PublishDir" `
    -d ProductVersion="$Version" `
    -out "$MsiOutput"

if ($LASTEXITCODE -ne 0) { throw "WiX build failed" }

Remove-Item $GeneratedWxs -Force -ErrorAction SilentlyContinue

Write-Host "==> SUCCESS: Created $MsiOutput" -ForegroundColor Green
$msiItem = Get-Item $MsiOutput
Write-Host ("Installer Size: {0:N2} MB" -f ($msiItem.Length / 1MB)) -ForegroundColor Green
