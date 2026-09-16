"""
AquaMusic Windows Desktop Launcher.
Hosts the local music server and launches the standalone app window.
100% offline, self-contained, and containerized within the package.
"""
import os
import sys
import time
import subprocess
import threading
import webbrowser
from urllib.request import urlopen

# Ensure script directory and parent directory are on sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(SCRIPT_DIR)

for p in [
    SCRIPT_DIR,
    PARENT_DIR,
    os.path.join(PARENT_DIR, "Lib", "site-packages"),
    os.path.join(PARENT_DIR, "python", "Lib", "site-packages"),
    os.path.join(SCRIPT_DIR, "Lib", "site-packages"),
]:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)

try:
    import app as aquamusic
except Exception as err:
    import traceback
    err_text = traceback.format_exc()
    log_path = os.path.join(PARENT_DIR, "aquamusic_error.log")
    try:
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(err_text)
    except Exception:
        pass
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, f"AquaMusic failed to initialize backend:\n\n{err_text}", "AquaMusic Startup Error", 0x10)
    except Exception:
        pass
    sys.exit(1)


def wait_for_server(url, timeout=4.0):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urlopen(url, timeout=0.5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.1)
    return False


def open_app_window(url):
    # Try Microsoft Edge in standalone chromeless application mode
    edge_paths = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
        "msedge.exe"
    ]

    for edge in edge_paths:
        if os.path.exists(edge) or edge == "msedge.exe":
            try:
                proc = subprocess.Popen([edge, f"--app={url}"])
                return proc
            except Exception:
                continue

    # Fallback to Chrome in app mode
    chrome_paths = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        "chrome.exe"
    ]

    for chrome in chrome_paths:
        if os.path.exists(chrome) or chrome == "chrome.exe":
            try:
                proc = subprocess.Popen([chrome, f"--app={url}"])
                return proc
            except Exception:
                continue

    # Fallback to system default browser
    webbrowser.open(url)
    return None


def main():
    # Start the local server
    server = aquamusic.serve_local(5000)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    url = f"http://127.0.0.1:{server.server_port}"
    wait_for_server(url)

    proc = open_app_window(url)

    # Keep server alive while window/browser runs
    if proc:
        proc.wait()
    else:
        # If launched default browser without process handle, keep server alive until interrupted
        try:
            while server_thread.is_alive():
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            pass

    server.shutdown()


if __name__ == "__main__":
    main()

