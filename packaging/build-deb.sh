#!/usr/bin/env bash
set -euo pipefail

# Build an amd64 Debian package.  PyInstaller embeds Python and every package
# from requirements.txt in /opt/aquamusic, so installing the resulting .deb
# never runs pip or downloads Python packages.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The build directory is disposable. Change away from it before cleaning so
# invoking this script from ./build never deletes the shell's current folder.
cd "$ROOT_DIR"
BUILD_DIR="$ROOT_DIR/build"
VERSION="${AQUAMUSIC_VERSION:-1.0.0}"
ARCH="${AQUAMUSIC_ARCH:-amd64}"
PACKAGE_NAME="aquamusic_${VERSION}_${ARCH}"
STAGE_DIR="$BUILD_DIR/$PACKAGE_NAME"
VENV_DIR="$BUILD_DIR/venv"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required offline asset: $1" >&2
    exit 1
  fi
}

require_file "$ROOT_DIR/static/vendor/lucide.min.js"

rm -rf "$BUILD_DIR"
mkdir -p "$STAGE_DIR/DEBIAN" "$STAGE_DIR/opt/aquamusic" "$STAGE_DIR/usr/bin" \
  "$STAGE_DIR/usr/share/applications" "$STAGE_DIR/usr/share/icons/hicolor/scalable/apps"

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$ROOT_DIR/requirements.txt"
"$VENV_DIR/bin/pyinstaller" --noconfirm --clean --windowed --name aquamusic \
  --distpath "$BUILD_DIR/dist" --workpath "$BUILD_DIR/pyinstaller" --specpath "$BUILD_DIR" \
  --add-data "$ROOT_DIR/templates:templates" --add-data "$ROOT_DIR/static:static" \
  --collect-all PyQt6 --collect-all PyQt6.QtWebEngineWidgets \
  "$ROOT_DIR/desktop.py"

cp -a "$BUILD_DIR/dist/aquamusic/." "$STAGE_DIR/opt/aquamusic/"
ln -s /opt/aquamusic/aquamusic "$STAGE_DIR/usr/bin/aquamusic"
install -m 0644 "$ROOT_DIR/packaging/aquamusic.desktop" "$STAGE_DIR/usr/share/applications/aquamusic.desktop"
install -m 0644 "$ROOT_DIR/packaging/aquamusic.svg" "$STAGE_DIR/usr/share/icons/hicolor/scalable/apps/aquamusic.svg"

sed -e "s/@VERSION@/$VERSION/" -e "s/@ARCH@/$ARCH/" \
  "$ROOT_DIR/packaging/control.in" > "$STAGE_DIR/DEBIAN/control"

dpkg-deb --build -Zzstd -z3 --root-owner-group "$STAGE_DIR" "$BUILD_DIR/${PACKAGE_NAME}.deb"
echo "Built $BUILD_DIR/${PACKAGE_NAME}.deb"
