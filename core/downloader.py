"""
AquaMusic Download Manager.
Downloads audio as high-quality MP3 with embedded metadata and artwork into safe folders.
Auto-fetches synchronized LRC lyrics and integrates with AquaMusic's library.
"""

import os
import re
import glob
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import yt_dlp
import hashlib
from core.cookies import get_cookie_file
from core import extractor
from core.safe_folder import sanitize_filename, is_safe_path, get_default_safe_folder

# ── Thread-safe registries ──────────────────────────────────────────────────
_registry_lock = threading.Lock()
_track_locks: dict[str, threading.Lock] = {}
_download_status: dict[str, dict] = {}
_playlist_status: dict[str, dict] = {}

# Thread pool for parallel playlist tracks (up to 4 concurrent tracks)
_playlist_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="aquamusic-pldl")


def get_playlist_status(playlist_id_or_url: str) -> dict:
    """Get active or last known playlist download status."""
    with _registry_lock:
        if playlist_id_or_url in _playlist_status:
            return _playlist_status[playlist_id_or_url]
        for _, pl in _playlist_status.items():
            if pl.get("url") == playlist_id_or_url or pl.get("id") == playlist_id_or_url:
                return pl
        return {"status": "idle", "completed": 0, "total": 0, "percent": 0}


def _get_track_lock(video_id: str) -> threading.Lock:
    with _registry_lock:
        if video_id not in _track_locks:
            _track_locks[video_id] = threading.Lock()
        return _track_locks[video_id]


def find_downloaded_file(video_id: str, search_dir: str) -> str | None:
    """
    Find existing downloaded MP3 for a video_id.
    Checks the safe directory and subdirectories.
    """
    if not os.path.exists(search_dir):
        return None

    for root, _, files in os.walk(search_dir):
        for f in files:
            if f.endswith(".mp3") and video_id in f:
                full_path = os.path.join(root, f)
                try:
                    if os.path.getsize(full_path) > 1024:
                        return full_path
                except OSError:
                    continue
    return None


def get_download_status(video_id: str) -> dict:
    """Get active or last known download status for a track."""
    with _registry_lock:
        return _download_status.get(video_id, {"status": "idle", "percent": 0})


def _update_status(video_id: str, **kwargs):
    with _registry_lock:
        if video_id not in _download_status:
            _download_status[video_id] = {"video_id": video_id, "percent": 0, "status": "idle"}
        _download_status[video_id].update(kwargs)


def _make_progress_hook(callback, video_id: str):
    """yt-dlp progress hook emitting clean percent, speed, and ETA."""
    def hook(d):
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            speed = d.get("speed") or 0
            eta = d.get("eta") or 0
            pct = round((downloaded / total * 100), 1) if total else 0

            # Fragment fallback (e.g. DASH streams or concurrent fragment downloads)
            fragment_index = d.get("fragment_index")
            fragment_count = d.get("fragment_count")
            if pct <= 0 and fragment_index is not None and fragment_count:
                pct = round((fragment_index / fragment_count) * 100, 1)

            if pct <= 0 and d.get("_percent_str"):
                try:
                    clean_p = re.sub(r'[^\d.]', '', str(d.get("_percent_str", "")))
                    if clean_p:
                        pct = float(clean_p)
                except Exception:
                    pass

            # Cap downloading percentage to 98% until conversion finishes
            if pct > 98:
                pct = 98.0

            _update_status(
                video_id,
                status="downloading",
                percent=pct,
                downloaded=downloaded,
                total=total,
                speed=speed,
                eta=eta,
            )

            if callback:
                try:
                    callback({
                        "event": "progress",
                        "video_id": video_id,
                        "percent": pct,
                        "downloaded": downloaded,
                        "total": total,
                        "speed": speed,
                        "eta": eta,
                    })
                except Exception:
                    pass

        elif status == "finished":
            _update_status(video_id, status="converting", percent=99)
            if callback:
                try:
                    callback({
                        "event": "converting",
                        "video_id": video_id,
                        "percent": 99,
                        "message": "Converting audio to high-quality MP3 with artwork...",
                    })
                except Exception:
                    pass

        elif status == "error":
            err_msg = str(d.get("error", "Download error"))
            _update_status(video_id, status="failed", error=err_msg)
            if callback:
                callback({
                    "event": "error",
                    "video_id": video_id,
                    "message": err_msg,
                })
    return hook


