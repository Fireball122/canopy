# Canopy Privacy Notice

Last updated: October 15, 2026

Canopy runs as a local Windows application. It does not include a Canopy account, its own analytics service, or automatic crash-reporting service.

## Data stored on this PC

Canopy stores its interface preferences in the embedded browser's local storage. The `Show panel on launch` preference is also stored under the current user's `HKCU\Software\CanopyShell\Canopy` registry key so the native host can use it before the interface loads. Diagnostic logs are created locally only when that setting is enabled.

Wallpaper paths, pinned applications, and other preferences stay on the PC unless a feature below sends an explicit query to a third party.

## Network requests

The following optional features make direct requests from the app:

- Weather in automatic mode asks ipapi.co for approximate IP-based location, then asks Open-Meteo for a forecast. A manually entered city is sent to Open-Meteo geocoding before requesting the forecast.
- Album-art lookup sends the active track title and artist to Apple's iTunes Search API only when the current media session has no artwork.
- Synced-lyrics lookup sends active track and artist information to LRCLIB when that media feature is used.

The app shows an unavailable state when a weather refresh fails; it does not substitute sample weather as live data.

These providers process requests under their own terms and privacy notices. Canopy does not proxy those requests or retain their responses outside the in-memory caches used while it is running.

## Updates and installation

The one-line installer contacts GitHub Releases to find and download a release package, downloads that release's published checksum file, and verifies the package before installation. If the Microsoft Edge WebView2 Runtime is missing, it downloads Microsoft's runtime bootstrapper and verifies its Windows signature before running it.

## Contact

For a privacy question or deletion request related to a future Canopy service, use the contact method published with the official project release.
