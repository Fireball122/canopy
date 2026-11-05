<#
.SYNOPSIS
  The Verification Cage Master Gatekeeper for Canopy.
.DESCRIPTION
  Enforces release version consistency, type safety, strict linting, production bundling, and
  optional native .NET compilation before any agent or developer work can be accepted.
#>
param(
  [switch]$Fast
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot

function Write-Pass([string]$msg) {
  Write-Host "[PASS] $msg" -ForegroundColor Green
}

function Write-Fail([string]$msg) {
  Write-Host "[FAIL] $msg" -ForegroundColor Red
}

function Write-Info([string]$msg) {
  Write-Host "[INFO] $msg" -ForegroundColor Cyan
}

function Write-WarnNotice([string]$msg) {
  Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  CANOPY VERIFICATION CAGE: EXECUTING GATES      " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Gate 1: Version consistency. Canopy.csproj <Version> is the source of truth (installer scripts
# default to it); package.json and the package-lock.json root must match it.
Write-Info "Gate 1/5: Checking release version consistency..."
[xml]$csproj = Get-Content -LiteralPath (Join-Path $RepoRoot 'Canopy.csproj') -Raw
$csprojVersion = @($csproj.Project.PropertyGroup | ForEach-Object { $_.Version } | Where-Object { $_ })[0]
# The first "version" key is the top-level one in both files. Regex instead of ConvertFrom-Json:
# Windows PowerShell 5.1 cannot parse package-lock.json's empty-string "" package key.
$versionPattern = '"version"\s*:\s*"([^"]+)"'
$packageJsonText = Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw
$packageLockText = Get-Content -LiteralPath (Join-Path $RepoRoot 'package-lock.json') -Raw
$versions = [ordered]@{
  'Canopy.csproj'     = "$csprojVersion".Trim()
  'package.json'      = [regex]::Match($packageJsonText, $versionPattern).Groups[1].Value
  'package-lock.json' = [regex]::Match($packageLockText, $versionPattern).Groups[1].Value
}
$distinctVersions = @($versions.Values | Select-Object -Unique)
if ([string]::IsNullOrWhiteSpace($versions['Canopy.csproj']) -or $distinctVersions.Count -ne 1) {
  foreach ($entry in $versions.GetEnumerator()) {
    Write-Fail "  $($entry.Key): '$($entry.Value)'"
  }
  Write-Fail "Version mismatch: bump Canopy.csproj, package.json and package-lock.json together."
  Write-Fail "VERIFICATION FAILED"
  exit 1
}
Write-Pass "Version $($versions['Canopy.csproj']) is consistent across csproj and npm manifests"

# Gate 2: TypeScript Strict Typecheck
Write-Info "Gate 2/5: Running TypeScript strict typecheck (tsc --noEmit)..."
Push-Location $RepoRoot
try {
  & cmd.exe /c "npm run typecheck"
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "TypeScript typecheck failed with exit code $LASTEXITCODE"
    Write-Fail "VERIFICATION FAILED"
    exit 1
  }
  Write-Pass "TypeScript strict typecheck passed"
}
finally {
  Pop-Location
}

# Gate 3: Biome Linter & Formatter
Write-Info "Gate 3/5: Running Biome linter & code rules (biome check src)..."
Push-Location $RepoRoot
try {
  & cmd.exe /c "npm run lint"
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Biome lint check failed with exit code $LASTEXITCODE"
    Write-Fail "VERIFICATION FAILED"
    exit 1
  }
  Write-Pass "Biome lint check passed"
}
finally {
  Pop-Location
}

# Gate 4: Production Frontend Bundle Build (typecheck already ran in Gate 2)
Write-Info "Gate 4/5: Running Vite production build (vite build)..."
Push-Location $RepoRoot
try {
  & cmd.exe /c "npx --no-install vite build"
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Frontend build failed with exit code $LASTEXITCODE"
    Write-Fail "VERIFICATION FAILED"
    exit 1
  }
  Write-Pass "Frontend production bundle built successfully"
}
finally {
  Pop-Location
}

# Gate 5: Native .NET 8 WPF Host Compilation (if .NET SDK available)
Write-Info "Gate 5/5: Checking native .NET 8 SDK availability..."
$dotnet = "dotnet"
if (Test-Path "$HOME\.dotnet\dotnet.exe") {
  $dotnet = "$HOME\.dotnet\dotnet.exe"
}
$sdkList = @()
# Windows PowerShell 5.1 turns redirected native stderr into a terminating error under
# ErrorActionPreference=Stop, which would silently skip this gate; relax it for the probe only.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $sdkOutput = & $dotnet --list-sdks 2>$null
  if ($sdkOutput) {
    $sdkList = @($sdkOutput | Where-Object { $_ -match '\S' })
  }
}
catch {
  $sdkList = @()
}
finally {
  $ErrorActionPreference = $previousPreference
}

if ($sdkList.Count -gt 0) {
  Write-Info "Found .NET SDK(s):"
  $sdkList | ForEach-Object { Write-Host "  - $_" -ForegroundColor DarkGray }
  Write-Info "Building Canopy.csproj in Release mode with /warnaserror..."
  Push-Location $RepoRoot
  try {
    & $dotnet build "$RepoRoot\Canopy.csproj" -c Release /p:SkipFrontendBuild=true /warnaserror
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Native C# .NET build failed with exit code $LASTEXITCODE"
      Write-Fail "VERIFICATION FAILED"
      exit 1
    }
    Write-Pass "Native C# host compiled with 0 warnings/errors"
  }
  finally {
    Pop-Location
  }
}
else {
  Write-WarnNotice ".NET SDK not installed on host machine (runtime only)."
  Write-WarnNotice "Skipping native host compilation; all frontend gates passed."
}

Write-Host "==================================================" -ForegroundColor Green
Write-Pass "ALL GATES PASSED"
Write-Host "==================================================" -ForegroundColor Green
exit 0
