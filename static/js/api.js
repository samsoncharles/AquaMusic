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

  /** Fetches the entire in-memory track library as a dictionary. */
  fetchLibrary() {
    return this.request('/api/library');
  },

  /** Fetches the library metadata stats. */
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

  /** Clears every indexed track without deleting any source audio files. */
  clearLibrary() {
    return this.request('/api/library', { method: 'DELETE' });
  },

  /** Scans library and purges entries whose local files were deleted on disk. */
  pruneMissingTracks() {
    return this.request('/api/library/prune-missing', {
      method: 'POST'
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

  /** Safe Folder configuration */
  getSafeFolder() {
    return this.request('/api/safe-folder');
  },

  setSafeFolder(folder) {
    return this.request('/api/safe-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder })
    });
  },

  /** Initiates a directory scan. */
  scanFolder(folderPath) {
    return this.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath })
    });
  },

  /** Gets directory folder contents for path picker. */
  getFolders(path = '') {
    return this.request(`/api/folders?path=${encodeURIComponent(path)}`);
  },

  /** Fetches auto-suggested MP3 folders from home directory */
  getAutoSearchFolders() {
    return this.request('/api/auto_search');
  },

  /** Fetches dominant color values of album art. */
  getDominantColor(trackId) {
    return this.request(`/api/art/${encodeURIComponent(trackId)}/dominant`);
  },

  /** Fetches low-resolution amplitude samples. */
  getWaveform(trackId) {
    return this.request(`/api/waveform/${encodeURIComponent(trackId)}`);
  },

  /** Fetches lyrics contents (LRC or plain) with optional title/artist metadata. */
  getLyrics(trackId, title = null, artist = null) {
    let url = `/api/lyrics/${encodeURIComponent(trackId)}`;
    const params = new URLSearchParams();
    if (title) params.append('title', title);
    if (artist) params.append('artist', artist);
    const qs = params.toString();
    if (qs) url += `?${qs}`;
    return this.request(url);
  },

  /** Persists lyrics to offline disk storage. */
  saveLyrics(trackId, content, type = 'lrc', title = null, artist = null) {
    return this.request(`/api/lyrics/${encodeURIComponent(trackId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, type, title, artist })
    });
  },

  /** Edits and saves mutagen metadata tags. */
  saveTags(trackId, tagData) {
    return this.request(`/api/tag/${encodeURIComponent(trackId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tagData)
    });
  },

  /** Reveals file in OS file manager */
  revealFile(trackId = '', path = '') {
    return this.request('/api/reveal-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_id: trackId, path: path })
    });
  },

  /** Online Search */
  searchOnline(query, maxResults = 15) {
    return this.request(`/api/online/search?q=${encodeURIComponent(query)}&max=${maxResults}`);
  },

  /** Online Track Metadata */
  getOnlineTrack(videoId) {
    return this.request(`/api/online/track/${encodeURIComponent(videoId)}`);
  },

  /** Start Track Download */
  startDownload(videoId) {
    return this.request(`/api/download/start/${encodeURIComponent(videoId)}`, {
      method: 'POST'
    });
  },

  /** Download Status */
  getDownloadStatus(videoId) {
    return this.request(`/api/download/status/${encodeURIComponent(videoId)}`);
  },

  /** Start Playlist Download */
  downloadPlaylist(url) {
    return this.request('/api/download/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
  },

  /** Check status of a playlist download */
  getPlaylistDownloadStatus(playlistIdOrUrl) {
    return this.request(`/api/download/playlist/status/${encodeURIComponent(playlistIdOrUrl)}`);
  },

  /** Fetch list of Safe Folder downloads */
  getDownloads() {
    return this.request('/api/downloads');
  },

  /** Delete downloaded audio file and library record */
  deleteDownload(trackId) {
    return this.request(`/api/download/${encodeURIComponent(trackId)}`, {
      method: 'DELETE'
    });
  },

  /** Import M3U playlist file/content */
  importM3U(name, content, filepath = '') {
    return this.request('/api/playlist/import-m3u', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, filepath })
    });
  }
};
