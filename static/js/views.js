// AquaMusic SPA Page View Renderers (Albums, Artists, Genres, Folders, Playlists, Queue)
class ViewsManager {
  
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

    // Load track metadata objects
    const plTracks = pl.trackIds
      .map(id => window.library.tracks[id])
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
}

window.views = new ViewsManager();
