import os
import sys
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
import hashlib
from pathlib import Path
from flask import Flask, render_template, request, Response, jsonify, send_file
from werkzeug.serving import make_server
import requests as http_requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from mutagen import File
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.mp4 import MP4

# Import local helper modules
import scanner
import art
import tagger
import waveform
from core import extractor, downloader, safe_folder

# Handle PyInstaller frozen paths
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    _template_folder = os.path.join(sys._MEIPASS, 'templates')
    _static_folder = os.path.join(sys._MEIPASS, 'static')
    app = Flask(__name__, template_folder=_template_folder, static_folder=_static_folder)
else:
    app = Flask(__name__)

# HTTP Session for stream proxying with connection pooling
_proxy_session = http_requests.Session()
_retry_strategy = Retry(total=2, backoff_factor=0.2, status_forcelist=[500, 502, 503, 504])
_adapter = HTTPAdapter(max_retries=_retry_strategy, pool_connections=25, pool_maxsize=50)
_proxy_session.mount("https://", _adapter)
_proxy_session.mount("http://", _adapter)

_stream_session = http_requests.Session()
_stream_session.mount("https://", HTTPAdapter(pool_connections=20, pool_maxsize=40))
_stream_session.mount("http://", HTTPAdapter(pool_connections=20, pool_maxsize=40))

def get_proxy_session():
    """Returns requests session loaded with active Firefox cookies for bot bypass."""
    try:
        from core import cookies
        cookie_file = cookies.get_cookie_file()
        if cookie_file and os.path.exists(cookie_file):
            import http.cookiejar
            cj = http.cookiejar.MozillaCookieJar(cookie_file)
            cj.load(ignore_discard=True, ignore_expires=True)
            _proxy_session.cookies = cj
    except Exception:
        pass
    return _proxy_session

# Per-user storage keeps the installed application read-only and preserves library/history
APP_DATA_DIR = Path(os.environ.get('AQUAMUSIC_DATA_DIR', Path.home() / '.local' / 'share' / 'AquaMusic'))
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
LYRICS_CACHE_DIR = APP_DATA_DIR / 'lyrics'
LYRICS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Track library data storage
LIBRARY = {}
LIBRARY_LOCK = threading.RLock()
LIBRARY_FILE = str(APP_DATA_DIR / 'library.json')
LOCAL_REPO_LIBRARY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'library.json')
DATABASE_FILE = APP_DATA_DIR / 'aquamusic.db'
SHARE_FILE = APP_DATA_DIR / 'sharing.json'
SHARE_SERVER = None
SHARE_THREAD = None
SHARE_LOCK = threading.Lock()

def database_connection():
    conn = sqlite3.connect(DATABASE_FILE, timeout=30.0)
    conn.execute('PRAGMA busy_timeout = 30000')
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA synchronous = NORMAL')
    return conn

def initialise_database():
    """Create durable application tables and migrate JSON cache if available."""
    with database_connection() as connection:
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('PRAGMA synchronous=NORMAL')
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
        has_migrated = connection.execute("SELECT 1 FROM app_state WHERE key = 'initial_migration_done'").fetchone()
        if not has_migrated:
            has_tracks = connection.execute('SELECT 1 FROM tracks LIMIT 1').fetchone()
            if not has_tracks:
                # Check ~/.local/share/AquaMusic/library.json or local ./library.json
                candidate_files = [LIBRARY_FILE, LOCAL_REPO_LIBRARY_FILE]
                for c_file in candidate_files:
                    if os.path.exists(c_file):
                        try:
                            legacy_tracks = json.loads(Path(c_file).read_text(encoding='utf-8'))
                            connection.executemany(
                                'INSERT OR REPLACE INTO tracks (id, payload) VALUES (?, ?)',
                                [(track_id, json.dumps(track, ensure_ascii=False))
                                 for track_id, track in legacy_tracks.items() if isinstance(track, dict)]
                            )
                            print(f'[Library] Migrated {len(legacy_tracks)} tracks from {c_file} to SQLite.')
                            break
                        except (OSError, json.JSONDecodeError) as error:
                            print(f'[Library] JSON migration from {c_file} skipped: {error}')
            connection.execute("INSERT OR REPLACE INTO app_state (key, payload) VALUES ('initial_migration_done', '\"true\"')")

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
    for attempt in range(4):
        try:
            with database_connection() as connection:
                connection.execute(
                    'INSERT INTO app_state (key, payload) VALUES (?, ?) '
                    'ON CONFLICT(key) DO UPDATE SET payload = excluded.payload',
                    (key, payload)
                )
            return
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < 3:
                time.sleep(0.08 * (2 ** attempt))
                continue
            raise


def get_active_safe_folder():
    """Get active safe download directory from settings, defaulting to ~/Music/AquaMusic/Downloads."""
    saved = load_state('safe_folder', None)
    if saved and isinstance(saved, str):
        ok, path = safe_folder.is_safe_path(saved)
        if ok:
            return path
    return safe_folder.get_default_safe_folder()

MAIN_SERVER_PORT = 5000

def load_share_config():
    defaults = {'enabled': True, 'port': 80}
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

def stop_share_server():
    global SHARE_SERVER, SHARE_THREAD
    with SHARE_LOCK:
        server = SHARE_SERVER
        SHARE_SERVER = None
        SHARE_THREAD = None
    if server:
        threading.Thread(target=server.shutdown, daemon=True).start()

