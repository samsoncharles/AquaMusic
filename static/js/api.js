// AquaMusic API Fetch Wrapper
window.api = {
  /**
   * Helper to perform fetch requests with error bounds.
   */
  async request(url, options = {}) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }
      // If content is an attachment (like M3U), we return the response or handle separately
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        return await response.json();
      }
      return await response.text();
    } catch (error) {
      console.error(`[API Error] Request failed to: ${url}`, error);
      throw error;
    }
  },

  /**
   * Fetches the entire in-memory track library as a dictionary.
   */
  fetchLibrary() {
    return this.request('/api/library');
  },

  /**
   * Fetches the library metadata stats.
   */
  fetchStats() {
    return this.request('/api/library/stats');
  },

  /** Removes tracks from the app library without deleting their audio files. */
  removeLibraryTracks(trackIds) {
    return this.request('/api/library/tracks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_ids: trackIds })
    });
  },

  getState(key) {
    return this.request(`/api/state/${encodeURIComponent(key)}`);
  },

  saveState(key, value) {
    return this.request(`/api/state/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
  },

  getSharing() {
    return this.request('/api/sharing');
  },

  saveSharing(settings) {
    return this.request('/api/sharing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  },

  /**
   * Initiates a directory scan.
   */
  scanFolder(folderPath) {
    return this.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath })
    });
  },

  /**
   * Gets directory folder contents for path picker.
   */
  getFolders(path = '') {
    return this.request(`/api/folders?path=${encodeURIComponent(path)}`);
  },

  /**
   * Fetches auto-suggested MP3 folders from home directory
   */
  getAutoSearchFolders() {
    return this.request('/api/auto_search');
  },

  /**
   * Fetches dominant color values of album art.
   */
  getDominantColor(trackId) {
    return this.request(`/api/art/${trackId}/dominant`);
  },

  /**
   * Fetches low-resolution amplitude samples.
   */
  getWaveform(trackId) {
    return this.request(`/api/waveform/${trackId}`);
  },

  /**
   * Fetches lyrics contents (LRC or plain).
   */
  getLyrics(trackId) {
    return this.request(`/api/lyrics/${trackId}`);
  },

  /**
   * Edits and saves mutagen metadata tags.
   */
  saveTags(trackId, tagData) {
    return this.request(`/api/tag/${trackId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tagData)
    });
  }
};
