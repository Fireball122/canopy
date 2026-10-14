@echo off
setlocal
set "CANOPY_DIR=%LOCALAPPDATA%\Canopy"
set "CANOPY_EXE=%CANOPY_DIR%\Canopy.exe"

if not exist "%CANOPY_EXE%" (
    echo [ERROR] Canopy.exe not found at %CANOPY_EXE%
    echo Please make sure Canopy is installed/published.
    pause
    exit /b 1
)

cd /d "%CANOPY_DIR%"
start "" "%CANOPY_EXE%" --expand
exit /b 0
