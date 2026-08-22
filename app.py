import os
import re
import json
import time
import threading
import colorsys
import ssl
import shutil
import subprocess
import socket
import sqlite3
from pathlib import Path
from flask import Flask, render_template, request, Response, jsonify, send_file
from werkzeug.serving import make_server
from mutagen import File
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.mp4 import MP4

# Import local helper modules
import scanner
import art
import tagger
import waveform

app = Flask(__name__)

# Per-user storage keeps the installed application read-only and preserves a
# person's library/history when AquaMusic is upgraded or reinstalled.
APP_DATA_DIR = Path(os.environ.get('AQUAMUSIC_DATA_DIR', Path.home() / '.local' / 'share' / 'AquaMusic'))
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

# Track library data storage
LIBRARY = {}
LIBRARY_FILE = str(APP_DATA_DIR / 'library.json')
DATABASE_FILE = APP_DATA_DIR / 'aquamusic.db'
SHARE_FILE = APP_DATA_DIR / 'sharing.json'
SHARE_SERVER = None
SHARE_THREAD = None
SHARE_LOCK = threading.Lock()

def database_connection():
    # Opening a connection is on the request path. Do not reconfigure the
    # database here: journal_mode takes a filesystem lock and made startup
    # and preference saves noticeably sluggish on large libraries.
    return sqlite3.connect(DATABASE_FILE, timeout=10)

def initialise_database():
    """Create durable application tables and migrate the old JSON cache once."""
    with database_connection() as connection:
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('''
            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            )
        ''')
        connection.execute('''
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            )
        ''')
        has_tracks = connection.execute('SELECT 1 FROM tracks LIMIT 1').fetchone()
        if not has_tracks and os.path.exists(LIBRARY_FILE):
            try:
                legacy_tracks = json.loads(Path(LIBRARY_FILE).read_text(encoding='utf-8'))
                connection.executemany(
                    'INSERT OR REPLACE INTO tracks (id, payload) VALUES (?, ?)',
                    [(track_id, json.dumps(track, ensure_ascii=False))
                     for track_id, track in legacy_tracks.items() if isinstance(track, dict)]
                )
                print(f'[Library] Migrated {len(legacy_tracks)} tracks to SQLite.')
            except (OSError, json.JSONDecodeError) as error:
                print(f'[Library] JSON migration skipped: {error}')

