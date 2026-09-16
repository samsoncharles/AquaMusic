import os
import io
import colorsys
import hashlib
import threading
from mutagen import File
from mutagen.flac import FLAC
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggvorbis import OggVorbis
from PIL import Image, ImageFile
import requests

ImageFile.LOAD_TRUNCATED_IMAGES = True

# In-memory LRU cache for art data
# Dict mapping track_id -> (image_bytes, mime_type)
ART_CACHE = {}
MAX_CACHE_SIZE = 250
_art_lock = threading.Lock()

def get_cached_art(track_id):
    """Retrieves image from cache if available in a thread-safe manner."""
    with _art_lock:
        if track_id in ART_CACHE:
            val = ART_CACHE.pop(track_id)
            ART_CACHE[track_id] = val
            return val
    return None

def set_cached_art(track_id, image_bytes, mime_type):
    """Puts image into LRU cache in a thread-safe manner."""
    with _art_lock:
        if len(ART_CACHE) >= MAX_CACHE_SIZE:
            oldest_key = next(iter(ART_CACHE))
            ART_CACHE.pop(oldest_key, None)
        ART_CACHE[track_id] = (image_bytes, mime_type)

def extract_art(file_path):
    """
    Extracts raw embedded artwork bytes and MIME type from an audio file.
    Supports MP3 (ID3), FLAC, MP4/M4A, Ogg Vorbis, and WMA.
    """
    if not file_path or not os.path.exists(file_path):
        return None, None

    try:
        audio = File(file_path)
        if audio is None:
            return None, None

        # 1. FLAC Picture blocks
        if isinstance(audio, FLAC) and audio.pictures:
            pic = audio.pictures[0]
            return pic.data, pic.mime

        # 2. MP3 ID3 APIC frame
        if hasattr(audio, 'tags') and audio.tags:
            # Check standard getall
            if hasattr(audio.tags, 'getall'):
                apics = audio.tags.getall('APIC')
                if apics:
                    apic = apics[0]
                    mime = getattr(apic, 'mime', 'image/jpeg')
                    if mime == 'image/jpg':
                        mime = 'image/jpeg'
                    return apic.data, mime

            # Check APIC keys fallback
            for key in audio.tags.keys():
                if key.startswith('APIC'):
                    apic = audio.tags[key]
                    mime = getattr(apic, 'mime', 'image/jpeg')
                    if mime == 'image/jpg':
                        mime = 'image/jpeg'
                    return apic.data, mime

        # 3. MP4 Cover atom
        if isinstance(audio, MP4):
            if 'covr' in audio.tags and audio.tags['covr']:
                covr = audio.tags['covr'][0]
                mime = 'image/jpeg'
                if isinstance(covr, MP4Cover):
                    if covr.imageformat == MP4Cover.FORMAT_PNG:
                        mime = 'image/png'
                    return bytes(covr), mime
                else:
                    return bytes(covr), mime

        # 4. Ogg Vorbis metadata_block_picture
        if isinstance(audio, OggVorbis):
            if 'metadata_block_picture' in audio.tags:
                import base64
                from mutagen.flac import Picture
                for b64_data in audio.tags['metadata_block_picture']:
                    try:
                        pic_data = base64.b64decode(b64_data)
                        pic = Picture(pic_data)
                        return pic.data, pic.mime
                    except Exception:
                        continue

        # 5. WMA/ASF Picture tag fallback
        if hasattr(audio, 'tags') and 'WM/Picture' in audio.tags:
            pictures = audio.tags['WM/Picture']
            if pictures:
                pic = pictures[0]
                if hasattr(pic, 'data'):
                    return pic.data, getattr(pic, 'mime', 'image/jpeg')
                elif hasattr(pic, 'value'):
                    return pic.value, 'image/jpeg'

    except Exception as e:
        print(f"[Art Extractor] Error reading art from {file_path}: {e}")

    return None, None

def fetch_online_art(video_id, thumbnail_url=None):
    """
    Fetch thumbnail image for online/YouTube tracks and cache it.
    """
    cached = get_cached_art(video_id)
    if cached:
        return cached

    urls = []
    if thumbnail_url:
        urls.append(thumbnail_url)
    urls.extend([
        f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
    ])

    for url in urls:
        try:
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200 and len(resp.content) > 1000:
                mime = resp.headers.get("Content-Type", "image/jpeg")
                set_cached_art(video_id, resp.content, mime)
                return resp.content, mime
        except Exception:
            continue

    return None, None

def get_dominant_color(image_bytes):
    """
    Computes a vibrant, glowing dominant accent color from artwork bytes.
    Resizes image to 50x50, converts to RGB, and performs a weighted average
    of pixels by their saturation and value to get a clean visual color.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = img.resize((50, 50)).convert('RGB')
        pixels = list(img.getdata())

        total_weight = 0.0
        r_sum, g_sum, b_sum = 0.0, 0.0, 0.0

        for r, g, b in pixels:
            h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            weight = (s * v) ** 2 + 0.01
            r_sum += r * weight
            g_sum += g * weight
            b_sum += b * weight
            total_weight += weight

        if total_weight > 0:
            r = int(r_sum / total_weight)
            g = int(g_sum / total_weight)
            b = int(b_sum / total_weight)
        else:
            r, g, b = 124, 106, 247

        # Ensure the color is vibrant enough to act as a glowing UI accent
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        s = max(s, 0.5)  # minimum saturation 50%
        v = max(v, 0.6)  # minimum brightness 60%
        r_f, g_f, b_f = colorsys.hsv_to_rgb(h, s, v)
        r, g, b = int(r_f * 255), int(g_f * 255), int(b_f * 255)

        hex_color = f"#{r:02x}{g:02x}{b:02x}"
        return {
            'r': r,
            'g': g,
            'b': b,
            'hex': hex_color
        }
    except Exception as e:
        print(f"[Art Extractor] Dominant color error: {e}")
        return {'r': 124, 'g': 106, 'b': 247, 'hex': '#7C6AF7'}

def generate_default_art_svg(artist, album):
    """
    Generates a deterministic linear gradient SVG placeholder for files with no artwork.
    Includes a subtle stripes texture and a centered 40% opaque music note.
    """
    seed_str = f"{artist or 'Unknown'} - {album or 'Unknown'}"
    val = 0
    for char in seed_str:
        val = (val * 31 + ord(char)) & 0xFFFFFFFF

    hue1 = (val * 137) % 360
    hue2 = (hue1 + 47) % 360

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="100%" height="100%">
  <defs>
    <linearGradient id="grad-{val}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl({hue1}, 65%, 25%)" />
      <stop offset="100%" stop-color="hsl({hue2}, 70%, 12%)" />
    </linearGradient>
    <pattern id="stripes-{val}" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="40" stroke="rgba(255,255,255,0.02)" stroke-width="8" />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#grad-{val})" />
  <rect width="100%" height="100%" fill="url(#stripes-{val})" />
  <g fill="#EEEEF5" opacity="0.4" transform="translate(175, 150) scale(6)">
    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
  </g>
</svg>"""
    return svg.encode('utf-8')