def start_share_server(config):
    global SHARE_SERVER, SHARE_THREAD, MAIN_SERVER_PORT
    stop_share_server()
    desired_port = int(config.get('port') or 80)
    # If desired port is different from the active main server port (e.g. port 80 vs 5000),
    # attempt to bind an auxiliary listener on that port.
    if desired_port != MAIN_SERVER_PORT:
        bound = False
        try:
            server = make_server('0.0.0.0', desired_port, app, threaded=True)
            with SHARE_LOCK:
                SHARE_SERVER = server
                SHARE_THREAD = threading.Thread(target=server.serve_forever, daemon=True)
                SHARE_THREAD.start()
            bound = True
            print(f"[Sharing] Auxiliary server active on port {desired_port}.")
        except Exception as ex:
            print(f"[Sharing] Direct port {desired_port} binding note: {ex}")

        # If port 80 was requested but couldn't bind (e.g. Apache is running), configure Apache reverse proxy
        if not bound and desired_port == 80 and sys.platform.startswith('linux'):
            try:
                # If running with root privileges, configure Apache2 proxy automatically
                if hasattr(os, 'geteuid') and os.geteuid() == 0:
                    conf_path = Path("/etc/apache2/sites-available/aquamusic.conf")
                    conf_content = f"""# AquaMusic Port 80 Proxy for Network Sharing
<VirtualHost *:80>
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass / http://127.0.0.1:{MAIN_SERVER_PORT}/
    ProxyPassReverse / http://127.0.0.1:{MAIN_SERVER_PORT}/
</VirtualHost>
"""
                    conf_path.write_text(conf_content, encoding='utf-8')
                    subprocess.run(["a2enmod", "proxy", "proxy_http"], capture_output=True)
                    subprocess.run(["a2ensite", "aquamusic.conf"], capture_output=True)
                    subprocess.run(["systemctl", "reload", "apache2"], capture_output=True)
                    print(f"[Sharing] Apache2 reverse proxy configured on port 80 -> port {MAIN_SERVER_PORT}.")
                elif shutil.which("aquamusic-share-port80"):
                    subprocess.run(["aquamusic-share-port80", str(MAIN_SERVER_PORT)], capture_output=True)
            except Exception as proxy_err:
                print(f"[Sharing] Apache proxy configuration note: {proxy_err}")

    config.update({'enabled': True, 'port': desired_port})
    save_share_config(config)
    return config

def load_library():
    """Loads the track library database from SQLite disk into memory."""
    global LIBRARY
    with LIBRARY_LOCK:
        try:
            with database_connection() as connection:
                rows = connection.execute('SELECT id, payload FROM tracks').fetchall()

            if rows:
                new_lib = {}
                for track_id, payload in rows:
                    try:
                        tr = json.loads(payload)
                        path = tr.get('path', '')
                        if tr.get('is_online') or os.path.splitext(path)[1].lower() in scanner.SUPPORTED_EXTENSIONS:
                            new_lib[track_id] = tr
                    except Exception:
                        continue
                LIBRARY = new_lib
                print(f"[Library] Loaded {len(LIBRARY)} tracks from local SQLite database.")
            else:
                LIBRARY = {}
        except Exception as e:
            print(f"[Library] Load failed: {e}. Starting with an empty library.")
            LIBRARY = {}

def save_library():
    """Atomically save cached paths and metadata in SQLite."""
    with LIBRARY_LOCK:
        try:
            items = list(LIBRARY.items())
            with database_connection() as connection:
                connection.execute('DELETE FROM tracks')
                connection.executemany(
                    'INSERT INTO tracks (id, payload) VALUES (?, ?)',
                    [(track_id, json.dumps(track, ensure_ascii=False)) for track_id, track in items]
                )
            print(f"[Library] Saved {len(items)} tracks to SQLite database.")
        except Exception as e:
            print(f"[Library] Save failed: {e}")


# Initialise and load database on boot
initialise_database()
load_library()

def auto_import_downloaded_track(filepath, video_id=None):
    """
    Scans a newly downloaded MP3 file and immediately registers it in LIBRARY and SQLite.
    """
    if not os.path.exists(filepath):
        return None

    track = scanner.scan_single_file(filepath)
    if track:
        track['is_downloaded'] = True
        if video_id:
            track['youtube_id'] = video_id
        with LIBRARY_LOCK:
            LIBRARY[track['id']] = track
        # Save to SQLite
        try:
            with database_connection() as connection:
                connection.execute(
                    'INSERT OR REPLACE INTO tracks (id, payload) VALUES (?, ?)',
                    (track['id'], json.dumps(track, ensure_ascii=False))
                )
        except Exception as e:
            print(f"[Library] Auto-import SQLite save error: {e}")
        print(f"[Library] Auto-imported: {track['title']} ({track['id']})")
        return track
    return None

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
        return None, None
    if end >= size:
        end = size - 1
    if start > end:
        start = end
        
    return start, end

# ── SPA Base Route ─────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

# ── Local Library API Endpoints ─────────────────────────────────────────────
@app.route('/api/library', methods=['GET'])
def get_library():
    with LIBRARY_LOCK:
        unique_lib = {}
        seen_paths = set()
        for k, tr in LIBRARY.items():
            if not isinstance(tr, dict):
                continue
            tid = tr.get('id', k)
            p = tr.get('path')
            if p:
                if p in seen_paths:
                    continue
                seen_paths.add(p)
            if tid not in unique_lib:
                unique_lib[tid] = tr
    return jsonify(unique_lib)

@app.route('/api/library/tracks', methods=['DELETE'])
def remove_library_tracks():
    """Remove tracks from the application's library database without deleting from disk."""
    data = request.get_json(silent=True) or {}
    track_ids = data.get('track_ids', [])
    if not isinstance(track_ids, list) or not all(isinstance(track_id, str) for track_id in track_ids):
        return jsonify({'status': 'error', 'message': 'track_ids must be a list of track IDs'}), 400

    removed_ids = []
    with LIBRARY_LOCK:
        for track_id in set(track_ids):
            if track_id in LIBRARY:
                LIBRARY.pop(track_id, None)
                art.ART_CACHE.pop(track_id, None)
                removed_ids.append(track_id)

    if removed_ids:
        try:
            with database_connection() as connection:
                connection.executemany('DELETE FROM tracks WHERE id = ?', [(tid,) for tid in removed_ids])
        except Exception as e:
            print(f"[Library] Error removing tracks: {e}")
    return jsonify({'status': 'ok', 'removed_ids': removed_ids})

