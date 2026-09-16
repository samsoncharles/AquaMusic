#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Building AquaMusic Lightweight Windows Release (XAMPP-Style) ==="

WIN_BUILD_DIR="$ROOT_DIR/build/win_pkg"
WIN_APP_DIR="$WIN_BUILD_DIR/AquaMusic"
RELEASE_DIR="$ROOT_DIR/release"

rm -rf "$WIN_APP_DIR"
mkdir -p "$WIN_APP_DIR" "$RELEASE_DIR"

# 1. Copy Application Code & Assets
echo "--> Bundling AquaMusic application files..."
cp "$ROOT_DIR/app.py" "$WIN_APP_DIR/"
cp "$ROOT_DIR/control_panel.py" "$WIN_APP_DIR/"
cp "$ROOT_DIR/art.py" "$WIN_APP_DIR/"
cp "$ROOT_DIR/scanner.py" "$WIN_APP_DIR/"
cp "$ROOT_DIR/tagger.py" "$WIN_APP_DIR/"
cp "$ROOT_DIR/waveform.py" "$WIN_APP_DIR/"
cp "$ROOT_DIR/requirements.txt" "$WIN_APP_DIR/"
cp "$ROOT_DIR/AquaMusic.bat" "$WIN_APP_DIR/"
cp "$ROOT_DIR/install_requirements.bat" "$WIN_APP_DIR/"
cp "$ROOT_DIR/README.md" "$WIN_APP_DIR/"
cp -r "$ROOT_DIR/core" "$WIN_APP_DIR/"
cp -r "$ROOT_DIR/templates" "$WIN_APP_DIR/"
cp -r "$ROOT_DIR/static" "$WIN_APP_DIR/"
rm -rf "$WIN_APP_DIR/core/__pycache__" "$WIN_APP_DIR/__pycache__"

# 2. Compile Windows Native Launcher (AquaMusic.exe)
echo "--> Compiling native Windows GUI launcher..."
cd "$ROOT_DIR/packaging"
x86_64-w64-mingw32-windres aquamusic.rc -O coff -o aquamusic.res
x86_64-w64-mingw32-gcc -O2 -mwindows launcher.c aquamusic.res -lshlwapi -o "$WIN_APP_DIR/AquaMusic.exe"
cp "$ROOT_DIR/packaging/aquamusic.ico" "$WIN_APP_DIR/"
cp "$ROOT_DIR/packaging/aquamusic.png" "$WIN_APP_DIR/"
cd "$ROOT_DIR"

# 3. Build Standalone Portable Zip Release
echo "--> Creating AquaMusic portable ZIP package..."
cd "$WIN_BUILD_DIR"
rm -f "$RELEASE_DIR/AquaMusic-1.0.1-win64-portable.zip"
zip -q -r "$RELEASE_DIR/AquaMusic-1.0.1-win64-portable.zip" AquaMusic/
cd "$ROOT_DIR"

# 4. Build Single-File Setup Executable with NSIS
echo "--> Compiling Windows Setup (.exe) installer with NSIS..."
makensis "$ROOT_DIR/packaging/installer.nsi"

echo ""
echo "=== Windows Release Built Successfully! ==="
ls -lh "$RELEASE_DIR"/AquaMusic*

