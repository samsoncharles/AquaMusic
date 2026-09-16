"""
AquaMusic Online Extractor.
Innertube direct search and yt-dlp metadata/stream URL extraction.
"""

import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor
import requests
import yt_dlp
from core.cookies import get_cookie_file

# ── Caches ──────────────────────────────────────────────────────────────────
_url_cache: dict[str, dict] = {}
_URL_CACHE_TTL = 900  # 15 minutes

_search_cache: dict[str, dict] = {}
_SEARCH_CACHE_TTL = 300  # 5 minutes

_cache_lock = threading.Lock()

# ── Thread pool for background extraction ───────────────────────────────────
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="aquamusic-extract")

# ── Persistent HTTP session for Innertube API ──────────────────────────────
_http_session = requests.Session()
_http_session.headers.update({
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Accept-Language": "en-US,en;q=0.9",
})


def _is_url(query: str) -> bool:
    """Check if input is a web URL."""
    return bool(re.match(r"^https?://", query.strip(), re.IGNORECASE))


def _is_playlist_url(url: str) -> bool:
    """Check if URL represents a playlist."""
    return bool(re.search(r"(?:list=|\/playlist\b)", url, re.IGNORECASE))


def _extract_video_id_from_url(url: str) -> str | None:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r"(?:v=|\/watch\?v=|\/embed\/|\/v\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})",
        r"^([a-zA-Z0-9_-]{11})$",
    ]
    for p in patterns:
        m = re.search(p, url.strip())
        if m:
            return m.group(1)
    return None


