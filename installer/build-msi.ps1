# build-msi.ps1 - Compiles a native Windows Installer (.msi) using WiX v4
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
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "MSI versions must use major.minor.patch numbers, for example 1.2.3."
}

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

$distSource = Join-Path $ProjectRoot "dist"
if (-not (Test-Path (Join-Path $distSource "index.html"))) {
    throw "Frontend bundle missing: dist\index.html was not produced by npm run build."
}

Write-Host "==> 2. Publishing Canopy v$Version ($Configuration)..." -ForegroundColor Cyan
if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

$dotnet = "$HOME/.dotnet/dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = "dotnet" }

& $dotnet publish "$ProjectRoot\Canopy.csproj" -c $Configuration -r win-x64 -o $PublishDir --self-contained true -p:SkipFrontendBuild=true "-p:Version=$Version"
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

Copy-Item (Join-Path $ProjectRoot "app.ico") (Join-Path $PublishDir "app.ico") -Force

# Mirror dist/ exactly. dotnet publish already copies it, and Copy-Item onto an existing
# directory nests the source inside it (publish\dist\dist), duplicating the whole bundle.
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

function ConvertTo-XmlAttribute([string]$Text) {
    return [System.Security.SecurityElement]::Escape($Text)
}

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">')
[void]$sb.AppendLine('  <Fragment>')
[void]$sb.AppendLine('    <ComponentGroup Id="ProductComponents">')

foreach ($file in $allFiles) {
    $relPath = $file.FullName.Substring($PublishDir.Length).TrimStart('\', '/')
    $relDir = Split-Path -Parent $relPath
    $dirId = "INSTALLFOLDER"

    if ($relDir) {
        # Normalize directory path to ID
        $cleanDir = $relDir -replace '[\\/]', '_' -replace '[^a-zA-Z0-9_]', ''
        $dirId = "DIR_" + $cleanDir
    }

    # Component GUIDs derive from the install-relative path so they stay stable across versions,
    # which MajorUpgrade relies on to replace files cleanly.
    $identity = $relPath.Replace('\', '/').ToLowerInvariant()
    $hash = Get-StableHash $identity
    $hashText = ([System.BitConverter]::ToString($hash)).Replace('-', '')
    $compGuid = ([guid]::new([byte[]]$hash[0..15])).ToString().ToUpperInvariant()
    $componentId = "cmp_" + $hashText.Substring(0, 20)
    $fileId = "fil_" + $hashText.Substring(0, 20)
    $source = ConvertTo-XmlAttribute $file.FullName

    [void]$sb.AppendLine("      <Component Id=`"$componentId`" Directory=`"$dirId`" Guid=`"$compGuid`">")
    [void]$sb.AppendLine("        <File Id=`"$fileId`" Source=`"$source`" KeyPath=`"yes`" />")
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
        $dirName = ConvertTo-XmlAttribute $dir.Name
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

try {
    Write-Host "==> 4. Checking WiX Toolset..." -ForegroundColor Cyan
    $wix = "$HOME/.dotnet/tools/wix.exe"
    if (-not (Test-Path $wix)) {
        $wixCmd = Get-Command "wix" -ErrorAction SilentlyContinue
        $wix = if ($wixCmd) { $wixCmd.Source } else { $null }
    }
    if (-not $wix) {
        throw "WiX Toolset not found. Install it with: dotnet tool install --global wix --version 4.0.5"
    }

    # Ensure WixToolset.Util.wixext is available. `extension add` reports on stderr when the
    # extension is already cached; Windows PowerShell 5.1 turns redirected stderr into a
    # terminating error under ErrorActionPreference=Stop, so relax it for this probe only.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $wix extension add -g WixToolset.Util.wixext/4.0.5 2>&1 | Out-Null
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    $MsiOutput = Join-Path $OutputDir "Canopy-v$Version-x64.msi"
    Write-Host "==> 5. Building MSI Installer with WiX: $MsiOutput" -ForegroundColor Cyan

    & $wix build (Join-Path $ScriptDir "Canopy.wxs") "$GeneratedWxs" `
        -arch x64 `
        -ext WixToolset.Util.wixext `
        -d SourceDir="$PublishDir" `
        -d ProductVersion="$Version" `
        -out "$MsiOutput"
    if ($LASTEXITCODE -ne 0) { throw "WiX build failed" }
}
finally {
    Remove-Item $GeneratedWxs -Force -ErrorAction SilentlyContinue
}

Write-Host "==> SUCCESS: Created $MsiOutput" -ForegroundColor Green
$msiItem = Get-Item $MsiOutput
Write-Host ("Installer Size: {0:N2} MB" -f ($msiItem.Length / 1MB)) -ForegroundColor Green
# winget/CanopyShell.Canopy.installer.yaml needs this hash (and the new ProductCode) per release.
Write-Host ("SHA256: {0}" -f (Get-FileHash -LiteralPath $MsiOutput -Algorithm SHA256).Hash) -ForegroundColor Green
