# Canopy - Packaging, Installer & GitHub Release Guide

This document explains every way you can package, distribute, and install Canopy for other Windows users.

---

## 1. Quick Summary of Distribution Formats

| Format | Target File | Best For | Prerequisites |
|---|---|---|---|
| **One-Line PowerShell Install** | `install.ps1` | GitHub README, fast terminal setup | None (runs in Windows PowerShell) |
| **Windows MSI Installer** | `dist-installer/Canopy-v1.0.0-x64.msi` | Standard users, enterprise, GPO | Built with WiX v4 (included script) |
| **Portable Release ZIP** | `dist-installer/Canopy-v1.0.0-win-x64-portable.zip` | Power users, no-install, thumb drives | None (fully self-contained) |
| **Windows Package Manager** | `winget install CanopyShell.Canopy` | Terminal users (`winget`) | PR to `microsoft/winget-pkgs` |

---

## 2. One-Line Install Command (Recommended for GitHub README)

Users can install or update Canopy directly from PowerShell without manual downloading:

```powershell
irm https://raw.githubusercontent.com/<YOUR-USERNAME>/canopy/main/install.ps1 | iex
```

### What this command does:
1. Automatically queries the GitHub Releases API for the latest version.
2. Downloads the package and installs it to `%LOCALAPPDATA%\Programs\Canopy` (**Per-user: no administrator / UAC prompt required**).
3. Adds shortcuts to the **Start Menu** and **Desktop**.
4. Automatically launches Canopy.

### To uninstall cleanly:
```powershell
# Recommended one-liner
$env:CANOPY_UNINSTALL=1; irm https://raw.githubusercontent.com/<YOUR-USERNAME>/canopy/main/install.ps1 | iex

# Or via scriptblock invocation
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/<YOUR-USERNAME>/canopy/main/install.ps1))) -Uninstall
```

---

## 3. Building Installers Locally

All build scripts are included in the repository.

### Option A: Build Native MSI Installer (`.msi`)
```powershell
.\installer\build-msi.ps1 -Version "1.0.0"
```
* **Output:** `dist-installer\Canopy-v1.0.0-x64.msi` (~8 MB)
* Built using **WiX Toolset v4**.
* Double-clicking installs per-user, registers in Windows Settings $\to$ Installed Apps, and creates start menu shortcuts.

### Option B: Build Portable Self-Contained ZIP (`.zip`)
```powershell
.\build-portable.ps1 -Version "1.0.0"
```
* **Output:** `dist-installer\Canopy-v1.0.0-win-x64-portable.zip`
* Bundles `Canopy.exe` and `dist/` with .NET 8 self-contained runtime.
* Unzip and run anywhere — zero runtime dependencies.

### Primary Installer Standardization
Canopy standardizes on the native **WiX v4 Windows Installer (`.msi`)** as its primary installer rather than legacy wizard `.exe` generators. This guarantees clean integration into Windows 11 `Settings -> Apps -> Installed Apps`, atomic rollbacks, zero UAC elevation prompts (per-user scope), and eliminates orphaned Windows Registry uninstaller entries.
---

## 4. Automated GitHub Releases (Zero Effort CI/CD)

The repository includes `.github/workflows/release.yml`.

Whenever you are ready to publish a new release to GitHub:

1. Commit your changes and tag the commit:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. GitHub Actions will automatically:
   - Check out the code on a clean Windows runner.
   - Compile the React frontend with Vite & TypeScript (`npm ci && npm run build`).
   - Compile the .NET 8 WPF application for `win-x64`.
   - Build the native `.msi` installer via WiX.
   - Package the `.zip` portable bundle.
   - Calculate SHA256 checksums (`checksums-sha256.txt`).
   - Create a GitHub Release and attach the MSI, ZIP, and checksums.

---

## 5. Publishing to Windows Package Manager (`winget`)

Once your GitHub Release has `Canopy-v1.0.0-x64.msi` uploaded:

1. Calculate the SHA256 hash of the MSI installer:
   ```powershell
   (Get-FileHash dist-installer\Canopy-v1.0.0-x64.msi -Algorithm SHA256).Hash.ToLower()
   ```
2. Replace `InstallerSha256` and `InstallerUrl` in `winget/canopy.yaml`.
3. Submit via Microsoft's `wingetcreate` tool:
   ```powershell
   winget install wingetcreate
   wingetcreate submit winget/canopy.yaml
   ```
   Or open a pull request directly on [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).

---

## 6. How to Distribute on GitHub (Step-by-Step for You)

1. **Create your repository on GitHub:**
   - Go to `https://github.com/new`, name it `canopy`, and set it to Public.
2. **Push the codebase:**
   ```bash
   git init
   git add .
   git commit -m "Initial release of Canopy"
   git remote add origin https://github.com/<YOUR-USERNAME>/canopy.git
   git branch -M main
   git push -u origin main
   ```
3. **Trigger your first Release:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. **Update the README:**
   - Add the one-line install command pointing to your repository:
     ```markdown
     ## Quick Install (Windows 10 / 11)
     Open PowerShell and run:
     ```powershell
     irm https://raw.githubusercontent.com/<YOUR-USERNAME>/canopy/main/install.ps1 | iex
     ```
     Or grab `Canopy-v1.0.0-x64.msi` from [Releases](https://github.com/<YOUR-USERNAME>/canopy/releases).
     ```
