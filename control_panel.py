#!/usr/bin/env python3
"""
AquaMusic Control Panel (XAMPP-Style Desktop Manager).
Provides Start/Stop server controls, live access links, real-time activity log,
and 1-click browser/safe folder access without heavy web engines.
"""

import os
import sys
import time
import socket
import threading
import subprocess
import webbrowser
from datetime import datetime

# Ensure the app root is in sys.path
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

REQUIRED_PACKAGES = {
    "flask": "Flask",
    "mutagen": "mutagen",
    "PIL": "Pillow",
    "yt_dlp": "yt-dlp",
    "requests": "requests",
}


def get_lan_ip():
    """Retrieve the primary local LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        # Doesn't need to be reachable, just triggers route lookup
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def check_dependencies():
    """Check which required packages are installed vs missing."""
    missing = []
    for mod_name, pkg_name in REQUIRED_PACKAGES.items():
        try:
            __import__(mod_name)
        except ImportError:
            missing.append(pkg_name)
    return missing


# ── CLI Fallback Mode (Headless / Terminal) ──────────────────────────────────
def run_cli_mode(port=5000):
    print("=" * 64)
    print("       🎵 AquaMusic Server v1.0.1 (CLI Mode)")
    print("=" * 64)

    missing = check_dependencies()
    if missing:
        print(f"[!] Warning: Missing dependencies: {', '.join(missing)}")
        print(f"    Run: pip install {' '.join(missing)}\n")

    import app as aquamusic
    server = aquamusic.serve_local(port, host="0.0.0.0")
    actual_port = server.server_port
    lan_ip = get_lan_ip()

    print(f"  ● Status:         RUNNING (PID: {os.getpid()})")
    print(f"  ➜ Local URL:      http://127.0.0.1:{actual_port}")
    if lan_ip != "127.0.0.1":
        print(f"  ➜ Network (LAN):  http://{lan_ip}:{actual_port}")
    print("=" * 64)
    print("  Server is active. Press Ctrl+C to stop.\n")

    try:
        webbrowser.open(f"http://127.0.0.1:{actual_port}")
    except Exception:
        pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[AquaMusic] Shutting down server...")
        server.shutdown()
        server.server_close()
        print("[AquaMusic] Server stopped cleanly.")


# ── Tkinter Modern GUI Control Panel (XAMPP-Style) ──────────────────────────
def run_gui_mode():
    try:
        import tkinter as tk
        from tkinter import ttk, messagebox
    except ImportError:
        print("[!] Tkinter is not available. Falling back to CLI mode...")
        run_cli_mode()
        return

    class AquaMusicControlPanel(tk.Tk):
        def __init__(self):
            # className="aquamusic" ensures GNOME Shell matches the window with aquamusic.desktop
            super().__init__(className="aquamusic")

            self.title("AquaMusic Control Panel v1.0.1")
            self.geometry("740x560")
            self.minsize(680, 500)

            # Colors & Theme (Modern Sleek Dark)
            self.c_bg = "#12141a"
            self.c_panel = "#1a1d26"
            self.c_card = "#222634"
            self.c_accent = "#38bdf8"      # Aqua Blue
            self.c_accent_hover = "#0ea5e9"
            self.c_success = "#10b981"     # Emerald Green
            self.c_danger = "#ef4444"      # Rose Red
            self.c_warning = "#f59e0b"     # Amber
            self.c_text = "#f3f4f6"
            self.c_muted = "#9ca3af"
            self.c_border = "#2d3345"

            self.configure(bg=self.c_bg)

            # State
            self.server = None
            self.server_thread = None
            self.is_running = False
            self.server_port = 5000
            self.lan_ip = get_lan_ip()

            # Set window icon (PNG for Linux/GNOME via iconphoto, ICO for Windows via iconbitmap)
            self._icon_img = None
            png_candidates = [
                os.path.join(APP_DIR, "aquamusic.png"),
                os.path.join(APP_DIR, "packaging", "aquamusic.png"),
                "/usr/share/icons/hicolor/256x256/apps/aquamusic.png",
                "/usr/share/pixmaps/aquamusic.png",
            ]
            for p in png_candidates:
                if os.path.exists(p):
                    try:
                        self._icon_img = tk.PhotoImage(file=p)
                        self.iconphoto(True, self._icon_img)
                        break
                    except Exception:
                        pass

            ico_path = os.path.join(APP_DIR, "packaging", "aquamusic.ico")
            if not os.path.exists(ico_path):
                ico_path = os.path.join(APP_DIR, "aquamusic.ico")
            if os.path.exists(ico_path):
                try:
                    self.iconbitmap(ico_path)
                except Exception:
                    pass

            self._create_widgets()
            self.protocol("WM_DELETE_WINDOW", self.on_quit)

            # Initial log message & dependency check
            self.log("AquaMusic Control Panel initialized.")
            self.log(f"Ready. Set your desired port (default: {self.server_port}) and click '▶ Start'.")
            self.check_reqs_async()

        def _create_widgets(self):
            # Top Banner
            header = tk.Frame(self, bg=self.c_panel, height=60, padx=16, pady=12, highlightthickness=1, highlightbackground=self.c_border)
            header.pack(fill=tk.X, side=tk.TOP)

            title_frame = tk.Frame(header, bg=self.c_panel)
            title_frame.pack(side=tk.LEFT)

            lbl_logo = tk.Label(title_frame, text="🎵", font=("Segoe UI", 18), bg=self.c_panel, fg=self.c_accent)
            lbl_logo.pack(side=tk.LEFT, padx=(0, 8))

            lbl_title = tk.Label(title_frame, text="AquaMusic Control Panel", font=("Segoe UI", 14, "bold"), bg=self.c_panel, fg=self.c_text)
            lbl_title.pack(side=tk.LEFT)

            lbl_ver = tk.Label(title_frame, text="v1.0.1", font=("Segoe UI", 10), bg=self.c_panel, fg=self.c_muted)
            lbl_ver.pack(side=tk.LEFT, padx=(6, 0))

            # Status pill in top right
            self.pill_frame = tk.Frame(header, bg="#2d1b22", padx=10, pady=4, highlightthickness=1, highlightbackground=self.c_danger)
            self.pill_frame.pack(side=tk.RIGHT)

            self.lbl_status_pill = tk.Label(self.pill_frame, text="● STOPPED", font=("Segoe UI", 9, "bold"), bg="#2d1b22", fg=self.c_danger)
            self.lbl_status_pill.pack()

            # Main Body Container
            body = tk.Frame(self, bg=self.c_bg, padx=16, pady=12)
            body.pack(fill=tk.BOTH, expand=True)

            # Left/Top: Services Table (XAMPP Style)
            module_frame = tk.LabelFrame(body, text=" Services & Modules ", font=("Segoe UI", 10, "bold"),
                                         bg=self.c_panel, fg=self.c_text, padx=12, pady=10,
                                         highlightthickness=1, highlightbackground=self.c_border)
            module_frame.pack(fill=tk.X, pady=(0, 10))

            # Column headers
            headers = [("Module", 14), ("PID", 8), ("Port", 8), ("Action", 12), ("Browser", 12)]
            hdr_box = tk.Frame(module_frame, bg=self.c_card, pady=4, padx=6)
            hdr_box.pack(fill=tk.X, pady=(0, 6))

            tk.Label(hdr_box, text="Module", width=18, anchor="w", font=("Segoe UI", 9, "bold"), bg=self.c_card, fg=self.c_muted).pack(side=tk.LEFT)
            tk.Label(hdr_box, text="PID", width=10, anchor="center", font=("Segoe UI", 9, "bold"), bg=self.c_card, fg=self.c_muted).pack(side=tk.LEFT)
            tk.Label(hdr_box, text="Port", width=10, anchor="center", font=("Segoe UI", 9, "bold"), bg=self.c_card, fg=self.c_muted).pack(side=tk.LEFT)
            tk.Label(hdr_box, text="Actions", width=24, anchor="center", font=("Segoe UI", 9, "bold"), bg=self.c_card, fg=self.c_muted).pack(side=tk.LEFT)

            # Service Row: AquaMusic Web Server
            row = tk.Frame(module_frame, bg=self.c_panel, pady=6, padx=6)
            row.pack(fill=tk.X)

            self.lbl_mod_name = tk.Label(row, text="AquaMusic Server", width=18, anchor="w", font=("Segoe UI", 10, "bold"), bg=self.c_panel, fg=self.c_text)
            self.lbl_mod_name.pack(side=tk.LEFT)

            self.lbl_pid = tk.Label(row, text="-", width=10, anchor="center", font=("Segoe UI", 9), bg=self.c_panel, fg=self.c_muted)
            self.lbl_pid.pack(side=tk.LEFT)

            # Editable Port Box
            port_box = tk.Frame(row, bg=self.c_panel, width=10)
            port_box.pack(side=tk.LEFT)

            self.port_var = tk.StringVar(value=str(self.server_port))
            self.port_var.trace_add("write", self.on_port_changed)

            self.entry_port = tk.Entry(port_box, textvariable=self.port_var, font=("Segoe UI", 9, "bold"), width=7, justify="center",
                                       bg=self.c_card, fg=self.c_accent, insertbackground=self.c_text,
                                       relief=tk.FLAT, highlightthickness=1, highlightbackground=self.c_border,
                                       highlightcolor=self.c_accent)
            self.entry_port.pack(padx=6)

            # Action Buttons
            btn_frame = tk.Frame(row, bg=self.c_panel)
            btn_frame.pack(side=tk.LEFT, padx=10)

            self.btn_toggle = tk.Button(btn_frame, text="▶ Start", font=("Segoe UI", 9, "bold"),
                                        bg=self.c_success, fg="#ffffff", activebackground="#059669", activeforeground="#ffffff",
                                        relief=tk.FLAT, padx=14, pady=3, cursor="hand2", command=self.toggle_server)
            self.btn_toggle.pack(side=tk.LEFT, padx=(0, 6))

            self.btn_open = tk.Button(btn_frame, text="🌐 Open Browser", font=("Segoe UI", 9),
                                      bg=self.c_card, fg=self.c_text, activebackground="#333a4d", activeforeground=self.c_text,
                                      relief=tk.FLAT, padx=10, pady=3, cursor="hand2", state=tk.DISABLED, command=self.open_browser)
            self.btn_open.pack(side=tk.LEFT)

            # Access URLs Panel
            url_frame = tk.LabelFrame(body, text=" Access Links ", font=("Segoe UI", 10, "bold"),
                                      bg=self.c_panel, fg=self.c_text, padx=12, pady=8,
                                      highlightthickness=1, highlightbackground=self.c_border)
            url_frame.pack(fill=tk.X, pady=(0, 10))

            # Local URL Row
            row_local = tk.Frame(url_frame, bg=self.c_panel, pady=3)
            row_local.pack(fill=tk.X)
            tk.Label(row_local, text="➜ Local Access:", width=16, anchor="w", font=("Segoe UI", 9, "bold"), bg=self.c_panel, fg=self.c_muted).pack(side=tk.LEFT)
            self.lbl_local_url = tk.Label(row_local, text=f"http://127.0.0.1:{self.server_port}", font=("Consolas", 10, "bold"), bg=self.c_panel, fg=self.c_accent, cursor="hand2")
            self.lbl_local_url.pack(side=tk.LEFT, padx=6)
            self.lbl_local_url.bind("<Button-1>", lambda e: self.open_browser())

            btn_copy_local = tk.Button(row_local, text="📋 Copy", font=("Segoe UI", 8), bg=self.c_card, fg=self.c_text, relief=tk.FLAT, padx=6, pady=1, cursor="hand2",
                                       command=lambda: self.copy_to_clipboard(f"http://127.0.0.1:{self.server_port}"))
            btn_copy_local.pack(side=tk.LEFT, padx=6)

            # Network URL Row
            row_lan = tk.Frame(url_frame, bg=self.c_panel, pady=3)
            row_lan.pack(fill=tk.X)
            tk.Label(row_lan, text="➜ Network (LAN):", width=16, anchor="w", font=("Segoe UI", 9, "bold"), bg=self.c_panel, fg=self.c_muted).pack(side=tk.LEFT)
            self.lbl_lan_url = tk.Label(row_lan, text=f"http://{self.lan_ip}:{self.server_port}", font=("Consolas", 10, "bold"), bg=self.c_panel, fg="#34d399", cursor="hand2")
            self.lbl_lan_url.pack(side=tk.LEFT, padx=6)
            self.lbl_lan_url.bind("<Button-1>", lambda e: self.open_browser(lan=True))

            btn_copy_lan = tk.Button(row_lan, text="📋 Copy", font=("Segoe UI", 8), bg=self.c_card, fg=self.c_text, relief=tk.FLAT, padx=6, pady=1, cursor="hand2",
                                     command=lambda: self.copy_to_clipboard(f"http://{self.lan_ip}:{self.server_port}"))
            btn_copy_lan.pack(side=tk.LEFT, padx=6)

            # Toolbar actions
            action_bar = tk.Frame(body, bg=self.c_bg)
            action_bar.pack(fill=tk.X, pady=(0, 8))

            btn_safe_folder = tk.Button(action_bar, text="📁 Open Music Folder", font=("Segoe UI", 9),
                                        bg=self.c_panel, fg=self.c_text, relief=tk.FLAT, padx=10, pady=4, cursor="hand2",
                                        command=self.open_music_folder)
            btn_safe_folder.pack(side=tk.LEFT, padx=(0, 6))

            self.btn_reqs = tk.Button(action_bar, text="📦 Install Requirements", font=("Segoe UI", 9),
                                      bg=self.c_panel, fg=self.c_text, relief=tk.FLAT, padx=10, pady=4, cursor="hand2",
                                      command=self.install_requirements)
            self.btn_reqs.pack(side=tk.LEFT, padx=(0, 6))

            btn_clear_log = tk.Button(action_bar, text="🧹 Clear Log", font=("Segoe UI", 9),
                                      bg=self.c_panel, fg=self.c_muted, relief=tk.FLAT, padx=8, pady=4, cursor="hand2",
                                      command=self.clear_log)
            btn_clear_log.pack(side=tk.LEFT)

            btn_quit = tk.Button(action_bar, text="✖ Quit", font=("Segoe UI", 9),
                                 bg="#3b1d22", fg=self.c_danger, relief=tk.FLAT, padx=12, pady=4, cursor="hand2",
                                 command=self.on_quit)
            btn_quit.pack(side=tk.RIGHT)

            # Real-Time Activity Log (Bottom Half - XAMPP style)
            log_frame = tk.LabelFrame(body, text=" Activity Log ", font=("Segoe UI", 9, "bold"),
                                      bg=self.c_panel, fg=self.c_text, padx=6, pady=6,
                                      highlightthickness=1, highlightbackground=self.c_border)
            log_frame.pack(fill=tk.BOTH, expand=True)

            self.log_text = tk.Text(log_frame, bg="#0d0f14", fg="#d1d5db", font=("Consolas", 9),
                                    wrap=tk.WORD, relief=tk.FLAT, padx=8, pady=6, insertbackground="#38bdf8")
            self.log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

            scrollbar = tk.Scrollbar(log_frame, command=self.log_text.yview, bg=self.c_panel)
            scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            self.log_text.config(yscrollcommand=scrollbar.set)

        def log(self, message):
            """Append a timestamped line to the activity log."""
            now_str = datetime.now().strftime("%H:%M:%S")
            line = f"[{now_str}] {message}\n"
            self.log_text.insert(tk.END, line)
            self.log_text.see(tk.END)

        def clear_log(self):
            self.log_text.delete("1.0", tk.END)
            self.log("Activity log cleared.")

        def copy_to_clipboard(self, text):
            self.clipboard_clear()
            self.clipboard_append(text)
            self.log(f"Copied to clipboard: {text}")

        def on_port_changed(self, *args):
            val = self.port_var.get().strip()
            if val.isdigit():
                port_num = int(val)
                if 1 <= port_num <= 65535:
                    self.server_port = port_num
                    self.lbl_local_url.config(text=f"http://127.0.0.1:{port_num}")
                    self.lbl_lan_url.config(text=f"http://{self.lan_ip}:{port_num}")

        def check_reqs_async(self):
            def _check():
                missing = check_dependencies()
                if missing:
                    self.log(f"[!] Missing dependencies detected: {', '.join(missing)}")
                    self.btn_reqs.config(bg="#78350f", fg=self.c_warning, text=f"⚠ Install ({len(missing)} missing)")
                else:
                    self.log("All requirements satisfied: Flask, mutagen, Pillow, yt-dlp, requests.")
            threading.Thread(target=_check, daemon=True).start()

        def install_requirements(self):
            self.log("Starting requirement installation via pip...")
            req_file = os.path.join(APP_DIR, "requirements.txt")

            def _run_pip():
                try:
                    cmd = [sys.executable, "-m", "pip", "install", "-r", req_file, "--break-system-packages"]
                    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                    for line in proc.stdout:
                        clean = line.strip()
                        if clean:
                            self.after(0, self.log, f"[pip] {clean}")
                    proc.wait()
                    if proc.returncode == 0:
                        self.after(0, self.log, "✓ Requirements installed successfully!")
                        self.after(0, self.btn_reqs.config, {"bg": self.c_panel, "fg": self.c_text, "text": "📦 Install Requirements"})
                        self.after(0, self.check_reqs_async)
                    else:
                        self.after(0, self.log, f"[!] pip finished with exit code {proc.returncode}")
                        self.after(0, self.log, "[💡 Tip] You can also install system packages with: sudo apt install python3-flask python3-mutagen python3-pil python3-requests yt-dlp")
                except Exception as ex:
                    self.after(0, self.log, f"[!] Failed to run pip: {ex}")

            threading.Thread(target=_run_pip, daemon=True).start()

        def toggle_server(self):
            if self.is_running:
                self.stop_server()
            else:
                self.start_server()

        def start_server(self):
            if self.is_running:
                return

            # Read and validate port from the input entry
            val = self.port_var.get().strip()
            if not val.isdigit() or not (1 <= int(val) <= 65535):
                self.log(f"[!] Invalid port '{val}'. Defaulting to 5000.")
                self.server_port = 5000
                self.port_var.set("5000")
            else:
                self.server_port = int(val)

            # Lock port entry while running
            self.entry_port.config(state="disabled")

            self.log(f"Starting AquaMusic server on port {self.server_port}...")
            try:
                import app as aquamusic
                self.server = aquamusic.serve_local(self.server_port, host="0.0.0.0")
                self.server_port = self.server.server_port

                self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
                self.server_thread.start()

                self.is_running = True
                pid = os.getpid()

                # Update UI
                self.lbl_pid.config(text=str(pid), fg=self.c_text)
                self.lbl_local_url.config(text=f"http://127.0.0.1:{self.server_port}")
                self.lbl_lan_url.config(text=f"http://{self.lan_ip}:{self.server_port}")

                self.btn_toggle.config(text="⏹ Stop", bg=self.c_danger, activebackground="#dc2626")
                self.btn_open.config(state=tk.NORMAL)

                self.pill_frame.config(bg="#064e3b", highlightbackground=self.c_success)
                self.lbl_status_pill.config(text="● RUNNING", bg="#064e3b", fg=self.c_success)

                self.log(f"Server started on port {self.server_port} (PID: {pid}).")
                self.log(f"Local Access:   http://127.0.0.1:{self.server_port}")
                if self.lan_ip != "127.0.0.1":
                    self.log(f"Network Access: http://{self.lan_ip}:{self.server_port}")

                # Open browser automatically after starting
                self.after(600, self.open_browser)

            except Exception as ex:
                self.is_running = False
                self.server = None
                self.entry_port.config(state="normal")
                self.log(f"[!] Error starting server: {ex}")
                if self.winfo_exists():
                    try:
                        messagebox.showerror("AquaMusic Server Error", f"Failed to start server on port {self.server_port}:\n\n{ex}", parent=self)
                    except Exception:
                        pass

        def stop_server(self):
            if not self.is_running or not self.server:
                return

            self.log("Stopping AquaMusic server...")
            try:
                self.server.shutdown()
                self.server.server_close()
            except Exception as ex:
                self.log(f"[!] Error during shutdown: {ex}")

            self.is_running = False
            self.server = None

            # Re-enable port editing when stopped
            self.entry_port.config(state="normal")

            # Update UI
            self.lbl_pid.config(text="-", fg=self.c_muted)
            self.btn_toggle.config(text="▶ Start", bg=self.c_success, activebackground="#059669")
            self.btn_open.config(state=tk.DISABLED)

            self.pill_frame.config(bg="#2d1b22", highlightbackground=self.c_danger)
            self.lbl_status_pill.config(text="● STOPPED", bg="#2d1b22", fg=self.c_danger)

            self.log("Server stopped.")

        def open_browser(self, lan=False):
            url = f"http://{self.lan_ip}:{self.server_port}" if lan else f"http://127.0.0.1:{self.server_port}"
            self.log(f"Opening browser: {url}")
            try:
                # Try app mode with Edge/Chrome if on Windows
                if sys.platform.startswith("win"):
                    edge = os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe")
                    if os.path.exists(edge):
                        subprocess.Popen([edge, f"--app={url}"])
                        return
                webbrowser.open(url)
            except Exception as ex:
                self.log(f"[!] Failed to open browser: {ex}")

        def open_music_folder(self):
            try:
                from core.safe_folder import get_default_safe_folder
                safe_folder = get_default_safe_folder()
                os.makedirs(safe_folder, exist_ok=True)
                self.log(f"Opening music folder: {safe_folder}")

                if sys.platform.startswith("win"):
                    os.startfile(safe_folder)
                elif sys.platform.startswith("darwin"):
                    subprocess.Popen(["open", safe_folder])
                else:
                    subprocess.Popen(["xdg-open", safe_folder])
            except Exception as ex:
                self.log(f"[!] Could not open folder: {ex}")

        def on_quit(self):
            if self.is_running:
                self.stop_server()
            self.destroy()

    app = AquaMusicControlPanel()
    app.mainloop()


def main():
    if "--cli" in sys.argv or "--headless" in sys.argv or "DISPLAY" not in os.environ and not sys.platform.startswith("win"):
        run_cli_mode()
    else:
        run_gui_mode()


if __name__ == "__main__":
    main()