@app.route('/api/library', methods=['DELETE'])
def clear_library():
    """Clear the application's complete music index without touching audio files."""
    with LIBRARY_LOCK:
        removed_ids = list(LIBRARY.keys())
        LIBRARY.clear()
        art.ART_CACHE.clear()
    try:
        with database_connection() as connection:
            connection.execute('DELETE FROM tracks')
    except Exception as e:
        print(f"[Library] Error clearing tracks: {e}")
    return jsonify({'status': 'ok', 'removed_ids': removed_ids})

@app.route('/api/library/prune-missing', methods=['POST'])
def prune_missing_library_tracks():
    """Remove tracks from LIBRARY and SQLite DB whose files on disk no longer exist."""
    missing_ids = []
    with LIBRARY_LOCK:
        for tid, t in list(LIBRARY.items()):
            p = t.get('path')
            # If path is set and points to a file that no longer exists on disk
            if p and not os.path.exists(p):
                missing_ids.append(tid)
                LIBRARY.pop(tid, None)
                art.ART_CACHE.pop(tid, None)

    if missing_ids:
        try:
            with database_connection() as connection:
                connection.executemany('DELETE FROM tracks WHERE id = ?', [(tid,) for tid in missing_ids])
        except Exception as e:
            print(f"[Library] Error pruning missing tracks: {e}")

    return jsonify({'status': 'ok', 'pruned_count': len(missing_ids), 'pruned_ids': missing_ids})

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
    """Manage optional HTTPS/HTTP access for trusted devices on the local network."""
    config = load_share_config()
    addresses = lan_addresses()
    effective_port = config.get('port', 80)

    if request.method == 'GET':
        config['addresses'] = addresses
        if effective_port == 80:
            config['urls'] = [f"http://{addr}" for addr in addresses]
        else:
            config['urls'] = [f"http://{addr}:{effective_port}" for addr in addresses]
        return jsonify(config)

    payload = request.get_json(silent=True) or {}
    enabled = bool(payload.get('enabled', False))
    if 'port' in payload and payload['port']:
        try:
            config['port'] = int(payload['port'])
        except (ValueError, TypeError):
            pass

    try:
        if enabled:
            config = start_share_server(config)
        else:
            stop_share_server()
            config['enabled'] = False
            save_share_config(config)
        config['addresses'] = addresses
        effective_port = config.get('port', 80)
        if effective_port == 80:
            config['urls'] = [f"http://{addr}" for addr in addresses]
        else:
            config['urls'] = [f"http://{addr}:{effective_port}" for addr in addresses]
        return jsonify(config)
    except Exception as error:
        return jsonify({'status': 'error', 'message': str(error)}), 400

@app.route('/api/library/stats', methods=['GET'])
def get_stats():
    with LIBRARY_LOCK:
        tracks = list(LIBRARY.values())
    total_tracks = len(tracks)
    total_duration = sum(t.get('duration', 0.0) for t in tracks)
    total_size = sum(t.get('file_size', 0) for t in tracks)
    artists = set(t.get('artist', 'Unknown Artist') for t in tracks)
    albums = set((t.get('artist', 'Unknown Artist'), t.get('album', 'Unknown Album')) for t in tracks)
    return jsonify({
        'totalTracks': total_tracks,
        'totalDuration': total_duration,
        'totalArtists': len(artists),
        'totalAlbums': len(albums),
        'totalSize': total_size
    })

# ── Safe Folder Management Endpoints ────────────────────────────────────────
@app.route('/api/safe-folder', methods=['GET', 'POST'])
def manage_safe_folder():
    """Get or update user safe download directory."""
    if request.method == 'GET':
        active = get_active_safe_folder()
        default = safe_folder.get_default_safe_folder()
        return jsonify({'folder': active, 'default': default})

    data = request.get_json(silent=True) or {}
    new_path = data.get('folder', '').strip()
    if not new_path:
        new_path = safe_folder.get_default_safe_folder()

    ok, res = safe_folder.is_safe_path(new_path)
    if not ok:
        return jsonify({'status': 'error', 'message': res}), 400

    save_state('safe_folder', res)
    return jsonify({'status': 'ok', 'folder': res})

# ── Library Scanner ─────────────────────────────────────────────────────────
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

@app.route('/api/folders', methods=['GET'])
def explore_folders():
    path = request.args.get('path', '').strip()
    return jsonify(scanner.get_directory_listing(path))

@app.route('/api/auto_search', methods=['GET'])
def auto_search():
    results = scanner.auto_search_mp3_folders()
    return jsonify({'folders': results})

