// AquaMusic Desktop Keyboard Shortcuts Manager (Module 17)
class KeyboardManager {
  constructor() {
    this.modal = null;
  }

  init() {
    this.modal = document.getElementById('modal-shortcuts');

    // Keydown event listener hook
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  handleKeyDown(event) {
    // 1. Safeguard: Ignore hotkeys if typing in input form elements
    const tag = event.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      // Escape can still be used to blur active inputs
      if (event.key === 'Escape') {
        event.target.blur();
        // Also close modals if open
        if (window.tagger) window.tagger.closeEditor();
        if (window.settings) window.settings.closeSettings();
        this.closeShortcuts();
      }
      return;
    }

    const key = event.key;

    switch (key) {
      // Space: Play / Pause toggle
      case ' ':
        event.preventDefault();
        if (window.player) window.player.togglePlay();
        break;

      // Left Arrow: Seek backwards
      case 'ArrowLeft':
        event.preventDefault();
        if (window.player) {
          const seekVal = event.shiftKey ? -30 : -5;
          window.player.seekRelative(seekVal);
          window.toast.show(`Seek ${seekVal > 0 ? '+' : ''}${seekVal}s`, 'info', 1000);
        }
        break;

      // Right Arrow: Seek forwards
      case 'ArrowRight':
        event.preventDefault();
        if (window.player) {
          const seekVal = event.shiftKey ? 30 : 5;
          window.player.seekRelative(seekVal);
          window.toast.show(`Seek ${seekVal > 0 ? '+' : ''}${seekVal}s`, 'info', 1000);
        }
        break;

      // Up Arrow: Raise Volume
      case 'ArrowUp':
        event.preventDefault();
        if (window.player) {
          const targetVol = Math.min(1.0, window.player.volume + 0.05);
          window.player.setVolume(targetVol);
          window.toast.show(`Volume: ${Math.round(targetVol * 100)}%`, 'info', 1000);
        }
        break;

      // Down Arrow: Lower Volume
      case 'ArrowDown':
        event.preventDefault();
        if (window.player) {
          const targetVol = Math.max(0.0, window.player.volume - 0.05);
          window.player.setVolume(targetVol);
          window.toast.show(`Volume: ${Math.round(targetVol * 100)}%`, 'info', 1000);
        }
        break;

      // N: Next track skip
      case 'n':
      case 'N':
        if (window.player) window.player.next();
        break;

      // P: Previous track return
      case 'p':
      case 'P':
        if (window.player) window.player.prev();
        break;

      // S: Toggle shuffle state
      case 's':
      case 'S':
        if (window.playlists) window.playlists.toggleShuffle();
        break;

      // R: Cycle repeat states
      case 'r':
      case 'R':
        if (window.playlists) window.playlists.cycleRepeat();
        break;

      // M: Mute toggle
      case 'm':
      case 'M':
        if (window.player) window.player.toggleMute();
        break;

      // L: Toggle lyrics overlay
      case 'l':
      case 'L':
        if (window.lyrics) window.lyrics.togglePanel();
        break;

      // E: Toggle EQ drawer
      case 'e':
      case 'E':
        if (window.eq) window.eq.togglePanel();
        break;

      // F: Toggle fullscreen Now Playing
      case 'f':
      case 'F':
        if (window.mainApp) window.mainApp.toggleNowPlayingPanel();
        break;

      // 1-5: Rate current song
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        if (window.player && window.player.currentTrack && window.ratings) {
          const rateValue = parseInt(key);
          window.ratings.setRating(window.player.currentTrack.id, rateValue);
          // Re-render large Now playing stats
          window.player.updateNowPlayingInfo(window.player.currentTrack.id);
        }
        break;

      // /: Focus search inputs
      case '/':
        event.preventDefault();
        const globalSearch = document.getElementById('global-search');
        const inlineFilter = document.getElementById('search-inline-filter');
        const activeSearch = inlineFilter || globalSearch;
        if (activeSearch) {
          activeSearch.focus();
          activeSearch.select();
        }
        break;

      // Escape: Close active overlays
      case 'Escape':
        if (window.tagger) window.tagger.closeEditor();
        if (window.settings) window.settings.closeSettings();
        if (window.eq) window.eq.togglePanel(false);
        if (window.lyrics) window.lyrics.togglePanel(false);
        this.closeShortcuts();
        break;

      // ?: Help shortcuts cheat-sheet modal
      case '?':
        this.showShortcuts();
        break;

      default:
        break;
    }
  }

  showShortcuts() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay && this.modal) {
      overlay.classList.add('show');
      this.modal.style.display = 'block';
    }
  }

  closeShortcuts() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay && this.modal) {
      overlay.classList.remove('show');
      this.modal.style.display = 'none';
    }
  }
}

window.keyboard = new KeyboardManager();
