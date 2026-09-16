#!/usr/bin/env bash
set -euo pipefail

# Build a lightweight XAMPP-style Debian package for AquaMusic.
# Contains the AquaMusic server, desktop Control Panel GUI (Tkinter),
# web assets, desktop shortcuts, and dependency automation.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
BUILD_DIR="$ROOT_DIR/build"
VERSION="${AQUAMUSIC_VERSION:-1.0.1}"
ARCH="${AQUAMUSIC_ARCH:-all}"
PACKAGE_NAME="aquamusic_${VERSION}_${ARCH}"
STAGE_DIR="$BUILD_DIR/$PACKAGE_NAME"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required offline asset: $1" >&2
    exit 1
  fi
}

require_file "$ROOT_DIR/static/vendor/lucide.min.js"
require_file "$ROOT_DIR/static/fonts/inter-400.woff2"
require_file "$ROOT_DIR/static/images/default-art.svg"

echo "--> Preparing stage directory: $STAGE_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/DEBIAN" \
         "$STAGE_DIR/opt/aquamusic" \
         "$STAGE_DIR/usr/bin" \
         "$STAGE_DIR/usr/share/applications" \
         "$STAGE_DIR/usr/share/icons/hicolor/scalable/apps"

echo "--> Staging AquaMusic application files..."
cp "$ROOT_DIR/app.py" "$STAGE_DIR/opt/aquamusic/"
cp "$ROOT_DIR/control_panel.py" "$STAGE_DIR/opt/aquamusic/"
cp "$ROOT_DIR/art.py" "$STAGE_DIR/opt/aquamusic/"
cp "$ROOT_DIR/scanner.py" "$STAGE_DIR/opt/aquamusic/"
cp "$ROOT_DIR/tagger.py" "$STAGE_DIR/opt/aquamusic/"
cp "$ROOT_DIR/waveform.py" "$STAGE_DIR/opt/aquamusic/"
cp "$ROOT_DIR/requirements.txt" "$STAGE_DIR/opt/aquamusic/"
cp -r "$ROOT_DIR/core" "$STAGE_DIR/opt/aquamusic/"
cp -r "$ROOT_DIR/templates" "$STAGE_DIR/opt/aquamusic/"
cp -r "$ROOT_DIR/static" "$STAGE_DIR/opt/aquamusic/"
rm -rf "$STAGE_DIR/opt/aquamusic/core/__pycache__"

# Copy icons
if [[ -f "$ROOT_DIR/packaging/aquamusic.ico" ]]; then
  cp "$ROOT_DIR/packaging/aquamusic.ico" "$STAGE_DIR/opt/aquamusic/"
fi
if [[ -f "$ROOT_DIR/packaging/aquamusic.png" ]]; then
  cp "$ROOT_DIR/packaging/aquamusic.png" "$STAGE_DIR/opt/aquamusic/"
  mkdir -p "$STAGE_DIR/usr/share/pixmaps" "$STAGE_DIR/usr/share/icons/hicolor/256x256/apps"
  install -m 0644 "$ROOT_DIR/packaging/aquamusic.png" "$STAGE_DIR/usr/share/pixmaps/aquamusic.png"
  install -m 0644 "$ROOT_DIR/packaging/aquamusic.png" "$STAGE_DIR/usr/share/icons/hicolor/256x256/apps/aquamusic.png"
fi

# Create executable launcher script in /usr/bin
cat << 'EOF' > "$STAGE_DIR/usr/bin/aquamusic"
#!/usr/bin/env bash
exec python3 /opt/aquamusic/control_panel.py "$@"
EOF
chmod 0755 "$STAGE_DIR/usr/bin/aquamusic"

# Install Port 80 network sharing proxy helper
install -m 0755 "$ROOT_DIR/packaging/aquamusic-share-port80" "$STAGE_DIR/usr/bin/aquamusic-share-port80"

# Desktop integration
install -m 0644 "$ROOT_DIR/packaging/aquamusic.desktop" "$STAGE_DIR/usr/share/applications/aquamusic.desktop"
install -m 0644 "$ROOT_DIR/packaging/aquamusic.svg" "$STAGE_DIR/usr/share/icons/hicolor/scalable/apps/aquamusic.svg"

# Debian control file
sed -e "s/@VERSION@/$VERSION/" -e "s/@ARCH@/$ARCH/" \
  "$ROOT_DIR/packaging/control.in" > "$STAGE_DIR/DEBIAN/control"

# Post-install hook: updates icon/mime caches and installs pip requirements if pip is present
cat << 'EOF' > "$STAGE_DIR/DEBIAN/postinst"
#!/usr/bin/env bash
set -e

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

# Install requirements if pip is available
if command -v pip3 >/dev/null 2>&1; then
    pip3 install -r /opt/aquamusic/requirements.txt --break-system-packages >/dev/null 2>&1 || true
elif command -v pip >/dev/null 2>&1; then
    pip install -r /opt/aquamusic/requirements.txt --break-system-packages >/dev/null 2>&1 || true
fi

exit 0
EOF
chmod 0755 "$STAGE_DIR/DEBIAN/postinst"

# Post-remove hook: cleanup
cat << 'EOF' > "$STAGE_DIR/DEBIAN/postrm"
#!/usr/bin/env bash
set -e

if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database -q /usr/share/applications || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
    fi
fi

exit 0
EOF
chmod 0755 "$STAGE_DIR/DEBIAN/postrm"

echo "--> Building Debian package with dpkg-deb..."
dpkg-deb --build -Zzstd -z3 --root-owner-group "$STAGE_DIR" "$BUILD_DIR/${PACKAGE_NAME}.deb"

mkdir -p "$ROOT_DIR/release"
cp -a "$BUILD_DIR/${PACKAGE_NAME}.deb" "$ROOT_DIR/release/"
# Also provide amd64 copy for convenience
if [[ "$ARCH" == "all" ]]; then
  cp -a "$BUILD_DIR/${PACKAGE_NAME}.deb" "$ROOT_DIR/release/aquamusic_${VERSION}_amd64.deb"
fi

echo "--> Built successfully: $ROOT_DIR/release/${PACKAGE_NAME}.deb"
ls -lh "$ROOT_DIR/release"/aquamusic_*.deb
