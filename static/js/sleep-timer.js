// AquaMusic Sleep Timer logic
class SleepTimer {
  constructor() {
    this.interval = null;
    this.endTime = null;
    this.mode = 'off'; // 'off', 'time', 'end-of-track'
    this.timerBtn = null;
  }

  init() {
    this.timerBtn = document.getElementById('btn-sleep-timer');
    if (this.timerBtn) {
      this.timerBtn.addEventListener('click', (e) => this.showMenu(e));
    }
  }

  showMenu(event) {
    event.stopPropagation();
    
    if (this.mode !== 'off') {
      // If already running, click cancels it
      this.cancel();
      window.toast.show("Sleep timer cancelled.", "info");
      return;
    }

    // Display custom choice context menu
    const menuItems = [
      { label: '15 Minutes', action: () => this.start(15 * 60) },
      { label: '30 Minutes', action: () => this.start(30 * 60) },
      { label: '45 Minutes', action: () => this.start(45 * 60) },
      { label: '1 Hour', action: () => this.start(60 * 60) },
      { label: 'End of Track', action: () => this.startEndOfTrack() },
      { label: 'Custom...', action: () => this.promptCustom() }
    ];

    window.contextMenu.showAt(event.clientX, event.clientY, menuItems);
  }

  start(seconds) {
    this.cancel();
    this.mode = 'time';
    this.endTime = Date.now() + seconds * 1000;
    
    window.toast.show(`Sleep timer set for ${Math.round(seconds / 60)} minutes.`, "success");
    this.updateButton();

    const tick = async () => {
      const remaining = this.endTime - Date.now();
      
      // Hook 30-second volume fade before closing
      if (remaining <= 30000 && remaining > 29000) {
        if (window.player?.gainNode) {
          window.player.rampGain(window.player.gainNode.gain.value, 0, 30);
        }
      }

      if (remaining <= 0) {
        if (window.player) {
          await window.player.softPause();
        }
        this.cancel();
        window.toast.show("Sleep timer expired. Playback stopped.", "info");
      } else {
        this.updateButton(remaining);
      }
    };

    tick();
    this.interval = setInterval(tick, 1000);
  }

  startEndOfTrack() {
    this.cancel();
    this.mode = 'end-of-track';
    window.toast.show("Sleep timer set to end of current track.", "success");
    this.updateButton();
  }

  async promptCustom() {
    const min = await window.dialog.prompt("Enter sleep timer duration in minutes:", "Custom Timer", "30");
    if (min !== null) {
      const minutes = parseInt(min);
      if (!isNaN(minutes) && minutes > 0) {
        this.start(minutes * 60);
      } else {
        window.toast.show("Invalid duration entered.", "error");
      }
    }
  }

  cancel() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.mode = 'off';
    this.endTime = null;
    this.resetButton();
  }

  onTrackEnded() {
    if (this.mode === 'end-of-track') {
      if (window.player) {
        window.player.softPause();
      }
      this.cancel();
      window.toast.show("Sleep timer (End of Track) triggered. Playback stopped.", "info");
      return true;
    }
    return false;
  }

  updateButton(remainingMs = null) {
    if (!this.timerBtn) return;
    this.timerBtn.classList.add('btn-toggle-active');
    
    if (this.mode === 'time' && remainingMs !== null) {
      const totalSecs = Math.ceil(remainingMs / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      this.timerBtn.title = `Timer active: ${mins}:${secs.toString().padStart(2, '0')} (Click to cancel)`;
      // Optionally update visual label if required
    } else if (this.mode === 'end-of-track') {
      this.timerBtn.title = "Timer active: End of song (Click to cancel)";
    }
  }

  resetButton() {
    if (!this.timerBtn) return;
    this.timerBtn.classList.remove('btn-toggle-active');
    this.timerBtn.title = "Sleep Timer";
  }
}

window.sleepTimer = new SleepTimer();