def _make_postprocessor_hook(callback, video_id: str):
    """yt-dlp postprocessor hook to track conversion/tagging progress."""
    def pp_hook(d):
        status = d.get("status")
        pp_name = d.get("postprocessor", "FFmpegExtractAudio")
        if status == "started":
            msg = "Converting audio to MP3..." if "FFmpeg" in str(pp_name) else "Embedding tags & artwork..."
            _update_status(video_id, status="converting", percent=99, message=msg)
            if callback:
                try:
                    callback({
                        "event": "converting",
                        "video_id": video_id,
                        "percent": 99,
                        "message": msg,
                    })
                except Exception:
                    pass
    return pp_hook


def fetch_and_save_lrc(artist: str, title: str, dest_mp3_path: str):
    """
    Attempt to fetch synchronized LRC lyrics from LRCLIB and save as .lrc next to dest_mp3_path.
    """
    try:
        clean_title = re.sub(r'\(Official.*?\)|\[Official.*?\]|\(Music Video\)|\(Audio\)|\[Audio\]|ft\..*|feat\..*', '', title, flags=re.IGNORECASE).strip()
        clean_artist = re.sub(r'VEVO|Official', '', artist, flags=re.IGNORECASE).strip()
        query = f"{clean_artist} {clean_title}".strip()
        if not query:
            return

        import requests
        resp = requests.get(
            f"https://lrclib.net/api/search?q={requests.utils.quote(query)}",
            timeout=5
        )
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and data:
                match = next((x for x in data if x.get("syncedLyrics")), data[0])
                lyrics_content = match.get("syncedLyrics") or match.get("plainLyrics")
                if lyrics_content:
                    lrc_path = os.path.splitext(dest_mp3_path)[0] + ".lrc"
                    with open(lrc_path, "w", encoding="utf-8") as f:
                        f.write(lyrics_content)
    except Exception as e:
        print(f"[Downloader] Failed to fetch LRC for {dest_mp3_path}: {e}")


