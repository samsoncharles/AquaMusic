@echo off
cd /d "%~dp0"

REM Try pythonw first for windowless launch of Control Panel
where pythonw >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" pythonw control_panel.py
    exit /b 0
)

REM Fallback to python
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" python control_panel.py
    exit /b 0
)

REM Fallback to py launcher
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" py -3 control_panel.py
    exit /b 0
)

echo =======================================================
echo   [ERROR] Python is not installed or not in PATH!
echo =======================================================
echo.
echo AquaMusic requires Python 3.
echo 1. Download and install Python from: https://www.python.org/
echo 2. Make sure to check "Add python.exe to PATH" during install.
echo 3. Run "install_requirements.bat" to install dependencies.
echo.
pause

