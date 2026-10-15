<#
.SYNOPSIS
  The Verification Cage Master Gatekeeper for Canopy.
.DESCRIPTION
  Enforces type safety, strict linting, production bundling, and optional
  native .NET compilation before any agent or developer work can be accepted.
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

# Gate 1: TypeScript Strict Typecheck
Write-Info "Gate 1/4: Running TypeScript strict typecheck (tsc --noEmit)..."
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

# Gate 2: Biome Linter & Formatter
Write-Info "Gate 2/4: Running Biome linter & code rules (biome check src)..."
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

# Gate 3: Production Frontend Bundle Build
Write-Info "Gate 3/4: Running Vite production build (vite build)..."
Push-Location $RepoRoot
try {
  & cmd.exe /c "npm run build"
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

# Gate 4: Native .NET 8 WPF Host Compilation (if .NET SDK available)
Write-Info "Gate 4/4: Checking native .NET 8 SDK availability..."
$sdkList = @()
try {
  $sdkOutput = & dotnet --list-sdks 2>$null
  if ($sdkOutput) {
    $sdkList = $sdkOutput | Where-Object { $_ -match '\S' }
  }
}
catch {
  $sdkList = @()
}

if ($sdkList.Count -gt 0) {
  Write-Info "Found .NET SDK(s):"
  $sdkList | ForEach-Object { Write-Host "  - $_" -ForegroundColor DarkGray }
  Write-Info "Building Canopy.csproj in Release mode with /warnaserror..."
  Push-Location $RepoRoot
  try {
    & dotnet build "$RepoRoot\Canopy.csproj" -c Release /p:SkipFrontendBuild=true /warnaserror
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
