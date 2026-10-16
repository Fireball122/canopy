@echo off
setlocal
if exist "%~dp0Canopy.exe" (
    cd /d "%~dp0"
    start "" "Canopy.exe" --expand
    exit /b 0
)
if exist "%LOCALAPPDATA%\Programs\Canopy\Canopy.exe" (
    cd /d "%LOCALAPPDATA%\Programs\Canopy"
    start "" "Canopy.exe" --expand
    exit /b 0
)
if exist "%LOCALAPPDATA%\Canopy\Canopy.exe" (
    cd /d "%LOCALAPPDATA%\Canopy"
    start "" "Canopy.exe" --expand
    exit /b 0
)
echo [ERROR] Canopy.exe not found.
pause
exit /b 1
