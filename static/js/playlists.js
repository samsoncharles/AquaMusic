// AquaMusic Playlists and Queue Manager
class PlaylistsManager {
  constructor() {
    this.playlists = []; // Array of {id, name, created, trackIds: []}
    this.activeQueue = []; // Active playback tracks list
    this.activeQueueIndex = -1;
    this.originalQueue = []; // Backup for unshuffling
    this.isShuffled = false;
    this.isAutopilotEnabled = false;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    this.newPlaylistTrackId = null;
    this.selectedAutoSearchFolders = new Set();
    this.isAutoSearchMode = false;
  }

  init() {
    this.loadPlaylists();
    this.loadQueueState();

    // Bind modal create playlist button
    const btnCreateConfirm = document.getElementById('btn-create-playlist-confirm');
    const inputNewName = document.getElementById('input-new-playlist-name');
    
    const doCreatePlaylist = () => {
      const val = inputNewName ? inputNewName.value.trim() : '';
      if (val) {
        const playlist = this.createPlaylist(val);
        if (playlist && this.newPlaylistTrackId) {
          this.addTrackToPlaylist(playlist.id, this.newPlaylistTrackId, true);
          window.toast.show(`Saved to "${playlist.name}"`, 'success');
        }
        this.newPlaylistTrackId = null;
        inputNewName.value = '';
        const modal = document.getElementById('modal-new-playlist');
        const overlay = document.getElementById('modal-overlay');
        if (modal) modal.style.display = 'none';
        if (overlay) overlay.classList.remove('show');
      }
    };
    
    if (btnCreateConfirm) {
      btnCreateConfirm.addEventListener('click', doCreatePlaylist);
    }
    if (inputNewName) {
      inputNewName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doCreatePlaylist();
        if (e.key === 'Escape') {
          this.newPlaylistTrackId = null;
          const modal = document.getElementById('modal-new-playlist');
          const overlay = document.getElementById('modal-overlay');
          if (modal) modal.style.display = 'none';
          if (overlay) overlay.classList.remove('show');
        }
      });
    }

    // A cancelled create action must not carry a track into a later playlist.
    document.querySelectorAll('[data-modal-close="modal-new-playlist"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.newPlaylistTrackId = null;
        const m = document.getElementById('modal-new-playlist');
        if (m) m.style.display = 'none';
        document.getElementById('modal-overlay')?.classList.remove('show');
      });
    });
    const btnConfirmFolder = document.getElementById('btn-confirm-folder-select');
    if (btnConfirmFolder) {
      btnConfirmFolder.addEventListener('click', () => {
        if (this.isAutoSearchMode && this.selectedAutoSearchFolders.size > 0) {
          this.importFolders([...this.selectedAutoSearchFolders]);
        } else if (this.selectedFolderSelectorPath) {
          this.importFolders([this.selectedFolderSelectorPath]);
        }
      });
    }
  }

  loadPlaylists() {
    const saved = localStorage.getItem('wavevault_playlists');
    if (saved) {
      try {
        this.playlists = JSON.parse(saved);
      } catch (e) {
        this.playlists = [];
      }
    }
    this.renderPlaylistsSidebar();
  }

  savePlaylists() {
    localStorage.setItem('wavevault_playlists', JSON.stringify(this.playlists));
    this.renderPlaylistsSidebar();
  }

  uniquePlaylistName(name, excludeId = null) {
    const baseName = name.trim() || 'Untitled Playlist';
    const usedNames = new Set(
      this.playlists
        .filter(playlist => playlist.id !== excludeId)
        .map(playlist => playlist.name.toLocaleLowerCase())
    );
    if (!usedNames.has(baseName.toLocaleLowerCase())) return baseName;

    let number = 2;
    let candidate = `${baseName} (${number})`;
    while (usedNames.has(candidate.toLocaleLowerCase())) {
      number += 1;
      candidate = `${baseName} (${number})`;
    }
    return candidate;
  }

  createPlaylist(name) {
    const newPlaylist = {
      id: 'pl-' + Math.random().toString(36).substr(2, 9),
      name: this.uniquePlaylistName(name),
      created: Date.now(),
      trackIds: []
    };
    this.playlists.push(newPlaylist);
    this.savePlaylists();
    window.toast.show(`Playlist "${newPlaylist.name}" created.`, 'success');
    return newPlaylist;
  }

  async deletePlaylist(playlistId) {
    const pl = this.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const confirmed = await window.dialog.confirm(`Are you sure you want to delete the playlist "${pl.name}"?`, 'Delete Playlist');
    if (confirmed) {
      this.playlists = this.playlists.filter(p => p.id !== playlistId);
      this.savePlaylists();
      window.toast.show("Playlist deleted.", "info");
      
      // Update track filtering
      if (window.library) {
        window.library.applyFiltersAndSorts();
      }

      // If currently showing this playlist, switch to library songs view
      if (window.mainApp && window.mainApp.currentView === `playlist-${playlistId}`) {
        window.mainApp.switchView('songs');
      }
    }
  }

  renamePlaylist(playlistId, newName) {
    const pl = this.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const oldName = pl.name;
    pl.name = this.uniquePlaylistName(newName, playlistId);
    this.savePlaylists();
    window.toast.show(`Playlist renamed from "${oldName}" to "${pl.name}".`, 'success');
    
    // Re-render if currently viewing this playlist
    if (window.mainApp && window.mainApp.currentView === `playlist-${playlistId}`) {
      window.mainApp.switchView(`playlist-${playlistId}`);
    }
  }

  removeAndBlacklistTrack(playlistId, trackId) {
    // 1. Save to blacklist in localStorage
    const blacklist = JSON.parse(localStorage.getItem('wavevault_blacklist') || '[]');
    if (!blacklist.includes(trackId)) {
      blacklist.push(trackId);
      localStorage.setItem('wavevault_blacklist', JSON.stringify(blacklist));
    }

    // 2. Remove from the selected playlist
    const pl = this.playlists.find(p => p.id === playlistId);
    if (pl) {
      pl.trackIds = pl.trackIds.filter(id => id !== trackId);
      this.savePlaylists();
    }

    window.toast.show("Track removed and blacklisted.", "info");

    // 3. Re-filter and re-render the library database
    if (window.library) {
      window.library.applyFiltersAndSorts();
    }
    
    // 4. Force refresh playlist view to reflect deletion
    if (window.mainApp && window.mainApp.currentView === `playlist-${playlistId}`) {
      window.mainApp.switchView(`playlist-${playlistId}`);
    }
  }

  addTrackToPlaylist(playlistId, trackId, silent = false) {
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist) return false;

    if (playlist.trackIds.includes(trackId)) {
      if (!silent) window.toast.show(`Track already exists in "${playlist.name}".`, 'warning');
      return false;
    }

    playlist.trackIds.push(trackId);
    this.savePlaylists();
    
    // Remember the last playlist used
    localStorage.setItem('wavevault_last_playlist', playlistId);
    
    if (!silent) window.toast.show(`Added to "${playlist.name}"`, 'success');
    return true;
  }

  addTrackWithYTMLogic(trackId) {
    const lastId = localStorage.getItem('wavevault_last_playlist');
    const lastPlaylist = this.playlists.find(p => p.id === lastId);

    if (!lastPlaylist) {
      window.toast.show('Create a playlist from the sidebar first.', 'info');
      return;
    }

    this.addTrackToPlaylist(lastPlaylist.id, trackId);
  }

  removeTrackFromPlaylist(playlistId, trackId, silent = false) {
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);
    this.savePlaylists();
    if (!silent) window.toast.show(`Removed from "${playlist.name}"`, 'info');
    
    // Refresh current view if showing this playlist
    if (window.mainApp && window.mainApp.currentView === `playlist-${playlistId}`) {
      window.mainApp.switchView(`playlist-${playlistId}`);
    }
  }

  moveTrackInPlaylist(playlistId, trackId, beforeTrackId) {
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist || trackId === beforeTrackId) return;

    const fromIndex = playlist.trackIds.indexOf(trackId);
    const targetIndex = playlist.trackIds.indexOf(beforeTrackId);
    if (fromIndex === -1 || targetIndex === -1) return;

    playlist.trackIds.splice(fromIndex, 1);
    const updatedTargetIndex = playlist.trackIds.indexOf(beforeTrackId);
    playlist.trackIds.splice(updatedTargetIndex, 0, trackId);
    this.savePlaylists();
  }

  /**
   * Triggers browser attachment download of an M3U file.
   */
  exportM3U(trackIds) {
    if (!trackIds || trackIds.length === 0) {
      window.toast.show("Cannot export empty playlist.", "warning");
      return;
    }
    const idsString = trackIds.join(',');
    window.location.href = `/api/playlist/export?ids=${idsString}`;
  }

  renderPlaylistsSidebar() {
    const container = document.getElementById('user-playlists-list');
    if (!container) return;
    container.innerHTML = '';

    if (this.playlists.length === 0) {
      container.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); padding:6px 12px;">No playlists yet</div>';
      return;
    }

    this.playlists.forEach(pl => {
      const el = document.createElement('a');
      el.className = 'sidebar-item playlist-item';
      el.dataset.view = `playlist-${pl.id}`;
      el.innerHTML = `
        <i data-lucide="music-3"></i>
        <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${pl.name}</span>
      `;

      // Bind click navigation
      el.addEventListener('click', () => {
        if (window.mainApp) window.mainApp.switchView(`playlist-${pl.id}`);
      });

      // Bind context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation(); // prevent bubbling to the general sidebar menu
        if (window.contextMenu) window.contextMenu.showForSidebar(e.clientX, e.clientY, pl.id);
      });

      // Bind HTML5 drag & drop handlers
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('drag-over');
      });

      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const trackId = e.dataTransfer.getData('text/plain');
        if (trackId) {
          this.addTrackToPlaylist(pl.id, trackId);
        }
      });

      container.appendChild(el);
    });

    if (window.lucide) {
      window.lucide.createIcons({ container: container });
    }
  }

  /* ----------------------------------------------------
     SMART PLAYLISTS RULES (Module 9)
     ---------------------------------------------------- */


  getPlayCount(trackId) {
    const stats = localStorage.getItem('wavevault_play_counts');
    if (stats) {
      try {
        const parsed = JSON.parse(stats);
        return parsed[trackId] || 0;
      } catch (e) {
        return 0;
      }
    }
    return 0;
  }

  incrementPlayCount(trackId) {
    let playCounts = {};
    const stats = localStorage.getItem('wavevault_play_counts');
    if (stats) {
      try {
        playCounts = JSON.parse(stats);
      } catch (e) {
        playCounts = {};
      }
    }
    playCounts[trackId] = (playCounts[trackId] || 0) + 1;
    localStorage.setItem('wavevault_play_counts', JSON.stringify(playCounts));
  }

  /* ----------------------------------------------------
     PLAYBACK QUEUE MANAGEMENT (Module 11)
     ---------------------------------------------------- */
  loadQueueState() {
    const savedQueue = localStorage.getItem('wavevault_queue');
    const savedIndex = localStorage.getItem('wavevault_queue_index');
    const savedShuffle = localStorage.getItem('wavevault_shuffle');
    const savedRepeat = localStorage.getItem('wavevault_repeat');
    const savedAutopilot = localStorage.getItem('wavevault_autopilot');

    if (savedQueue) {
      try { this.activeQueue = JSON.parse(savedQueue); } catch (e) { this.activeQueue = []; }
    }
    if (savedIndex) {
      this.activeQueueIndex = parseInt(savedIndex);
    }
    if (savedShuffle) {
      this.isShuffled = JSON.parse(savedShuffle);
    }
    if (savedRepeat) {
      this.repeatMode = savedRepeat;
    }
    if (savedAutopilot) {
      this.isAutopilotEnabled = JSON.parse(savedAutopilot);
    }
    
    this.originalQueue = [...this.activeQueue]; // fallback
    this.updateControlsUI();
  }

  saveQueueState() {
    localStorage.setItem('wavevault_queue', JSON.stringify(this.activeQueue));
    localStorage.setItem('wavevault_queue_index', this.activeQueueIndex.toString());
    localStorage.setItem('wavevault_shuffle', JSON.stringify(this.isShuffled));
    localStorage.setItem('wavevault_repeat', this.repeatMode);
    localStorage.setItem('wavevault_autopilot', JSON.stringify(this.isAutopilotEnabled));
  }

  setQueue(tracksList, startIndex = 0) {
    this.originalQueue = [...tracksList];
    this.activeQueue = [...tracksList];
    this.activeQueueIndex = startIndex;
    this.isShuffled = false;
    
    this.saveQueueState();
    this.updateControlsUI();
  }

  /**
   * Shuffles active queue, keeping current track first.
   */
  toggleShuffle() {
    this.isShuffled = !this.isShuffled;
    
    if (this.isShuffled) {
      if (this.activeQueue.length > 1) {
        // Keep current song at the beginning
        const current = this.activeQueue[this.activeQueueIndex];
        const rest = this.activeQueue.filter((_, i) => i !== this.activeQueueIndex);
        if (this.isAutopilotEnabled) {
          // Bitrate-focused Shuffle Algorithm
          // 1. First, completely randomize the remaining pool so identical bitrates aren't sequentially clumped.
          let available = [...rest];
          for (let i = available.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [available[i], available[j]] = [available[j], available[i]];
          }

          // 2. Build the journey picking randomly from a bucket of nearest matches
          const newRest = [];
          let referenceBitrate = current.bitrate || 128; // Fallback to standard 128kbps

          while (available.length > 0) {
            // Find the absolute minimum difference
            let minDiff = Infinity;
            for (const track of available) {
              const diff = Math.abs((track.bitrate || 128) - referenceBitrate);
              if (diff < minDiff) minDiff = diff;
            }

            // Gather all tracks that are within a small tolerance of the best match
            const tolerance = 16; 
            const candidates = available.filter(t => Math.abs((t.bitrate || 128) - referenceBitrate) <= minDiff + tolerance);

            // Pick randomly from the candidates bucket
            const pickIndex = Math.floor(Math.random() * candidates.length);
            const pickedTrack = candidates[pickIndex];
            
            // Remove picked track from available pool
            const availIndex = available.findIndex(t => t.id === pickedTrack.id);
            available.splice(availIndex, 1);
            
            newRest.push(pickedTrack);
            referenceBitrate = pickedTrack.bitrate || 128;
          }
          
          this.activeQueue = [current, ...newRest];
        } else {
          // Standard Fisher-Yates Random Shuffle
          for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
          }
          this.activeQueue = [current, ...rest];
        }
        this.activeQueueIndex = 0;
      }
      window.toast.show("Shuffle enabled", "info");
    } else {
      // Restore original queue order
      const current = this.activeQueue[this.activeQueueIndex];
      const origIndex = this.originalQueue.findIndex(t => t.id === current.id);
      
      this.activeQueue = [...this.originalQueue];
      this.activeQueueIndex = origIndex !== -1 ? origIndex : 0;
      window.toast.show("Shuffle disabled", "info");
    }

    this.saveQueueState();
    this.updateControlsUI();
    
    // Refresh queue viewport if open
    if (window.mainApp && window.mainApp.currentView === 'queue') {
      window.mainApp.switchView('queue');
    }
    
    // Refresh Up Next widget instantly
    if (window.player && window.player.updateUpNextWidget) {
      window.player.updateUpNextWidget();
    }
  }

  toggleAutopilot() {
    this.isAutopilotEnabled = !this.isAutopilotEnabled;
    window.toast.show(`Autopilot ${this.isAutopilotEnabled ? 'enabled' : 'disabled'}`, 'info');
    
    // If shuffle is currently active, we need to reshuffle to apply the new setting
    if (this.isShuffled) {
      this.isShuffled = false; // Temporarily disable
      this.toggleShuffle();    // Re-enable to trigger the new algorithm
    } else {
      this.saveQueueState();
      this.updateControlsUI();
    }
  }

  cycleRepeat() {
    // Off -> Repeat All -> Repeat One
    if (this.repeatMode === 'off') {
      this.repeatMode = 'all';
      window.toast.show("Repeat all enabled", "info");
    } else if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
      window.toast.show("Repeat one enabled", "info");
    } else {
      this.repeatMode = 'off';
      window.toast.show("Repeat disabled", "info");
    }

    this.saveQueueState();
    this.updateControlsUI();
  }

  updateControlsUI() {
    const shuffleBtn = document.getElementById('btn-shuffle');
    const autopilotBtn = document.getElementById('btn-autopilot');
    const repeatBtn = document.getElementById('btn-repeat');

    if (shuffleBtn) {
      shuffleBtn.classList.toggle('btn-toggle-active', this.isShuffled);
    }
    
    if (autopilotBtn) {
      autopilotBtn.style.display = this.isShuffled ? 'inline-flex' : 'none';
      autopilotBtn.classList.toggle('btn-toggle-active', this.isAutopilotEnabled);
      autopilotBtn.innerHTML = `<i data-lucide="${this.isAutopilotEnabled ? 'toggle-right' : 'toggle-left'}"></i>`;
      if (window.lucide) window.lucide.createIcons({ container: autopilotBtn });
    }

    if (repeatBtn) {
      const iconNode = repeatBtn.querySelector('i');
      repeatBtn.classList.toggle('btn-toggle-active', this.repeatMode !== 'off');
      
      const indicator = document.getElementById('repeat-one-indicator');
      if (indicator) {
        indicator.style.display = (this.repeatMode === 'one') ? 'flex' : 'none';
      }
      
      if (iconNode) {
        iconNode.setAttribute('data-lucide', 'repeat');
        if (window.lucide) {
          window.lucide.createIcons({ nodeList: [iconNode] });
        }
      }
    }
  }

  getCurrentTrack() {
    if (this.activeQueueIndex >= 0 && this.activeQueueIndex < this.activeQueue.length) {
      return this.activeQueue[this.activeQueueIndex];
    }
    return null;
  }
  peekNextTrack() {
    if (this.activeQueue.length === 0) return null;
    if (this.repeatMode === 'one') {
      return this.getCurrentTrack();
    }
    if (this.activeQueueIndex < this.activeQueue.length - 1) {
      return this.activeQueue[this.activeQueueIndex + 1];
    } else {
      if (this.repeatMode === 'all') {
        return this.activeQueue[0];
      }
    }
    return null;
  }

  nextTrack(ignoreRepeatOne = false) {
    if (this.activeQueue.length === 0) return null;

    if (this.repeatMode === 'one' && !ignoreRepeatOne) {
      // Repeat current track
      return this.getCurrentTrack();
    }

    if (this.activeQueueIndex < this.activeQueue.length - 1) {
      this.activeQueueIndex++;
    } else {
      // We reached the end of queue
      if (this.repeatMode === 'all') {
        this.activeQueueIndex = 0; // Wrap around
      } else {
        return null; // Stop playing
      }
    }
    
    this.saveQueueState();
    return this.getCurrentTrack();
  }

  prevTrack(ignoreRepeatOne = false) {
    if (this.activeQueue.length === 0) return null;

    if (this.repeatMode === 'one' && !ignoreRepeatOne) {
      // Repeat current track
      return this.getCurrentTrack();
    }

    if (this.activeQueueIndex > 0) {
      this.activeQueueIndex--;
    } else {
      if (this.repeatMode === 'all') {
        this.activeQueueIndex = this.activeQueue.length - 1; // Wrap to end
      } else {
        // Stay on first track
      }
    }

    this.saveQueueState();
    return this.getCurrentTrack();
  }

  addToQueue(track, playNext = false) {
    if (playNext) {
      // Insert after current index
      const insertIdx = this.activeQueueIndex + 1;
      this.activeQueue.splice(insertIdx, 0, track);
      window.toast.show(`"${track.title}" will play next.`, "success");
    } else {
      // Add to end of queue
      this.activeQueue.push(track);
      window.toast.show(`"${track.title}" added to end of queue.`, "success");
    }
    this.saveQueueState();

    if (window.mainApp && window.mainApp.currentView === 'queue') {
      window.mainApp.switchView('queue');
    }
  }

  clearQueue() {
    this.activeQueue = [];
    this.activeQueueIndex = -1;
    this.originalQueue = [];
    this.saveQueueState();
    window.toast.show("Queue cleared.", "info");

    if (window.mainApp && window.mainApp.currentView === 'queue') {
      window.mainApp.switchView('queue');
    }
  }

  /* ----------------------------------------------------
     LOCAL FOLDER IMPORT
     ---------------------------------------------------- */
  showFolderSelector() {
    this.folderSelectorModal = document.getElementById('modal-folder-selector');
    const overlay = document.getElementById('modal-overlay');
    
    if (overlay && this.folderSelectorModal) {
      // Force hide any other modals lingering in the overlay
      overlay.querySelectorAll('.modal-container').forEach(m => m.style.display = 'none');
      
      overlay.classList.add('show');
      this.folderSelectorModal.style.display = 'block';
      
      let lastFolder = localStorage.getItem('wavevault_folder_path') || '';
      if (lastFolder === '/') lastFolder = ''; // Force home dir if root was saved
      this.renderFolderSelectorNodes(lastFolder);
      
      const btnAutoSearch = document.getElementById('btn-auto-search-folders');
      if (btnAutoSearch) {
        btnAutoSearch.onclick = () => this.runAutoSearch();
      }
    }
  }

  async runAutoSearch() {
    const nodesContainer = document.getElementById('selector-nodes');
    const breadcrumbs = document.getElementById('selector-breadcrumbs');
    if (!nodesContainer) return;
    
    nodesContainer.innerHTML = '<div style="padding: 20px; text-align: center;"><div class="loader" style="width:24px; height:24px; border-width:2px; margin:0 auto 12px auto;"></div><span style="color:var(--text-secondary);">Scanning home directory for MP3 folders...<br><small>This may take a moment.</small></span></div>';
    breadcrumbs.innerHTML = `<span class="folder-path-node" style="color:var(--accent);">Auto-Search Results</span>`;
    this.selectedFolderSelectorPath = '';
    this.selectedAutoSearchFolders.clear();
    this.isAutoSearchMode = true;
    this.updateFolderImportButton();
    
    try {
      const data = await window.api.getAutoSearchFolders();
      nodesContainer.innerHTML = '';
      
      if (!data.folders || data.folders.length === 0) {
        nodesContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No MP3 folders found in home directory.</div>';
        return;
      }
      
      data.folders.forEach(f => {
        const row = document.createElement('div');
        row.className = 'folder-node-row';
        row.style.justifyContent = 'space-between';
        row.setAttribute('role', 'checkbox');
        row.setAttribute('aria-checked', 'false');
        row.style.cursor = 'pointer';

        const info = document.createElement('div');
        info.className = 'folder-node-info';
        const checkbox = document.createElement('span');
        checkbox.style.cssText = 'width:18px; height:18px; flex:0 0 18px; border:2px solid var(--text-muted); border-radius:3px; display:grid; place-items:center; color:white; font-size:13px;';
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', 'folder-search');
        icon.style.color = 'var(--accent)';
        const name = document.createElement('span');
        name.className = 'folder-node-name';
        name.title = f.path;
        name.append(document.createTextNode(f.name));
        const path = document.createElement('div');
        path.style.cssText = 'font-size:0.75rem; color:var(--text-muted); margin-top:2px;';
        path.textContent = f.path;
        name.append(path);
        info.append(checkbox, icon, name);
        const count = document.createElement('span');
        count.style.cssText = 'font-size:0.8rem; color:var(--text-secondary); background:var(--bg-surface-3); padding:2px 6px; border-radius:10px;';
        count.textContent = `${f.audio_count} songs`;
        row.append(info, count);
        row.addEventListener('click', () => {
          if (this.selectedAutoSearchFolders.has(f.path)) {
            this.selectedAutoSearchFolders.delete(f.path);
          } else {
            this.selectedAutoSearchFolders.add(f.path);
          }
          const selected = this.selectedAutoSearchFolders.has(f.path);
          row.setAttribute('aria-checked', String(selected));
          checkbox.textContent = selected ? '✓' : '';
          checkbox.style.borderColor = selected ? 'var(--accent)' : 'var(--text-muted)';
          checkbox.style.background = selected ? 'var(--accent)' : 'transparent';
          this.updateFolderImportButton();
        });
        nodesContainer.appendChild(row);
      });
      
      if (window.lucide) window.lucide.createIcons({ container: nodesContainer });
    } catch (err) {
      nodesContainer.innerHTML = `<div style="padding: 10px; color: var(--danger); text-align: center;">Auto-Search Failed: ${err.message || err}</div>`;
    }
  }

  updateFolderImportButton() {
    const button = document.getElementById('btn-confirm-folder-select');
    if (!button) return;
    const count = this.selectedAutoSearchFolders.size;
    button.textContent = this.isAutoSearchMode
      ? (count ? `Import ${count} Selected Folder${count === 1 ? '' : 's'}` : 'Select Folders to Import')
      : 'Select Folder';
    button.disabled = this.isAutoSearchMode && count === 0;
  }

  closeFolderSelector() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay && this.folderSelectorModal) {
      overlay.classList.remove('show');
      this.folderSelectorModal.style.display = 'none';
    }
  }

  async renderFolderSelectorNodes(dirPath = '') {
    const breadcrumbs = document.getElementById('selector-breadcrumbs');
    const nodesContainer = document.getElementById('selector-nodes');
    
    if (!breadcrumbs || !nodesContainer) return;
    
    this.isAutoSearchMode = false;
    this.selectedAutoSearchFolders.clear();
    this.updateFolderImportButton();
    nodesContainer.innerHTML = '<div style="padding: 10px; text-align: center;"><div class="loader" style="width:20px; height:20px; border-width:2px; margin:0 auto 6px auto;"></div><span>Loading folders...</span></div>';

    try {
      const data = await window.api.getFolders(dirPath);
      this.selectedFolderSelectorPath = data.current_path;
      
      // Render breadcrumbs
      const separator = window.mainApp.pathSeparator;
      const segments = data.current_path.split(separator).filter(Boolean);
      let cumulativePath = window.mainApp.isWindows ? '' : '';

      let breadcrumbsHtml = `<span class="folder-path-node selector-path-trigger" data-path="/">Root</span>`;
      segments.forEach((seg, idx) => {
        cumulativePath += (idx === 0 && window.mainApp.isWindows) ? seg : (separator + seg);
        breadcrumbsHtml += ` <span style="color:var(--text-muted);">/</span> <span class="folder-path-node selector-path-trigger" data-path="${cumulativePath}">${seg}</span>`;
      });
      
      breadcrumbs.innerHTML = breadcrumbsHtml;

      // Bind breadcrumbs clicks
      breadcrumbs.querySelectorAll('.selector-path-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
          this.renderFolderSelectorNodes(btn.dataset.path);
        });
      });

      // Render subfolders list
      nodesContainer.innerHTML = '';
      
      // Destination Stats Banner
      if (data.audio_count !== undefined) {
        const statsRow = document.createElement('div');
        statsRow.style.padding = '10px 16px';
        statsRow.style.marginBottom = '12px';
        statsRow.style.backgroundColor = 'var(--bg-surface-2)';
        statsRow.style.borderRadius = 'var(--border-radius)';
        statsRow.style.display = 'flex';
        statsRow.style.alignItems = 'center';
        statsRow.style.justifyContent = 'space-between';
        statsRow.innerHTML = `
          <div style="font-weight: 600; color: var(--text-primary);"><i data-lucide="music" style="width:16px;height:16px; margin-right:8px; vertical-align:text-bottom;"></i>Destination Stats</div>
          <div style="font-size: 0.85rem; color: var(--text-secondary);">
            <span style="color:var(--accent); font-weight:bold;">${data.audio_count}</span> songs
            ${data.audio_size_mb ? ` <span style="margin:0 6px;">•</span> <span style="font-weight:bold;">${data.audio_size_mb} MB</span>` : ''}
          </div>
        `;
        nodesContainer.appendChild(statsRow);
      }
      
      // Parent directory back node
      if (data.parent_path) {
        const row = document.createElement('div');
        row.className = 'folder-node-row';
        row.innerHTML = `
          <div class="folder-node-info">
            <i data-lucide="corner-left-up"></i>
            <span class="folder-node-name">.. (Parent Directory)</span>
          </div>
        `;
        row.addEventListener('click', () => {
          this.renderFolderSelectorNodes(data.parent_path);
        });
        nodesContainer.appendChild(row);
      }

      // Children subdirectories
      if (data.folders.length === 0) {
        const row = document.createElement('div');
        row.style.padding = '12px';
        row.style.fontSize = '0.85rem';
        row.style.color = 'var(--text-muted)';
        row.style.textAlign = 'center';
        row.innerText = 'No subfolders here';
        nodesContainer.appendChild(row);
      }

      data.folders.forEach(f => {
        const row = document.createElement('div');
        row.className = 'folder-node-row';
        row.style.justifyContent = 'space-between';
        
        let countBadge = '';
        if (f.audio_count > 0) {
          countBadge = `<span style="font-size:0.8rem; color:var(--text-secondary); background:var(--bg-surface-3); padding:2px 6px; border-radius:10px;">${f.audio_count} songs</span>`;
        }
        
        row.innerHTML = `
          <div class="folder-node-info">
            <i data-lucide="folder"></i>
            <span class="folder-node-name" title="${f.name}">${f.name}</span>
          </div>
          ${countBadge}
        `;
        row.addEventListener('click', () => {
          this.renderFolderSelectorNodes(f.path);
        });
        nodesContainer.appendChild(row);
      });

      if (window.lucide) {
        window.lucide.createIcons({ container: nodesContainer });
        window.lucide.createIcons({ container: breadcrumbs });
      }

    } catch (err) {
      nodesContainer.innerHTML = `<div style="padding: 10px; color: var(--danger); text-align: center;">Error: ${err.message || err}</div>`;
    }
  }

  async createPlaylistFromFolder(folderPath) {
    this.closeFolderSelector();
    return this.createPlaylistsFromFolders([folderPath]);
  }

  async importFolders(folderPaths) {
    this.closeFolderSelector();
    const paths = [...new Set(folderPaths)];
    let importedCount = 0;
    window.toast.show(`Importing ${paths.length} folder${paths.length === 1 ? '' : 's'}...`, 'info');

    for (const folderPath of paths) {
      try {
        const res = await window.api.scanFolder(folderPath);
        if (res.status !== 'ok') throw new Error(res.message || 'Scanner could not start');

        await new Promise((resolve, reject) => {
          const evtSource = new EventSource('/api/scan/status');
          evtSource.onmessage = event => {
            const state = JSON.parse(event.data);
            if (state.status === 'done') {
              evtSource.close();
              resolve();
            } else if (state.status === 'error') {
              evtSource.close();
              reject(new Error(state.message || 'Folder scan failed'));
            }
          };
          evtSource.onerror = () => {
          evtSource.close();
          reject(new Error('Folder scan connection failed'));
        };
        });
        importedCount += 1;
      } catch (err) {
        window.toast.show(`Could not import "${folderPath}": ${err.message || err}`, 'error');
      }
    }

    if (importedCount > 0) {
      if (window.library) await window.library.reload();
      window.toast.show('Music folder import complete.', 'success');
      if (window.mainApp) window.mainApp.switchView('songs');
    }
  }

  async createPlaylistsFromFolders(folderPaths) {
    this.closeFolderSelector();
    const paths = [...new Set(folderPaths)];
    window.toast.show(`Importing ${paths.length} folder${paths.length === 1 ? '' : 's'}...`, 'info');

    // The server exposes one scanner status stream, so batch imports run in
    // order to ensure each playlist is built from the correct completed scan.
    const imported = [];
    for (const folderPath of paths) {
      try {
        const playlist = await this.importFolderAsPlaylist(folderPath);
        if (playlist) imported.push(playlist);
      } catch (err) {
        window.toast.show(`Could not import "${folderPath}": ${err.message || err}`, 'error');
      }
    }

    if (imported.length) {
      window.toast.show(`Imported ${imported.length} playlist${imported.length === 1 ? '' : 's'}.`, 'success');
      if (window.mainApp) window.mainApp.switchView(`playlist-${imported[imported.length - 1].id}`);
    }
  }

  async importFolderAsPlaylist(folderPath) {
    const sep = window.mainApp.pathSeparator;
    const folderName = folderPath.substring(folderPath.lastIndexOf(sep) + 1) || 'Folder Playlist';
    const res = await window.api.scanFolder(folderPath);
    if (res.status !== 'ok') throw new Error(res.message || 'Scanner could not start');

    await new Promise((resolve, reject) => {
      const evtSource = new EventSource('/api/scan/status');
      evtSource.onmessage = event => {
        const state = JSON.parse(event.data);
        if (state.status === 'done') {
          evtSource.close();
          resolve();
        } else if (state.status === 'error') {
          evtSource.close();
          reject(new Error(state.message || 'Folder scan failed'));
        }
      };
      evtSource.onerror = () => {
        evtSource.close();
        reject(new Error('Folder scan connection failed'));
      };
    });

    if (window.library) await window.library.reload();
    const normalizePath = p => (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const normalizedFolder = normalizePath(folderPath);
    const matchingTrackIds = Object.values(window.library._allTracks || window.library.tracks)
      .filter(track => normalizePath(track.path).startsWith(normalizedFolder))
      .map(track => track.id);

    if (!matchingTrackIds.length) {
      window.toast.show(`No audio files found in "${folderName}".`, 'warning');
      return null;
    }

    const newPlaylist = {
      id: 'pl-' + Math.random().toString(36).substr(2, 9),
      name: this.uniquePlaylistName(folderName),
      created: Date.now(),
      trackIds: matchingTrackIds
    };
    this.playlists.push(newPlaylist);
    this.savePlaylists();
    return newPlaylist;
  }
}

window.playlists = new PlaylistsManager();