def load_state(key, default):
    with database_connection() as connection:
        row = connection.execute('SELECT payload FROM app_state WHERE key = ?', (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row[0])
    except json.JSONDecodeError:
        return default

def save_state(key, value):
    payload = json.dumps(value, ensure_ascii=False)
    with database_connection() as connection:
        connection.execute(
            'INSERT INTO app_state (key, payload) VALUES (?, ?) '
            'ON CONFLICT(key) DO UPDATE SET payload = excluded.payload',
            (key, payload)
        )

def load_share_config():
    defaults = {'enabled': False, 'port': 5000}
    try:
        if SHARE_FILE.exists():
            defaults.update(json.loads(SHARE_FILE.read_text(encoding='utf-8')))
    except (OSError, json.JSONDecodeError):
        pass
    return defaults

def save_share_config(config):
    SHARE_FILE.write_text(json.dumps(config, indent=2), encoding='utf-8')

def lan_addresses():
    addresses = []
    # This does not send traffic; it asks the OS which local address it would
    # use for a LAN route.  It works even when the hostname is not in DNS.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(('192.0.2.1', 80))
            address = probe.getsockname()[0]
            if not address.startswith('127.'):
                addresses.append(address)
    except OSError:
        pass
    try:
        for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = item[4][0]
            if not address.startswith('127.') and address not in addresses:
                addresses.append(address)
    except OSError:
        pass
    return addresses

def ensure_share_certificate(cert_path, key_path):
    """Create a local self-signed certificate only when the user did not supply one."""
    cert, key = Path(cert_path), Path(key_path)
    if cert.is_file() and key.is_file():
        return str(cert), str(key)
    cert.parent.mkdir(parents=True, exist_ok=True)
    openssl = shutil.which('openssl')
    if not openssl:
        raise RuntimeError('No TLS certificate was supplied and openssl is not installed.')
    san = ','.join(['DNS:localhost'] + [f'IP:{ip}' for ip in lan_addresses()])
    command = [openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
               '-keyout', str(key), '-out', str(cert), '-subj', '/CN=AquaMusic Local',
               '-addext', f'subjectAltName={san}']
    subprocess.run(command, check=True, capture_output=True)
    os.chmod(key, 0o600)
    return str(cert), str(key)

def stop_share_server():
    global SHARE_SERVER, SHARE_THREAD
    with SHARE_LOCK:
        server = SHARE_SERVER
        SHARE_SERVER = None
        SHARE_THREAD = None
    # shutdown() waits for serve_forever() and must not run inside the request
    # thread that server is currently handling.
    if server:
        threading.Thread(target=server.shutdown, daemon=True).start()

def start_share_server(config):
    global SHARE_SERVER, SHARE_THREAD
    stop_share_server()
    port = 5000
    server = make_server('0.0.0.0', port, app, threaded=True)
    with SHARE_LOCK:
        SHARE_SERVER = server
        SHARE_THREAD = threading.Thread(target=server.serve_forever, daemon=True)
        SHARE_THREAD.start()
    config.update({'enabled': True, 'port': port})
    save_share_config(config)
    return config

def load_library():
    """Loads the track library database from disk if it exists."""
    global LIBRARY
    try:
        with database_connection() as connection:
            rows = connection.execute('SELECT id, payload FROM tracks').fetchall()
        if rows:
            LIBRARY = {track_id: json.loads(payload) for track_id, payload in rows}
            # Keep a previously saved library from resurfacing video files
            # after the scanner has been restricted to audio-only formats.
            LIBRARY = {
                track_id: track for track_id, track in LIBRARY.items()
                if os.path.splitext(track.get('path', ''))[1].lower() in scanner.SUPPORTED_EXTENSIONS
            }
            print(f"[Library] Loaded {len(LIBRARY)} tracks from local file database.")
        else:
            LIBRARY = {}
    except Exception as e:
        print(f"[Library] Load failed: {e}. Starting with an empty library.")
        LIBRARY = {}

def save_library():
    """Atomically save cached paths and metadata in SQLite."""
    try:
        with database_connection() as connection:
            connection.execute('DELETE FROM tracks')
            connection.executemany(
                'INSERT INTO tracks (id, payload) VALUES (?, ?)',
                [(track_id, json.dumps(track, ensure_ascii=False)) for track_id, track in LIBRARY.items()]
            )
        print(f"[Library] Saved {len(LIBRARY)} tracks to SQLite database.")
    except Exception as e:
        print(f"[Library] Save failed: {e}")

# Initialise and load before the HTTP server accepts requests.
initialise_database()
load_library()

def get_mime(path):
    """Returns the corresponding audio MIME type based on file extension."""
    ext = os.path.splitext(path)[1].lower()
    mapping = {
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.opus': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.wav': 'audio/wav',
        '.wma': 'audio/x-ms-wma',
        '.aac': 'audio/aac',
        '.aiff': 'audio/x-aiff',
        '.ape': 'audio/ape',
        '.wv': 'audio/x-wavpack'
    }
    return mapping.get(ext, 'application/octet-stream')

def parse_range(range_header, size):
    """Parses HTTP Range header for streaming seeks."""
    match = re.match(r'bytes=(\d+)-(\d*)', range_header)
    if not match:
        return 0, size - 1
    
    start = int(match.group(1))
    end_str = match.group(2)
    end = int(end_str) if end_str else size - 1
    
    if start >= size:
        start = size - 1
    if end >= size:
        end = size - 1
    if start > end:
        start = end
        
    return start, end

# SPA Base Route
@app.route('/')
def index():
    return render_template('index.html')

# Fetch Full Library
@app.route('/api/library', methods=['GET'])
def get_library():
    return jsonify(LIBRARY)

@app.route('/api/library/tracks', methods=['DELETE'])
def remove_library_tracks():
    """Remove tracks from the application's library database, not from disk."""
    data = request.get_json(silent=True) or {}
    track_ids = data.get('track_ids', [])
    if not isinstance(track_ids, list) or not all(isinstance(track_id, str) for track_id in track_ids):
        return jsonify({'status': 'error', 'message': 'track_ids must be a list of track IDs'}), 400

    removed_ids = []
    for track_id in set(track_ids):
        if track_id in LIBRARY:
            LIBRARY.pop(track_id)
            # Avoid retaining artwork for a track that no longer exists in the library.
            art.ART_CACHE.pop(track_id, None)
            removed_ids.append(track_id)

    if removed_ids:
        save_library()
    return jsonify({'status': 'ok', 'removed_ids': removed_ids})

@app.route('/api/library', methods=['DELETE'])
def clear_library():
    """Clear the application's complete music index without touching audio files."""
    removed_ids = list(LIBRARY)
    LIBRARY.clear()
    art.ART_CACHE.clear()
    save_library()
    return jsonify({'status': 'ok', 'removed_ids': removed_ids})

@app.route('/api/state/<key>', methods=['GET', 'PUT'])
def persistent_state(key):
    """Store user state (playlists, queue, settings) with the music database."""
    if not re.fullmatch(r'[a-z0-9_-]{1,64}', key):
        return jsonify({'status': 'error', 'message': 'Invalid state key'}), 400
    if request.method == 'GET':
        return jsonify(load_state(key, None))
    value = request.get_json(silent=True)
    if value is None:
        return jsonify({'status': 'error', 'message': 'JSON data is required'}), 400
    save_state(key, value)
    return jsonify({'status': 'ok'})

@app.route('/api/sharing', methods=['GET', 'POST'])
def sharing_settings():
    """Manage optional HTTPS access for trusted devices on the local network."""
    if request.method == 'GET':
        config = load_share_config()
        config['addresses'] = lan_addresses()
        config['urls'] = [f"http://{address}:{config['port']}" for address in config['addresses']] if config['enabled'] else []
        return jsonify(config)

    payload = request.get_json(silent=True) or {}
    enabled = bool(payload.get('enabled', False))
    config = load_share_config()
    try:
        if enabled:
            config = start_share_server(config)
        else:
            stop_share_server()
            config['enabled'] = False
            save_share_config(config)
        config['addresses'] = lan_addresses()
        config['urls'] = [f"http://{address}:{config['port']}" for address in config['addresses']] if config['enabled'] else []
        return jsonify(config)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        return jsonify({'status': 'error', 'message': str(error)}), 400

def import_media_paths(paths):
    """Imports files delivered by the desktop's OS 'Open With' integration."""
    added = []
    for raw_path in paths:
        path = os.path.abspath(raw_path)
        if os.path.isfile(path) and os.path.splitext(path)[1].lower() in scanner.SUPPORTED_EXTENSIONS:
            track = scanner.scan_single_file(path)
            if track:
                LIBRARY[track['id']] = track
                added.append(track['id'])
    if added:
        save_library()
    return added

# Library Stats
@app.route('/api/library/stats', methods=['GET'])
def get_stats():
    total_tracks = len(LIBRARY)
    total_duration = sum(t.get('duration', 0.0) for t in LIBRARY.values())
    total_size = sum(t.get('file_size', 0) for t in LIBRARY.values())
    
    artists = set(t.get('artist', 'Unknown Artist') for t in LIBRARY.values())
    albums = set((t.get('artist', 'Unknown Artist'), t.get('album', 'Unknown Album')) for t in LIBRARY.values())
    
    return jsonify({
        'totalTracks': total_tracks,
        'totalDuration': total_duration,
        'totalArtists': len(artists),
        'totalAlbums': len(albums),
        'totalSize': total_size
    })

# Start Library Scanner
@app.route('/api/scan', methods=['POST'])
def trigger_scan():
    data = request.json or {}
    folder_path = data.get('folder_path', '').strip()
    if not folder_path:
        return jsonify({'status': 'error', 'message': 'No folder path provided'}), 400
        
    if not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        return jsonify({'status': 'error', 'message': 'Directory path does not exist on server'}), 400

    if scanner.SCAN_STATE['status'] == 'scanning':
        return jsonify({'status': 'error', 'message': 'A folder scan is already in progress'}), 400

    # Set this before returning so an immediately opened status stream never
    # observes the old "idle" state while the worker thread is starting.
    with scanner.scan_lock:
        scanner.SCAN_STATE.update({
            'status': 'scanning',
            'total': 0,
            'scanned': 0,
            'current_file': 'Starting scan...',
            'errors': 0,
            'elapsed': 0,
        })

    def run_scan():
        scanner.scan_directory_recursive(folder_path, LIBRARY)
        save_library()

    thread = threading.Thread(target=run_scan)
    thread.daemon = True
    thread.start()

    return jsonify({'status': 'ok', 'message': 'Scan successfully initiated.'})

# SSE Progress status updates
@app.route('/api/scan/status', methods=['GET'])
def scan_status():
    def event_stream():
        while True:
            with scanner.scan_lock:
                state = scanner.SCAN_STATE.copy()
            yield f"data: {json.dumps(state)}\n\n"
            if state['status'] in ('done', 'error', 'idle'):
                break
            time.sleep(0.5)
    return Response(event_stream(), mimetype="text/event-stream")

# Folders Explorer
@app.route('/api/folders', methods=['GET'])
def explore_folders():
    path = request.args.get('path', '').strip()
    return jsonify(scanner.get_directory_listing(path))

@app.route('/api/auto_search', methods=['GET'])
def auto_search():
    results = scanner.auto_search_mp3_folders()
    return jsonify({'folders': results})

# Audio Streamer with HTTP range seeking support
@app.route('/api/stream/<track_id>', methods=['GET'])
def stream_audio(track_id):
    if track_id not in LIBRARY:
        return "Track not found", 404
        
    track = LIBRARY[track_id]
    path = track['path']
    if not os.path.exists(path):
        return "File not found on system", 404

    size = os.path.getsize(path)
    mime = get_mime(path)

    range_header = request.headers.get('Range')
    if not range_header:
        response = send_file(path, mimetype=mime)
        response.headers['Accept-Ranges'] = 'bytes'
        return response

    start, end = parse_range(range_header, size)
    length = end - start + 1

    try:
        with open(path, 'rb') as f:
            f.seek(start)
            chunk = f.read(length)
    except Exception as e:
        return str(e), 500

    response = Response(chunk, 206, mimetype=mime)
    response.headers.update({
        'Content-Range': f'bytes {start}-{end}/{size}',
        'Accept-Ranges': 'bytes',
        'Content-Length': length,
        'Cache-Control': 'no-cache',
    })
    return response

# Get Album Art
@app.route('/api/art/<track_id>', methods=['GET'])
def get_art(track_id):
    if track_id not in LIBRARY:
        # Default fallback if track not in memory
        svg = art.generate_default_art_svg("Unknown", "Unknown")
        return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "max-age=86400"})

    track = LIBRARY[track_id]
    artist = track.get('artist', 'Unknown Artist')
    album = track.get('album', 'Unknown Album')

    # Try cache first
    cached = art.get_cached_art(track_id)
    if cached:
        return Response(cached[0], mimetype=cached[1], headers={"Cache-Control": "max-age=86400"})

    # Extract
    file_path = track['path']
    art_bytes, mime = art.extract_art(file_path)

    if art_bytes and mime:
        art.set_cached_art(track_id, art_bytes, mime)
        return Response(art_bytes, mimetype=mime, headers={"Cache-Control": "max-age=86400"})

    # Fallback to SVG generator
    svg = art.generate_default_art_svg(artist, album)
    return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "max-age=86400"})