# ── Unified Audio Streamer (Local Files + Online YouTube Proxy) ─────────────
@app.route('/api/stream/<track_id>', methods=['GET', 'HEAD', 'OPTIONS'])
def stream_audio(track_id):
    """
    Stream audio with HTTP Range support.
    1. Responds to CORS preflights immediately.
    2. If local track or downloaded file exists, streams natively via send_file.
    3. If online track, proxies direct stream URL from YouTube CDN with Range support.
    """
    if request.method == 'OPTIONS':
        resp = Response('', 200)
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Range, Content-Type, Authorization, Accept'
        resp.headers['Access-Control-Max-Age'] = '86400'
        return resp

    local_path = None

    # Check memory library first
    with LIBRARY_LOCK:
        if track_id in LIBRARY:
            local_path = LIBRARY[track_id].get('path')

    # If not in memory library or path doesn't exist, check Safe Folder
    if not local_path or not os.path.exists(local_path):
        safe_dir = get_active_safe_folder()
        found = downloader.find_downloaded_file(track_id, safe_dir)
        if found and os.path.exists(found):
            local_path = found

    # ── Option A: Stream Local File on Disk ──
    if local_path and os.path.exists(local_path):
        mime = get_mime(local_path)
        resp = send_file(local_path, mimetype=mime, conditional=True)
        resp.headers['Accept-Ranges'] = 'bytes'
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Headers'] = 'Range, Content-Type'
        resp.headers['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length, Accept-Ranges'
        return resp

    # Guard: 32-character hex ID belongs to local library, do not forward to YouTube
    if len(track_id) == 32 and all(c in '0123456789abcdefABCDEF' for c in track_id):
        return jsonify({"error": "Local audio file not found on disk"}), 404

    # ── Option B: Proxy Online YouTube Stream ──
    stream_info = extractor.get_stream_url(track_id)
    if not stream_info or not stream_info.get("url"):
        return jsonify({"error": "Could not extract stream URL for track"}), 404

    stream_url = stream_info["url"]
    ext = stream_info.get("ext", "webm")
    mime_map = {
        "webm": "audio/webm",
        "m4a": "audio/mp4",
        "mp4": "audio/mp4",
        "opus": "audio/ogg",
        "ogg": "audio/ogg",
        "mp3": "audio/mpeg",
    }
    content_type = mime_map.get(ext, "audio/webm")

    # Use static headers matching uyube's proven proxy config
    upstream_headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
        "Referer": "https://www.youtube.com/",
        "Origin": "https://www.youtube.com",
    }

    range_hdr = request.headers.get("Range")
    if range_hdr:
        upstream_headers["Range"] = range_hdr

    try:
        upstream = _stream_session.get(
            stream_url,
            headers=upstream_headers,
            stream=True,
            timeout=(8, 60),
        )

        # If upstream URL expired or was blocked (403/404/410), refresh stream URL once
        if upstream.status_code >= 400:
            print(f"[Stream] Upstream returned {upstream.status_code} for {track_id}, refreshing stream info...")
            upstream.close()
            extractor.invalidate_stream_url(track_id)
            refreshed = extractor.get_stream_url(track_id, force_refresh=True)
            if refreshed and refreshed.get("url"):
                stream_url = refreshed["url"]
                refresh_headers = {
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
                    "Referer": "https://www.youtube.com/",
                    "Origin": "https://www.youtube.com",
                }
                if range_hdr:
                    refresh_headers["Range"] = range_hdr

                upstream = _stream_session.get(
                    stream_url,
                    headers=refresh_headers,
                    stream=True,
                    timeout=(8, 60),
                )

        if upstream.status_code >= 400:
            err_code = upstream.status_code
            upstream.close()
            return jsonify({"error": f"Upstream streaming failed with HTTP {err_code}"}), 502

        resp_headers = {
            "Content-Type": content_type,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Range, Content-Type, Authorization, Accept, X-Requested-With",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        }

        if upstream.headers.get("Content-Length"):
            resp_headers["Content-Length"] = upstream.headers["Content-Length"]
        if upstream.headers.get("Content-Range"):
            resp_headers["Content-Range"] = upstream.headers["Content-Range"]

        def generate_proxy():
            try:
                for chunk in upstream.iter_content(chunk_size=128 * 1024):
                    if chunk:
                        yield chunk
            except (GeneratorExit, ConnectionResetError, BrokenPipeError):
                pass
            except Exception as ex:
                print(f"[Stream] Proxy interrupted for {track_id}: {ex}")
            finally:
                upstream.close()

        status_code = 206 if (range_hdr and upstream.status_code == 206) else (upstream.status_code if upstream.status_code in (200, 206) else 200)
        return Response(generate_proxy(), status=status_code, headers=resp_headers)

    except Exception as e:
        print(f"[Stream] Upstream proxy error for {track_id}: {e}")
        return jsonify({"error": "Failed to stream online audio"}), 500

# ── Unified Cover Art & Dominant Color ──────────────────────────────────────
@app.route('/api/art/<track_id>', methods=['GET'])
def get_art(track_id):
    # 1. Try cache first
    cached = art.get_cached_art(track_id)
    if cached:
        return Response(cached[0], mimetype=cached[1], headers={"Cache-Control": "max-age=86400"})

    # 2. If in local library, extract from file
    with LIBRARY_LOCK:
        track = LIBRARY.get(track_id)

    if track and os.path.exists(track.get('path', '')):
        file_path = track['path']
        art_bytes, mime = art.extract_art(file_path)
        if art_bytes and mime:
            art.set_cached_art(track_id, art_bytes, mime)
            return Response(art_bytes, mimetype=mime, headers={"Cache-Control": "max-age=86400"})
        # Fallback to SVG
        svg = art.generate_default_art_svg(track.get('artist'), track.get('album'))
        return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "max-age=86400"})

    # 3. If online track, fetch YouTube thumbnail
    art_bytes, mime = art.fetch_online_art(track_id)
    if art_bytes and mime:
        return Response(art_bytes, mimetype=mime, headers={"Cache-Control": "max-age=86400"})

    # 4. Default fallback
    svg = art.generate_default_art_svg("Online", "Music")
    return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "max-age=86400"})

@app.route('/api/art/<track_id>/dominant', methods=['GET'])
def get_art_dominant(track_id):
    cached = art.get_cached_art(track_id)
    if cached:
        return jsonify(art.get_dominant_color(cached[0]))

    with LIBRARY_LOCK:
        track = LIBRARY.get(track_id)

    if track and os.path.exists(track.get('path', '')):
        art_bytes, _ = art.extract_art(track['path'])
        if art_bytes:
            return jsonify(art.get_dominant_color(art_bytes))

    # Try online thumbnail
    art_bytes, _ = art.fetch_online_art(track_id)
    if art_bytes:
        return jsonify(art.get_dominant_color(art_bytes))

    # Deterministic fallback color
    seed_str = track_id
    val = 0
    for char in seed_str:
        val = (val * 31 + ord(char)) & 0xFFFFFFFF
    hue = (val * 137) % 360
    r_f, g_f, b_f = colorsys.hsv_to_rgb(hue / 360.0, 0.75, 0.75)
    r, g, b = int(r_f * 255), int(g_f * 255), int(b_f * 255)
    return jsonify({'r': r, 'g': g, 'b': b, 'hex': f"#{r:02x}{g:02x}{b:02x}"})

