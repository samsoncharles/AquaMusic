// AquaMusic SPA Page View Renderers (Albums, Artists, Genres, Folders, Playlists, Queue)
class ViewsManager {
  constructor() {
    this.downloadTasks = new Map();
    this.showDownloadsDrawer = true;
    this.cachedDownloads = [];
    this.currentOnlineTab = 'search';
    this.lastOnlineQuery = '';
    this.lastOnlineResults = null;
  }

  getActiveDownloadTasks() {
    return Array.from(this.downloadTasks.values()).filter(
      t => t.status === 'downloading' || t.status === 'starting' || t.status === 'converting'
    );
  }

  updateDownloadIndicators() {
    const activeTasks = this.getActiveDownloadTasks();
    const activeCount = activeTasks.length;

    // 1. Pulsing red dot on sidebar "YouTube Stream" nav item
    const navOnline = document.getElementById('nav-item-online');
    if (navOnline) {
      let dot = navOnline.querySelector('.download-red-dot');
      if (activeCount > 0) {
        if (!dot) {
          dot = document.createElement('span');
          dot.className = 'download-red-dot';
          dot.id = 'online-nav-red-dot';
          navOnline.appendChild(dot);
        }
        dot.title = `${activeCount} active download${activeCount !== 1 ? 's' : ''}`;
      } else if (dot) {
        dot.remove();
      }
    }

    // 2. Pulsing red dot on "Safe Folder Downloads" subtab button
    const tabDownloads = document.getElementById('tab-btn-online-downloads');
    if (tabDownloads) {
      let dot = tabDownloads.querySelector('.download-red-dot');
      if (activeCount > 0) {
        if (!dot) {
          dot = document.createElement('span');
          dot.className = 'download-red-dot';
          dot.id = 'tab-downloads-red-dot';
          dot.style.marginLeft = '6px';
          tabDownloads.appendChild(dot);
        }
      } else if (dot) {
        dot.remove();
      }
    }
  }

  async isDownloaded(videoId) {
    if (!videoId) return false;
    if (this.cachedDownloads && this.cachedDownloads.some(t => String(t.id) === String(videoId) || t.youtube_id === videoId)) {
      return true;
    }
    try {
      const res = await window.api.getDownloads();
      this.cachedDownloads = res.downloads || [];
      return this.cachedDownloads.some(t => String(t.id) === String(videoId) || t.youtube_id === videoId);
    } catch (_) {
      return false;
    }
  }

  updateDownloadsDrawerUI() {
    const dBar = document.getElementById('online-downloads-bar');
    if (!dBar) return;

    const activeTasks = this.getActiveDownloadTasks();
    const allTasks = Array.from(this.downloadTasks.values());

    if (allTasks.length === 0) {
      dBar.style.display = 'none';
      return;
    }

    dBar.style.display = 'flex';

    const titleEl = document.getElementById('download-progress-title');
    if (titleEl) {
      titleEl.textContent = activeTasks.length > 0
        ? `Downloading Audio (${activeTasks.length} active)`
        : `Downloads Finished (${allTasks.length})`;
    }

    const drawerItems = document.getElementById('download-drawer-items');
    if (drawerItems) {
      drawerItems.style.display = this.showDownloadsDrawer ? 'flex' : 'none';
      drawerItems.innerHTML = allTasks.map(t => `
        <div style="display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; background: var(--bg-surface-1); border-radius: 8px; border: 1px solid var(--border);">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
            <span style="font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 70%;" title="${t.track.title}">${t.track.title}</span>
            <span style="font-size: 0.78rem; font-weight: 700; color: ${t.status === 'completed' ? '#10b981' : (t.status === 'failed' ? 'var(--danger)' : 'var(--accent)')};">
              ${t.status === 'completed' ? '✓ Saved' : (t.status === 'failed' ? 'Failed' : (t.status === 'converting' ? 'Converting...' : `${t.percent}%`))}
            </span>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
            ${t.verboseLabel || (t.status === 'completed' ? '✓ Saved to Safe Folder' : 'Processing download...')}
          </div>
          <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
            <div style="width: ${t.percent}%; height: 100%; background: ${t.status === 'completed' ? '#10b981' : (t.status === 'failed' ? 'var(--danger)' : 'var(--accent)')}; transition: width 0.3s ease;"></div>
          </div>
        </div>
      `).join('');
    }

    const toggleBtn = document.getElementById('btn-toggle-dl-drawer');
    if (toggleBtn) {
      toggleBtn.textContent = this.showDownloadsDrawer ? 'Hide Progress' : 'Show Progress';
    }
  }

