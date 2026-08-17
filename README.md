# AquaMusic

A polished local music player built with Flask and vanilla JavaScript. Browse an audio-only library, manage playlists and queue playback, edit tags, and enjoy artwork, waveforms, themes, and keyboard-friendly controls.

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

Then open `http://127.0.0.1:5000`.

Local library data, logs, credentials, and environment files are intentionally excluded from Git.