# ── Unified Waveform Endpoint ───────────────────────────────────────────────
@app.route('/api/waveform/<track_id>', methods=['GET'])
def get_waveform(track_id):
    with LIBRARY_LOCK:
        track = LIBRARY.get(track_id)

    if track and os.path.exists(track.get('path', '')):
        samples = waveform.generate_waveform_samples(track['path'])
    else:
        # Check if downloaded in safe folder
        found = downloader.find_downloaded_file(track_id, get_active_safe_folder())
        if found and os.path.exists(found):
            samples = waveform.generate_waveform_samples(found)
        else:
            # Deterministic waveform from video ID
            samples = waveform.generate_waveform_samples(track_id)

    return jsonify(samples)

# ── Multi-Tier Lyrics Engine (Local LRC + Offline Cache + Tags + LRCLIB) ────
@app.route('/api/lyrics/<track_id>', methods=['GET'])
def get_lyrics(track_id):
    req_title = (request.args.get('title') or '').strip()
    req_artist = (request.args.get('artist') or '').strip()

    title = req_title or None
    artist = req_artist or None
    local_path = None

    with LIBRARY_LOCK:
        track = LIBRARY.get(track_id)
        if track:
            title = title or track.get('title')
            artist = artist or track.get('artist')
            local_path = track.get('path')

    if not local_path or not os.path.exists(local_path):
        found = downloader.find_downloaded_file(track_id, get_active_safe_folder())
        if found and os.path.exists(found):
            local_path = found

    # 1. Check local companion .lrc file next to audio file
    if local_path and os.path.exists(local_path):
        base_no_ext = os.path.splitext(local_path)[0]
        lrc_path = base_no_ext + '.lrc'
        if os.path.exists(lrc_path):
            try:
                with open(lrc_path, 'r', encoding='utf-8', errors='ignore') as f:
                    return jsonify({'type': 'lrc', 'content': f.read(), 'offline_cached': True})
            except Exception as e:
                print(f"[Lyrics] Failed reading local LRC: {e}")

    # 2. Check offline persistent cache directory ($APP_DATA_DIR/lyrics/<track_id>.lrc / .txt)
    cache_lrc = LYRICS_CACHE_DIR / f"{track_id}.lrc"
    if cache_lrc.exists():
        try:
            with open(cache_lrc, 'r', encoding='utf-8', errors='ignore') as f:
                return jsonify({'type': 'lrc', 'content': f.read(), 'offline_cached': True})
        except Exception as e:
            print(f"[Lyrics] Failed reading cached LRC: {e}")

    cache_txt = LYRICS_CACHE_DIR / f"{track_id}.txt"
    if cache_txt.exists():
        try:
            with open(cache_txt, 'r', encoding='utf-8', errors='ignore') as f:
                return jsonify({'type': 'plain', 'content': f.read(), 'offline_cached': True})
        except Exception as e:
            print(f"[Lyrics] Failed reading cached text lyrics: {e}")

    # Also check slug cache if title & artist known
    slug_key = None
    if title:
        clean_slug = re.sub(r'[^a-zA-Z0-9_\-]+', '_', f"{artist or ''}_{title}".lower()).strip('_')
        if clean_slug:
            slug_key = clean_slug
            slug_lrc = LYRICS_CACHE_DIR / f"slug_{clean_slug}.lrc"
            if slug_lrc.exists():
                try:
                    with open(slug_lrc, 'r', encoding='utf-8', errors='ignore') as f:
                        return jsonify({'type': 'lrc', 'content': f.read(), 'offline_cached': True})
                except Exception:
                    pass

    # 3. Check embedded tags
    if local_path and os.path.exists(local_path):
        try:
            audio = File(local_path)
            if audio is not None:
                if local_path.lower().endswith('.mp3') and audio.tags:
                    uslt = [v for k, v in audio.tags.items() if k.startswith('USLT')]
                    if uslt:
                        content = str(uslt[0])
                        # Cache embedded lyrics offline
                        try:
                            with open(cache_txt, 'w', encoding='utf-8') as f:
                                f.write(content)
                        except Exception:
                            pass
                        return jsonify({'type': 'plain', 'content': content, 'offline_cached': True})
                elif isinstance(audio, (FLAC, OggVorbis)) and audio.tags:
                    for k in ['LYRICS', 'lyrics']:
                        if k in audio.tags and audio.tags[k]:
                            content = audio.tags[k][0]
                            try:
                                with open(cache_txt, 'w', encoding='utf-8') as f:
                                    f.write(content)
                            except Exception:
                                pass
                            return jsonify({'type': 'plain', 'content': content, 'offline_cached': True})
                elif isinstance(audio, MP4) and audio.tags:
                    if '\xa9lyr' in audio.tags and audio.tags['\xa9lyr']:
                        content = audio.tags['\xa9lyr'][0]
                        try:
                            with open(cache_txt, 'w', encoding='utf-8') as f:
                                f.write(content)
                        except Exception:
                            pass
                        return jsonify({'type': 'plain', 'content': content, 'offline_cached': True})
        except Exception as e:
            print(f"[Lyrics] Embedded tag error: {e}")

    # 4. If online track or local track missing lyrics, fetch from LRCLIB online API
    if not title:
        info = extractor.get_track_info(track_id)
        if info:
            title = info.get('title')
            artist = info.get('artist')
    if title:
        clean_title = re.sub(r'\(Official.*?\)|\[Official.*?\]|\(Music Video\)|\(Audio\)|\[Audio\]|\(Visualizer\)|\(Lyric Video\)|ft\..*|feat\..*', '', title, flags=re.IGNORECASE).strip()
        clean_title = re.sub(r'[\(\[\{][^\)\]\}]*$', '', clean_title).strip(' -:;,')
        clean_artist = re.sub(r'VEVO|Official', '', artist or '', flags=re.IGNORECASE).strip(' -:;,')
        query = f"{clean_artist} {clean_title}".strip()

        try:
            resp = http_requests.get(f"https://lrclib.net/api/search?q={http_requests.utils.quote(query)}", timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list) and data:
                    match = next((item for item in data if item.get('syncedLyrics')), data[0])
                    if match.get('syncedLyrics'):
                        content = match['syncedLyrics']
                        # Persist permanently to disk cache for offline use!
                        try:
                            with open(cache_lrc, 'w', encoding='utf-8') as f:
                                f.write(content)
                            if slug_key:
                                with open(LYRICS_CACHE_DIR / f"slug_{slug_key}.lrc", 'w', encoding='utf-8') as f:
                                    f.write(content)
                            if local_path and os.path.exists(local_path):
                                base_no_ext = os.path.splitext(local_path)[0]
                                with open(base_no_ext + '.lrc', 'w', encoding='utf-8') as f:
                                    f.write(content)
                        except Exception as ex:
                            print(f"[Lyrics] Error caching synced lyrics to disk: {ex}")
                        return jsonify({'type': 'lrc', 'content': content, 'offline_cached': True})
                    elif match.get('plainLyrics'):
                        content = match['plainLyrics']
                        try:
                            with open(cache_txt, 'w', encoding='utf-8') as f:
                                f.write(content)
                            if slug_key:
                                with open(LYRICS_CACHE_DIR / f"slug_{slug_key}.txt", 'w', encoding='utf-8') as f:
                                    f.write(content)
                        except Exception as ex:
                            print(f"[Lyrics] Error caching plain lyrics to disk: {ex}")
                        return jsonify({'type': 'plain', 'content': content, 'offline_cached': True})
        except Exception as e:
            print(f"[Lyrics] Online LRCLIB search error: {e}")

    return jsonify({'type': 'none', 'content': '', 'offline_cached': False})

