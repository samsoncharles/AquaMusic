// AquaMusic Enhanced Context Menu Manager
class ContextMenuManager {
  constructor() {
    this.menu = null;
    this.trackId = null;
    this.infoModal = null;
  }

  init() {
    this.menu = document.getElementById('context-menu');
    this.infoModal = document.getElementById('modal-trackinfo');

    window.addEventListener('click', (e) => {
      // Don't hide if clicking inside active context menu
      if (this.menu && this.menu.contains(e.target)) return;
      this.hide();
    });
    window.addEventListener('scroll', () => this.hide(), true);

    // Globally disable browser default right-click context menu
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    }, { capture: true });
  }

  hide() {
    if (this.menu) {
      this.menu.style.display = 'none';
      this.menu.innerHTML = '';
    }
  }

  /**
   * Helper to resolve track object from ID or object.
   */
  resolveTrack(trackIdOrObj) {
    if (!trackIdOrObj) return null;
    if (typeof trackIdOrObj === 'object' && trackIdOrObj.id) return trackIdOrObj;
    const tid = String(trackIdOrObj);
    if (window.library && window.library.tracks && window.library.tracks[tid]) {
      return window.library.tracks[tid];
    }
    if (window.library && window.library._allTracks && window.library._allTracks[tid]) {
      return window.library._allTracks[tid];
    }
    if (window.onlineTracks && window.onlineTracks[tid]) {
      return window.onlineTracks[tid];
    }
    if (window.player && window.player.currentTrack && String(window.player.currentTrack.id) === tid) {
      return window.player.currentTrack;
    }
    return { id: tid, title: 'Audio Track', artist: '', album: '', duration: 0, path: '' };
  }

  /**
   * Renders the complete context menu for a track.
   */
  showForTrack(x, y, trackIdOrObj, playActionOverride = null, playlistContextId = null) {
    if (!this.menu) this.init();
    const track = this.resolveTrack(trackIdOrObj);
    if (!track) return;
    this.trackId = track.id;

    this.menu.innerHTML = '';
    this.menu.style.display = 'block';

    const isOnline = track.is_online || !track.path;

    // 1. Play Now
    this.addMenuItem('▶ Play Now', () => {
      if (playActionOverride) {
        playActionOverride();
      } else if (window.player) {
        if (window.playlists) window.playlists.addToQueue(track, true);
        window.player.playTrack(track, true);
      }
    });

    // 2. Play Next
    this.addMenuItem('⏭ Play Next', () => {
      if (window.playlists) {
        window.playlists.addToQueue(track, true);
        window.toast.show(`Queued next: "${track.title}"`, 'success');
      }
    });

    // 3. Add to Queue
    this.addMenuItem('⊕ Add to Queue', () => {
      if (window.playlists) {
        window.playlists.addToQueue(track, false);
        window.toast.show(`Added to queue: "${track.title}"`, 'success');
      }
    });

    this.addDivider();

    // 4. Add to Playlist (Interactive Submenu listing actual playlists)
    const playlistSub = this.addSubmenuItem('➕ Add to Playlist');
    const userPlaylists = (window.playlists && window.playlists.playlists) ? window.playlists.playlists : [];
    
    if (userPlaylists.length > 0) {
      userPlaylists.forEach(pl => {
        this.addSubmenuRow(playlistSub.submenu, `📁 ${pl.name}`, () => {
          if (window.playlists) {
            window.playlists.addTrackToPlaylist(pl.id, track.id);
            window.toast.show(`Added to "${pl.name}"`, 'success');
          }
        });
      });
      const subDiv = document.createElement('div');
      subDiv.className = 'menu-divider';
      playlistSub.submenu.appendChild(subDiv);
    }

    this.addSubmenuRow(playlistSub.submenu, '✨ Create New Playlist...', async () => {
      const name = await window.dialog.prompt('Enter playlist name:', 'New Playlist', 'My Playlist');
      if (name && name.trim() && window.playlists) {
        const pl = window.playlists.createPlaylist(name.trim());
        if (pl) {
          window.playlists.addTrackToPlaylist(pl.id, track.id);
          window.toast.show(`Created "${pl.name}" with track`, 'success');
        }
      }
    });

    // 5. Favorites
    const currentRating = (window.ratings && window.ratings.ratings) ? (window.ratings.ratings[track.id] || 0) : 0;
    const isFav = currentRating >= 5;
    this.addMenuItem(isFav ? '💔 Remove from Favorites' : '❤ Add to Favorites', () => {
      if (window.ratings) {
        window.ratings.setRating(track.id, isFav ? 0 : 5);
        window.toast.show(isFav ? 'Removed from favorites' : 'Saved to favorites', 'info');
      }
    });

    // 6. Rating Submenu
    const rateItem = this.addSubmenuItem('★ Rate Track');
    [1, 2, 3, 4, 5].forEach(star => {
      this.addSubmenuRow(rateItem.submenu, `${'★'.repeat(star)}${'☆'.repeat(5 - star)}`, () => {
        if (window.ratings) {
          window.ratings.setRating(track.id, star);
          window.toast.show(`Rated ${star} stars`, 'success');
        }
      });
    });

    this.addDivider();

    // 7. Track Specifications / Details
    this.addMenuItem('ℹ Track Specifications', () => {
      this.showTrackInfo(track);
    });

    // 8. Download to Safe Folder (if online track)
    if (isOnline) {
      this.addMenuItem('⬇ Download to Safe Folder', () => {
        if (window.views && typeof window.views.triggerTrackDownload === 'function') {
          window.views.triggerTrackDownload(track);
        } else if (window.api && window.api.startDownload) {
          window.api.startDownload(track.id);
          window.toast.show(`Downloading "${track.title}" to Safe Folder...`, 'info');
        }
      });
    }

    // 9. File Operations (if local track)
    if (!isOnline && track.path) {
      this.addMenuItem('📁 Copy File Path', () => {
        navigator.clipboard.writeText(track.path);
        window.toast.show("File path copied to clipboard!", "success");
      });

      this.addMenuItem('📂 Open File Location', async () => {
        try {
          await window.api.revealFile(track.id, track.path);
          window.toast.show("Opened directory in file manager", "info");
        } catch (e) {
          navigator.clipboard.writeText(track.path);
          window.toast.show("Path copied: " + track.path, "info");
        }
      });

      this.addMenuItem('✏ Edit Metadata Tags', () => {
        if (window.tagger) window.tagger.showEditor(track.id);
      });

      if (track.is_downloaded || (track.path && (track.path.includes('AquaMusic') || track.path.includes('Downloads'))) || (window.views?.cachedDownloads && window.views.cachedDownloads.some(d => String(d.id) === String(track.id)))) {
        this.addMenuItem('🗑 Delete Downloaded File', async () => {
          const confirmed = await window.dialog.confirm(
            `Delete "${track.title}" from your computer? The downloaded audio file will be permanently removed.`,
            'Delete Download'
          );
          if (confirmed) {
            try {
              await window.api.deleteDownload(track.id);
              window.toast.show(`Deleted "${track.title}"`, "info");
              if (window.library) await window.library.reload();
              if (window.views && window.views.currentOnlineTab === 'downloads') {
                window.views.renderOnlineDownloads();
              }
            } catch (err) {
              window.toast.show(`Delete failed: ${err.message}`, "error");
            }
          }
        });
      }
    } else {
      this.addMenuItem('📋 Copy Web URL', () => {
        const url = track.webpage_url || track.url || `https://www.youtube.com/watch?v=${track.id}`;
        navigator.clipboard.writeText(url);
        window.toast.show("URL copied to clipboard!", "success");
      });
    }

    // 10. Playlist context remove
    if (playlistContextId) {
      this.addDivider();
      this.addMenuItem('🗑 Remove from Playlist', () => {
        if (window.playlists) {
          window.playlists.removeTrackFromPlaylist(playlistContextId, track.id);
        }
      });
    }

    // 11. Remove from local library
    const inLibrary = (window.library && window.library.tracks && (window.library.tracks[track.id] || window.library._allTracks?.[track.id])) || (!isOnline);
    if (inLibrary) {
      this.addDivider();
      this.addMenuItem('🗑 Remove from Library', async () => {
        const confirmed = await window.dialog.confirm(
          `Remove "${track.title}" from your library? (The audio file on disk will NOT be deleted.)`,
          'Remove Track'
        );
        if (confirmed) {
          try {
            await window.api.removeLibraryTracks([track.id]);
            if (window.library) await window.library.reload();
            window.toast.show("Track removed from library database.", "info");
          } catch (err) {
            window.toast.show("Failed to remove track: " + err.message, "error");
          }
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

        this.addMenuItem(`💾 Export as M3U`, () => {
          if (pl.trackIds && pl.trackIds.length > 0) {
            window.playlists.exportM3U(pl.trackIds);
          } else {
            window.toast.show("Playlist is empty.", "warning");
          }
        });

        this.addMenuItem(`🗑 Delete "${pl.name}"`, () => {
          window.playlists.deletePlaylist(playlistId);
        });

        this.addDivider();
      }
    }

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

    this.addMenuItem('📁 Import Music Folder', () => {
      if (window.playlists) window.playlists.showFolderSelector();
    });

    this.addMenuItem('📄 Import M3U Playlist', () => {
      if (window.playlists) window.playlists.triggerImportM3U();
    });

    this.addDivider();

    this.addMenuItem('🧹 Clean Unlinked Music', () => {
      if (window.playlists) window.playlists.cleanOrphanTracks();
    });

    if (window.lucide) window.lucide.createIcons({ container: this.menu });

    this.positionMenu(x, y);
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
    wrapper.style.position = 'relative';
    wrapper.innerHTML = `
      <span>${label}</span>
      <i data-lucide="chevron-right" style="font-size:0.75rem; margin-left:auto;"></i>
      <div class="submenu"></div>
    `;

    if (window.lucide) {
      window.lucide.createIcons({ container: wrapper });
    }

    const submenu = wrapper.querySelector('.submenu');

    // Adjust submenu orientation if overflowing right edge
    wrapper.addEventListener('mouseenter', () => {
      const rect = wrapper.getBoundingClientRect();
      if (rect.right + 180 > window.innerWidth) {
        submenu.style.left = 'auto';
        submenu.style.right = '100%';
      } else {
        submenu.style.left = '100%';
        submenu.style.right = 'auto';
      }
    });

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
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    let left = x;
    let top = y;

    if (x + 220 > screenW) {
      left = screenW - 230;
    }
    if (y + 350 > screenH) {
      top = Math.max(10, screenH - 360);
    }

    this.menu.style.left = `${Math.max(10, left)}px`;
    this.menu.style.top = `${Math.max(10, top)}px`;
  }

  /* Metadata Specs Modal Sheet */
  showTrackInfo(trackIdOrObj) {
    const track = this.resolveTrack(trackIdOrObj);
    if (!track) return;

    const grid = document.getElementById('track-info-specs-grid');
    if (!grid) return;

    const formatBytes = (bytes) => {
      if (!bytes) return 'N/A';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const isOnline = track.is_online || !track.path;

    const specs = [
      { label: 'Title', value: track.title || 'Unknown' },
      { label: 'Artist', value: track.artist || 'Unknown' },
      { label: 'Album', value: track.album || (isOnline ? 'Online Stream' : 'Unknown') },
      { label: 'Album Artist', value: track.album_artist || track.artist || 'Unknown' },
      { label: 'Year', value: track.year || 'N/A' },
      { label: 'Genre', value: track.genre || (isOnline ? 'Online' : 'Unknown') },
      { label: 'Track Number', value: track.track_number || 'N/A' },
      { label: 'Duration', value: track.duration_fmt || 'N/A' },
      { label: 'Bitrate', value: track.bitrate ? `${track.bitrate} kbps` : (isOnline ? 'HQ Variable' : 'N/A') },
      { label: 'Sample Rate', value: track.sample_rate ? `${track.sample_rate} Hz` : 'N/A' },
      { label: 'Audio Format', value: track.codec || (isOnline ? 'YouTube Audio' : 'MP3') },
      { label: 'File Size', value: formatBytes(track.file_size) },
      { label: 'Location', value: isOnline ? (track.webpage_url || track.url || 'YouTube CDN') : track.path }
    ];

    grid.innerHTML = specs.map(s => `
      <div class="track-info-item">
        <span class="track-info-label">${s.label}</span>
        <span class="track-info-value" style="word-break: break-all;">${s.value}</span>
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