def download_track(
    video_id: str,
    download_dir: str = None,
    progress_callback=None,
    custom_title=None,
    custom_artist=None,
    on_complete_callback=None,
) -> dict:
    """
    Download a single track as MP3 with embedded metadata and artwork into a safe folder.
    Prevents duplicate overlapping downloads of the same video_id.
    Standardizes filename without track numbers: 'Artist - Title [id].mp3'.
    """
    if not download_dir:
        download_dir = get_default_safe_folder()

    safe_ok, safe_res = is_safe_path(download_dir)
    if not safe_ok:
        download_dir = get_default_safe_folder()

    os.makedirs(download_dir, exist_ok=True)

    # 1. Check if already downloaded on disk
    existing = find_downloaded_file(video_id, download_dir)
    if existing:
        fname = os.path.basename(existing)
        _update_status(video_id, status="completed", percent=100, filepath=existing, filename=fname)
        if progress_callback:
            progress_callback({
                "event": "complete",
                "video_id": video_id,
                "filename": fname,
                "filepath": existing,
            })
        if on_complete_callback:
            on_complete_callback(existing, video_id)
        return {
            "success": True,
            "filepath": existing,
            "filename": fname,
            "video_id": video_id,
        }

    # 2. Acquire per-track lock to prevent colliding yt-dlp instances
    lock = _get_track_lock(video_id)
    with lock:
        existing = find_downloaded_file(video_id, download_dir)
        if existing:
            fname = os.path.basename(existing)
            _update_status(video_id, status="completed", percent=100, filepath=existing, filename=fname)
            if progress_callback:
                progress_callback({
                    "event": "complete",
                    "video_id": video_id,
                    "filename": fname,
                    "filepath": existing,
                })
            if on_complete_callback:
                on_complete_callback(existing, video_id)
            return {
                "success": True,
                "filepath": existing,
                "filename": fname,
                "video_id": video_id,
            }

        _update_status(video_id, status="starting", percent=0)
        url = f"https://music.youtube.com/watch?v={video_id}"

        # Clean out any 0-byte corrupt part files
        for part_file in glob.glob(os.path.join(download_dir, f"*{video_id}*.part")):
            try:
                if os.path.getsize(part_file) == 0:
                    os.unlink(part_file)
            except OSError:
                pass

        output_template = os.path.join(
            download_dir,
            "%(title)s [%(id)s].%(ext)s",
        )

        cookie_file = get_cookie_file()
        opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "ba[ext=m4a]/ba[ext=webm]/bestaudio/ba",
            "extract_audio": True,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "0",  # LAME -V0 ~245 kbps VBR
                },
                {
                    "key": "FFmpegMetadata",
                    "add_metadata": True,
                },
                {
                    "key": "EmbedThumbnail",
                },
            ],
            "writethumbnail": True,
            "outtmpl": output_template,
            "overwrites": True,
            "ignoreerrors": False,
            "http_chunk_size": 10485760,           # 10MB chunk size for speed
            "concurrent_fragment_downloads": 4,   # 4 parallel fragments per track
            "buffer_size": 16384,
            "retries": 5,
            "fragment_retries": 5,
            "extractor_args": {
                "youtube": {
                    "player_client": ["web_embedded", "web", "tv"],
                }
            },
            "postprocessor_args": {
                "thumbnailsconverter": ["-vf", "crop=ih:ih"],
            },
        }
        if cookie_file:
            opts["cookiefile"] = cookie_file

        # Always register progress hook so global download status is updated in real-time
        opts["progress_hooks"] = [_make_progress_hook(progress_callback, video_id)]
        opts["postprocessor_hooks"] = [_make_postprocessor_hook(progress_callback, video_id)]

        try:
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=True)
            except Exception as first_err:
                if cookie_file:
                    # Retry without cookies if cookies caused an issue
                    try:
                        retry_opts = dict(opts)
                        retry_opts.pop("cookiefile", None)
                        with yt_dlp.YoutubeDL(retry_opts) as ydl:
                            info = ydl.extract_info(url, download=True)
                    except Exception:
                        raise first_err
                else:
                    raise first_err

            if not info:
                _update_status(video_id, status="failed", error="Could not extract track info")
                return {"success": False, "error": "Failed to extract info"}

            title = custom_title or info.get("title") or "Unknown Title"
            artist = custom_artist or info.get("artist") or info.get("uploader") or ""

            # Locate the generated MP3
            filepath = find_downloaded_file(video_id, download_dir)
            if not filepath:
                for f in os.listdir(download_dir):
                    if f.endswith(".mp3") and (video_id in f or title[:15] in f):
                        filepath = os.path.join(download_dir, f)
                        break

            if not filepath or not os.path.exists(filepath):
                _update_status(video_id, status="failed", error="File not created")
                return {"success": False, "error": "Audio file not created"}

            # Rename cleanly to 'Artist - Title [id].mp3' without track numbers
            current_filename = os.path.basename(filepath)
            clean_title = sanitize_filename(title)
            clean_artist = sanitize_filename(artist)

            if clean_artist and clean_artist not in ["Unknown Artist", "NA", "Unknown"]:
                nice_filename = f"{clean_artist} - {clean_title} [{video_id}].mp3"
            else:
                nice_filename = f"{clean_title} [{video_id}].mp3"

            nice_path = os.path.join(download_dir, nice_filename)
            if filepath != nice_path and not os.path.exists(nice_path):
                try:
                    os.rename(filepath, nice_path)
                    filepath = nice_path
                    current_filename = nice_filename
                except OSError:
                    pass

            # Fetch companion synced LRC lyrics in background
            threading.Thread(target=fetch_and_save_lrc, args=(clean_artist, clean_title, filepath), daemon=True).start()

            _update_status(
                video_id,
                status="completed",
                percent=100,
                filepath=filepath,
                filename=current_filename,
            )

            if progress_callback:
                progress_callback({
                    "event": "complete",
                    "video_id": video_id,
                    "filename": current_filename,
                    "filepath": filepath,
                    "title": title,
                    "artist": artist,
                })

            if on_complete_callback:
                on_complete_callback(filepath, video_id)

            return {
                "success": True,
                "filepath": filepath,
                "filename": current_filename,
                "title": title,
                "artist": artist,
                "video_id": video_id,
            }

        except Exception as e:
            err = str(e)
            print(f"[Downloader] Error downloading {video_id}: {err}")
            _update_status(video_id, status="failed", error=err)
            if progress_callback:
                progress_callback({
                    "event": "error",
                    "video_id": video_id,
                    "message": err,
                })
            return {"success": False, "error": err, "video_id": video_id}