@app.route('/api/lyrics/<track_id>', methods=['POST'])
def save_offline_lyrics(track_id):
    """Save lyrics into permanent local offline storage for future offline playback."""
    data = request.get_json(silent=True) or {}
    content = (data.get('content') or '').strip()
    l_type = data.get('type', 'lrc')
    title = (data.get('title') or '').strip()
    artist = (data.get('artist') or '').strip()

    if not content:
        return jsonify({'status': 'error', 'message': 'No lyrics content provided'}), 400

    ext = '.lrc' if l_type == 'lrc' else '.txt'
    cache_path = LYRICS_CACHE_DIR / f"{track_id}{ext}"
    try:
        with open(cache_path, 'w', encoding='utf-8') as f:
            f.write(content)
        if title:
            clean_slug = re.sub(r'[^a-zA-Z0-9_\-]+', '_', f"{artist}_{title}".lower()).strip('_')
            if clean_slug:
                with open(LYRICS_CACHE_DIR / f"slug_{clean_slug}{ext}", 'w', encoding='utf-8') as f:
                    f.write(content)
    except Exception as e:
        print(f"[Lyrics] Error writing offline lyrics: {e}")

    # Also save companion .lrc beside local file if track has a local file
    local_path = None
    with LIBRARY_LOCK:
        track = LIBRARY.get(track_id)
        if track:
            local_path = track.get('path')

    if not local_path or not os.path.exists(local_path):
        found = downloader.find_downloaded_file(track_id, get_active_safe_folder())
        if found and os.path.exists(found):
            local_path = found

    if local_path and os.path.exists(local_path) and l_type == 'lrc':
        base_no_ext = os.path.splitext(local_path)[0]
        try:
            with open(base_no_ext + '.lrc', 'w', encoding='utf-8') as f:
                f.write(content)
        except Exception:
            pass

    return jsonify({'status': 'ok', 'track_id': track_id, 'offline_cached': True})

# ── Online Search & Exploration Endpoints ──────────────────────────────────
@app.route('/api/online/search', methods=['GET'])
def api_online_search():
    """
    Search YouTube Music by keyword or extract from YouTube / Playlist URL.
    Query parameter: ?q=<search term or URL>&max=15
    """
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'type': 'search', 'query': '', 'results': []})

    max_results = request.args.get('max', 15, type=int)
    results = extractor.search(query, max_results=max_results)
    return jsonify(results)

@app.route('/api/online/track/<video_id>', methods=['GET'])
def api_online_track(video_id):
    """Retrieve metadata for a single YouTube track."""
    info = extractor.get_track_info(video_id)
    if info:
        return jsonify(info)
    return jsonify({'error': 'Track not found'}), 404

# ── Online Downloads Endpoints ──────────────────────────────────────────────
@app.route('/api/download/start/<video_id>', methods=['POST'])
def start_download_track(video_id):
    """
    Start downloading a YouTube track in background into the active safe folder.
    Auto-imports into local library on completion.
    """
    safe_dir = get_active_safe_folder()

    def on_complete(filepath, vid):
        auto_import_downloaded_track(filepath, vid)

    # Check if already completed
    existing = downloader.find_downloaded_file(video_id, safe_dir)
    if existing and os.path.exists(existing):
        auto_import_downloaded_track(existing, video_id)
        return jsonify({'status': 'completed', 'video_id': video_id, 'filepath': existing})

    def run():
        downloader.download_track(
            video_id=video_id,
            download_dir=safe_dir,
            on_complete_callback=on_complete,
        )

    threading.Thread(target=run, daemon=True).start()
    return jsonify({'status': 'started', 'video_id': video_id})

@app.route('/api/download/status/<video_id>', methods=['GET'])
def get_download_status(video_id):
    """Check download status for a track."""
    return jsonify(downloader.get_download_status(video_id))

