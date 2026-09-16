"""
Safe folder manager for AquaMusic.
Validates, protects, and manages download directories and file paths.
Prevents directory traversal and accidental writes to system root folders.
"""

import os
import re
from pathlib import Path

# System directories that must never be set as download destinations
FORBIDDEN_ROOTS = [
    "/", "/bin", "/sbin", "/boot", "/dev", "/etc", "/lib", "/lib64",
    "/opt", "/proc", "/root", "/run", "/sys", "/usr", "/var"
]

def get_default_safe_folder() -> str:
    """Return default safe download folder in user's Music directory."""
    music_dir = Path.home() / "Music" / "AquaMusic"
    try:
        music_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return str(music_dir)


def is_safe_path(target_path: str) -> tuple[bool, str]:
    """
    Validate that target_path is safe to use for storing downloaded audio.
    Returns (is_safe: bool, reason: str).
    """
    if not target_path or not isinstance(target_path, str):
        return False, "Invalid path provided."

    expanded = os.path.expanduser(target_path.strip())
    resolved = os.path.abspath(expanded)

    # Check against forbidden system roots
    for forbidden in FORBIDDEN_ROOTS:
        if resolved == forbidden or (resolved.startswith(forbidden + "/") and not resolved.startswith(str(Path.home()))):
            return False, f"Folder path '{resolved}' is inside protected system space."

    # Must be an absolute path
    if not os.path.isabs(resolved):
        return False, "Path must be an absolute path."

    # Try creating directory if it doesn't exist
    try:
        os.makedirs(resolved, exist_ok=True)
    except OSError as e:
        return False, f"Cannot create directory '{resolved}': {e}"

    # Verify write permission
    if not os.access(resolved, os.W_OK):
        return False, f"Directory '{resolved}' is not writable."

    return True, resolved


def sanitize_filename(name: str, max_len: int = 150) -> str:
    """
    Sanitizes string into a clean, safe filename.
    Removes invalid filesystem characters, path traversal sequences, and trailing dots/spaces.
    """
    if not name:
        return "track"

    # Remove path traversal characters and forbidden symbols
    clean = re.sub(r'[\\/*?:"<>|]', "", name)
    # Remove control characters
    clean = re.sub(r'[\x00-\x1f\x7f-\x9f]', "", clean)
    # Collapse multiple whitespaces
    clean = re.sub(r"\s+", " ", clean).strip(". ")
    if not clean:
        clean = "track"

    return clean[:max_len]