def download_playlist(
    playlist_url: str,
    download_dir: str = None,
    progress_callback=None,
    on_track_complete=None,
) -> dict:
    """
    Download all tracks in a playlist in parallel (up to 4 tracks simultaneously).
    Standardizes filenames without track numbers.
    """
    if not download_dir:
        download_dir = get_default_safe_folder()

    pl_info = extractor.get_playlist_info(playlist_url)
    tracks = pl_info.get("results", [])
    total = len(tracks)

    if total == 0:
        return {"success": False, "error": "No tracks found in playlist", "total": 0}

    pl_title = pl_info.get("playlist_title", "Playlist")
    clean_folder_name = sanitize_filename(pl_title)
    target_dir = os.path.join(download_dir, clean_folder_name)
    os.makedirs(target_dir, exist_ok=True)

    pl_id = hashlib.md5(playlist_url.encode("utf-8")).hexdigest()[:12]
    track_ids = [t.get("id") for t in tracks if t.get("id")]

    with _registry_lock:
        _playlist_status[pl_id] = {
            "id": pl_id,
            "url": playlist_url,
            "title": pl_title,
            "total": total,
            "completed": 0,
            "failed": 0,
            "percent": 0.0,
            "status": "downloading",
            "last_track": "",
            "target_dir": target_dir,
            "tracks": track_ids,
        }
        _playlist_status[playlist_url] = _playlist_status[pl_id]

    completed = 0
    failed = 0
    lock = threading.Lock()

    def download_single(track):
        nonlocal completed, failed
        vid = track.get("id")
        title = track.get("title", "")
        if not vid:
            with lock:
                failed += 1
            return None

        with _registry_lock:
            if pl_id in _playlist_status:
                _playlist_status[pl_id]["last_track"] = title

        res = download_track(
            video_id=vid,
            download_dir=target_dir,
            custom_title=title,
            custom_artist=track.get("artist"),
            on_complete_callback=on_track_complete,
        )

        with lock:
            if res.get("success"):
                completed += 1
            else:
                failed += 1

            pct = round(((completed + failed) / total * 100), 1) if total else 0.0
            with _registry_lock:
                if pl_id in _playlist_status:
                    _playlist_status[pl_id]["completed"] = completed
                    _playlist_status[pl_id]["failed"] = failed
                    _playlist_status[pl_id]["percent"] = pct
                    _playlist_status[pl_id]["last_track"] = title

            if progress_callback:
                progress_callback({
                    "event": "playlist_progress",
                    "completed": completed,
                    "failed": failed,
                    "total": total,
                    "percent": pct,
                    "last_track": title,
                })

        return res

    futures = [
        _playlist_executor.submit(download_single, track)
        for track in tracks
    ]

    for future in as_completed(futures):
        try:
            future.result()
        except Exception as e:
            print(f"[Downloader] Playlist track exception: {e}")

    final_result = {
        "id": pl_id,
        "success": completed > 0,
        "completed": completed,
        "failed": failed,
        "total": total,
        "percent": 100.0 if completed + failed >= total else round(((completed + failed) / total * 100), 1),
        "target_dir": target_dir,
        "status": "completed",
    }

    with _registry_lock:
        if pl_id in _playlist_status:
            _playlist_status[pl_id].update(final_result)

    if progress_callback:
        progress_callback({
            "event": "playlist_download_complete",
            **final_result,
        })

    return final_result