@app.route('/api/download/playlist', methods=['POST'])
def start_download_playlist():
    """
    Download all tracks in a YouTube playlist concurrently into a safe subfolder.
    Auto-imports tracks into library on completion.
    """
    data = request.get_json(silent=True) or {}
    playlist_url = data.get('url', '').strip()
    if not playlist_url:
        return jsonify({'status': 'error', 'message': 'No playlist URL provided'}), 400

    safe_dir = get_active_safe_folder()
    pl_id = hashlib.md5(playlist_url.encode("utf-8")).hexdigest()[:12]

    def on_track_complete(filepath, vid):
        auto_import_downloaded_track(filepath, vid)

    def run():
        downloader.download_playlist(
            playlist_url=playlist_url,
            download_dir=safe_dir,
            on_track_complete=on_track_complete,
        )

    threading.Thread(target=run, daemon=True).start()
    return jsonify({
        'status': 'started',
        'playlist_id': pl_id,
        'playlist_url': playlist_url,
        'target_folder': safe_dir
    })

@app.route('/api/download/playlist/status/<path:playlist_id_or_url>', methods=['GET'])
def get_playlist_download_status(playlist_id_or_url):
    """Check download status of an active or recent playlist download."""
    return jsonify(downloader.get_playlist_status(playlist_id_or_url))

@app.route('/api/downloads', methods=['GET'])
def get_downloads():
    """List all audio files in the active Safe Folder downloads directory."""
    safe_dir = get_active_safe_folder()
    if not os.path.exists(safe_dir):
        return jsonify({'status': 'ok', 'downloads': [], 'folder': safe_dir, 'total_size': 0, 'total_size_fmt': '0 MB'})

    results = []
    total_bytes = 0

    # Auto-prune any missing files under safe_dir that are still indexed in LIBRARY
    with LIBRARY_LOCK:
        ghost_ids = [
            tid for tid, t in list(LIBRARY.items())
            if t.get('path') and t.get('path').startswith(safe_dir) and not os.path.exists(t.get('path'))
        ]
        for tid in ghost_ids:
            LIBRARY.pop(tid, None)
            art.ART_CACHE.pop(tid, None)
    if ghost_ids:
        try:
            with database_connection() as connection:
                connection.executemany('DELETE FROM tracks WHERE id = ?', [(tid,) for tid in ghost_ids])
        except Exception as e:
            print(f"[Downloads] Error pruning dead safe-dir tracks: {e}")

    try:
        entries = list(os.scandir(safe_dir))
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

    for entry in entries:
        if not entry.is_file():
            continue
        ext = os.path.splitext(entry.name)[1].lower()
        if ext not in scanner.SUPPORTED_EXTENSIONS:
            continue

        try:
            stat = entry.stat()
            size = stat.st_size
            total_bytes += size
            mtime = stat.st_mtime
        except OSError:
            size = 0
            mtime = 0

        # Look up track in LIBRARY by path
        track_obj = None
        with LIBRARY_LOCK:
            for tid, t in LIBRARY.items():
                if t.get('path') == entry.path:
                    track_obj = dict(t)
                    break

        if not track_obj:
            # Auto scan this downloaded file
            track_obj = scanner.scan_single_file(entry.path)
            if track_obj:
                with LIBRARY_LOCK:
                    LIBRARY[track_obj['id']] = track_obj
                try:
                    with database_connection() as connection:
                        connection.execute(
                            'INSERT OR REPLACE INTO tracks (id, payload) VALUES (?, ?)',
                            (track_obj['id'], json.dumps(track_obj, ensure_ascii=False))
                        )
                except Exception as ex:
                    print(f"[Downloads] Error saving track to DB: {ex}")

        if not track_obj:
            tid = hashlib.md5(entry.path.encode('utf-8')).hexdigest()
            track_obj = {
                'id': tid,
                'title': os.path.splitext(entry.name)[0],
                'artist': 'AquaMusic Download',
                'album': 'Safe Folder',
                'duration': 0,
                'duration_fmt': '0:00',
                'path': entry.path,
            }

        track_obj['file_size'] = size
        track_obj['file_size_fmt'] = f"{size / (1024 * 1024):.1f} MB" if size >= 1024 * 1024 else f"{size / 1024:.0f} KB"
        track_obj['downloaded_at'] = mtime
        results.append(track_obj)

    results.sort(key=lambda x: x.get('downloaded_at', 0), reverse=True)

    def format_size(bytes_val):
        if bytes_val >= 1024 * 1024 * 1024:
            return f"{bytes_val / (1024 * 1024 * 1024):.2f} GB"
        if bytes_val >= 1024 * 1024:
            return f"{bytes_val / (1024 * 1024):.1f} MB"
        return f"{bytes_val / 1024:.0f} KB"

    return jsonify({
        'status': 'ok',
        'downloads': results,
        'folder': safe_dir,
        'total_size': total_bytes,
        'total_size_fmt': format_size(total_bytes)
    })

@app.route('/api/download/<track_id>', methods=['DELETE'])
def delete_downloaded_track(track_id):
    """Delete a downloaded audio file from the Safe Folder and library database."""
    target_path = None
    with LIBRARY_LOCK:
        if track_id in LIBRARY:
            target_path = LIBRARY[track_id].get('path')

    if not target_path or not os.path.exists(target_path):
        safe_dir = get_active_safe_folder()
        found = downloader.find_downloaded_file(track_id, safe_dir)
        if found and os.path.exists(found):
            target_path = found

    if target_path and os.path.exists(target_path):
        try:
            os.remove(target_path)
            print(f"[Downloads] Deleted audio file: {target_path}")
        except Exception as e:
            return jsonify({'status': 'error', 'message': f"Could not remove file: {e}"}), 500

    with LIBRARY_LOCK:
        LIBRARY.pop(track_id, None)
        art.ART_CACHE.pop(track_id, None)
    try:
        with database_connection() as connection:
            connection.execute('DELETE FROM tracks WHERE id = ?', (track_id,))
    except Exception as e:
        print(f"[Downloads] Error removing track from DB: {e}")

    return jsonify({'status': 'ok', 'deleted_id': track_id})

