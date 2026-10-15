<#
.SYNOPSIS
  Git Worktree Isolation Automation for Canopy AI Agents and Developers.
.DESCRIPTION
  Enforces atomic isolation for features, refactors, and experiments.
  Prevents dirty git states and contaminated branches on main.
.EXAMPLE
  .\scripts\worktree.ps1 new my-feature
  .\scripts\worktree.ps1 test my-feature
  .\scripts\worktree.ps1 merge my-feature
  .\scripts\worktree.ps1 abort my-feature
  .\scripts\worktree.ps1 list
#>
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('new', 'test', 'merge', 'abort', 'list')]
  [string]$Action,

  [Parameter(Position = 1, Mandatory = $false)]
  [string]$FeatureName
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$RepoRoot = Split-Path $ScriptDir -Parent
$WorktreeBase = Join-Path (Split-Path $RepoRoot -Parent) "canopy-worktrees"

function Write-Info([string]$msg) {
  Write-Host "[INFO] $msg" -ForegroundColor Cyan
}

function Write-Pass([string]$msg) {
  Write-Host "[PASS] $msg" -ForegroundColor Green
}

function Write-Fail([string]$msg) {
  Write-Host "[FAIL] $msg" -ForegroundColor Red
}

function Write-WarnNotice([string]$msg) {
  Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Assert-FeatureName([string]$name) {
  if ([string]::IsNullOrWhiteSpace($name)) {
    Write-Fail "Feature name is required for action '$Action'."
    Write-Host "Usage: .\scripts\worktree.ps1 $Action <feature-name>" -ForegroundColor Yellow
    exit 1
  }
}

switch ($Action) {
  'list' {
    Write-Info "Active Git Worktrees:"
    Push-Location $RepoRoot
    try {
      git worktree list
    }
    finally {
      Pop-Location
    }
    exit 0
  }

  'new' {
    Assert-FeatureName $FeatureName
    $Branch = "feat/$FeatureName"
    $TargetDir = Join-Path $WorktreeBase $FeatureName

    if (Test-Path $TargetDir) {
      Write-Fail "Worktree directory already exists: $TargetDir"
      exit 1
    }

    if (-not (Test-Path $WorktreeBase)) {
      New-Item -ItemType Directory -Path $WorktreeBase -Force | Out-Null
    }

    Write-Info "Creating isolated worktree for branch '$Branch' at '$TargetDir'..."
    Push-Location $RepoRoot
    try {
      # Check if branch already exists
      $branchExists = git branch --list $Branch
      if ($branchExists) {
        git worktree add $TargetDir $Branch
      }
      else {
        git worktree add -b $Branch $TargetDir HEAD
      }

      if ($LASTEXITCODE -ne 0) {
        Write-Fail "Failed to create worktree."
        exit 1
      }
    }
    finally {
      Pop-Location
    }

    # Link node_modules using NTFS directory junction for fast zero-overhead dependency sharing
    $sourceNodeModules = Join-Path $RepoRoot "node_modules"
    $targetNodeModules = Join-Path $TargetDir "node_modules"
    if ((Test-Path $sourceNodeModules) -and (-not (Test-Path $targetNodeModules))) {
      Write-Info "Linking shared node_modules via NTFS junction..."
      & cmd.exe /c "mklink /J `"$targetNodeModules`" `"$sourceNodeModules`"" | Out-Null
    }

    # Copy local environment files and uncommitted cage scripts if present
    $sourceEnv = Join-Path $RepoRoot ".env"
    if (Test-Path $sourceEnv) {
      Copy-Item $sourceEnv (Join-Path $TargetDir ".env") -Force
    }

    $cageFiles = @('verify.ps1', 'biome.json', 'AGENTS.md', 'SPEC.md')
    foreach ($f in $cageFiles) {
      $srcFile = Join-Path $RepoRoot $f
      $dstFile = Join-Path $TargetDir $f
      if ((Test-Path $srcFile) -and (-not (Test-Path $dstFile))) {
        Copy-Item $srcFile $dstFile -Force
      }
    }
    Write-Pass "Worktree '$FeatureName' created successfully."
    Write-Host "`nTo start developing in isolation:" -ForegroundColor Cyan
    Write-Host "  cd `"$TargetDir`"" -ForegroundColor White
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\verify.ps1" -ForegroundColor White
    exit 0
  }

  'test' {
    $TargetDir = $RepoRoot
    if (-not [string]::IsNullOrWhiteSpace($FeatureName)) {
      $TargetDir = Join-Path $WorktreeBase $FeatureName
    }
    elseif (Test-Path ".\verify.ps1") {
      $TargetDir = (Get-Item ".").FullName
    }

    $VerifyScript = Join-Path $TargetDir "verify.ps1"
    if (-not (Test-Path $VerifyScript)) {
      Write-Fail "verify.ps1 not found in target directory: $TargetDir"
      exit 1
    }

    Write-Info "Running verification in '$TargetDir'..."
    Push-Location $TargetDir
    try {
      & powershell -NoProfile -ExecutionPolicy Bypass -File ".\verify.ps1"
      if ($LASTEXITCODE -ne 0) {
        Write-Fail "Verification gate failed in worktree."
        exit 1
      }
      Write-Pass "Verification gate passed in worktree."
    }
    finally {
      Pop-Location
    }
    exit 0
  }

  'merge' {
    Assert-FeatureName $FeatureName
    $Branch = "feat/$FeatureName"
    $TargetDir = Join-Path $WorktreeBase $FeatureName

    if (-not (Test-Path $TargetDir)) {
      Write-Fail "Worktree directory does not exist: $TargetDir"
      exit 1
    }

    Write-Info "Step 1: Running verification gate on worktree before merge..."
    Push-Location $TargetDir
    try {
      & powershell -NoProfile -ExecutionPolicy Bypass -File ".\verify.ps1"
      if ($LASTEXITCODE -ne 0) {
        Write-Fail "Verification failed. Refusing to merge unverified branch '$Branch'."
        exit 1
      }
    }
    finally {
      Pop-Location
    }

    Write-Info "Step 2: Merging '$Branch' into current branch..."
    Push-Location $RepoRoot
    try {
      git merge $Branch --no-ff -m "feat: merge $Branch after verification cage pass"
      if ($LASTEXITCODE -ne 0) {
        Write-Fail "Git merge encountered conflicts."
        exit 1
      }

      Write-Info "Step 3: Cleaning up worktree and branch..."
      # Remove junction if present
      $targetNodeModules = Join-Path $TargetDir "node_modules"
      if (Test-Path $targetNodeModules) {
        & cmd.exe /c "rmdir `"$targetNodeModules`"" 2>$null | Out-Null
      }

      git worktree remove $TargetDir --force
      git branch -d $Branch
      Write-Pass "Successfully merged '$Branch' and cleaned up worktree."
    }
    finally {
      Pop-Location
    }
    exit 0
  }

  'abort' {
    Assert-FeatureName $FeatureName
    $Branch = "feat/$FeatureName"
    $TargetDir = Join-Path $WorktreeBase $FeatureName

    Write-WarnNotice "Aborting and discarding worktree '$FeatureName'..."
    Push-Location $RepoRoot
    try {
      $targetNodeModules = Join-Path $TargetDir "node_modules"
      if (Test-Path $targetNodeModules) {
        & cmd.exe /c "rmdir `"$targetNodeModules`"" 2>$null | Out-Null
      }

      if (Test-Path $TargetDir) {
        git worktree remove $TargetDir --force 2>$null
      }

      if (Test-Path $TargetDir) {
        Remove-Item -Path $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
      }

      git branch -D $Branch 2>$null
      Write-Pass "Worktree and branch '$Branch' discarded."
    }
    finally {
      Pop-Location
    }
    exit 0
  }
}
