# Signs the MSI and the executable inside each portable ZIP for a release build.
# GitHub Actions provides WINDOWS_CERTIFICATE_BASE64 and WINDOWS_CERTIFICATE_PASSWORD as secrets.
[CmdletBinding()]
param(
    [string]$ArtifactsDirectory = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\dist-installer"),
    [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

function Get-SignToolPath {
    $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
    $kitRoot = Join-Path $programFilesX86 "Windows Kits\10\bin"
    $candidate = Get-ChildItem -Path $kitRoot -Filter "signtool.exe" -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -match "\\x64$" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $candidate) { throw "signtool.exe was not found. Install the Windows SDK signing tools." }
    return $candidate.FullName
}

$certificateBase64 = $env:WINDOWS_CERTIFICATE_BASE64
$certificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD
if ([string]::IsNullOrWhiteSpace($certificateBase64) -or [string]::IsNullOrWhiteSpace($certificatePassword)) {
    throw "WINDOWS_CERTIFICATE_BASE64 and WINDOWS_CERTIFICATE_PASSWORD must be provided."
}

$signTool = Get-SignToolPath
$artifacts = Resolve-Path -LiteralPath $ArtifactsDirectory -ErrorAction Stop
$workingDirectory = Join-Path $env:TEMP ("Canopy-signing-" + [guid]::NewGuid().ToString())
$certificatePath = Join-Path $workingDirectory "release-signing.pfx"

function Sign-ReleaseFile([string]$Path) {
    Write-Host "==> Signing $(Split-Path -Leaf $Path)" -ForegroundColor Cyan
    & $signTool sign /fd SHA256 /a /f $certificatePath /p $certificatePassword /tr $TimestampServer /td SHA256 $Path
    if ($LASTEXITCODE -ne 0) { throw "Signing failed for $Path" }

    & $signTool verify /pa /v $Path
    if ($LASTEXITCODE -ne 0) { throw "Signature verification failed for $Path" }
}

try {
    New-Item -ItemType Directory -Path $workingDirectory -Force | Out-Null
    [System.IO.File]::WriteAllBytes($certificatePath, [System.Convert]::FromBase64String($certificateBase64))

    Get-ChildItem -Path $artifacts -Filter "Canopy-*.msi" -File | ForEach-Object {
        Sign-ReleaseFile $_.FullName
    }

    Get-ChildItem -Path $artifacts -Filter "Canopy-*.zip" -File | ForEach-Object {
        $archive = $_
        $archiveDirectory = Join-Path $workingDirectory ([guid]::NewGuid().ToString())
        Expand-Archive -LiteralPath $archive.FullName -DestinationPath $archiveDirectory -Force
        $executable = Get-ChildItem -Path $archiveDirectory -Filter "Canopy.exe" -Recurse -File | Select-Object -First 1
        if (-not $executable) { throw "Canopy.exe was not found in $($archive.Name)." }

        Sign-ReleaseFile $executable.FullName
        Remove-Item -LiteralPath $archive.FullName -Force
        Compress-Archive -Path (Join-Path $archiveDirectory '*') -DestinationPath $archive.FullName -CompressionLevel Optimal
    }
}
finally {
    Remove-Item -LiteralPath $workingDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