# ── File System & Desktop Integration Endpoints ─────────────────────────────
@app.route('/api/reveal-file', methods=['POST'])
def reveal_file():
    """Opens the directory containing the file in the OS file manager."""
    data = request.get_json(silent=True) or {}
    path = data.get('path', '')
    track_id = data.get('track_id', '')

    if not path and track_id:
        with LIBRARY_LOCK:
            if track_id in LIBRARY:
                path = LIBRARY[track_id].get('path')

    if not path or not os.path.exists(path):
        return jsonify({'status': 'error', 'message': 'File does not exist on disk'}), 404

    folder = os.path.dirname(os.path.abspath(path))
    try:
        if shutil.which('xdg-open'):
            subprocess.Popen(['xdg-open', folder])
        elif shutil.which('gio'):
            subprocess.Popen(['gio', 'open', folder])
        return jsonify({'status': 'ok', 'folder': folder})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

# ── Single Track Metadata & Tag Editing ─────────────────────────────────────
@app.route('/api/track/<track_id>', methods=['GET'])
def get_track(track_id):
    with LIBRARY_LOCK:
        if track_id not in LIBRARY:
            return "Track not found", 404
        return jsonify(LIBRARY[track_id])

@app.route('/api/tag/<track_id>', methods=['POST'])
def edit_tags(track_id):
    with LIBRARY_LOCK:
        if track_id not in LIBRARY:
            return jsonify({'status': 'error', 'message': 'Track not found in library'}), 404
        track = LIBRARY[track_id]

    data = request.json or {}
    
    success, err_msg = tagger.update_track_tags(track['path'], data)
    if not success:
        return jsonify({'status': 'error', 'message': f"Tag write failed: {err_msg}"}), 500

    art_changed = False
    if 'art_base64' in data or data.get('remove_art'):
        art_ok, art_err = tagger.update_artwork(
            track['path'], 
            art_base64=data.get('art_base64'), 
            remove_art=data.get('remove_art', False)
        )
        if art_ok:
            art.ART_CACHE.pop(track_id, None)
            art_changed = True

    with LIBRARY_LOCK:
        for field in ['title', 'artist', 'album', 'album_artist', 'year', 'genre', 'track_number', 'disc_number', 'comment', 'composer', 'bpm']:
            if field in data:
                track[field] = data[field]
        if art_changed:
            track['has_art'] = not data.get('remove_art', False)

    save_library()
    return jsonify({'status': 'ok'})

@app.route('/api/playlist/export', methods=['GET'])
def export_playlist():
    ids_str = request.args.get('ids', '')
    if not ids_str:
        return "No track IDs provided", 400
        
    ids = ids_str.split(',')
    m3u_lines = ["#EXTM3U"]
    
    with LIBRARY_LOCK:
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

@app.route('/api/playlist/import-m3u', methods=['POST'])
def import_m3u_playlist():
    """Import an M3U file or content, register/scan local tracks, and return playlist."""
    data = request.get_json(silent=True) or {}
    content = data.get('content', '')
    name = data.get('name', 'Imported Playlist')
    filepath = data.get('filepath', '')

    if filepath and os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            if not data.get('name'):
                name = os.path.splitext(os.path.basename(filepath))[0]
        except Exception as e:
            return jsonify({'status': 'error', 'message': f"Failed reading file: {e}"}), 400

    if not content:
        return jsonify({'status': 'error', 'message': 'No M3U content provided'}), 400

    lines = [line.strip() for line in content.splitlines() if line.strip()]
    track_ids = []
    tracks_to_insert = []
    base_dir = os.path.dirname(filepath) if filepath else os.path.expanduser('~')

    for line in lines:
        if line.startswith('#'):
            continue
        p = line
        if not os.path.isabs(p):
            p = os.path.normpath(os.path.join(base_dir, p))
        if not os.path.exists(p):
            continue
        ext = os.path.splitext(p)[1].lower()
        if ext not in scanner.SUPPORTED_EXTENSIONS:
            continue

        existing_track = None
        with LIBRARY_LOCK:
            for tid, tr in LIBRARY.items():
                if tr.get('path') == p:
                    existing_track = tr
                    break

        if existing_track:
            track_ids.append(existing_track['id'])
        else:
            tr = scanner.scan_single_file(p)
            if tr:
                with LIBRARY_LOCK:
                    LIBRARY[tr['id']] = tr
                tracks_to_insert.append((tr['id'], json.dumps(tr, ensure_ascii=False)))
                track_ids.append(tr['id'])

    if tracks_to_insert:
        try:
            with database_connection() as connection:
                connection.executemany('INSERT OR REPLACE INTO tracks (id, payload) VALUES (?, ?)', tracks_to_insert)
        except Exception as ex:
            print(f"[M3U Import] Error saving tracks: {ex}")

    return jsonify({
        'status': 'ok',
        'name': name,
        'track_ids': track_ids,
        'count': len(track_ids)
    })

def serve_local(port=0, host='127.0.0.1'):
    """Run the private local HTTP server used by the desktop application."""
    global MAIN_SERVER_PORT
    server = make_server(host, int(port), app, threaded=True)
    MAIN_SERVER_PORT = server.server_port
    return server

if __name__ == '__main__':
    host = os.environ.get('AQUAMUSIC_HOST', '0.0.0.0')
    server = serve_local(os.environ.get('AQUAMUSIC_PORT', '5000'), host)
    port = server.server_port
    print(f'[Local] Serving AquaMusic at http://127.0.0.1:{port}')
    if host == '0.0.0.0':
        addresses = lan_addresses()
        if addresses:
            print('[LAN] Open one of these HTTP URLs on another device:')
            for address in addresses:
                print(f'      http://{address}:{port}')
    server.serve_forever()
