<#
.SYNOPSIS
  Configures Git to use repository pre-commit hooks.
#>
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent

Write-Host "Configuring Git hooks path for Canopy..." -ForegroundColor Cyan
Push-Location $RepoRoot
try {
  git config core.hooksPath .githooks
  $currentHooks = git config core.hooksPath
  if ($currentHooks -eq '.githooks') {
    Write-Host "[PASS] Git hooks configured successfully: core.hooksPath = $currentHooks" -ForegroundColor Green
    Write-Host "Every commit will now be verified through verify.ps1." -ForegroundColor Green
  }
  else {
    Write-Host "[FAIL] Failed to configure core.hooksPath (got: $currentHooks)" -ForegroundColor Red
    exit 1
  }
}
finally {
  Pop-Location
}
