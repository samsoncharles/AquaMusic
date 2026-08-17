import os
import hashlib
import time
import json
import threading
from mutagen import File
from mutagen.flac import FLAC
from mutagen.mp4 import MP4
from mutagen.oggvorbis import OggVorbis
from mutagen.mp3 import MP3

# Set of supported audio file extensions
SUPPORTED_EXTENSIONS = {
    '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.wma',
    '.opus', '.aiff', '.ape', '.mpc', '.wv', '.tta', '.alac'
}

# Global scanning state
SCAN_STATE = {
    'status': 'idle',        # 'idle', 'scanning', 'done', 'error'
    'total': 0,
    'scanned': 0,
    'current_file': '',
    'errors': 0,
    'elapsed': 0
}
scan_lock = threading.Lock()

def parse_replaygain(val):
    """Cleans up and parses ReplayGain values like '-7.42 dB' or '+1.2' to float."""
    if val is None:
        return None
    try:
        if isinstance(val, list):
            val = val[0]
        val_str = str(val).lower().replace('db', '').strip()
        return float(val_str)
    except Exception:
        return None

def parse_bpm(val):
    """Extracts integer BPM value from tags."""
    if val is None:
        return None
    try:
        if isinstance(val, list):
            val = val[0]
        # remove decimals or text
        val_str = str(val).split('.')[0].strip()
        return int(''.join(c for c in val_str if c.isdigit()))
    except Exception:
        return None

def parse_track_disc(val):
    """Extracts track/disc number as integer, handling fractional/tuple formats (e.g. '1/12' or (1, 12))."""
    if val is None:
        return 0
    try:
        if isinstance(val, (list, tuple)):
            if len(val) > 0:
                val = val[0]
            else:
                return 0
        val_str = str(val).split('/')[0].strip()
        return int(val_str)
    except Exception:
        return 0

def format_duration(seconds):
    """Formats float duration into standard format (e.g., '4:32' or '1:02:14')."""
    if not seconds:
        return "0:00"
    secs = int(seconds)
    hours = secs // 3600
    minutes = (secs % 3600) // 60
    seconds_remaining = secs % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{seconds_remaining:02d}"
    else:
        return f"{minutes}:{seconds_remaining:02d}"

def check_has_art(audio):
    """Fast check for artwork presence without loading large image blocks into memory."""
    try:
        if isinstance(audio, FLAC) and audio.pictures:
            return True
        if isinstance(audio, MP4) and 'covr' in audio.tags:
            return True
        if hasattr(audio, 'tags') and audio.tags:
            # Check APIC for MP3/ID3
            for key in audio.tags.keys():
                if key.startswith('APIC:'):
                    return True
            # Check Ogg Vorbis metadata picture block
            if 'metadata_block_picture' in audio.tags:
                return True
            # WMA pictures
            if 'WM/Picture' in audio.tags:
                return True
    except Exception:
        pass
    return False