# Get Dominant Art Color for ambient styling
@app.route('/api/art/<track_id>/dominant', methods=['GET'])
def get_art_dominant(track_id):
    if track_id not in LIBRARY:
        return jsonify({'r': 124, 'g': 106, 'b': 247, 'hex': '#7C6AF7'})

    track = LIBRARY[track_id]
    
    # Check cache first
    cached = art.get_cached_art(track_id)
    if cached:
        color = art.get_dominant_color(cached[0])
        return jsonify(color)

    # Try extraction
    file_path = track['path']
    art_bytes, mime = art.extract_art(file_path)
    if art_bytes:
        color = art.get_dominant_color(art_bytes)
        return jsonify(color)

    # Deterministic default color based on SVG seed parameters
    seed_str = f"{track.get('artist', 'Unknown')} - {track.get('album', 'Unknown')}"
    val = 0
    for char in seed_str:
        val = (val * 31 + ord(char)) & 0xFFFFFFFF
    hue = (val * 137) % 360
    
    # HSL conversion to saturated vibrant color
    r_f, g_f, b_f = colorsys.hsv_to_rgb(hue / 360.0, 0.7, 0.7)
    r, g, b = int(r_f * 255), int(g_f * 255), int(b_f * 255)
    return jsonify({
        'r': r,
        'g': g,
        'b': b,
        'hex': f"#{r:02x}{g:02x}{b:02x}"
    })

