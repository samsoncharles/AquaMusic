## AquaMusic v1.0.1

### 🚀 What's New in AquaMusic v1.0.1

#### ⚡ Ultra-Lightweight XAMPP-Style Control Panel
- Replaced oversized bundled runtimes (282 MB) with a native **Tkinter Control Panel GUI** (`control_panel.py`).
- Overall package size reduced by **99.9%** from 282MB down to **283KB**!
- Clean **Start / Stop** toggle controls, live PID/status pill, editable port entry with automatic validation, and direct LAN/Wi-Fi access links.
- Automated dependency checker with a 1-click **"📦 Install Requirements"** button.
- Real-time scrolling server event and activity log.

#### 🎵 Online YouTube Streaming & Safe Folder MP3 Downloader
- Unthrottled online streaming with mobile and embedded client signature bypass (`ba[ext=m4a]/ba[ext=webm]/bestaudio[abr<=160]`).
- High-speed parallel fragment downloading with automatic LAME VBR MP3 conversion and high-res cover art embedding.
- Real-time downloads drawer with live speed (MB/s), byte counters, ETA, and stage indicators.

#### 🎙️ Synchronous Line-by-Line Lyrics Mode
- Immersive synchronized lyrics view with Apple Music / Spotify-grade aesthetics and typography.
- Fixed scroll lockout: isolated user gestures (`wheel`, `touch`) so every line transitions and scrolls smoothly into the center slot on beat without delaying or double-scrolling.
- High-precision 60fps `requestAnimationFrame` synchronization loop for microsecond-accurate timestamp tracking.
- Full transport playback controls directly in lyrics mode (play/pause, shuffle, repeat, like, volume, spectrum visualizer toggle).

#### 🌐 Port 80 Network Sharing & Apache2 Reverse Proxy
- Share music across your local network so phones, tablets, and smart TVs can access your music library.
- Built-in automated Apache2 reverse proxy configuration (`aquamusic-share-port80`) to seamlessly map port 80 to AquaMusic port 5000.

#### 💡 Screen Keep-Awake (Continuous Display Wake Lock)
- Integrated dual-engine display keep-alive system (W3C Screen Wake Lock API + hardware video playback keep-alive anchor).
- Prevents display dimming, screen sleep, or lock screen timeout continuously whenever AquaMusic is open in the browser.
- Auto-reacquires wake locks on visibility changes, window focus, user gestures, and playback state changes with 15-second heartbeat monitor.

#### 📦 Download Packages
- **Linux Debian / Ubuntu / Kali / Mint**: `aquamusic_1.0.1_amd64.deb` (283 KB)
- **Windows Setup Installer**: `AquaMusic-1.0.1-Setup.exe` (533 KB)
- **Windows Portable Standalone**: `AquaMusic-1.0.1-win64-portable.zip` (491 KB)