def scan_single_file(file_path):
    """
    Scans a single audio file and extracts all metadata fields required by AquaMusic.
    Falls back gracefully to folder/filenames if tags are missing.
    """
    try:
        audio = File(file_path)
        stat = os.stat(file_path)
        file_size = stat.st_size
        added_time = int(stat.st_mtime)

        # Fallback values
        filename_stem = os.path.splitext(os.path.basename(file_path))[0]
        parent_dir_name = os.path.basename(os.path.dirname(file_path))

        title = filename_stem
        artist = "Unknown Artist"
        album = parent_dir_name if parent_dir_name else "Unknown Album"
        album_artist = "Unknown Artist"
        year = ""
        genre = "Unknown Genre"
        track_number = 0
        disc_number = 0
        comment = ""
        composer = ""
        replay_gain = None
        bpm = None

        # Technical info defaults
        duration = 0.0
        bitrate = 0
        sample_rate = 0
        channels = 2
        codec = os.path.splitext(file_path)[1][1:].upper()

        if audio is not None:
            # Get duration & technical parameters
            if audio.info:
                duration = getattr(audio.info, 'length', 0.0)
                bitrate = getattr(audio.info, 'bitrate', 0)
                if bitrate:
                    bitrate = bitrate // 1000  # convert bps to kbps
                sample_rate = getattr(audio.info, 'sample_rate', 0)
                channels = getattr(audio.info, 'channels', 2)

            # 1. MP3 / ID3 Specific Extraction
            if isinstance(audio, MP3) and audio.tags:
                tags = audio.tags
                title = str(tags.get('TIT2', title))
                artist = str(tags.get('TPE1', artist))
                album = str(tags.get('TALB', album))
                album_artist = str(tags.get('TPE2', tags.get('TPE1', artist)))
                
                # Year check
                year_val = tags.get('TDRC', tags.get('TDAT', tags.get('TYER', '')))
                year = str(year_val) if year_val else ""
                
                genre = str(tags.get('TCON', genre))
                track_number = parse_track_disc(tags.get('TRCK'))
                disc_number = parse_track_disc(tags.get('TPOS'))
                
                # Comment
                comment_frames = [v for k, v in tags.items() if k.startswith('COMM')]
                if comment_frames:
                    comment = str(comment_frames[0])
                
                composer = str(tags.get('TCOM', ''))
                bpm = parse_bpm(tags.get('TBPM'))
                
                # ReplayGain
                rg_txxx = [v for k, v in tags.items() if k.startswith('TXXX:') and 'replaygain' in k.lower()]
                if rg_txxx:
                    replay_gain = parse_replaygain(rg_txxx[0])

            # 2. FLAC / OGG (Vorbis Comment) Specific Extraction
            elif isinstance(audio, (FLAC, OggVorbis)) and audio.tags:
                tags = audio.tags
                
                def first_tag(keys, default=""):
                    for k in keys:
                        if k in tags and tags[k]:
                            return tags[k][0]
                    return default
                
                title = first_tag(['TITLE', 'title'], title)
                artist = first_tag(['ARTIST', 'artist'], artist)
                album = first_tag(['ALBUM', 'album'], album)
                album_artist = first_tag(['ALBUMARTIST', 'albumartist', 'album artist', 'ARTIST', 'artist'], artist)
                year = first_tag(['DATE', 'date', 'YEAR', 'year'], "")
                genre = first_tag(['GENRE', 'genre'], genre)
                
                track_number = parse_track_disc(tags.get('TRACKNUMBER', tags.get('tracknumber')))
                disc_number = parse_track_disc(tags.get('DISCNUMBER', tags.get('discnumber')))
                comment = first_tag(['COMMENT', 'comment'], "")
                composer = first_tag(['COMPOSER', 'composer'], "")
                bpm = parse_bpm(first_tag(['BPM', 'bpm'], None))
                replay_gain = parse_replaygain(first_tag(['REPLAYGAIN_TRACK_GAIN', 'replaygain_track_gain'], None))

            # 3. MP4 / M4A (iTunes Atom) Specific Extraction
            elif isinstance(audio, MP4) and audio.tags:
                tags = audio.tags
                
                def first_mp4(keys, default=""):
                    for k in keys:
                        if k in tags and tags[k]:
                            return tags[k][0]
                    return default

                title = first_mp4(['\xa9nam'], title)
                artist = first_mp4(['\xa9ART'], artist)
                album = first_mp4(['\xa9alb'], album)
                album_artist = first_mp4(['aART', '\xa9ART'], artist)
                year = first_mp4(['\xa9day'], "")
                genre = first_mp4(['\xa9gen'], genre)
                comment = first_mp4(['\xa9cmt'], "")
                composer = first_mp4(['\xa9wrt'], "")
                
                # trkn and disk are lists of tuples: [(num, total)]
                if 'trkn' in tags and tags['trkn']:
                    track_number = tags['trkn'][0][0]
                if 'disk' in tags and tags['disk']:
                    disc_number = tags['disk'][0][0]
                if 'tmpo' in tags and tags['tmpo']:
                    bpm = tags['tmpo'][0]
                    
                # ReplayGain in user-defined atoms
                for k in tags.keys():
                    if 'replaygain_track_gain' in k.lower():
                        replay_gain = parse_replaygain(tags[k])

            # Check general tags list if generic audio formats (WMA, Wav, etc.)
            elif hasattr(audio, 'tags') and audio.tags:
                tags = audio.tags
                # Simple string lookups
                for tkey in tags.keys():
                    tkey_l = tkey.lower()
                    if 'title' in tkey_l:
                        title = str(tags[tkey])
                    elif 'artist' in tkey_l:
                        artist = str(tags[tkey])
                    elif 'album' in tkey_l:
                        album = str(tags[tkey])

        has_art = check_has_art(audio)

        # Generate a unique deterministic ID
        track_id = hashlib.md5(file_path.encode('utf-8')).hexdigest()

        return {
            'id': track_id,
            'path': file_path,
            'title': title,
            'artist': artist,
            'album': album,
            'album_artist': album_artist,
            'year': year,
            'genre': genre,
            'track_number': track_number,
            'disc_number': disc_number,
            'comment': comment,
            'composer': composer,
            'duration': duration,
            'duration_fmt': format_duration(duration),
            'bitrate': bitrate,
            'sample_rate': sample_rate,
            'channels': channels,
            'codec': codec,
            'file_size': file_size,
            'has_art': has_art,
            'replay_gain': replay_gain,
            'bpm': bpm,
            'added': added_time,
            'rating': 0,        # Initial values (overridden by frontend localstorage)
            'play_count': 0     # Initial values
        }
    except Exception as e:
        print(f"[Scanner] Error scanning {file_path}: {e}")
        return None

