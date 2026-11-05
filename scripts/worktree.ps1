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

# Resolve the main checkout even when this script is invoked from a worktree's own copy: the first
# `worktree list` entry is always the main working tree. Without this, `merge`/`abort` run from
# inside a worktree would merge into and then delete the worktree they are running from.
$RepoRoot = $null
$worktreeListing = & git -C $ScriptDir worktree list --porcelain
if ($LASTEXITCODE -eq 0) {
  $mainEntry = @($worktreeListing | Where-Object { $_ -like 'worktree *' })[0]
  if ($mainEntry) {
    $RepoRoot = (Resolve-Path -LiteralPath $mainEntry.Substring('worktree '.Length)).Path
  }
}
if (-not $RepoRoot) {
  $RepoRoot = Split-Path $ScriptDir -Parent
}
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

# Runs a git command whose failure is tolerated (cleanup paths). Windows PowerShell 5.1 promotes
# redirected native stderr to a terminating error under ErrorActionPreference=Stop, so a missing
# branch or worktree would otherwise abort the script halfway through cleanup.
function Invoke-GitTolerant {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & git @args 2>&1 | Out-Null
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
}

# Removes the shared node_modules junction without following it. `git worktree remove --force`
# must never see the junction, or it could recurse into the main checkout's node_modules.
function Remove-NodeModulesJunction([string]$worktreeDir) {
  $targetNodeModules = Join-Path $worktreeDir "node_modules"
  if (-not (Test-Path -LiteralPath $targetNodeModules)) {
    return
  }
  $item = Get-Item -LiteralPath $targetNodeModules -Force
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    # Non-recursive delete removes only the reparse point, never the junction target.
    [System.IO.Directory]::Delete($targetNodeModules, $false)
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
      if ($LASTEXITCODE -ne 0) {
        Write-WarnNotice "Could not create the node_modules junction; run npm ci inside the worktree."
      }
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
      Remove-NodeModulesJunction $TargetDir

      git worktree remove $TargetDir --force
      if ($LASTEXITCODE -ne 0) {
        Write-WarnNotice "Merged, but could not remove worktree '$TargetDir'; remove it manually."
        exit 1
      }
      git branch -d $Branch
      if ($LASTEXITCODE -ne 0) {
        Write-WarnNotice "Merged, but branch '$Branch' could not be deleted."
        exit 1
      }
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
      Remove-NodeModulesJunction $TargetDir

      if (Test-Path $TargetDir) {
        Invoke-GitTolerant worktree remove $TargetDir --force
      }

      if (Test-Path $TargetDir) {
        Remove-Item -Path $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
      }

      # Drop the stale administrative entry if the directory was removed outside git.
      Invoke-GitTolerant worktree prune
      Invoke-GitTolerant branch -D $Branch
      Write-Pass "Worktree and branch '$Branch' discarded."
    }
    finally {
      Pop-Location
    }
    exit 0
  }
}