  /* ----------------------------------------------------
     1. ALBUMS GRID VIEW
     ---------------------------------------------------- */
  renderAlbums() {
    const container = document.getElementById('content-area');
    if (!container || !window.library) return;

    // Group songs by album
    const albums = {};
    Object.values(window.library.tracks).forEach(track => {
      const key = `${track.artist} - ${track.album}`;
      if (!albums[key]) {
        albums[key] = {
          name: track.album,
          artist: track.artist,
          year: track.year || '',
          trackCount: 0,
          sampleTrackId: track.id
        };
      }
      albums[key].trackCount++;
    });

    const albumList = Object.values(albums).sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div class="library-header-actions">
        <h2>Albums Grid</h2>
        <p style="color:var(--text-secondary); font-size:0.85rem;">${albumList.length} unique albums in library</p>
      </div>
      <div class="albums-grid-view" id="albums-grid-container"></div>
    `;

    const grid = document.getElementById('albums-grid-container');
    
    if (albumList.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No Albums Found</h3><p>Start scanning folders containing music files.</p></div>';
      return;
    }

    albumList.forEach(album => {
      const card = document.createElement('div');
      card.className = 'album-card';
      card.innerHTML = `
        <img class="album-card-art" src="/api/art/${album.sampleTrackId}" alt="Album Art" loading="lazy">
        <div class="album-card-title" title="${album.name}">${album.name}</div>
        <div class="album-card-artist" title="${album.artist}">${album.artist}</div>
        <div class="album-card-info">
          <span>${album.trackCount} track${album.trackCount > 1 ? 's' : ''}</span>
          <span>${album.year}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        // Switch to songs list pre-filtered by this album
        window.library.sortKeys = [];
        window.library.searchQuery = '';
        window.library.clearAdvancedFilters();
        
        // Filter visible list manually
        window.library.visibleTracksList = Object.values(window.library.tracks).filter(t => 
          t.album === album.name && t.artist === album.artist
        );
        
        window.library.renderSongsView();
        
        // Update header subtitle
        const sub = document.getElementById('library-track-count-subtitle');
        if (sub) sub.innerText = `Album: ${album.name} (${album.trackCount} tracks)`;
      });

      grid.appendChild(card);
    });
  }

  /* ----------------------------------------------------
     2. ARTISTS TWO-COLUMN SPLIT-PANEL VIEW
     ---------------------------------------------------- */
  renderArtists() {
    const container = document.getElementById('content-area');
    if (!container || !window.library) return;

    // Group songs by artist
    const artistsMap = {};
    Object.values(window.library.tracks).forEach(track => {
      const name = track.artist || 'Unknown Artist';
      if (!artistsMap[name]) {
        artistsMap[name] = [];
      }
      artistsMap[name].push(track);
    });

    const artistsList = Object.keys(artistsMap).sort((a, b) => a.localeCompare(b));

    container.innerHTML = `
      <div class="artists-split-view">
        <div class="artists-sidebar-nav">
          <div class="artist-nav-index" id="artist-alphabet-jump"></div>
          <div class="artist-nav-list" id="artist-list-container"></div>
        </div>
        <div class="artist-detail-pane" id="artist-detail-container">
          <div class="empty-state" style="height:100%;">
            <i data-lucide="users"></i>
            <h3>Select an Artist</h3>
            <p>Browse discographies and full track listings.</p>
          </div>
        </div>
      </div>
    `;

    // Render A-Z Jump Links
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
    const jumpBand = document.getElementById('artist-alphabet-jump');
    
    alphabet.forEach(letter => {
      const span = document.createElement('span');
      span.className = 'artist-index-letter';
      span.innerText = letter;
      
      span.addEventListener('click', () => {
        const firstMatch = artistsList.find(name => {
          if (letter === '#') return /^\d/.test(name);
          return name.toUpperCase().startsWith(letter);
        });
        
        if (firstMatch) {
          const matchEl = document.querySelector(`[data-artist-name="${CSS.escape(firstMatch)}"]`);
          if (matchEl) {
            matchEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            matchEl.click();
          }
        }
      });
      jumpBand.appendChild(span);
    });

    // Render Artist list items
    const listContainer = document.getElementById('artist-list-container');
    artistsList.forEach(artName => {
      const item = document.createElement('div');
      item.className = 'artist-nav-item';
      item.innerText = artName;
      item.dataset.artistName = artName;

      item.addEventListener('click', () => {
        document.querySelectorAll('.artist-nav-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        this.renderArtistDetails(artName, artistsMap[artName]);
      });

      listContainer.appendChild(item);
    });

    if (window.lucide) {
      window.lucide.createIcons({ container: container });
    }
  }

  renderArtistDetails(artistName, artistTracks) {
    const pane = document.getElementById('artist-detail-container');
    if (!pane) return;

    // Find a representative track for cover banner
    const sampleTrack = artistTracks[0];

    // Group artist tracks by Album
    const albums = {};
    artistTracks.forEach(t => {
      if (!albums[t.album]) {
        albums[t.album] = {
          name: t.album,
          year: t.year || '',
          sampleTrackId: t.id,
          tracks: []
        };
      }
      albums[t.album].tracks.push(t);
    });

    // Sort albums chronologically
    const albumList = Object.values(albums).sort((a, b) => b.year.localeCompare(a.year));

    pane.innerHTML = `
      <div class="artist-hero-banner" style="background-image: url('/api/art/${sampleTrack.id}')">
        <div class="artist-hero-overlay"></div>
        <div class="artist-hero-content">
          <h2>${artistName}</h2>
          <p>${artistTracks.length} song${artistTracks.length !== 1 ? 's' : ''} in library</p>
        </div>
      </div>
      
      <div style="padding: 24px;">
        <h3 style="margin-bottom:16px; font-family:var(--font-display);">Albums</h3>
        <div class="albums-grid-view" id="artist-albums-grid"></div>
      </div>
    `;

    const grid = document.getElementById('artist-albums-grid');
    albumList.forEach(album => {
      const card = document.createElement('div');
      card.className = 'album-card';
      card.innerHTML = `
        <img class="album-card-art" src="/api/art/${album.sampleTrackId}" alt="Album Cover">
        <div class="album-card-title">${album.name}</div>
        <div class="album-card-artist">${album.tracks.length} track${album.tracks.length > 1 ? 's' : ''}</div>
        <div class="album-card-info">
          <span>${album.year}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        // Show songs list pre-filtered by this album
        window.library.sortKeys = [];
        window.library.searchQuery = '';
        window.library.clearAdvancedFilters();
        window.library.visibleTracksList = album.tracks;
        
        window.library.renderSongsView();
        
        const sub = document.getElementById('library-track-count-subtitle');
        if (sub) sub.innerText = `Artist: ${artistName} • Album: ${album.name}`;
      });

      grid.appendChild(card);
    });
  }

  /* ----------------------------------------------------
     3. GENRES 2X2 COLLAGE VIEW
     ---------------------------------------------------- */
  renderGenres() {
    const container = document.getElementById('content-area');
    if (!container || !window.library) return;

    // Group songs by genre
    const genresMap = {};
    Object.values(window.library.tracks).forEach(track => {
      const name = track.genre || 'Unknown Genre';
      if (!genresMap[name]) {
        genresMap[name] = [];
      }
      genresMap[name].push(track);
    });

    const genresList = Object.keys(genresMap).sort((a, b) => a.localeCompare(b));

    container.innerHTML = `
      <div class="library-header-actions">
        <h2>Genres</h2>
        <p style="color:var(--text-secondary); font-size:0.85rem;">${genresList.length} unique genres found</p>
      </div>
      <div class="genres-grid-view" id="genres-grid-container"></div>
    `;

    const grid = document.getElementById('genres-grid-container');

    genresList.forEach(genre => {
      // Find up to 4 unique track IDs to build a 2x2 collage
      const collageTracks = [];
      const seenAlbums = new Set();
      
      genresMap[genre].forEach(t => {
        if (collageTracks.length < 4 && !seenAlbums.has(t.album)) {
          collageTracks.push(t);
          seenAlbums.add(t.album);
        }
      });

      // Fill in remaining with same track if not enough albums
      while (collageTracks.length < 4 && genresMap[genre].length > collageTracks.length) {
        collageTracks.push(genresMap[genre][collageTracks.length]);
      }

      const card = document.createElement('div');
      card.className = 'genre-card';
      
      // Render collage grid images
      let collageHtml = '<div class="genre-collage">';
      for (let i = 0; i < 4; i++) {
        const track = collageTracks[i];
        if (track) {
          collageHtml += `<img src="/api/art/${track.id}" alt="Art Grid" loading="lazy">`;
        } else {
          collageHtml += `<div style="background-color:var(--bg-surface-3);"></div>`;
        }
      }
      collageHtml += '</div>';

      card.innerHTML = `
        ${collageHtml}
        <div class="genre-title">${genre}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">${genresMap[genre].length} songs</div>
      `;

      card.addEventListener('click', () => {
        window.library.sortKeys = [];
        window.library.searchQuery = '';
        window.library.clearAdvancedFilters();
        window.library.visibleTracksList = genresMap[genre];
        
        window.library.renderSongsView();
        
        const sub = document.getElementById('library-track-count-subtitle');
        if (sub) sub.innerText = `Genre: ${genre} (${genresMap[genre].length} songs)`;
      });

      grid.appendChild(card);
    });
  }

  /* ----------------------------------------------------
     4. FOLDERS EXPLORER TREE VIEW (Spotify/Musicolet-style)
     ---------------------------------------------------- */
  async renderFolders(dirPath = '') {
    const container = document.getElementById('content-area');
    if (!container) return;

    container.innerHTML = '<div class="empty-state"><div class="loader"></div><span>Exploring folder structure...</span></div>';

    try {
      const data = await window.api.getFolders(dirPath);
      
      // Calculate tracks in current directory with normalized path separator checks
      const allTracks = Object.values(window.library.tracks);
      const normalizePath = (p) => {
        if (!p) return '';
        return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      };
      const normalizedCurrentPath = normalizePath(data.current_path);

      const currentFolderTracks = allTracks.filter(t => {
        const lastSepIdx = Math.max(t.path.lastIndexOf('/'), t.path.lastIndexOf('\\'));
        if (lastSepIdx === -1) return false;
        const parent = t.path.substring(0, lastSepIdx);
        return normalizePath(parent) === normalizedCurrentPath;
      });

      // Split directories into path segments for breadcrumbs navigation
      const separator = window.mainApp.pathSeparator;
      const segments = data.current_path.split(separator).filter(Boolean);
      let cumulativePath = window.mainApp.isWindows ? '' : '';

      let breadcrumbsHtml = `<span class="folder-path-node" data-path="/">Root</span>`;
      segments.forEach((seg, idx) => {
        cumulativePath += (idx === 0 && window.mainApp.isWindows) ? seg : (separator + seg);
        breadcrumbsHtml += ` <span style="color:var(--text-muted);">/</span> <span class="folder-path-node" data-path="${cumulativePath}">${seg}</span>`;
      });

      container.innerHTML = `
        <div class="folders-view-container">
          <div class="library-header-actions" style="padding:0 0 16px 0;">
            <h2>Folders Browse</h2>
            <p style="color:var(--text-secondary); font-size:0.85rem;">Browse scanned music files by directory tree</p>
          </div>

          <div class="folder-tree-path" id="folder-breadcrumbs">
            ${breadcrumbsHtml}
          </div>

          <div class="folder-node-list" id="folder-list-nodes">
            <!-- Back navigation node -->
            ${data.parent_path ? `
              <div class="folder-node-row folder-parent-trigger" data-path="${data.parent_path}">
                <div class="folder-node-info">
                  <i data-lucide="corner-left-up"></i>
                  <span class="folder-node-name">.. (Parent Directory)</span>
                </div>
              </div>
            ` : ''}

            <!-- Subdirectories list -->
            ${data.folders.map(f => `
              <div class="folder-node-row folder-node-trigger" data-path="${f.path}">
                <div class="folder-node-info">
                  <i data-lucide="folder"></i>
                  <span class="folder-node-name" title="${f.name}">${f.name}</span>
                </div>
                <div style="font-size:0.75rem; color:var(--text-muted);">Folder</div>
              </div>
            `).join('')}

            <!-- Direct Audios childs list Play button -->
            ${currentFolderTracks.length > 0 ? `
              <div class="folder-node-row folder-songs-trigger" style="border-color:var(--accent-dim); background-color:var(--accent-dim); margin-bottom:12px;">
                <div class="folder-node-info">
                  <i data-lucide="play-circle" style="color:var(--accent);"></i>
                  <span class="folder-node-name" style="color:var(--accent-text); font-weight:600;">Play All ${currentFolderTracks.length} Songs</span>
                </div>
                <div style="font-size:0.75rem; color:var(--accent-text); font-weight:600;">Audio Folder</div>
              </div>
            ` : ''}
          </div>

          <!-- Individual Songs List Table inside the Folder view -->
          ${currentFolderTracks.length > 0 ? `
            <div style="margin-top: 24px;">
              <h3 style="margin-bottom: 12px; font-family: var(--font-display);">Songs in this Folder</h3>
              <div class="song-table-container" style="padding: 0; overflow: visible;">
                <div class="song-table-header" style="grid-template-columns: 48px minmax(200px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 80px; position: relative;">
                  <div>#</div>
                  <div>Title</div>
                  <div>Artist</div>
                  <div>Album</div>
                  <div>Duration</div>
                </div>
                <div class="folder-songs-table-body">
                  ${currentFolderTracks.map((track, idx) => `
                    <div class="song-row" data-id="${track.id}" style="grid-template-columns: 48px minmax(200px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 80px;">
                      <div class="song-thumbnail-wrapper">
                        <img src="/api/art/${track.id}" alt="art" loading="lazy">
                        <div class="song-play-overlay" data-track-id="${track.id}"><i data-lucide="play"></i></div>
                      </div>
                      <div class="song-title-cell" title="${track.title}">${track.title}</div>
                      <div class="song-text-cell" title="${track.artist}">${track.artist}</div>
                      <div class="song-text-cell" title="${track.album}">${track.album}</div>
                      <div class="song-text-cell">${track.duration_fmt}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      `;

      if (window.lucide) {
        window.lucide.createIcons({ container: container });
      }

      // Bind click triggers for folders
      container.querySelectorAll('.folder-path-node, .folder-parent-trigger, .folder-node-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.renderFolders(btn.dataset.path);
        });
      });

      // Bind individual song rows click triggers in folders view
      container.querySelectorAll('.folder-songs-table-body .song-row').forEach((row, idx) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.song-play-overlay')) return;
          if (window.playlists && window.player) {
            window.playlists.setQueue(currentFolderTracks, idx);
            window.player.playTrack(row.dataset.id, true);
          }
        });

        const overlayPlay = row.querySelector('.song-play-overlay');
        if (overlayPlay) {
          overlayPlay.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.playlists && window.player) {
              window.playlists.setQueue(currentFolderTracks, idx);
              window.player.playTrack(row.dataset.id, true);
            }
          });
        }

        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const playCallback = () => {
            if (window.playlists && window.player) {
              window.playlists.setQueue(files, index);
              window.player.playTrack(row.dataset.id, true);
            }
          };
          if (window.contextMenu) {
            window.contextMenu.showForTrack(e.clientX, e.clientY, row.dataset.id, playCallback);
          }
        });
      });

      // Play folder song lists
      const playFolderBtn = container.querySelector('.folder-songs-trigger');
      if (playFolderBtn) {
        playFolderBtn.addEventListener('click', () => {
          if (window.playlists && window.player) {
            window.playlists.setQueue(currentFolderTracks, 0);
            window.player.playTrack(currentFolderTracks[0].id, true);
          }
        });
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3>Failed to Load Directory</h3><p>${err.message || err}</p></div>`;
    }
  }

  /* ----------------------------------------------------
     5. USER PLAYLISTS VIEWS
     ---------------------------------------------------- */
  renderPlaylistView(playlistId) {
    const container = document.getElementById('content-area');
    if (!container || !window.playlists || !window.library) return;

    const pl = window.playlists.playlists.find(p => p.id === playlistId);
    if (!pl) return;

    // Update document title to reflect active playlist
    document.title = `${pl.name} - AquaMusic`;

    // Load track metadata objects (supporting both local library and online saved tracks)
    const plTracks = pl.trackIds
      .map(id => (window.library && window.library.tracks && window.library.tracks[id]) || (window.onlineTracks && window.onlineTracks[id]))
      .filter(Boolean);

    // Pick a fresh set of tracks for the cover every time this playlist opens.
    // This only affects the artwork; playlist order and playback stay intact.
    const coverTracks = [...plTracks];
    for (let i = coverTracks.length - 1; i > 0; i--) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      [coverTracks[i], coverTracks[randomIndex]] = [coverTracks[randomIndex], coverTracks[i]];
    }

    // Build modern mosaic collage - single large art with gradient overlay
    const heroTrack = coverTracks[0];
    const heroArt = heroTrack ? `/api/art/${heroTrack.id}` : '/api/art/default';
    
    let collageHtml = `
      <div class="playlist-hero-collage">
        <img class="playlist-hero-main" src="${heroArt}" alt="Playlist Cover">
        <div class="playlist-hero-stack">`;
    
    for (let i = 1; i < Math.min(4, coverTracks.length); i++) {
      collageHtml += `<img class="playlist-hero-mini" src="/api/art/${coverTracks[i].id}" alt="track art" style="z-index: ${4 - i}; transform: translateX(${(i - 1) * -8}px);">`;
    }
    
    collageHtml += `</div></div>`;

    container.innerHTML = `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column;">
        <div class="library-header-actions playlist-sticky-header" style="display:flex; flex-direction:row; align-items:center; gap:24px; text-align:left; padding: 24px; flex-shrink: 0;">
          ${collageHtml}
          <div style="flex:1;">
            <h2 style="font-size: 1.8rem; font-weight: 800; letter-spacing: -0.02em;">${pl.name}</h2>
            <p style="color:var(--text-secondary); font-size:0.85rem; margin-top:6px;">Playlist • ${plTracks.length} song${plTracks.length !== 1 ? 's' : ''}</p>
            
            <div style="display:flex; gap:10px; margin-top:16px; align-items:center;">
              <button id="btn-playlist-play-all" style="background: var(--text-primary); color: var(--bg-base); border: none; padding: 10px 24px; border-radius: 24px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;"><i data-lucide="play" style="width:16px;height:16px;"></i> Play</button>
              <button id="btn-playlist-shuffle-all" style="background: transparent; color: var(--text-primary); border: 1px solid var(--border-strong); padding: 10px 24px; border-radius: 24px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;"><i data-lucide="shuffle" style="width:16px;height:16px;"></i> Shuffle</button>
              <button class="btn-filter-toggle" id="btn-playlist-export-m3u" title="Export M3U" style="border-radius: 20px; padding: 8px 16px;"><i data-lucide="download" style="width:14px;height:14px;"></i> M3U</button>
              <button class="btn-filter-toggle" id="btn-playlist-delete" style="border-color:var(--danger); color:var(--danger); border-radius: 20px; padding: 8px 16px;"><i data-lucide="trash-2" style="width:14px;height:14px;"></i> Delete</button>
            </div>
          </div>
        </div>

        <!-- Songs list (Scrollable remaining area) -->
        <div style="flex: 1; overflow-y: auto; overflow-x: hidden;">
          <div class="song-table-container" style="overflow: visible; padding-bottom: 24px;">
            <div class="song-table-header" style="grid-template-columns: 48px minmax(200px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 80px; position: sticky; top: 0; z-index: 10;">
              <div>#</div>
              <div>Title</div>
              <div>Artist</div>
              <div>Album</div>
              <div>Duration</div>
            </div>
            <div id="playlist-content-table" style="width: 100%;"></div>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) {
      window.lucide.createIcons({ container: container });
    }

    // Play action
    const btnPlay = document.getElementById('btn-playlist-play-all');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        if (plTracks.length > 0 && window.playlists && window.player) {
          window.playlists.setQueue(plTracks, 0);
          window.player.playTrack(plTracks[0].id, true);
        } else {
          window.toast.show("No songs in playlist.", "warning");
        }
      });
    }

    // Shuffle play action
    const btnShuffle = document.getElementById('btn-playlist-shuffle-all');
    if (btnShuffle) {
      btnShuffle.addEventListener('click', () => {
        if (plTracks.length > 0 && window.playlists && window.player) {
          const randomIdx = Math.floor(Math.random() * plTracks.length);
          window.playlists.setQueue(plTracks, randomIdx);
          window.playlists.isShuffled = false; // Reset so toggleShuffle works
          window.playlists.toggleShuffle();
          const first = window.playlists.activeQueue[0];
          if (first) window.player.playTrack(first.id, true);
        } else {
          window.toast.show("No songs in playlist.", "warning");
        }
      });
    }

    // Delete Playlist
    const btnDel = document.getElementById('btn-playlist-delete');
    if (btnDel) {
      btnDel.addEventListener('click', () => {
        window.playlists.deletePlaylist(playlistId);
      });
    }

    // Export M3U
    const btnExp = document.getElementById('btn-playlist-export-m3u');
    if (btnExp) {
      btnExp.addEventListener('click', () => {
        window.playlists.exportM3U(pl.trackIds);
      });
    }

    // Render Table rows
    const tblBody = document.getElementById('playlist-content-table');
    if (tblBody) {
      // Direct render (no virtualization needed for typically shorter user playlists, but stays fast)
      plTracks.forEach((track, index) => {
        const row = document.createElement('div');
        row.className = 'song-row';
        row.dataset.id = track.id;
        row.setAttribute('draggable', 'true');
        row.style.gridTemplateColumns = '48px minmax(200px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 80px';
        row.style.position = 'relative';
        
        row.innerHTML = `
          <div class="song-thumbnail-wrapper">
            <img src="/api/art/${track.id}" alt="art" loading="lazy">
            <div class="song-play-overlay"><i data-lucide="play"></i></div>
          </div>
          <div class="song-title-cell">${track.title}</div>
          <div class="song-text-cell">${track.artist}</div>
          <div class="song-text-cell">${track.album}</div>
          <div class="song-text-cell">${track.duration_fmt}</div>
        `;

        // Row single-click plays
        row.addEventListener('click', (e) => {
          if (e.target.closest('.song-play-overlay')) return;
          if (window.playlists && window.player) {
            window.playlists.setQueue(plTracks, index);
            window.player.playTrack(track.id, true);
          }
        });

        // Reorder this playlist by dropping a song onto the song it should precede.
        row.addEventListener('dragstart', event => {
          event.dataTransfer.setData('text/plain', track.id);
          event.dataTransfer.effectAllowed = 'move';
          row.style.opacity = '0.5';
        });
        row.addEventListener('dragend', () => {
          row.style.opacity = '1';
          row.classList.remove('drag-over');
        });
        row.addEventListener('dragover', event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', event => {
          event.preventDefault();
          row.classList.remove('drag-over');
          const draggedTrackId = event.dataTransfer.getData('text/plain');
          if (draggedTrackId && window.playlists) {
            window.playlists.moveTrackInPlaylist(pl.id, draggedTrackId, track.id);
            window.mainApp.switchView(`playlist-${pl.id}`);
          }
        });

        // Context Menu
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const playCallback = () => {
            if (window.playlists && window.player) {
              window.playlists.setQueue(plTracks, index);
              window.player.playTrack(track.id, true);
            }
          };
          if (window.contextMenu) window.contextMenu.showForTrack(e.clientX, e.clientY, track.id, playCallback, pl.id);
        });

        tblBody.appendChild(row);
      });

      if (window.lucide) window.lucide.createIcons({ container: tblBody });
    }
  }

  /* ----------------------------------------------------
     6. ACTIVE QUEUE PANEL VIEW
     ---------------------------------------------------- */
  renderQueueView() {
    const container = document.getElementById('content-area');
    if (!container || !window.playlists) return;

    const queue = window.playlists.activeQueue;
    const currentIdx = window.playlists.activeQueueIndex;

    container.innerHTML = `
      <div class="library-header-actions" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2>Playback Queue</h2>
          <p style="color:var(--text-secondary); font-size:0.85rem; margin-top:4px;">${queue.length} songs in queue</p>
        </div>
        <button class="btn-filter-toggle" id="btn-clear-queue-list" style="border-color:var(--danger); color:var(--danger);"><i data-lucide="x-circle"></i> Clear Queue</button>
      </div>

      <!-- Songs list -->
      <div class="song-table-container" style="padding-top:10px;">
        <h4 style="margin: 10px 0; color:var(--text-primary); font-family:var(--font-display);">Now Playing</h4>
        <div id="queue-now-playing-row">
          <!-- Active song injected here -->
        </div>

        <h4 style="margin: 20px 0 10px 0; color:var(--text-primary); font-family:var(--font-display);">Next Up</h4>
        <div class="folder-node-list" id="queue-next-up-list">
          <!-- Next songs list -->
        </div>
      </div>
    `;

    if (window.lucide) {
      window.lucide.createIcons({ container: container });
    }

    // Bind Clear Queue
    const btnClear = document.getElementById('btn-clear-queue-list');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        window.playlists.clearQueue();
      });
    }

    // Render active playing track row
    const nowPlayingRowBox = document.getElementById('queue-now-playing-row');
    const currentTrack = window.playlists.getCurrentTrack();
    if (currentTrack && nowPlayingRowBox) {
      const row = document.createElement('div');
      row.className = 'song-row active-playing';
      row.dataset.id = currentTrack.id;
      row.style.gridTemplateColumns = '48px minmax(200px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 80px';
      row.innerHTML = `
        <div class="song-thumbnail-wrapper">
          <img src="/api/art/${currentTrack.id}" alt="art">
          <div class="song-play-overlay" style="opacity:1;"><i data-lucide="volume-2" style="color:var(--accent);"></i></div>
        </div>
        <div class="song-title-cell">${currentTrack.title}</div>
        <div class="song-text-cell">${currentTrack.artist}</div>
        <div class="song-text-cell">${currentTrack.album}</div>
        <div class="song-text-cell">${currentTrack.duration_fmt}</div>
      `;
      nowPlayingRowBox.appendChild(row);
    } else if (nowPlayingRowBox) {
      nowPlayingRowBox.innerHTML = '<div style="font-size:0.85rem; color:var(--text-muted); padding:10px;">Queue is empty</div>';
    }

    // Render "Next Up" list (Module 11 next up rows)
    const nextList = document.getElementById('queue-next-up-list');
    if (nextList && queue.length > 0) {
      const nextUpTracks = queue.slice(currentIdx + 1);
      
      if (nextUpTracks.length === 0) {
        nextList.innerHTML = '<div style="font-size:0.85rem; color:var(--text-muted); padding:10px;">No tracks next up</div>';
        return;
      }

      nextUpTracks.forEach((track, offsetIndex) => {
        const queuePositionIndex = currentIdx + 1 + offsetIndex;
        const row = document.createElement('div');
        row.className = 'song-row';
        row.dataset.id = track.id;
        row.style.gridTemplateColumns = '48px minmax(200px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 80px';
        
        row.innerHTML = `
          <div class="song-thumbnail-wrapper">
            <img src="/api/art/${track.id}" alt="art" loading="lazy">
            <div class="song-play-overlay"><i data-lucide="play"></i></div>
          </div>
          <div class="song-title-cell">${track.title}</div>
          <div class="song-text-cell">${track.artist}</div>
          <div class="song-text-cell">${track.album}</div>
          <div class="song-text-cell">${track.duration_fmt}</div>
        `;

        row.addEventListener('click', (e) => {
          if (e.target.closest('.song-play-overlay')) return;
          if (window.player) {
            window.playlists.activeQueueIndex = queuePositionIndex;
            window.playlists.saveQueueState();
            window.player.playTrack(track.id, true);
          }
        });

        nextList.appendChild(row);
      });

      if (window.lucide) {
        window.lucide.createIcons({ container: nextList });
      }
    }
  }

  /* ----------------------------------------------------
     7. ONLINE YOUTUBE STREAMER & DOWNLOADER VIEW
     ---------------------------------------------------- */
  renderOnlineView() {
    const container = document.getElementById('content-area');
    if (!container) return;
    document.title = 'YouTube Music - AquaMusic';

    this.currentOnlineTab = this.currentOnlineTab || 'search';

    // Outer container with explicit 100% height and overflow-y: auto for smooth scrolling
    container.innerHTML = `
      <div class="online-view-container" style="height: 100%; overflow-y: auto; overflow-x: hidden; padding: 24px; max-width: 1300px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">
        <!-- Subtab Navigation -->
        <div class="online-subtabs" style="display: flex; gap: 10px; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 14px;">
          <button class="btn-filter-toggle ${this.currentOnlineTab !== 'downloads' ? 'active' : ''}" id="tab-btn-online-search" style="border-radius: 20px; padding: 8px 18px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <i data-lucide="search" style="width: 15px; height: 15px;"></i>
            <span>Search & Stream</span>
          </button>
          <button class="btn-filter-toggle ${this.currentOnlineTab === 'downloads' ? 'active' : ''}" id="tab-btn-online-downloads" style="border-radius: 20px; padding: 8px 18px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <i data-lucide="download" style="width: 15px; height: 15px;"></i>
            <span>Safe Folder Downloads</span>
            <span id="downloads-badge" style="background: var(--accent); color: #fff; font-size: 0.72rem; padding: 2px 7px; border-radius: 10px; font-weight: 700; margin-left: 4px; display: none;">0</span>
          </button>
        </div>

        <div id="online-tab-content" style="display: flex; flex-direction: column; gap: 20px;"></div>
      </div>
    `;

    if (window.lucide) {
      window.lucide.createIcons({ container: container });
    }

    // Refresh red dot indicators
    this.updateDownloadIndicators();

    // Bind subtab buttons
    const btnTabSearch = document.getElementById('tab-btn-online-search');
    const btnTabDownloads = document.getElementById('tab-btn-online-downloads');
    if (btnTabSearch) {
      btnTabSearch.addEventListener('click', () => {
        if (this.currentOnlineTab !== 'search') {
          this.currentOnlineTab = 'search';
          this.renderOnlineView();
        }
      });
    }
    if (btnTabDownloads) {
      btnTabDownloads.addEventListener('click', () => {
        if (this.currentOnlineTab !== 'downloads') {
          this.currentOnlineTab = 'downloads';
          this.renderOnlineView();
        }
      });
    }

    // Pre-fetch download badge count
    window.api.getDownloads().then(res => {
      const downloads = res.downloads || [];
      this.cachedDownloads = downloads;
      const badge = document.getElementById('downloads-badge');
      if (badge && downloads.length > 0) {
        badge.textContent = downloads.length;
        badge.style.display = 'inline-block';
      }
    }).catch(() => {});

    // Render active tab
    if (this.currentOnlineTab === 'downloads') {
      this.renderOnlineDownloads();
    } else {
      this.renderOnlineSearchTab();
    }
  }

  renderOnlineSearchTab() {
    const tabContent = document.getElementById('online-tab-content');
    if (!tabContent) return;

    const hasActiveTasks = this.getActiveDownloadTasks().length > 0;

    tabContent.innerHTML = `
      <div class="online-search-box" style="display: flex; gap: 12px; align-items: center; background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: 14px; padding: 8px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input type="text" id="online-search-input" style="flex: 1; background: transparent; border: none; outline: none; color: var(--text-primary); font-size: 1rem; font-family: inherit;" placeholder="Real-time search: type artist, song, or paste YouTube playlist URL..." value="${this.lastOnlineQuery || ''}">
        <button id="btn-clear-online-search" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: ${this.lastOnlineQuery ? 'block' : 'none'}; padding: 4px;" title="Clear search"><i data-lucide="x" style="width: 16px; height: 16px;"></i></button>
        <button id="btn-trigger-online-search" class="btn-primary" style="padding: 8px 22px; font-weight: 600; display: flex; align-items: center; gap: 6px; border-radius: 20px; flex-shrink: 0;">Search</button>
      </div>

      <!-- Collapsible Multi-Download Progress Drawer with Show / Hide Toggle -->
      <div id="online-downloads-bar" style="${hasActiveTasks ? 'display: flex;' : 'display: none;'} background: rgba(124, 106, 247, 0.08); border: 1px solid rgba(124, 106, 247, 0.25); border-radius: 12px; padding: 12px 16px; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--accent); font-weight: 600;">
            <i data-lucide="download" style="width: 16px; height: 16px;"></i>
            <span id="download-progress-title">Downloads in Progress</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="btn-toggle-dl-drawer" class="btn-filter-toggle" style="border-radius: 14px; padding: 4px 12px; font-size: 0.78rem; font-weight: 600; cursor: pointer;">
              ${this.showDownloadsDrawer ? 'Hide Details' : 'Show Details'}
            </button>
          </div>
        </div>
        <div id="download-drawer-items" style="${this.showDownloadsDrawer ? 'display: flex;' : 'display: none;'} flex-direction: column; gap: 8px;">
          <!-- Dynamically filled by updateDownloadsDrawerUI() -->
        </div>
      </div>

      <div id="online-results-container"></div>
    `;

    if (window.lucide) {
      window.lucide.createIcons({ container: tabContent });
    }

    // Toggle download drawer button
    const toggleDrawerBtn = document.getElementById('btn-toggle-dl-drawer');
    if (toggleDrawerBtn) {
      toggleDrawerBtn.addEventListener('click', () => {
        this.showDownloadsDrawer = !this.showDownloadsDrawer;
        this.updateDownloadsDrawerUI();
      });
    }

    this.updateDownloadsDrawerUI();

    const searchInput = document.getElementById('online-search-input');
    const searchBtn = document.getElementById('btn-trigger-online-search');
    const clearBtn = document.getElementById('btn-clear-online-search');

    // Real-time search debouncing (380ms)
    let debounceTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim();
        if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
        clearTimeout(debounceTimer);
        if (val.length >= 2) {
          debounceTimer = setTimeout(() => {
            this.triggerOnlineSearch(val);
          }, 380);
        } else if (val.length === 0) {
          this.lastOnlineResults = null;
          this.lastOnlineQuery = '';
          this.renderOnlineInitialState();
        }
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(debounceTimer);
          this.triggerOnlineSearch(searchInput.value.trim());
        }
      });
    }

    if (clearBtn && searchInput) {
      clearBtn.addEventListener('click', () => {
        clearTimeout(debounceTimer);
        searchInput.value = '';
        clearBtn.style.display = 'none';
        this.lastOnlineResults = null;
        this.lastOnlineQuery = '';
        this.renderOnlineInitialState();
        searchInput.focus();
      });
    }

    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => {
        clearTimeout(debounceTimer);
        this.triggerOnlineSearch(searchInput.value.trim());
      });
    }

    if (this.lastOnlineResults) {
      this.renderOnlineResults(this.lastOnlineResults);
    } else {
      this.renderOnlineInitialState();
    }
  }

  renderOnlineInitialState() {
    const resultsContainer = document.getElementById('online-results-container');
    if (!resultsContainer) return;
    resultsContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 70px 20px; text-align: center; color: var(--text-muted); gap: 14px;">
        <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--bg-surface-2); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border);">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent);">
            <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" fill="currentColor" fill-opacity="0.15"/>
            <polygon points="9.5 15.2 15 12 9.5 8.8" fill="currentColor"/>
            <path d="M17.8 9.2a3.8 3.8 0 0 1 0 5.6" stroke="currentColor" fill="none"/>
          </svg>
        </div>
        <h3 style="color: var(--text-primary); font-size: 1.2rem; font-weight: 700;">Stream YouTube Music Online</h3>
        <p style="font-size: 0.88rem; max-width: 480px; line-height: 1.6; color: var(--text-secondary);">Real-time search across YouTube Music. Drag songs into your playlists, stream with high quality, or save offline to your Safe Folder.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons({ container: resultsContainer });
  }

  async renderOnlineDownloads() {
    const tabContent = document.getElementById('online-tab-content');
    if (!tabContent) return;

    tabContent.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 14px;">
        <div class="loader"></div>
        <span style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 500;">Loading Safe Folder downloads...</span>
      </div>
    `;

    try {
      const data = await window.api.getDownloads();
      const downloads = data.downloads || [];
      this.cachedDownloads = downloads;

      const activeTasks = this.getActiveDownloadTasks();

      // Update badge
      const badge = document.getElementById('downloads-badge');
      if (badge) {
        badge.textContent = downloads.length;
        badge.style.display = downloads.length > 0 ? 'inline-block' : 'none';
      }

      if (downloads.length === 0 && activeTasks.length === 0) {
        tabContent.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 70px 20px; text-align: center; color: var(--text-muted); gap: 14px;">
            <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--bg-surface-2); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border);">
              <i data-lucide="download" style="width: 28px; height: 28px; color: var(--accent);"></i>
            </div>
            <h3 style="color: var(--text-primary); font-size: 1.2rem; font-weight: 700;">No Safe Folder Downloads Yet</h3>
            <p style="font-size: 0.88rem; max-width: 460px; line-height: 1.6; color: var(--text-secondary);">When you download any song from YouTube, it is saved securely into your Safe Folder (<code style="color:var(--accent);">${data.folder || '~/Music/AquaMusic'}</code>) and ready for offline listening.</p>
            <button class="btn-primary" onclick="window.views.currentOnlineTab='search'; window.views.renderOnlineView();" style="margin-top: 10px; border-radius: 20px; padding: 8px 22px;">Search Songs to Download</button>
          </div>
        `;
        if (window.lucide) window.lucide.createIcons({ container: tabContent });
        return;
      }

      // Register downloaded tracks into memory lookup
      window.onlineTracks = window.onlineTracks || {};
      downloads.forEach(t => { window.onlineTracks[t.id] = t; });

      const gridColumns = '48px minmax(220px, 3fr) minmax(140px, 2fr) minmax(120px, 1.5fr) 80px 90px 120px';
      const currentPlayingId = window.player?.currentTrack?.id;

      // In-progress downloads displayed at top of table (faded with progress underneath)
      const inProgressHtml = activeTasks.map(task => {
        return `
          <div class="song-row downloaded-song-row downloading-faded-row" 
               data-id="${task.id}" 
               id="downloading-row-${task.id}"
               style="grid-template-columns: ${gridColumns};">
            <div class="song-thumbnail-wrapper">
              <img class="song-row-art" src="${task.track.thumbnail || `/api/art/${task.id}`}" onerror="this.src='/static/icons/default-art.svg'" alt="art" loading="lazy">
              <div class="song-play-overlay" style="opacity: 1 !important;">
                <div class="loader" style="width: 14px; height: 14px; border-width: 2px;"></div>
              </div>
            </div>
            <div class="song-title-cell" title="${task.track.title}">${task.track.title}</div>
            <div class="song-text-cell" title="${task.track.artist}">${task.track.artist}</div>
            <div class="song-text-cell" style="color: var(--accent); font-weight: 500;" id="dl-row-status-${task.id}">
              ${task.status === 'converting' ? 'Converting...' : 'Downloading...'}
            </div>
            <div class="song-text-cell" id="dl-row-pct-${task.id}" style="font-weight: 700; color: var(--accent);">${task.percent || 0}%</div>
            <div class="song-text-cell" style="color: var(--text-muted); font-size: 0.8rem;">Safe Folder</div>
            <div class="song-text-cell" style="text-align: right; color: var(--accent); font-size: 0.8rem; font-weight: 600;">In Progress</div>
            <div class="download-row-progress-container" id="dl-row-prog-${task.id}">
              <div class="download-row-progress-bar">
                <div class="download-row-progress-fill" id="dl-row-fill-${task.id}" style="width: ${task.percent || 0}%;"></div>
              </div>
            </div>
          </div>
        `;
      }).join('');

      const itemsHtml = downloads.map((track, idx) => {
        const isCurrent = currentPlayingId && String(currentPlayingId) === String(track.id);
        return `
          <div class="song-row downloaded-song-row ${isCurrent ? 'active-playing' : ''}" 
               data-id="${track.id}" 
               data-idx="${idx}" 
               draggable="true" 
               style="grid-template-columns: ${gridColumns};">
            <div class="song-thumbnail-wrapper">
              <img class="song-row-art" src="/api/art/${track.id}" onerror="this.src='/static/icons/default-art.svg'" alt="art" loading="lazy">
              <div class="song-play-overlay">
                <i data-lucide="${isCurrent && window.player?.isPlaying ? 'pause' : 'play'}"></i>
              </div>
            </div>
            <div class="song-title-cell" title="${track.title}">${track.title}</div>
            <div class="song-text-cell" title="${track.artist}">${track.artist}</div>
            <div class="song-text-cell" title="${track.album || 'Downloads'}">${track.album || 'Downloads'}</div>
            <div class="song-text-cell">${track.duration_fmt || '0:00'}</div>
            <div class="song-text-cell" style="color: var(--text-muted); font-size: 0.8rem;">${track.file_size_fmt || ''}</div>
            <div class="song-text-cell" style="text-align: right; display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
              <button class="btn-dl-add-pl row-context-btn" data-id="${track.id}" title="Add to Playlist" aria-label="Add to Playlist">
                <i data-lucide="plus"></i>
              </button>
              <button class="btn-dl-reveal row-context-btn" data-id="${track.id}" data-path="${track.path || ''}" title="Open File Location" aria-label="Reveal">
                <i data-lucide="folder"></i>
              </button>
              <button class="btn-dl-delete row-context-btn" data-id="${track.id}" title="Delete File" aria-label="Delete" style="color: var(--danger);">
                <i data-lucide="trash-2"></i>
              </button>
              <button class="row-context-btn btn-dl-ctx" data-id="${track.id}" title="More Options" aria-label="More Options">
                <i data-lucide="more-vertical"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');

      const combinedTracksHtml = inProgressHtml + itemsHtml;

      tabContent.innerHTML = `
        <div class="library-header-actions playlist-sticky-header" style="display:flex; flex-direction:row; align-items:center; gap:20px; text-align:left; padding: 18px 20px; background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: 14px; flex-wrap: wrap;">
          <div style="width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--bg-surface-3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
            <i data-lucide="hard-drive" style="color: var(--accent); width: 26px; height: 26px;"></i>
          </div>
          <div style="flex: 1; min-width: 180px;">
            <h2 style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary); margin: 0;">Safe Folder Downloads</h2>
            <p style="color: var(--text-secondary); font-size: 0.82rem; margin-top: 4px;">${downloads.length} offline track${downloads.length !== 1 ? 's' : ''}${activeTasks.length > 0 ? ` • ${activeTasks.length} downloading` : ''} • ${data.total_size_fmt || '0 MB'} • <span style="font-family: monospace; font-size: 0.78rem;">${data.folder || ''}</span></p>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <button id="btn-dl-play-all" style="background: var(--text-primary); color: var(--bg-base); border: none; padding: 10px 22px; border-radius: 24px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;"><i data-lucide="play" style="width:15px; height:15px;"></i> Play All</button>
            <button id="btn-dl-open-folder" class="btn-filter-toggle" style="border-radius: 24px; padding: 8px 18px; font-weight: 600; display: flex; align-items: center; gap: 6px;"><i data-lucide="folder-open" style="width:14px; height:14px;"></i> Open Folder</button>
          </div>
        </div>

        <div class="song-table-container" style="background: var(--bg-surface-1); border-radius: 12px; border: 1px solid var(--border); overflow: hidden;">
          <div class="song-table-header" style="grid-template-columns: ${gridColumns}; padding: 10px 14px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); border-bottom: 1px solid var(--border);">
            <div>#</div>
            <div>Title</div>
            <div>Artist</div>
            <div>Album</div>
            <div>Duration</div>
            <div>Size</div>
            <div style="text-align: right;">Actions</div>
          </div>
          <div id="downloaded-tracks-list">${combinedTracksHtml}</div>
        </div>
      `;

      if (window.lucide) window.lucide.createIcons({ container: tabContent });

      // Play all downloads
      const btnPlayAll = document.getElementById('btn-dl-play-all');
      if (btnPlayAll && downloads.length > 0) {
        btnPlayAll.addEventListener('click', () => {
          if (window.playlists && window.player) {
            window.playlists.setQueue(downloads, 0);
            window.player.playTrack(downloads[0], true);
          }
        });
      }

      // Open downloads folder
      const btnOpenFolder = document.getElementById('btn-dl-open-folder');
      if (btnOpenFolder && data.folder) {
        btnOpenFolder.addEventListener('click', () => {
          window.api.revealFile('', data.folder);
          window.toast.show("Opening Safe Folder in file manager...", "info");
        });
      }

      // Event listeners for each downloaded track row
      const rows = tabContent.querySelectorAll('.downloaded-song-row');
      rows.forEach(row => {
        const idx = parseInt(row.dataset.idx, 10);
        const track = downloads[idx];
        if (!track) return;

        const playTrackNow = () => {
          if (window.playlists && window.player) {
            window.playlists.setQueue(downloads, idx);
            window.player.playTrack(track, true);
          }
        };

        // Drag & drop into playlists
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', track.id);
          e.dataTransfer.effectAllowed = 'copyMove';
          row.style.opacity = '0.5';
        });
        row.addEventListener('dragend', () => {
          row.style.opacity = '1';
        });

        // Click to play
        row.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          playTrackNow();
        });

        const overlay = row.querySelector('.song-play-overlay');
        if (overlay) {
          overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            playTrackNow();
          });
        }

        // Add to playlist
        const addPlBtn = row.querySelector('.btn-dl-add-pl');
        if (addPlBtn) {
          addPlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.contextMenu) {
              const rect = addPlBtn.getBoundingClientRect();
              window.contextMenu.showForTrack(rect.left, rect.bottom + 4, track, playTrackNow);
            }
          });
        }

        // Reveal file
        const revealBtn = row.querySelector('.btn-dl-reveal');
        if (revealBtn) {
          revealBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.api.revealFile(track.id, track.path || '');
            window.toast.show("Opened directory in file manager", "info");
          });
        }

        // Delete download
        const delBtn = row.querySelector('.btn-dl-delete');
        if (delBtn) {
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmed = await window.dialog.confirm(
              `Delete "${track.title}" from your computer? The downloaded audio file will be permanently removed.`,
              'Delete Download'
            );
            if (confirmed) {
              try {
                await window.api.deleteDownload(track.id);
                window.toast.show(`Deleted "${track.title}"`, "info");
                if (window.library) await window.library.reload();
                this.renderOnlineDownloads();
              } catch (err) {
                window.toast.show(`Delete failed: ${err.message}`, "error");
              }
            }
          });
        }

        // Context Menu
        const ctxBtn = row.querySelector('.btn-dl-ctx');
        if (ctxBtn) {
          ctxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.contextMenu) {
              const rect = ctxBtn.getBoundingClientRect();
              window.contextMenu.showForTrack(rect.left, rect.bottom + 4, track, playTrackNow);
            }
          });
        }

        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (window.contextMenu) {
            window.contextMenu.showForTrack(e.clientX, e.clientY, track, playTrackNow);
          }
        });
      });

    } catch (err) {
      tabContent.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; padding: 40px 20px; color: var(--danger); gap: 10px;">
          <i data-lucide="alert-circle" style="width: 32px; height: 32px;"></i>
          <span style="font-size: 0.95rem; font-weight: 600;">Could not load downloads: ${err.message || err}</span>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ container: tabContent });
    }
  }
 
  async triggerOnlineSearch(query) {
    if (!query) return;
    this.lastOnlineQuery = query;

    const resultsContainer = document.getElementById('online-results-container');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 14px;">
        <div class="loader"></div>
        <span style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 500;">Searching YouTube Music...</span>
      </div>
    `;

    try {
      const data = await window.api.searchOnline(query, 20);
      this.lastOnlineResults = data;
      this.renderOnlineResults(data);
    } catch (err) {
      resultsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; padding: 40px 20px; color: var(--danger); gap: 10px;">
          <i data-lucide="alert-circle" style="width: 32px; height: 32px;"></i>
          <span style="font-size: 0.95rem; font-weight: 600;">Search failed: ${err.message || err}</span>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ container: resultsContainer });
    }
  }

  renderOnlineResults(data) {
    const resultsContainer = document.getElementById('online-results-container');
    if (!resultsContainer) return;

    const results = data.results || [];
    if (results.length === 0) {
      resultsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 50px 20px; text-align: center; color: var(--text-muted); gap: 10px;">
          <i data-lucide="search-x" style="width: 36px; height: 36px;"></i>
          <p style="font-size: 0.95rem;">No tracks found for "${data.query || ''}".</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ container: resultsContainer });
      return;
    }

    // Register tracks in window.onlineTracks for player and context menu lookup
    window.onlineTracks = window.onlineTracks || {};
    results.forEach(t => {
      window.onlineTracks[t.id] = t;
    });
    try {
      localStorage.setItem('wavevault_online_tracks', JSON.stringify(window.onlineTracks));
    } catch (_) {}

    const isPlaylist = data.type === 'playlist';
    const displayTitle = isPlaylist ? (data.playlist_title || 'YouTube Playlist') : `Search: "${data.query || ''}"`;

    // Modern Playlist-Style Sticky Header
    const headerHtml = `
      <div class="library-header-actions playlist-sticky-header" style="display:flex; flex-direction:row; align-items:center; gap:20px; text-align:left; padding: 18px 20px; background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: 14px; margin-bottom: 16px; flex-wrap: wrap;">
        <div style="width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--bg-surface-3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
          ${results[0]?.thumbnail ? `<img src="${results[0].thumbnail}" alt="art" style="width: 100%; height: 100%; object-fit: cover;">` : `<i data-lucide="music" style="color: var(--accent);"></i>`}
        </div>
        <div style="flex: 1; min-width: 180px;">
          <h2 style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary); margin: 0;">${displayTitle}</h2>
          <p style="color: var(--text-secondary); font-size: 0.82rem; margin-top: 4px;">YouTube Music • ${results.length} track${results.length !== 1 ? 's' : ''}</p>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <button id="btn-online-play-all" style="background: var(--text-primary); color: var(--bg-base); border: none; padding: 10px 22px; border-radius: 24px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;"><i data-lucide="play" style="width:15px; height:15px;"></i> Play All</button>
          <button id="btn-online-shuffle-all" style="background: transparent; color: var(--text-primary); border: 1px solid var(--border-strong); padding: 10px 20px; border-radius: 24px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;"><i data-lucide="shuffle" style="width:15px; height:15px;"></i> Shuffle</button>
          ${isPlaylist ? `<button id="btn-online-dl-all" class="btn-filter-toggle" style="border-radius: 24px; padding: 8px 18px; font-weight: 600;"><i data-lucide="download" style="width:14px; height:14px;"></i> Download All</button>` : ''}
        </div>
      </div>
    `;

    // Standard Playlist Grid Template Matching Library / Playlists
    const gridColumns = '48px minmax(220px, 3fr) minmax(140px, 2fr) minmax(130px, 1.5fr) 80px 110px';

    const currentPlayingId = window.player?.currentTrack?.id;

    const itemsHtml = results.map((track, idx) => {
      const isCurrent = currentPlayingId && String(currentPlayingId) === String(track.id);
      const activeTask = this.downloadTasks.get(track.id);
      const isDownloading = !!activeTask && (activeTask.status === 'downloading' || activeTask.status === 'starting' || activeTask.status === 'converting');
      const isSaved = this.cachedDownloads && this.cachedDownloads.some(d => String(d.id) === String(track.id) || d.youtube_id === track.id);
      return `
        <div class="song-row online-song-row ${isCurrent ? 'active-playing' : ''} ${isDownloading ? 'downloading-faded-row' : ''} ${isSaved ? 'download-finished' : ''}" 
             data-id="${track.id}" 
             id="online-song-row-${track.id}"
             data-idx="${idx}" 
             draggable="true" 
             style="grid-template-columns: ${gridColumns};">
          <div class="song-thumbnail-wrapper">
            <img class="song-row-art" src="${track.thumbnail || `/api/art/${track.id}`}" alt="art" loading="lazy">
            <div class="song-play-overlay">
              <i data-lucide="${isCurrent && window.player?.isPlaying ? 'pause' : 'play'}"></i>
            </div>
          </div>
          <div class="song-title-cell" title="${track.title}">${track.title}</div>
          <div class="song-text-cell" title="${track.artist}">${track.artist}</div>
          <div class="song-text-cell" title="${track.album || 'YouTube Music'}">${track.album || 'YouTube Music'}</div>
          <div class="song-text-cell">${track.duration_fmt || track.duration_str || '0:00'}</div>
          <div class="song-text-cell" style="text-align: right; display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
            <button class="btn-online-add-pl row-context-btn" data-id="${track.id}" title="Add to Playlist" aria-label="Add to Playlist">
              <i data-lucide="plus"></i>
            </button>
            <button class="btn-online-download row-context-btn" data-id="${track.id}" title="${isSaved ? 'Saved in Safe Folder' : (isDownloading ? 'Downloading...' : 'Download to Safe Folder')}" aria-label="Download" ${isSaved ? 'disabled style="color: #10b981; border-color: #10b981;"' : (isDownloading ? 'disabled' : '')}>
              ${isSaved ? '✓ Saved' : (isDownloading ? `<span class="dl-btn-pct" style="font-size: 0.72rem; font-weight: 700; color: var(--accent);">${activeTask.status === 'converting' ? 'Conv...' : (activeTask.percent || 0) + '%'}</span>` : '<i data-lucide="download"></i>')}
            </button>
            <button class="row-context-btn btn-online-ctx" data-id="${track.id}" title="More Options" aria-label="More Options">
              <i data-lucide="more-vertical"></i>
            </button>
          </div>
          <div class="download-row-progress-container" id="dl-row-prog-${track.id}" style="${isDownloading ? 'display: flex;' : 'display: none;'}">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 2px;">
              <span id="dl-row-status-${track.id}" style="font-weight: 600; color: var(--accent);">${activeTask?.status === 'converting' ? 'Converting audio to MP3...' : 'Downloading audio...'}</span>
              <span id="dl-row-pct-${track.id}" style="font-weight: 700; color: var(--accent);">${activeTask?.percent || 0}%</span>
            </div>
            <div class="download-row-progress-bar">
              <div class="download-row-progress-fill" id="dl-row-fill-${track.id}" style="width: ${activeTask?.percent || 0}%;"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    resultsContainer.innerHTML = `
      ${headerHtml}
      <!-- Live Playlist Download Progress Banner -->
      <div id="online-playlist-dl-banner" style="display: none; margin-bottom: 16px; padding: 14px 18px; background: var(--bg-surface-2); border: 1px solid var(--border-strong); border-radius: 12px; transition: all 0.3s ease;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <i id="pl-banner-icon" data-lucide="loader" class="spin" style="color: var(--accent); width: 18px; height: 18px;"></i>
            <span id="pl-banner-title" style="font-weight: 600; font-size: 0.88rem; color: var(--text-primary);">Downloading Playlist: ${displayTitle}</span>
          </div>
          <span id="pl-banner-stats" style="font-weight: 700; font-size: 0.82rem; color: var(--accent);">0% (0 / ${results.length} tracks)</span>
        </div>
        <div style="width: 100%; height: 6px; background: var(--bg-surface-3); border-radius: 3px; overflow: hidden; margin-bottom: 6px;">
          <div id="pl-banner-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-glow)); border-radius: 3px; transition: width 0.3s ease;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.76rem; color: var(--text-secondary);">
          <span id="pl-banner-track-status">Preparing download to Safe Folder...</span>
          <span id="pl-banner-completed-label">0 completed</span>
        </div>
      </div>
      <div class="song-table-container" style="background: var(--bg-surface-1); border-radius: 12px; border: 1px solid var(--border); overflow: hidden;">
        <div class="song-table-header" style="grid-template-columns: ${gridColumns}; padding: 10px 14px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); border-bottom: 1px solid var(--border);">
          <div>#</div>
          <div>Title</div>
          <div>Artist</div>
          <div>Album / Source</div>
          <div>Duration</div>
          <div style="text-align: right;">Actions</div>
        </div>
        <div id="online-tracks-list">${itemsHtml}</div>
      </div>
    `;

    if (window.lucide) {
      window.lucide.createIcons({ container: resultsContainer });
    }

    // Play All Click
    const btnPlayAll = document.getElementById('btn-online-play-all');
    if (btnPlayAll && results.length > 0) {
      btnPlayAll.addEventListener('click', () => {
        if (window.playlists && window.player) {
          window.playlists.setQueue(results, 0);
          window.player.playTrack(results[0], true);
        }
      });
    }

    // Shuffle All Click
    const btnShuffleAll = document.getElementById('btn-online-shuffle-all');
    if (btnShuffleAll && results.length > 0) {
      btnShuffleAll.addEventListener('click', () => {
        if (window.playlists && window.player) {
          const randIdx = Math.floor(Math.random() * results.length);
          window.playlists.setQueue(results, randIdx);
          window.playlists.isShuffled = false;
          window.playlists.toggleShuffle();
          const firstTrack = window.playlists.activeQueue[0] || results[randIdx];
          window.player.playTrack(firstTrack, true);
        }
      });
    }

    // Download All Click
    const btnDlAll = document.getElementById('btn-online-dl-all');
    if (btnDlAll && data.query) {
      btnDlAll.addEventListener('click', async () => {
        btnDlAll.disabled = true;
        btnDlAll.innerHTML = '<i data-lucide="loader" class="spin" style="width:14px; height:14px;"></i> Starting...';
        if (window.lucide) window.lucide.createIcons({ container: btnDlAll });

        // Reveal the progress banner
        const banner = document.getElementById('online-playlist-dl-banner');
        if (banner) banner.style.display = 'block';

        // Register each unsaved track in this.downloadTasks
        results.forEach(track => {
          if (!track || !track.id) return;
          const isSaved = this.cachedDownloads && this.cachedDownloads.some(d => String(d.id) === String(track.id) || d.youtube_id === track.id);
          if (isSaved) return;

          const rowEl = document.getElementById(`online-song-row-${track.id}`);
          if (rowEl) {
            rowEl.classList.add('downloading-faded-row');
            const prog = rowEl.querySelector('.download-row-progress-container') || document.getElementById(`dl-row-prog-${track.id}`);
            if (prog) prog.style.display = 'flex';
          }
          const rowDlBtn = rowEl?.querySelector('.btn-online-download');
          if (rowDlBtn) {
            rowDlBtn.disabled = true;
            rowDlBtn.innerHTML = '<span class="dl-btn-pct" style="font-size: 0.72rem; font-weight: 700; color: var(--accent);">Queued</span>';
          }

          if (!this.downloadTasks.has(track.id)) {
            this.downloadTasks.set(track.id, {
              id: track.id,
              track: track,
              percent: 0,
              status: 'queued',
              buttonEl: rowDlBtn
            });
          }
        });

        this.updateDownloadIndicators();
        this.updateDownloadsDrawerUI();

        window.toast.show(`Starting playlist download for "${data.playlist_title || 'playlist'}"...`, "info");

        try {
          const resp = await window.api.downloadPlaylist(data.query);
          const plId = resp?.playlist_id || data.query;
          this.trackPlaylistDownloadProgress(plId, data, results, btnDlAll, resultsContainer);
        } catch (e) {
          window.toast.show("Download failed: " + e.message, "error");
          btnDlAll.disabled = false;
          btnDlAll.innerHTML = '<i data-lucide="download" style="width:14px; height:14px;"></i> Download All';
          if (window.lucide) window.lucide.createIcons({ container: btnDlAll });
        }
      });
    }

    // Bind Rows Events (Click, Play Overlay, Add to Playlist, Download, Context Menu, Drag & Drop)
    const rows = resultsContainer.querySelectorAll('.online-song-row');
    rows.forEach(row => {
      const idx = parseInt(row.dataset.idx, 10);
      const track = results[idx];
      if (!track) return;

      const playTrackNow = () => {
        if (window.playlists && window.player) {
          window.playlists.setQueue(results, idx);
          window.player.playTrack(track, true);
        }
      };

      // Drag & Drop: allow saving track to playlists in sidebar by dragging
      row.addEventListener('dragstart', (e) => {
        window.onlineTracks = window.onlineTracks || {};
        window.onlineTracks[track.id] = track;
        try {
          localStorage.setItem('wavevault_online_tracks', JSON.stringify(window.onlineTracks));
        } catch (_) {}
        e.dataTransfer.setData('text/plain', track.id);
        e.dataTransfer.effectAllowed = 'copyMove';
        row.style.opacity = '0.5';
      });

      row.addEventListener('dragend', () => {
        row.style.opacity = '1';
      });

      // Row Click
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        playTrackNow();
      });

      // Play Overlay Click
      const overlay = row.querySelector('.song-play-overlay');
      if (overlay) {
        overlay.addEventListener('click', (e) => {
          e.stopPropagation();
          playTrackNow();
        });
      }

      // Add to Playlist Button Click
      const addPlBtn = row.querySelector('.btn-online-add-pl');
      if (addPlBtn) {
        addPlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.contextMenu) {
            const rect = addPlBtn.getBoundingClientRect();
            window.contextMenu.showForTrack(rect.left, rect.bottom + 4, track, playTrackNow);
          }
        });
      }

      // Download Button Click
      const dlBtn = row.querySelector('.btn-online-download');
      if (dlBtn) {
        dlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.triggerTrackDownload(track, dlBtn);
        });
      }

      // Context Button Click
      const ctxBtn = row.querySelector('.btn-online-ctx');
      if (ctxBtn) {
        ctxBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.contextMenu) {
            const rect = ctxBtn.getBoundingClientRect();
            window.contextMenu.showForTrack(rect.left, rect.bottom + 4, track, playTrackNow);
          }
        });
      }

      // Right-Click Context Menu
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (window.contextMenu) {
          window.contextMenu.showForTrack(e.clientX, e.clientY, track, playTrackNow);
        }
      });
    });
  }

  async triggerTrackDownload(track, buttonEl) {
    if (!track || !track.id) return;

    // 1. Check if track is already actively downloading
    const existingTask = this.downloadTasks.get(track.id);
    if (existingTask && (existingTask.status === 'downloading' || existingTask.status === 'starting' || existingTask.status === 'converting')) {
      window.toast.show(`"${track.title}" is already being downloaded!`, "warning");
      return;
    }

    // 2. Check if track already exists in Safe Folder on disk
    const alreadyExists = await this.isDownloaded(track.id);
    if (alreadyExists) {
      window.toast.show(`"${track.title}" is already in your Safe Folder!`, "info");
      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.style.color = '#10b981';
        buttonEl.style.borderColor = '#10b981';
        buttonEl.innerHTML = '✓ Saved';
      }
      return;
    }

    // 3. Mark row as downloading-faded and reveal progress container
    const rowEl = document.getElementById(`online-song-row-${track.id}`) || buttonEl?.closest('.song-row');
    if (rowEl) {
      rowEl.classList.add('downloading-faded-row');
      const prog = rowEl.querySelector('.download-row-progress-container') || document.getElementById(`dl-row-prog-${track.id}`);
      if (prog) prog.style.display = 'flex';
    }

    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.innerHTML = '<div class="loader" style="width: 12px; height: 12px; border-width: 2px;"></div>';
      buttonEl.innerHTML = '<span class="dl-btn-pct" style="font-size: 0.72rem; font-weight: 700; color: var(--accent);">0%</span>';
    }

    // Register active download task in map
    const task = {
      id: track.id,
      track: track,
      percent: 0,
      status: 'starting',
      buttonEl: buttonEl
    };
    this.downloadTasks.set(track.id, task);

    // Update red dot indicators and drawer
    this.updateDownloadIndicators();
    this.updateDownloadsDrawerUI();

    // If currently on Downloads tab, re-render to display the new in-progress faded row
    if (this.currentOnlineTab === 'downloads') {
      this.renderOnlineDownloads();
    }

    window.toast.show(`Starting download for "${track.title}" to Safe Folder...`, "info");

    try {
      await window.api.startDownload(track.id);
      this.pollDownloadStatus(track, buttonEl);
    } catch (err) {
      task.status = 'failed';
      this.updateDownloadIndicators();
      this.updateDownloadsDrawerUI();
      window.toast.show("Download failed: " + err.message, "error");
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.innerHTML = '<i data-lucide="download" style="width: 14px; height: 14px;"></i>';
        if (window.lucide) window.lucide.createIcons({ container: buttonEl });
      }
      if (rowEl) rowEl.classList.remove('downloading-faded-row');
    }
  }

  pollDownloadStatus(track, buttonEl) {
    const task = this.downloadTasks.get(track.id);
    if (!task) return;

    let errorCount = 0;
    const poll = setInterval(async () => {
      try {
        const stat = await window.api.getDownloadStatus(track.id);
        errorCount = 0;

        const pct = Math.min(100, Math.max(0, stat.percent || 0));

        task.percent = pct;
        task.status = stat.status || 'downloading';

        // Update progress drawer UI
        this.updateDownloadsDrawerUI();

        // Update in-row progress bar in Downloads tab if visible
        const rowFill = document.getElementById(`dl-row-fill-${track.id}`);
        const rowPct = document.getElementById(`dl-row-pct-${track.id}`);
        const rowStatus = document.getElementById(`dl-row-status-${track.id}`);
        if (rowFill) rowFill.style.width = `${pct}%`;
        if (rowPct) rowPct.textContent = `${pct}%`;
        if (rowStatus) rowStatus.textContent = task.status === 'converting' ? 'Converting...' : 'Downloading...';
        // Update in-row progress bar and labels across both search and downloads views
        const rowFills = document.querySelectorAll(`[id="dl-row-fill-${track.id}"]`);
        const rowPcts = document.querySelectorAll(`[id="dl-row-pct-${track.id}"]`);
        const rowStatuses = document.querySelectorAll(`[id="dl-row-status-${track.id}"]`);

        // Build rich, verbose progress status
        let statusLabel = '';
        if (task.status === 'converting') {
          statusLabel = stat.message || 'Converting audio to high-quality MP3...';
        } else if (pct >= 99) {
          statusLabel = 'Embedding album artwork & lyrics...';
        } else {
          const parts = ['Downloading'];
          if (stat.speed && stat.speed > 0) {
            const mb = stat.speed / 1048576;
            parts.push(mb < 0.1 ? (stat.speed / 1024).toFixed(0) + ' KB/s' : mb.toFixed(1) + ' MB/s');
          }
          if (stat.downloaded && stat.total) {
            const dlMb = (stat.downloaded / 1048576).toFixed(1);
            const totMb = (stat.total / 1048576).toFixed(1);
            parts.push(`${dlMb} / ${totMb} MB`);
          }
          if (stat.eta && stat.eta > 0) {
            parts.push(`${stat.eta}s left`);
          }
          statusLabel = parts.join(' • ');
        }
        task.verboseLabel = statusLabel;

        rowFills.forEach(fill => { fill.style.width = `${pct}%`; });
        rowPcts.forEach(p => { p.textContent = `${pct}%`; });
        rowStatuses.forEach(s => { s.textContent = statusLabel; });

        // Update buttons across UI with live percentage
        const btns = document.querySelectorAll(`.btn-online-download[data-id="${track.id}"]`);
        btns.forEach(btn => {
          btn.disabled = true;
          btn.innerHTML = `<span style="font-size: 0.72rem; font-weight: 700; color: var(--accent);">${task.status === 'converting' ? 'Conv...' : pct + '%'}</span>`;
        });

        if (stat.status === 'completed') {
          clearInterval(poll);
          task.status = 'completed';
          task.percent = 100;
          this.updateDownloadIndicators();
          this.updateDownloadsDrawerUI();

          if (buttonEl) {
            buttonEl.disabled = true;
            buttonEl.style.color = '#10b981';
            buttonEl.style.borderColor = '#10b981';
            buttonEl.innerHTML = '✓ Saved';
          }
          btns.forEach(btn => {
            btn.disabled = true;
            btn.style.color = '#10b981';
            btn.style.borderColor = '#10b981';
            btn.innerHTML = '✓ Saved';
          });

          // Un-fade rows with completion indicator
          const rows = document.querySelectorAll(`[data-id="${track.id}"]`);
          rows.forEach(r => {
            r.classList.add('download-finished');
            r.classList.remove('downloading-faded-row');
          });

          rowFills.forEach(fill => { fill.style.width = '100%'; });
          rowPcts.forEach(p => { p.textContent = '100%'; });
          rowStatuses.forEach(s => { s.textContent = '✓ Saved to Safe Folder'; s.style.color = '#10b981'; });

          // Cache completed track
          this.cachedDownloads = this.cachedDownloads || [];
          this.cachedDownloads.push({
            id: track.id,
            title: track.title,
            artist: track.artist,
            thumbnail: track.thumbnail,
            duration_fmt: track.duration_fmt || track.duration_str
          });
          if (!this.cachedDownloads.some(d => String(d.id) === String(track.id) || d.youtube_id === track.id)) {
            this.cachedDownloads.push({
              id: track.id,
              youtube_id: track.id,
              title: track.title,
              artist: track.artist,
              thumbnail: track.thumbnail,
              duration_fmt: track.duration_fmt || track.duration_str
            });
          }

          window.toast.show(`✓ Downloaded "${track.title}" to Safe Folder!`, "success");

          if (window.library) {
            window.library.reload();
          }

          // If on Downloads tab, refresh list so completed track row shows
          if (this.currentOnlineTab === 'downloads') {
            this.renderOnlineDownloads();
          }

          // Update downloads badge count
          window.api.getDownloads().then(res => {
            const downloads = res.downloads || [];
            this.cachedDownloads = downloads;
            const badge = document.getElementById('downloads-badge');
            if (badge && downloads.length > 0) {
              badge.textContent = downloads.length;
              badge.style.display = 'inline-block';
            }
          }).catch(() => {});

          // Remove in-row progress bar after 3.5 seconds
          setTimeout(() => {
            const progContainers = document.querySelectorAll(`[id="dl-row-prog-${track.id}"]`);
            progContainers.forEach(pc => { pc.style.display = 'none'; });
          }, 3500);

          // Remove completed task after 4 seconds to clear drawer
          setTimeout(() => {
            if (this.downloadTasks.get(track.id)?.status === 'completed') {
              this.downloadTasks.delete(track.id);
              this.updateDownloadIndicators();
              this.updateDownloadsDrawerUI();
            }
          }, 4000);

        } else if (stat.status === 'failed') {
          clearInterval(poll);
          task.status = 'failed';
          this.updateDownloadIndicators();
          this.updateDownloadsDrawerUI();

          if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.innerHTML = '<i data-lucide="download" style="width: 14px; height: 14px;"></i>';
            if (window.lucide) window.lucide.createIcons({ container: buttonEl });
          }
          btns.forEach(btn => {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="download" style="width: 14px; height: 14px;"></i>';
            if (window.lucide) window.lucide.createIcons({ container: btn });
          });

          const rows = document.querySelectorAll(`[data-id="${track.id}"]`);
          rows.forEach(r => {
            r.classList.remove('downloading-faded-row');
          });

          window.toast.show(`Download failed for "${track.title}": ${stat.error || 'Unknown error'}`, "error");

          setTimeout(() => {
            if (this.downloadTasks.get(track.id)?.status === 'failed') {
              this.downloadTasks.delete(track.id);
              this.updateDownloadIndicators();
              this.updateDownloadsDrawerUI();
            }
          }, 5000);
        }
      } catch (e) {
        errorCount++;
        if (errorCount > 8) {
          clearInterval(poll);
        }
      }
    }, 800);
  }

  trackPlaylistDownloadProgress(plId, data, results, btnDlAll, resultsContainer) {
    const banner = document.getElementById('online-playlist-dl-banner');
    const bannerIcon = document.getElementById('pl-banner-icon');
    const bannerTitle = document.getElementById('pl-banner-title');
    const bannerStats = document.getElementById('pl-banner-stats');
    const bannerBar = document.getElementById('pl-banner-progress-bar');
    const bannerTrackStatus = document.getElementById('pl-banner-track-status');
    const bannerCompletedLabel = document.getElementById('pl-banner-completed-label');

    let pollCount = 0;
    const pollInterval = setInterval(async () => {
      pollCount++;
      try {
        const plStat = await window.api.getPlaylistDownloadStatus(plId);
        const completed = plStat.completed || 0;
        const failed = plStat.failed || 0;
        const total = plStat.total || results.length;
        const pct = Math.min(100, Math.max(0, plStat.percent || Math.round(((completed + failed) / (total || 1)) * 100)));

        // Update overall banner
        if (bannerBar) bannerBar.style.width = `${pct}%`;
        if (bannerStats) bannerStats.textContent = `${pct}% (${completed} / ${total} tracks)`;
        if (bannerCompletedLabel) bannerCompletedLabel.textContent = `${completed} completed${failed ? `, ${failed} failed` : ''}`;
        if (plStat.last_track && bannerTrackStatus) {
          bannerTrackStatus.textContent = `Processing: "${plStat.last_track}"`;
        }

        // Poll individual track statuses to update row progress
        for (const track of results) {
          const task = this.downloadTasks.get(track.id);
          if (!task || task.status === 'completed') continue;

          try {
            const trackStat = await window.api.getDownloadStatus(track.id);
            const tPct = Math.min(100, Math.max(0, trackStat.percent || 0));
            task.percent = tPct;
            task.status = trackStat.status || 'downloading';

            const row = document.getElementById(`online-song-row-${track.id}`);
            const rowBar = document.getElementById(`dl-row-fill-${track.id}`);
            const rowPct = document.getElementById(`dl-row-pct-${track.id}`);
            const rowStatus = document.getElementById(`dl-row-status-${track.id}`);
            const btn = row?.querySelector('.btn-online-download');

            if (rowBar) rowBar.style.width = `${tPct}%`;
            if (rowPct) rowPct.textContent = `${tPct}%`;

            if (trackStat.status === 'completed' || tPct >= 100) {
              task.status = 'completed';
              if (row) {
                row.classList.remove('downloading-faded-row');
                row.classList.add('download-finished');
                const prog = row.querySelector('.download-row-progress-container');
                if (prog) prog.style.display = 'none';
              }
              if (btn) {
                btn.disabled = true;
                btn.style.color = '#10b981';
                btn.style.borderColor = '#10b981';
                btn.innerHTML = '✓ Saved';
              }
            } else if (trackStat.status === 'converting') {
              if (rowStatus) rowStatus.textContent = 'Converting audio to MP3...';
              if (btn) btn.innerHTML = '<span class="dl-btn-pct" style="font-size: 0.72rem; font-weight: 700; color: var(--accent);">Conv...</span>';
            } else if (trackStat.status === 'downloading') {
              if (rowStatus) rowStatus.textContent = 'Downloading audio...';
              if (btn) btn.innerHTML = `<span class="dl-btn-pct" style="font-size: 0.72rem; font-weight: 700; color: var(--accent);">${tPct}%</span>`;
            }
          } catch (_) {}
        }

        this.updateDownloadIndicators();
        this.updateDownloadsDrawerUI();

        // Check if finished
        if (plStat.status === 'completed' || (completed + failed >= total && total > 0)) {
          clearInterval(pollInterval);
          if (banner) {
            banner.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            banner.style.background = 'rgba(16, 185, 129, 0.08)';
          }
          if (bannerIcon) {
            bannerIcon.classList.remove('spin');
            bannerIcon.setAttribute('data-lucide', 'check-circle');
            bannerIcon.style.color = '#10b981';
          }
          if (bannerTitle) bannerTitle.textContent = `Playlist Downloaded: "${data.playlist_title || 'Playlist'}"`;
          if (bannerTrackStatus) bannerTrackStatus.textContent = `All ${completed} tracks saved to Safe Folder!`;
          if (bannerBar) {
            bannerBar.style.width = '100%';
            bannerBar.style.background = '#10b981';
          }

          if (btnDlAll) {
            btnDlAll.disabled = true;
            btnDlAll.style.color = '#10b981';
            btnDlAll.style.borderColor = '#10b981';
            btnDlAll.innerHTML = '<i data-lucide="check" style="width:14px; height:14px;"></i> All Downloaded';
          }

          if (window.lucide) window.lucide.createIcons({ container: resultsContainer });
          await this.loadDownloads();
          if (window.library) window.library.reload();
          window.toast.show(`Playlist "${data.playlist_title || 'playlist'}" completely downloaded!`, "success");
        }
      } catch (err) {
        if (pollCount > 300) {
          clearInterval(pollInterval);
        }
      }
    }, 1000);
  }
}

window.views = new ViewsManager();

