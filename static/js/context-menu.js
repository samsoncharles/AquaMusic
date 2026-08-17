// AquaMusic Custom Right-Click Context Menu Manager (Module 18)
class ContextMenuManager {
  constructor() {
    this.menu = null;
    this.trackId = null;
    this.infoModal = null;
  }

  init() {
    this.menu = document.getElementById('context-menu');
    this.infoModal = document.getElementById('modal-trackinfo');

    // Click outside to close triggers
    window.addEventListener('click', () => this.hide());
    window.addEventListener('scroll', () => this.hide(), true);
  }

  hide() {
    if (this.menu) {
      this.menu.style.display = 'none';
      this.menu.innerHTML = '';
    }
  }

  /**
   * General helper to show a custom action menu at (x,y)
   */
  showAt(x, y, items) {
    if (!this.menu) this.init();

    this.menu.innerHTML = '';
    this.menu.style.display = 'block';

    items.forEach(item => {
      if (item.type === 'divider') {
        const div = document.createElement('div');
        div.className = 'menu-divider';
        this.menu.appendChild(div);
        return;
      }

      const row = document.createElement('div');
      row.className = 'menu-item';
      row.innerHTML = `
        <div class="menu-item-left">
          <span>${item.label}</span>
        </div>
      `;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hide();
        item.action();
      });

      this.menu.appendChild(row);
    });

    this.positionMenu(x, y);
  }

  /**
   * Renders the full context menu for a track.
   */
  showForTrack(x, y, trackId, playActionOverride = null, playlistContextId = null) {
    if (!this.menu) this.init();
    this.trackId = trackId;

    if (!window.library || !window.library.tracks[trackId]) return;
    const track = window.library.tracks[trackId];

    this.menu.innerHTML = '';
    this.menu.style.display = 'block';

    // 1. Play now
    this.addMenuItem('▶ Play Now', () => {
      if (playActionOverride) {
        playActionOverride();
      } else if (window.playlists && window.player) {
        window.playlists.addToQueue(track, true);
        window.playlists.activeQueueIndex = window.playlists.activeQueue.length - 1; // Play last added
        window.player.playTrack(track.id, true);
      }
    });

    // 2. Play next
    this.addMenuItem('⏭ Play Next', () => {
      if (window.playlists) window.playlists.addToQueue(track, true);
    });

    // 3. Add to end of queue
    this.addMenuItem('⊕ Add to end of queue', () => {
      if (window.playlists) window.playlists.addToQueue(track, false);
    });

    this.addDivider();

    // 4. Add to Playlist (YTM Logic)
    this.addMenuItem('➕ Add to Playlist', () => {
      if (window.playlists) {
        window.playlists.addTrackWithYTMLogic(trackId);
      }
    });

    // 5. Add to Favorites
    this.addMenuItem('❤ Add to Favorites', () => {
      if (window.ratings) {
        window.ratings.setRating(trackId, 5); // 5-star favorite
      }
    });

    // 6. Rate track (with nested sub-menus)
    const rateItem = this.addSubmenuItem('★ Rate Track');
    [1, 2, 3, 4, 5].forEach(star => {
      this.addSubmenuRow(rateItem.submenu, `${'★'.repeat(star)}${'☆'.repeat(5 - star)}`, () => {
        if (window.ratings) window.ratings.setRating(trackId, star);
      });
    });

    this.addDivider();

    // 7. Track Info
    this.addMenuItem('ℹ Track specifications', () => {
      this.showTrackInfo(trackId);
    });

    // 8. Copy path
    this.addMenuItem('📁 Copy file path', () => {
      navigator.clipboard.writeText(track.path);
      window.toast.show("File path copied to clipboard!", "success");
    });

    this.addDivider();

    // 9. Edit tags
    this.addMenuItem('✏ Edit tags', () => {
      if (window.tagger) window.tagger.showEditor(trackId);
    });

    if (playlistContextId) {
      this.addDivider();
      this.addMenuItem('🗑 Remove from Playlist', () => {
        if (window.playlists) {
          window.playlists.removeAndBlacklistTrack(playlistContextId, trackId);
        }
      });
    }

    this.positionMenu(x, y);
  }

  showForSidebar(x, y, playlistId = null) {
    this.hide();
    this.menu.innerHTML = '';
    this.menu.style.display = 'block';

    if (playlistId && window.playlists) {
      const pl = window.playlists.playlists.find(p => p.id === playlistId);
      if (pl) {
        this.addMenuItem(`▶ Play "${pl.name}"`, () => {
          if (window.mainApp) window.mainApp.switchView(`playlist-${playlistId}`);
          setTimeout(() => {
            if (window.library && window.library.visibleTracksList.length > 0) {
              window.playlists.setQueue(window.library.visibleTracksList, 0);
              if (window.player) window.player.playTrack(window.library.visibleTracksList[0].id, true);
            }
          }, 100);
        });

        this.addMenuItem(`✏ Rename "${pl.name}"`, async () => {
          const newName = await window.dialog.prompt(`Enter a new name for "${pl.name}":`, 'Rename Playlist', pl.name);
          if (newName !== null && newName.trim()) {
            window.playlists.renamePlaylist(playlistId, newName.trim());
          }
        });

        this.addMenuItem(`🗑 Delete "${pl.name}"`, () => {
          window.playlists.deletePlaylist(playlistId);
        });

        this.addDivider();
      }
    }

    // Global sidebar options
    this.addMenuItem('➕ Create New Playlist', () => {
      const overlay = document.getElementById('modal-overlay');
      const modal = document.getElementById('modal-new-playlist');
      if (overlay) {
        overlay.querySelectorAll('.modal-container').forEach(m => m.style.display = 'none');
        overlay.classList.add('show');
      }
      if (modal) {
        modal.style.display = 'block';
        const input = document.getElementById('input-new-playlist-name');
        if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
      }
    });

    this.addMenuItem('📁 Import Local Folder', () => {
      if (window.playlists) window.playlists.showFolderSelector();
    });

    if (window.lucide) window.lucide.createIcons({ container: this.menu });

    this.positionMenu(x, y);
    this.menu.classList.add('show');
  }

  addMenuItem(label, action) {
    const el = document.createElement('div');
    el.className = 'menu-item';
    el.innerText = label;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      action();
    });
    this.menu.appendChild(el);
  }

  addDivider() {
    const el = document.createElement('div');
    el.className = 'menu-divider';
    this.menu.appendChild(el);
  }

  addSubmenuItem(label) {
    const wrapper = document.createElement('div');
    wrapper.className = 'menu-item';
    wrapper.innerHTML = `
      <span>${label}</span>
      <i data-lucide="chevron-right" style="font-size:0.75rem;"></i>
      <div class="submenu"></div>
    `;

    if (window.lucide) {
      window.lucide.createIcons({ container: wrapper });
    }

    const submenu = wrapper.querySelector('.submenu');
    this.menu.appendChild(wrapper);

    return { wrapper, submenu };
  }

  addSubmenuRow(submenuContainer, label, action) {
    const el = document.createElement('div');
    el.className = 'menu-item';
    el.innerText = label;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      action();
    });
    submenuContainer.appendChild(el);
  }

  positionMenu(x, y) {
    const rect = this.menu.getBoundingClientRect();
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // Adjust if coordinates overflow screen borders
    let left = x;
    let top = y;

    if (x + rect.width > screenW) {
      left = screenW - rect.width - 10;
    }
    if (y + rect.height > screenH) {
      top = screenH - rect.height - 10;
    }

    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
  }

  /* ----------------------------------------------------
     Metadata Specs Modal Sheets (Module 18 info)
     ---------------------------------------------------- */
  showTrackInfo(trackId) {
    if (!window.library || !window.library.tracks[trackId]) return;
    const track = window.library.tracks[trackId];

    const grid = document.getElementById('track-info-specs-grid');
    if (!grid) return;

    // Map labels
    const formatBytes = (bytes) => {
      if (!bytes) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const specs = [
      { label: 'File Title', value: track.title },
      { label: 'Contributing Artist', value: track.artist },
      { label: 'Album Title', value: track.album },
      { label: 'Album Artist', value: track.album_artist },
      { label: 'Release Year', value: track.year },
      { label: 'Genre Style', value: track.genre },
      { label: 'Track Position', value: track.track_number },
      { label: 'Disc Position', value: track.disc_number },
      { label: 'Beats per Minute (BPM)', value: track.bpm || 'None' },
      { label: 'Composer/Author', value: track.composer || 'None' },
      { label: 'Comments Metadata', value: track.comment || 'None' },
      { label: 'Audio Codec Format', value: track.codec },
      { label: 'Length Duration', value: track.duration_fmt },
      { label: 'Compression Bitrate', value: track.bitrate ? `${track.bitrate} kbps` : 'Unknown' },
      { label: 'Sampling Rate Frequency', value: track.sample_rate ? `${track.sample_rate} Hz` : 'Unknown' },
      { label: 'Channels Layout', value: track.channels === 1 ? 'Mono (1.0)' : 'Stereo (2.0)' },
      { label: 'System File Size', value: formatBytes(track.file_size) },
      { label: 'Local File Location', value: track.path }
    ];

    grid.innerHTML = specs.map(s => `
      <div class="track-info-item">
        <span class="track-info-label">${s.label}</span>
        <span class="track-info-value">${s.value}</span>
      </div>
    `).join('');

    const overlay = document.getElementById('modal-overlay');
    if (overlay && this.infoModal) {
      overlay.classList.add('show');
      this.infoModal.style.display = 'block';
    }
  }

  closeTrackInfo() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay && this.infoModal) {
      overlay.classList.remove('show');
      this.infoModal.style.display = 'none';
    }
  }
}

window.contextMenu = new ContextMenuManager();
