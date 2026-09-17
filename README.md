# AquaMusic v1.0.1

A modern, high-fidelity personal music player, online YouTube music streamer, and offline audio manager built with Python, Flask, and vanilla web technologies.

Featuring a lightweight **XAMPP-style Control Panel**, synchronized line-by-line immersive lyrics, 10-band equalizer, living aurora frosted-glass aesthetics, high-speed unthrottled streaming and MP3 downloads to Safe Folder, and local network sharing.

---

## What's New in v1.0.1

- **Lightweight XAMPP-Style Control Panel**:
  - Native desktop control panel GUI (`control_panel.py`) using native Tkinter — ultra-lightweight (package size reduced by **99.9%** from 282MB down to **283KB**).
  - Explicit **Start / Stop** toggle controls, editable port entry with validation, module status, and live LAN access links.
  - Built-in requirement checker and automated 1-click `pip` package installer.
  - Real-time scrolling server log viewer.
- **YouTube Music Streaming & Safe Folder MP3 Downloader**:
  - Unthrottled online streaming with mobile/embedded client signature bypass (`ba[ext=m4a]/ba[ext=webm]/bestaudio[abr<=160]`).
  - High-speed parallel fragment downloading with automatic LAME VBR MP3 audio conversion and high-res cover art embedding.
  - Real-time download progress drawer with live speed (MB/s), byte counters, ETA, and stage indicators.
- **Synchronous Line-by-Line Lyrics Mode**:
  - Immersive full-screen synced lyrics view with Apple Music / Spotify typography.
  - Fixed scroll lockout: isolated user gestures (`wheel`, `touch`) so every line transitions and scrolls smoothly on beat without delaying or double-scrolling.
  - High-precision 60fps `requestAnimationFrame` synchronization loop for microsecond-accurate timestamp tracking.
  - Full playback transport controls directly inside the lyrics screen (play/pause, shuffle, repeat, like, volume, spectrum toggle).
- **Network Sharing & Apache2 Port 80 Proxy Integration**:
  - Easily share AquaMusic across your local Wi-Fi / LAN to your phone, tablet, or smart TV.
  - Includes `aquamusic-share-port80` helper script to automatically configure Apache2 reverse proxy on Port 80.
- **Screen Keep-Awake (Display Sleep Prevention)**:
  - Dual-engine display keep-alive system (W3C Screen Wake Lock API + continuous hardware video keep-alive anchor).
  - Keeps the screen awake continuously whenever AquaMusic is active in the browser, preventing screen dimming, sleep, or lock screen timeout.
- **Cross-Platform Releases**:
  - **Linux Debian / Ubuntu**: Lightweight `.deb` package (283 KB) with desktop menu integration and GNOME Shell dock icons.
  - **Windows**: Native NSIS Setup Installer (`AquaMusic-1.0.1-Setup.exe`, 533 KB) and standalone portable ZIP (`AquaMusic-1.0.1-win64-portable.zip`, 491 KB).

---

## Installation & Releases

### Linux (Debian / Ubuntu / Kali / Mint)
Download the latest `.deb` package from [Releases](https://github.com/samsoncharles/AquaMusic/releases):
```bash
sudo dpkg -i aquamusic_1.0.1_amd64.deb
```
Launch **AquaMusic** from your desktop app launcher or run:
```bash
aquamusic
```

### Windows (10 / 11)
1. Download **`AquaMusic-1.0.1-Setup.exe`** from [Releases](https://github.com/samsoncharles/AquaMusic/releases) and run the installer.
2. Or download **`AquaMusic-1.0.1-win64-portable.zip`**, extract anywhere, and double-click **`AquaMusic.exe`**.

---

## Run from Source (Development Mode)

```bash
git clone https://github.com/samsoncharles/AquaMusic.git
cd AquaMusic

# Install dependencies
pip install -r requirements.txt

# Launch Control Panel GUI
python control_panel.py

# Or run the server directly
python app.py
```
Then visit `http://127.0.0.1:5000` in your web browser.

---

## Building Packages

### Debian Package (.deb)
```bash
bash packaging/build-deb.sh
```
Builds `release/aquamusic_1.0.1_amd64.deb`.

### Windows Package (.exe & .zip)
On Linux using MinGW-w64 and NSIS, or on Windows:
```bash
bash packaging/build-win.sh
```
Builds `release/AquaMusic-1.0.1-Setup.exe` and `release/AquaMusic-1.0.1-win64-portable.zip`.

---

## Screenshots

| Playlist | Queue |
| --- | --- |
| ![Dark playlist view](<assets/screenshots/Screenshot From 2026-08-17 03-22-26.png>) | ![Light queue view](<assets/screenshots/Screenshot From 2026-08-17 03-25-12.png>) |

| Track menu | Music folder picker |
| --- | --- |
| ![Track context menu](<assets/screenshots/Screenshot From 2026-08-17 03-22-51.png>) | ![Music folder picker](<assets/screenshots/Screenshot From 2026-08-17 03-23-25.png>) |

---

## License

MIT License. Local library data, audio cache, logs, and credentials are intentionally excluded from Git.