# Get Waveform amplitude samples
@app.route('/api/waveform/<track_id>', methods=['GET'])
def get_waveform(track_id):
    if track_id not in LIBRARY:
        return jsonify([0.5] * 200)
    track = LIBRARY[track_id]
    samples = waveform.generate_waveform_samples(track['path'])
    return jsonify(samples)

# Get Track Lyrics
@app.route('/api/lyrics/<track_id>', methods=['GET'])
def get_lyrics(track_id):
    if track_id not in LIBRARY:
        return jsonify({'type': 'none', 'content': ''})
    
    track = LIBRARY[track_id]
    file_path = track['path']
    
    # 1. Search for a local .lrc file in the same directory
    base_no_ext = os.path.splitext(file_path)[0]
    lrc_path = base_no_ext + '.lrc'
    if os.path.exists(lrc_path):
        try:
            with open(lrc_path, 'r', encoding='utf-8', errors='ignore') as f:
                return jsonify({'type': 'lrc', 'content': f.read()})
        except Exception as e:
            print(f"[Lyrics] Failed to read .lrc file: {e}")

    # 2. Check for embedded tags
    try:
        audio = File(file_path)
        if audio is not None:
            # MP3 USLT
            if file_path.lower().endswith('.mp3') and audio.tags:
                uslt = [v for k, v in audio.tags.items() if k.startswith('USLT')]
                if uslt:
                    return jsonify({'type': 'plain', 'content': str(uslt[0])})
            # FLAC / Ogg
            elif isinstance(audio, (FLAC, OggVorbis)) and audio.tags:
                for k in ['LYRICS', 'lyrics']:
                    if k in audio.tags and audio.tags[k]:
                        return jsonify({'type': 'plain', 'content': audio.tags[k][0]})
            # MP4 / M4A
            elif isinstance(audio, MP4) and audio.tags:
                if '\xa9lyr' in audio.tags and audio.tags['\xa9lyr']:
                    return jsonify({'type': 'plain', 'content': audio.tags['\xa9lyr'][0]})
    except Exception as e:
        print(f"[Lyrics] Embedded extraction error: {e}")

    return jsonify({'type': 'none', 'content': ''})

