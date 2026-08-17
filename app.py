import os
import re
import json
import time
import threading
import colorsys
from flask import Flask, render_template, request, Response, jsonify, send_file
from werkzeug.utils import secure_filename
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

# Track library data storage
LIBRARY = {}
LIBRARY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'library.json')

def load_library():
    """Loads the track library database from disk if it exists."""
    global LIBRARY
    if os.path.exists(LIBRARY_FILE):
        try:
            with open(LIBRARY_FILE, 'r', encoding='utf-8') as f:
                LIBRARY = json.load(f)
            # Keep a previously saved library from resurfacing video files
            # after the scanner has been restricted to audio-only formats.
            LIBRARY = {
                track_id: track for track_id, track in LIBRARY.items()
                if os.path.splitext(track.get('path', ''))[1].lower() in scanner.SUPPORTED_EXTENSIONS
            }
            print(f"[Library] Loaded {len(LIBRARY)} tracks from local file database.")
        except Exception as e:
            print(f"[Library] Load failed: {e}. Starting with an empty library.")
            LIBRARY = {}
    else:
        LIBRARY = {}

def save_library():
    """Saves the track library database to disk."""
    try:
        with open(LIBRARY_FILE, 'w', encoding='utf-8') as f:
            json.dump(LIBRARY, f, indent=2, ensure_ascii=False)
        print(f"[Library] Saved {len(LIBRARY)} tracks to local database.")
    except Exception as e:
        print(f"[Library] Save failed: {e}")

# Initial load
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





if __name__ == '__main__':
    # Ensure static and templates dirs exist
    os.makedirs(os.path.join(app.root_path, 'templates'), exist_ok=True)
    os.makedirs(os.path.join(app.root_path, 'static', 'css'), exist_ok=True)
    os.makedirs(os.path.join(app.root_path, 'static', 'js'), exist_ok=True)
    
    app.run(host='0.0.0.0', port=5000, debug=True)