def scan_directory_recursive(folder_path, library_dict, on_progress=None):
    """
    Recursively scans the folder path for supported formats.
    Updates `library_dict` in-place and calls `on_progress` periodically.
    """
    global SCAN_STATE
    start_time = time.time()

    with scan_lock:
        SCAN_STATE.update({
            'status': 'scanning',
            'total': 0,
            'scanned': 0,
            'current_file': 'Listing directories...',
            'errors': 0,
            'elapsed': 0
        })

    # First pass: Gather all supported file paths
    file_list = []
    try:
        for root, _, files in os.walk(folder_path):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in SUPPORTED_EXTENSIONS:
                    file_list.append(os.path.join(root, file))
    except Exception as e:
        print(f"[Scanner] Directory walk failed: {e}")
        with scan_lock:
            SCAN_STATE.update({
                'status': 'error',
                'current_file': f"Scan failed: {str(e)}"
            })
        return

    total_files = len(file_list)
    with scan_lock:
        SCAN_STATE['total'] = total_files

    if total_files == 0:
        with scan_lock:
            SCAN_STATE['status'] = 'done'
            SCAN_STATE['current_file'] = 'No files found.'
        if on_progress:
            on_progress()
        return

    # Second pass: Extract metadata
    for i, file_path in enumerate(file_list):
        with scan_lock:
            SCAN_STATE['current_file'] = file_path
            SCAN_STATE['elapsed'] = int(time.time() - start_time)

        track_data = scan_single_file(file_path)
        
        with scan_lock:
            if track_data:
                library_dict[track_data['id']] = track_data
            else:
                SCAN_STATE['errors'] += 1
            SCAN_STATE['scanned'] = i + 1

        if on_progress and (i % 5 == 0 or i == total_files - 1):
            on_progress()

    with scan_lock:
        SCAN_STATE['status'] = 'done'
        SCAN_STATE['current_file'] = f"Completed scanning {total_files} files."
        SCAN_STATE['elapsed'] = int(time.time() - start_time)
    if on_progress:
        on_progress()

def _shallow_audio_count(path):
    try:
        count = 0
        for entry in os.scandir(path):
            if entry.is_file():
                ext = os.path.splitext(entry.name)[1].lower()
                if ext in SUPPORTED_EXTENSIONS:
                    count += 1
        return count
    except Exception:
        return 0

def get_directory_listing(path):
    """
    Returns files and subdirectories for the folder picker.
    Filters to return standard folders, plus checks for any music file children.
    """
    if not path or path == '/':
        path = os.path.expanduser('~')

    if not os.path.exists(path) or not os.path.isdir(path):
        # Fallback to user home
        path = os.path.expanduser('~')

    result = {
        'current_path': path,
        'parent_path': os.path.dirname(path) if path != os.path.dirname(path) else '',
        'folders': [],
        'audio_count': 0,
        'audio_size_bytes': 0
    }

    try:
        for entry in os.scandir(path):
            try:
                if entry.is_dir() and not entry.name.startswith('.'):
                    sub_count = _shallow_audio_count(entry.path)
                    result['folders'].append({
                        'name': entry.name,
                        'path': entry.path,
                        'audio_count': sub_count
                    })
                elif entry.is_file():
                    ext = os.path.splitext(entry.name)[1].lower()
                    if ext in SUPPORTED_EXTENSIONS:
                        result['audio_count'] += 1
                        result['audio_size_bytes'] += entry.stat().st_size
            except Exception:
                continue
    except Exception as e:
        print(f"[Scanner] Directory listing error for {path}: {e}")
        # Return empty list or folder structure with error
    
    # Sort folders alphabetically
    result['folders'].sort(key=lambda x: x['name'].lower())
    
    # Format size to MB
    result['audio_size_mb'] = round(result['audio_size_bytes'] / (1024 * 1024), 2)
    return result

def auto_search_mp3_folders(start_path=None, max_depth=4):
    """
    Auto-searches the user's home directory for folders containing MP3/audio files.
    """
    if not start_path:
        start_path = os.path.expanduser('~')
    
    results = []
    
    def _scan(current_path, depth):
        if depth > max_depth:
            return
        try:
            has_audio = False
            subdirs = []
            for entry in os.scandir(current_path):
                if entry.is_file():
                    ext = os.path.splitext(entry.name)[1].lower()
                    if ext in SUPPORTED_EXTENSIONS:
                        has_audio = True
                elif entry.is_dir() and not entry.name.startswith('.'):
                    subdirs.append(entry.path)
            
            if has_audio:
                count = _shallow_audio_count(current_path)
                if count > 0:
                    results.append({
                        'name': os.path.basename(current_path) or current_path,
                        'path': current_path,
                        'audio_count': count
                    })
            
            for d in subdirs:
                _scan(d, depth + 1)
        except Exception:
            pass
            
    _scan(start_path, 1)
    
    # Sort by audio count descending
    results.sort(key=lambda x: x['audio_count'], reverse=True)
    return results
