# AquaMusic

A polished local music player built with Flask and vanilla JavaScript. Browse an audio-only library, manage playlists and queue playback, edit tags, and enjoy artwork, waveforms, themes, and keyboard-friendly controls.

## Desktop and nearby-device sharing

The desktop app is private by default: its player server listens only on `127.0.0.1`. In **Settings → Share to nearby devices**, opt in to HTTPS sharing and copy the displayed Wi-Fi link. AquaMusic generates a self-signed certificate in its per-user data folder when paths are left blank, or you can provide your own certificate and key.

Build the 64-bit Debian package on an amd64 Debian/Ubuntu machine:

```bash
chmod +x packaging/build-deb.sh
./packaging/build-deb.sh
sudo apt install ./build/aquamusic_1.0.0_amd64.deb
```

The package registers common audio formats with Linux, so selecting an MP3 in a file manager and choosing **Open With → AquaMusic** imports it into the local library.

The `.deb` embeds the Python runtime and all packages in `requirements.txt`;
the application does not run `pip` on the user's computer. Its icon library is
also vendored in `static/vendor`, and all themes are already local CSS. The
target computer still needs the normal Debian/Ubuntu graphics and audio
libraries declared by the package (these are ordinarily part of a desktop
installation); install them from a local apt repository/media first if that
computer has no network access.

## Highlights

- Audio-only folder scanning with batch import
- Playlist creation, drag-to-reorder, randomized covers, and M3U export
- Queue controls, shuffle, repeat, ratings, lyrics, tag editing, and waveform display
- Light and dark themes with responsive desktop and mobile layouts

## Screenshots

| Playlist | Queue |
| --- | --- |
| ![Dark playlist view](<assets/screenshots/Screenshot From 2026-08-17 03-22-26.png>) | ![Light queue view](<assets/screenshots/Screenshot From 2026-08-17 03-25-12.png>) |

| Track menu | Music folder picker |
| --- | --- |
| ![Track context menu](<assets/screenshots/Screenshot From 2026-08-17 03-22-51.png>) | ![Music folder picker](<assets/screenshots/Screenshot From 2026-08-17 03-23-25.png>) |

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:5000`. This development mode is also local-only.

Local library data, logs, credentials, and environment files are intentionally excluded from Git.