# Get metadata for a single track
@app.route('/api/track/<track_id>', methods=['GET'])
def get_track(track_id):
    if track_id not in LIBRARY:
        return "Track not found", 404
    return jsonify(LIBRARY[track_id])

# Write tag edits back to file
@app.route('/api/tag/<track_id>', methods=['POST'])
def edit_tags(track_id):
    if track_id not in LIBRARY:
        return jsonify({'status': 'error', 'message': 'Track not found in library'}), 404
        
    track = LIBRARY[track_id]
    data = request.json or {}
    
    # 1. Update text metadata tags
    success, err_msg = tagger.update_track_tags(track['path'], data)
    if not success:
        return jsonify({'status': 'error', 'message': f"Tag write failed: {err_msg}"}), 500
        
    # 2. Update artwork if requested
    art_changed = False
    if 'art_base64' in data or data.get('remove_art'):
        art_ok, art_err = tagger.update_artwork(
            track['path'], 
            art_base64=data.get('art_base64'), 
            remove_art=data.get('remove_art', False)
        )
        if art_ok:
            # Clear LRU cache entry so it reloads art fresh
            art.ART_CACHE.pop(track_id, None)
            art_changed = True
        else:
            print(f"[Tagger] Artwork write error: {art_err}")

    # 3. Synchronize in-memory cache
    for field in ['title', 'artist', 'album', 'album_artist', 'year', 'genre', 'track_number', 'disc_number', 'comment', 'composer', 'bpm']:
        if field in data:
            track[field] = data[field]
            
    if art_changed:
        track['has_art'] = not data.get('remove_art', False)
        
    # Re-generate duration formatting if track number was updated or files re-read
    save_library()
    return jsonify({'status': 'ok'})

# Export playlist file as M3U
@app.route('/api/playlist/export', methods=['GET'])
def export_playlist():
    ids_str = request.args.get('ids', '')
    if not ids_str:
        return "No track IDs provided", 400
        
    ids = ids_str.split(',')
    m3u_lines = ["#EXTM3U"]
    
    for track_id in ids:
        if track_id in LIBRARY:
            track = LIBRARY[track_id]
            duration = int(track.get('duration', -1))
            artist = track.get('artist', 'Unknown Artist')
            title = track.get('title', 'Unknown Title')
            path = track.get('path', '')
            m3u_lines.append(f"#EXTINF:{duration},{artist} - {title}")
            m3u_lines.append(path)
            
    m3u_content = "\n".join(m3u_lines)
    return Response(
        m3u_content,
        mimetype="audio/x-mpegurl",
        headers={"Content-Disposition": "attachment; filename=aquamusic_playlist.m3u"}
    )





def serve_local(port=0, host='127.0.0.1'):
    """Run the private local HTTP server used by the desktop application."""
    return make_server(host, int(port), app, threaded=True)

if __name__ == '__main__':
    # Development mode remains private by default; Settings can explicitly
    # enable the separate HTTPS LAN listener.
    host = os.environ.get('AQUAMUSIC_HOST', '127.0.0.1')
    server = serve_local(os.environ.get('AQUAMUSIC_PORT', '5000'), host)
    port = server.server_port
    print(f'[Local] Serving AquaMusic at http://127.0.0.1:{port}')
    if host == '0.0.0.0':
        addresses = lan_addresses()
        if addresses:
            print('[LAN] Open one of these HTTP URLs on another device:')
            for address in addresses:
                print(f'      http://{address}:{port}')
        else:
            print('[LAN] Server is listening on the network, but no LAN IPv4 address was detected.')
    server.serve_forever()
