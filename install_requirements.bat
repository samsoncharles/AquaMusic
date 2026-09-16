@echo off
title AquaMusic Setup - Installing Requirements
cd /d "%~dp0"
echo =======================================================
echo    AquaMusic Requirements Installer
echo =======================================================
echo.
echo Checking Python installation...

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not found in your system PATH.
    echo Please download and install Python 3 from https://www.python.org/
    echo Make sure to check "Add python.exe to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo Python detected:
python --version
echo.
echo Installing required packages (Flask, mutagen, Pillow, yt-dlp, requests)...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =======================================================
    echo   [SUCCESS] All requirements installed successfully!
    echo   You can now launch AquaMusic by running AquaMusic.bat
    echo =======================================================
) else (
    echo.
    echo [ERROR] Failed to install some requirements. Please check your internet connection.
)

echo.
pause