def _base_opts() -> dict:
    """Lightweight yt-dlp options — matches uyube's proven config."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 15,
        "http_chunk_size": 10485760,
        "concurrent_fragment_downloads": 4,
        "extractor_args": {
            "youtube": {
                "player_client": ["web_embedded", "web", "tv"],
            }
        },
    }
    cookie_file = get_cookie_file()
    if cookie_file:
        opts["cookiefile"] = cookie_file
    return opts



def _format_duration(seconds: int | float | None) -> str:
    """Format seconds into MM:SS or HH:MM:SS."""
    if not seconds:
        return "0:00"
    seconds = int(seconds)
    if seconds >= 3600:
        h = seconds // 3600
        m = (seconds % 3600) // 60
        s = seconds % 60
        return f"{h}:{m:02d}:{s:02d}"
    m = seconds // 60
    s = seconds % 60
    return f"{m}:{s:02d}"


def _parse_duration_str(text: str) -> tuple[int, str]:
    """Parse duration string like '3:45' or '1:12:05' into (seconds, string)."""
    if not text:
        return 0, "0:00"
    parts = text.strip().split(":")
    try:
        if len(parts) == 2:
            s = int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            s = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        else:
            s = int(parts[0])
        return s, text.strip()
    except Exception:
        return 0, text.strip()


def _extract_track_info(entry: dict) -> dict:
    """Normalize a yt-dlp info dict into our track format."""
    video_id = entry.get("id", "")
    thumbnail = entry.get("thumbnail", "")

    thumbnails = entry.get("thumbnails", [])
    if thumbnails:
        for t in reversed(thumbnails):
            if t.get("url"):
                thumbnail = t["url"]
                break

    if not thumbnail and video_id:
        thumbnail = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

    return {
        "id": video_id,
        "title": entry.get("title") or "Unknown Title",
        "artist": entry.get("artist") or entry.get("uploader") or entry.get("channel") or "Unknown Artist",
        "album": entry.get("album", ""),
        "duration": entry.get("duration", 0),
        "duration_str": _format_duration(entry.get("duration")),
        "duration_fmt": _format_duration(entry.get("duration")),
        "thumbnail": thumbnail,
        "url": f"https://music.youtube.com/watch?v={video_id}" if video_id else "",
        "webpage_url": entry.get("webpage_url", f"https://www.youtube.com/watch?v={video_id}"),
        "is_online": True,
    }


def _search_innertube(query: str, max_results: int = 15) -> list[dict]:
    """
    Direct Innertube JSON search (fast, ~1-2s).
    """
    url = "https://www.youtube.com/youtubei/v1/search"
    payload = {
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20240101.00.00",
                "hl": "en",
                "gl": "US",
            }
        },
        "query": query,
    }

    resp = _http_session.post(url, json=payload, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    results = []
    contents = (
        data.get("contents", {})
        .get("twoColumnSearchResultsRenderer", {})
        .get("primaryContents", {})
        .get("sectionListRenderer", {})
        .get("contents", [])
    )

    for sec in contents:
        items = sec.get("itemSectionRenderer", {}).get("contents", [])
        for it in items:
            vr = it.get("videoRenderer")
            if not vr:
                continue

            vid = vr.get("videoId")
            if not vid:
                continue

            title_runs = vr.get("title", {}).get("runs", [])
            title = "".join(run.get("text", "") for run in title_runs) or "Unknown Title"

            owner_runs = vr.get("ownerText", {}).get("runs", [])
            artist = "".join(run.get("text", "") for run in owner_runs) or "Unknown Artist"

            length_text = vr.get("lengthText", {}).get("simpleText", "")
            duration_sec, duration_str = _parse_duration_str(length_text)

            thumbs = vr.get("thumbnail", {}).get("thumbnails", [])
            thumb = thumbs[-1].get("url") if thumbs else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

            results.append({
                "id": vid,
                "title": title,
                "artist": artist,
                "album": "",
                "duration": duration_sec,
                "duration_str": duration_str,
                "duration_fmt": duration_str,
                "thumbnail": thumb,
                "url": f"https://music.youtube.com/watch?v={vid}",
                "webpage_url": f"https://www.youtube.com/watch?v={vid}",
                "is_online": True,
            })

            if len(results) >= max_results:
                break
        if len(results) >= max_results:
            break

    return results


def search(query: str, max_results: int = 15) -> dict:
    """
    Unified search entry point for text queries or YouTube URLs.
    Detects playlists, single tracks, and combined video+playlist links.
    """
    query = query.strip()
    if not query:
        return {"type": "search", "query": "", "results": []}

    if _is_url(query):
        video_id = _extract_video_id_from_url(query)
        is_pl = _is_playlist_url(query)

        if is_pl:
            playlist_data = get_playlist_info(query)
            if video_id:
                try:
                    single_track = get_track_info(video_id)
                    if single_track:
                        playlist_data["single_track"] = single_track
                except Exception:
                    pass

            if playlist_data.get("results"):
                return playlist_data

            # Fallback if playlist extraction returned empty (e.g. YouTube mix) but video_id exists
            if video_id:
                track = get_track_info(video_id)
                if track:
                    return {"type": "track", "query": query, "results": [track]}
            return playlist_data
        else:
            track = get_track_info_by_url(query)
            if track:
                return {"type": "track", "query": query, "results": [track]}
            return {"type": "track", "query": query, "results": []}
    else:
        return search_text(query, max_results)


def search_text(query: str, max_results: int = 15) -> dict:
    """
    Search YouTube by text query with caching.
    Uses Innertube first, falls back to yt-dlp flat search.
    """
    cache_key = f"{query.lower()}:{max_results}"

    with _cache_lock:
        if cache_key in _search_cache:
            cached = _search_cache[cache_key]
            if (time.time() - cached["_cached_at"]) < _SEARCH_CACHE_TTL:
                return cached["data"]

    # 1. Direct Innertube search
    try:
        results = _search_innertube(query, max_results=max_results)
        if results:
            result = {"type": "search", "query": query, "results": results}
            with _cache_lock:
                _search_cache[cache_key] = {"data": result, "_cached_at": time.time()}
            # Pre-warm top 5 search results in background thread for instant playback
            for r in results[:5]:
                vid = r.get("id")
                if vid:
                    _executor.submit(get_stream_url, vid)
            return result
    except Exception as e:
        print(f"[Extractor] Innertube search fallback: {e}")

    # 2. Fallback to lightweight yt-dlp flat search
    try:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
            "skip_download": True,
            "ignoreerrors": True,
            "socket_timeout": 10,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch{max_results}:{query}", download=False)

        results = []
        if info and "entries" in info:
            for entry in info["entries"]:
                if entry:
                    results.append(_extract_track_info(entry))

        result = {"type": "search", "query": query, "results": results}
        with _cache_lock:
            _search_cache[cache_key] = {"data": result, "_cached_at": time.time()}
        return result
    except Exception as e:
        print(f"[Extractor] yt-dlp search error: {e}")
        return {"type": "search", "query": query, "results": [], "error": str(e)}


def get_track_info_by_url(url: str) -> dict | None:
    """Extract metadata for a single track from its URL."""
    video_id = _extract_video_id_from_url(url)
    if video_id:
        return get_track_info(video_id)

    opts = _base_opts()
    opts["format"] = "bestaudio/best"
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if info:
            return _extract_track_info(info)
    except Exception as e:
        print(f"[Extractor] Track info error for {url}: {e}")
    return None


def get_track_info(video_id: str) -> dict | None:
    """Extract metadata for a single track by video ID."""
    now = time.time()
    with _cache_lock:
        if video_id in _url_cache:
            cached = _url_cache[video_id]
            if (now - cached["_cached_at"]) < _URL_CACHE_TTL:
                return {
                    "id": video_id,
                    "title": cached.get("title", "Unknown Title"),
                    "artist": cached.get("artist", "Unknown Artist"),
                    "album": cached.get("album", ""),
                    "duration": cached.get("duration", 0),
                    "duration_str": _format_duration(cached.get("duration", 0)),
                    "duration_fmt": _format_duration(cached.get("duration", 0)),
                    "thumbnail": cached.get("thumbnail", f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"),
                    "url": f"https://music.youtube.com/watch?v={video_id}",
                    "webpage_url": f"https://www.youtube.com/watch?v={video_id}",
                    "is_online": True,
                }

    opts = _base_opts()
    opts["format"] = "ba[ext=m4a]/ba[ext=webm]/bestaudio/ba"
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(
                f"https://music.youtube.com/watch?v={video_id}",
                download=False,
            )
        if info:
            return _extract_track_info(info)
    except Exception as e:
        print(f"[Extractor] Track info error for {video_id}: {e}")
    return None


def invalidate_stream_url(video_id: str):
    """Invalidate cached stream URL so fresh ones are requested on error."""
    with _cache_lock:
        _url_cache.pop(video_id, None)


def get_stream_url(video_id: str, force_refresh: bool = False) -> dict | None:
    """
    Get direct audio stream URL optimized for instant playback.
    Prefers format 140 (M4A) or 251 (Opus) to avoid YouTube speed throttling.
    Caches results for _URL_CACHE_TTL.
    """
    now = time.time()

    if not force_refresh:
        with _cache_lock:
            if video_id in _url_cache:
                cached = _url_cache[video_id]
                if (now - cached["_cached_at"]) < _URL_CACHE_TTL:
                    return cached

    opts = _base_opts()
    # ba[ext=m4a]/ba[ext=webm]/bestaudio[abr<=160] avoids throttled 263k formats
    opts["format"] = "ba[ext=m4a]/ba[ext=webm]/bestaudio[abr<=160]/bestaudio"

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(
                f"https://music.youtube.com/watch?v={video_id}",
                download=False,
            )

        if not info:
            return None

        stream_url = info.get("url")
        ext = info.get("ext", "webm")
        filesize = info.get("filesize") or info.get("filesize_approx")
        abr = info.get("abr")

        if not stream_url and info.get("formats"):
            audio_formats = [
                f for f in info["formats"]
                if f.get("acodec") != "none" and (f.get("vcodec") == "none" or f.get("vcodec") is None)
            ]
            if not audio_formats:
                audio_formats = [f for f in info["formats"] if f.get("acodec") != "none"]

            if audio_formats:
                # Prefer M4A or WebM with reasonable bitrate ~128-160k for instant streaming
                audio_formats.sort(key=lambda f: (f.get("abr") or 0), reverse=True)
                # Find best matching under 170k if available
                stream_candidate = next((f for f in audio_formats if (f.get("abr") or 0) <= 170), audio_formats[0])
                stream_url = stream_candidate.get("url")
                ext = stream_candidate.get("ext", "webm")
                filesize = stream_candidate.get("filesize") or stream_candidate.get("filesize_approx")
                abr = stream_candidate.get("abr")

        if not stream_url:
            return None

        thumb = info.get("thumbnail", "")
        if not thumb and info.get("thumbnails"):
            thumb = info["thumbnails"][-1].get("url", "")
        if not thumb:
            thumb = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

        result = {
            "id": video_id,
            "url": stream_url,
            "ext": ext,
            "filesize": filesize,
            "abr": abr,
            "duration": info.get("duration"),
            "title": info.get("title", ""),
            "artist": info.get("artist") or info.get("uploader") or "",
            "album": info.get("album", ""),
            "thumbnail": thumb,
            "_cached_at": now,
        }

        with _cache_lock:
            _url_cache[video_id] = result
        return result

    except Exception as e:
        print(f"[Extractor] Stream URL error for {video_id}: {e}")
        return None



def get_playlist_info(url: str) -> dict:
    """Extract playlist metadata and track list."""
    opts = _base_opts()
    opts["extract_flat"] = "in_playlist"
    opts["ignoreerrors"] = True

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        if not info:
            return {"type": "playlist", "query": url, "results": []}

        playlist_title = info.get("title") or "Unknown Playlist"
        playlist_id = info.get("id", "")

        results = []
        if "entries" in info:
            for i, entry in enumerate(info["entries"]):
                if entry:
                    vid = entry.get("id", "")
                    track = {
                        "id": vid,
                        "title": entry.get("title") or "Unknown Title",
                        "artist": entry.get("uploader") or entry.get("channel") or "Unknown Artist",
                        "album": entry.get("album", ""),
                        "duration": entry.get("duration", 0),
                        "duration_str": _format_duration(entry.get("duration")),
                        "duration_fmt": _format_duration(entry.get("duration")),
                        "thumbnail": entry.get("thumbnail") or (f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else ""),
                        "url": entry.get("url", f"https://music.youtube.com/watch?v={vid}"),
                        "webpage_url": entry.get("webpage_url", ""),
                        "playlist_index": i + 1,
                        "is_online": True,
                    }
                    results.append(track)

        return {
            "type": "playlist",
            "query": url,
            "results": results,
            "playlist_title": playlist_title,
            "playlist_id": playlist_id,
            "total_tracks": len(results),
        }

    except Exception as e:
        print(f"[Extractor] Playlist error: {e}")
        return {
            "type": "playlist",
            "query": url,
            "results": [],
            "error": str(e),
        }


def submit(fn, *args, **kwargs):
    """Submit a task to the background thread pool."""
    return _executor.submit(fn, *args, **kwargs)

