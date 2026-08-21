"""AquaMusic's native Linux desktop host.

The music server stays on 127.0.0.1 and is rendered inside Qt WebEngine.  The
only public listener is the explicit HTTPS sharing option in the UI.
"""
import argparse
import sys
import threading
from urllib.parse import unquote, urlparse

from PyQt6.QtCore import QUrl
from PyQt6.QtGui import QKeySequence, QShortcut
from PyQt6.QtWidgets import QApplication, QMainWindow
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebEngineCore import QWebEngineProfile, QWebEngineSettings

import app as aquamusic


class AquaMusicWindow(QMainWindow):
    def __init__(self, url, server):
        super().__init__()
        self.server = server
        self.setWindowTitle('AquaMusic')
        self.setMinimumSize(900, 620)
        self.resize(1440, 900)
        self.view = QWebEngineView(self)
        # Allow the page's requestFullscreen() calls (video, visualizers, and
        # future web controls) to behave like they do in Firefox/Chrome.
        self.view.settings().setAttribute(
            QWebEngineSettings.WebAttribute.FullScreenSupportEnabled, True
        )
        self.view.page().fullScreenRequested.connect(self._handle_fullscreen_request)
        self.view.setUrl(QUrl(url))
        self.setCentralWidget(self.view)

        self.fullscreen_shortcut = QShortcut(QKeySequence('F11'), self)
        self.fullscreen_shortcut.activated.connect(self.toggle_fullscreen)
        self.exit_fullscreen_shortcut = QShortcut(QKeySequence('Esc'), self)
        self.exit_fullscreen_shortcut.activated.connect(self.exit_fullscreen)

    def _handle_fullscreen_request(self, request):
        request.accept()
        if request.toggleOn():
            self.showFullScreen()
        else:
            self.showNormal()

    def toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()

    def exit_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()

    def closeEvent(self, event):
        self.server.shutdown()
        super().closeEvent(event)


def main():
    parser = argparse.ArgumentParser(description='AquaMusic desktop player')
    parser.add_argument('media', nargs='*', help='audio files supplied by Open With')
    args = parser.parse_args()

    media_paths = []
    for item in args.media:
        parsed = urlparse(item)
        media_paths.append(unquote(parsed.path) if parsed.scheme == 'file' else item)
    if media_paths:
        aquamusic.import_media_paths(media_paths)
    server = aquamusic.serve_local(0)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    qt_app = QApplication(sys.argv)
    qt_app.setApplicationName('AquaMusic')
    # Themes, playback history, playlists, and other browser-side preferences
    # are durable application data rather than temporary WebEngine cache.
    profile_dir = aquamusic.APP_DATA_DIR / 'web-profile'
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile = QWebEngineProfile.defaultProfile()
    profile.setPersistentStoragePath(str(profile_dir))
    profile.setCachePath(str(profile_dir / 'cache'))
    profile.setPersistentCookiesPolicy(
        QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies
    )
    window = AquaMusicWindow(f'http://127.0.0.1:{server.server_port}', server)
    window.show()
    return qt_app.exec()


if __name__ == '__main__':
    raise SystemExit(main())
