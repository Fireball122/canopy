# Canopy - Packaging, Installer & GitHub Release Guide

This document explains every way you can package, distribute, and install Canopy for other Windows users.

---

## 1. Quick Summary of Distribution Formats

| Format | Target File | Best For | Prerequisites |
|---|---|---|---|
| **Setup Wizard** | `dist-installer/Canopy-v<version>-Setup.exe` | Most users (README recommendation) | Built with Inno Setup 6 |
| **Windows MSI Installer** | `dist-installer/Canopy-v<version>-x64.msi` | Silent/managed deployment, winget | Built with WiX v4 |
| **Portable Release ZIP** | `dist-installer/Canopy-v<version>-win-x64-portable.zip` | Power users, no-install, thumb drives | None (fully self-contained) |
| **One-Line PowerShell Install** | `install.ps1` | Fast terminal setup | None (Windows PowerShell 5.1+) |
| **Windows Package Manager** | `winget install CanopyShell.Canopy` | Terminal users (`winget`) | PR to `microsoft/winget-pkgs` |

All installers are per-user (`%LOCALAPPDATA%\Programs\Canopy`) and need no administrator rights.
Every build is self-contained (.NET 8 runtime bundled); only the Microsoft Edge WebView2 Runtime is
required, and the Setup wizard and `install.ps1` install it when missing.

---

## 2. Versioning

`<Version>` in `Canopy.csproj` is the single source of truth. The build scripts default to it, the
release workflow refuses to publish a tag that differs from it, and `verify.ps1` fails when
`package.json` / `package-lock.json` disagree. To cut a release, bump all three together:

1. `Canopy.csproj` -> `<Version>X.Y.Z</Version>`
2. `package.json` -> `"version": "X.Y.Z"`
3. `package-lock.json` -> top-level `"version"` and `packages[""].version` (or run `npm install --package-lock-only`)

Then run `powershell -ExecutionPolicy Bypass -File .\verify.ps1`.

---

## 3. One-Line Install Command

Users can install or update Canopy directly from PowerShell without manual downloading:

```powershell
irm https://raw.githubusercontent.com/Fireball122/canopy/main/install.ps1 | iex
```

### What this command does:
1. Installs the Microsoft Edge WebView2 Runtime if it is missing (signature-checked Microsoft bootstrapper).
2. Queries the GitHub Releases API for the latest version and downloads the portable ZIP.
3. Verifies the download against the release's `checksums-sha256.txt` and refuses to install on mismatch.
4. Installs to `%LOCALAPPDATA%\Programs\Canopy` (**per-user: no administrator / UAC prompt required**),
   adds **Start Menu** and **Desktop** shortcuts, and launches Canopy.

### To uninstall cleanly:
```powershell
# Recommended one-liner
$env:CANOPY_UNINSTALL=1; irm https://raw.githubusercontent.com/Fireball122/canopy/main/install.ps1 | iex

# Or via scriptblock invocation
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Fireball122/canopy/main/install.ps1))) -Uninstall
```

---

## 4. Building Installers Locally

All build scripts are included in the repository. Omit `-Version` to use the version from `Canopy.csproj`.

### Option A: Setup Wizard (`.exe`)
```powershell
.\installer\build-setup-exe.ps1
```
* **Output:** `dist-installer\Canopy-v<version>-Setup.exe`
* Requires **Inno Setup 6** (`winget install JRSoftware.InnoSetup`).
* Offers desktop shortcut and start-with-Windows options, installs WebView2 when missing, closes a
  running Canopy before upgrading, and on uninstall optionally removes `%LOCALAPPDATA%\Canopy` data.

### Option B: Native MSI Installer (`.msi`)
```powershell
.\installer\build-msi.ps1
```
* **Output:** `dist-installer\Canopy-v<version>-x64.msi`
* Requires **WiX Toolset v4** (`dotnet tool install --global wix --version 4.0.5`).
* Per-user install registered in Settings -> Installed Apps, with Start Menu and Desktop shortcuts.
  The stable `UpgradeCode` plus `MajorUpgrade` replaces older versions in place.
* Prints the MSI SHA256 at the end (needed for winget).

### Option C: Portable Self-Contained ZIP (`.zip`)
```powershell
.\build-portable.ps1
```
* **Output:** `dist-installer\Canopy-v<version>-win-x64-portable.zip`
* Single-file `Canopy.exe` (.NET 8 runtime bundled) plus the `dist/` UI bundle and `Start Canopy.bat`.
* Unzip and run anywhere — zero runtime dependencies besides WebView2.

---

## 5. Automated GitHub Releases

The repository includes `.github/workflows/release.yml`. After bumping the version (section 2):

1. Commit your changes and tag the commit:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
2. GitHub Actions will automatically:
   - Fail fast if the tag does not match `<Version>` in `Canopy.csproj`.
   - Install dependencies (`npm ci`) and run Biome.
   - Build the `.msi` (WiX; this step type-checks and bundles the React frontend), the portable
     `.zip`, and the `Setup.exe` (Inno Setup); each publishes the self-contained .NET 8 host for `win-x64`.
   - Calculate SHA256 checksums (`checksums-sha256.txt`, consumed by `install.ps1`).
   - Create the GitHub Release `vX.Y.Z` and attach the Setup EXE, MSI, ZIP, and checksums.

A manual run (Actions -> Release Canopy -> Run workflow) uses the csproj version and creates the tag.

Pull requests and pushes to `main` run `.github/workflows/validate.yml`, which executes `verify.ps1`
under Windows PowerShell 5.1.

---

## 6. Publishing to Windows Package Manager (`winget`)

The manifests live in `winget/` (multi-file format: version, installer, and en-US locale).
`Canopy.wxs` generates a new MSI `ProductCode` on every build, so both the hash and the product code
must be refreshed from the **published** MSI for each release.

Easiest: let `wingetcreate` compute both and open the PR:
```powershell
winget install Microsoft.WingetCreate
wingetcreate update CanopyShell.Canopy --version X.Y.Z `
  --urls https://github.com/Fireball122/canopy/releases/download/vX.Y.Z/Canopy-vX.Y.Z-x64.msi --submit
```

Manual alternative:
1. Get the SHA256 from `checksums-sha256.txt` (or `Get-FileHash dist-installer\Canopy-vX.Y.Z-x64.msi`).
2. Read the `ProductCode` of that MSI (e.g. Orca, or `wingetcreate` output).
3. Update `PackageVersion` in all three files and `InstallerUrl`, `InstallerSha256`, and `ProductCode`
   in `winget/CanopyShell.Canopy.installer.yaml`.
4. Validate and submit:
   ```powershell
   winget validate --manifest winget
   wingetcreate submit winget
   ```
   Or open a pull request directly on [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
