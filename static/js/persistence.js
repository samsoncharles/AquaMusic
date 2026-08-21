// Durable desktop preferences. Web localStorage remains a fast local cache,
// while this SQLite-backed snapshot survives WebEngine profile resets/upgrades.
window.persistence = {
  key: 'preferences',
  timer: null,
  ready: false,

  snapshot() {
    const preferences = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith('wavevault_')) preferences[key] = localStorage.getItem(key);
    }
    return preferences;
  },

  apply(preferences) {
    if (!preferences || typeof preferences !== 'object') return;
    Object.entries(preferences).forEach(([key, value]) => {
      if (key.startsWith('wavevault_') && typeof value === 'string') localStorage.setItem(key, value);
    });
  },

  scheduleSave() {
    if (!this.ready) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      window.api.saveState(this.key, this.snapshot()).catch(error =>
        console.warn('Could not save desktop preferences to the database.', error)
      );
    }, 250);
  },

  async init() {
    try {
      const stored = await window.api.getState(this.key);
      if (stored && typeof stored === 'object' && Object.keys(stored).length) {
        this.apply(stored);
      } else {
        // First run: preserve any existing WebEngine profile preferences.
        await window.api.saveState(this.key, this.snapshot());
      }
    } catch (error) {
      console.warn('Desktop preference database unavailable; using localStorage.', error);
    }

    try {
      const playback = await window.api.getState('playback');
      if (playback?.trackId) {
        localStorage.setItem('wavevault_last_track_id', playback.trackId);
        localStorage.setItem('wavevault_last_position', String(playback.position || 0));
      }
    } catch (_) { /* local preference backup remains available */ }

    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
      originalSetItem(key, value);
      if (key.startsWith('wavevault_')) this.scheduleSave();
    };
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = key => {
      originalRemoveItem(key);
      if (key.startsWith('wavevault_')) this.scheduleSave();
    };
    this.ready = true;
    window.addEventListener('pagehide', () => {
      fetch(`/api/state/${this.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.snapshot()),
        keepalive: true
      }).catch(() => {});
    });
  }
};
