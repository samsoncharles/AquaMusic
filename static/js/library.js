// AquaMusic Library Database, Multi-Column Sorts, Live debounced Filter & Virtual Scroll Engine
class LibraryManager {
  constructor() {
    this._allTracks = {}; // Raw dictionary of track_id -> track metadata
    this.visibleTracksList = []; // Ordered array of tracks matching active filters
    this.sortKeys = []; // Array of {key, dir: 'asc'|'desc'} for multi-column sorts

    // Virtual Scroll state
    this.virtualList = null;
    this.rowHeight = 56;
    this.searchDebounceTimer = null;

    // Active filters
    this.searchQuery = '';
    this.advancedFilters = {
      genre: '',
      yearMin: '',
      yearMax: '',
      durationMin: '',
      durationMax: '',
      ratingMin: 0,
      bitrateMin: '',
      hasLyrics: 'any',
      hasArt: 'any'
    };
  }

  get tracks() {
    const blacklist = JSON.parse(localStorage.getItem('wavevault_blacklist') || '[]');
    const blacklistSet = new Set(blacklist);

    const filtered = {};
    Object.entries(this._allTracks).forEach(([id, track]) => {
      if (!blacklistSet.has(id)) {
        filtered[id] = track;
      }
    });
    return filtered;
  }

  set tracks(val) {
    this._allTracks = val;
  }

  async load() {
    try {
      const data = await window.api.fetchLibrary();
      this.tracks = data;

      // Inject ratings from localStorage into library model
      this.syncRatingsAndPlayCounts();

      this.applyFiltersAndSorts();
    } catch (err) {
      console.error("[Library Manager] Loading failed", err);
      window.toast.show("Could not load music library", "error");
    }
  }

  async reload() {
    await this.load();

    // Refresh current page view
    if (window.mainApp) {
      window.mainApp.refreshCurrentView();
    }
  }

  syncRatingsAndPlayCounts() {
    if (!window.ratings) return;
    Object.keys(this.tracks).forEach(id => {
      this.tracks[id].rating = window.ratings.getRating(id);

      // Load playcounts
      if (window.playlists) {
        this.tracks[id].play_count = window.playlists.getPlayCount(id);
      }
    });
  }

  updateTrackProperties(trackId, props) {
    if (this.tracks[trackId]) {
      Object.assign(this.tracks[trackId], props);
      this.syncRatingsAndPlayCounts();
      this.applyFiltersAndSorts();

      // Trigger virtual list redraw
      if (this.virtualList) {
        this.virtualList.refresh();
      }
    }
  }

  /* ----------------------------------------------------
     Live Filtering Debounce (Module 14)
     ---------------------------------------------------- */
  setSearchQuery(q) {
    this.searchQuery = q.toLowerCase();

    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    this.searchDebounceTimer = setTimeout(() => {
      this.applyFiltersAndSorts();
      if (window.mainApp && window.mainApp.currentView !== 'songs') {
        // Force navigate to songs list when typing in global search
        window.mainApp.switchView('songs');
      } else {
        this.renderSongsView();
      }
    }, 200);
  }

  setAdvancedFilter(key, val) {
    this.advancedFilters[key] = val;
    this.applyFiltersAndSorts();
    this.renderSongsView();
  }

  clearAdvancedFilters() {
    this.advancedFilters = {
      genre: '',
      yearMin: '',
      yearMax: '',
      durationMin: '',
      durationMax: '',
      ratingMin: 0,
      bitrateMin: '',
      hasLyrics: 'any',
      hasArt: 'any'
    };

    // Reset HTML settings form inputs
    const gSelect = document.getElementById('filter-adv-genre');
    if (gSelect) gSelect.value = '';
    const yMin = document.getElementById('filter-adv-year-min');
    if (yMin) yMin.value = '';
    const yMax = document.getElementById('filter-adv-year-max');
    if (yMax) yMax.value = '';
    const dMin = document.getElementById('filter-adv-dur-min');
    if (dMin) dMin.value = '';
    const dMax = document.getElementById('filter-adv-dur-max');
    if (dMax) dMax.value = '';
    const rMin = document.getElementById('filter-adv-rating-min');
    if (rMin) rMin.value = '0';
    const bMin = document.getElementById('filter-adv-bitrate-min');
    if (bMin) bMin.value = '';
    const lyr = document.getElementById('filter-adv-lyrics');
    if (lyr) lyr.value = 'any';
    const art = document.getElementById('filter-adv-art');
    if (art) art.value = 'any';

    this.applyFiltersAndSorts();
    this.renderSongsView();
    window.toast.show("Advanced filters cleared.", "info");
  }

  applyFiltersAndSorts() {
    const list = Object.values(this.tracks);

    // 1. Apply Search and Advanced Filters
    this.visibleTracksList = list.filter(track => {
      // Inline text match
      if (this.searchQuery) {
        const matchesText =
          (track.title || '').toLowerCase().includes(this.searchQuery) ||
          (track.artist || '').toLowerCase().includes(this.searchQuery) ||
          (track.album || '').toLowerCase().includes(this.searchQuery) ||
          (track.genre || '').toLowerCase().includes(this.searchQuery) ||
          (track.comment || '').toLowerCase().includes(this.searchQuery) ||
          (track.composer || '').toLowerCase().includes(this.searchQuery);

        if (!matchesText) return false;
      }

      // Advanced Filters
      const adv = this.advancedFilters;

      if (adv.genre && (track.genre || '').toLowerCase() !== adv.genre.toLowerCase()) {
        return false;
      }

      const trackYear = parseInt(track.year);
      if (adv.yearMin && (isNaN(trackYear) || trackYear < parseInt(adv.yearMin))) {
        return false;
      }
      if (adv.yearMax && (isNaN(trackYear) || trackYear > parseInt(adv.yearMax))) {
        return false;
      }

      if (adv.durationMin && track.duration < (parseInt(adv.durationMin) * 60)) {
        return false;
      }
      if (adv.durationMax && track.duration > (parseInt(adv.durationMax) * 60)) {
        return false;
      }

      if (adv.ratingMin && (track.rating || 0) < parseFloat(adv.ratingMin)) {
        return false;
      }

      if (adv.bitrateMin && track.bitrate < parseInt(adv.bitrateMin)) {
        return false;
      }

      if (adv.hasLyrics !== 'any') {
        const check = adv.hasLyrics === 'yes';
        // Simulating check: tracks might need tags scanned, we verify if lyric files are present in the directory
        // but for frontend check we verify if comments/USLT fields are filled.
        const isFilled = !!(track.comment || track.composer);
        if (check !== isFilled) return false;
      }

      if (adv.hasArt !== 'any') {
        const check = adv.hasArt === 'yes';
        if (check !== !!track.has_art) return false;
      }

      return true;
    });

    // 2. Apply Custom Sorting (Module 14)
    if (this.sortKeys.length > 0) {
      this.visibleTracksList.sort((a, b) => {
        for (const sort of this.sortKeys) {
          let valA = a[sort.key];
          let valB = b[sort.key];

          // Handle String compare vs Numeric compares
          let comparison = 0;
          if (typeof valA === 'string') {
            comparison = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
          } else {
            const numA = parseFloat(valA) || 0;
            const numB = parseFloat(valB) || 0;
            comparison = numA - numB;
          }

          if (comparison !== 0) {
            return sort.dir === 'asc' ? comparison : -comparison;
          }
        }
        return 0; // equivalent
      });
    }
  }

  toggleSort(columnKey, isShiftPressed) {
    const existingIdx = this.sortKeys.findIndex(s => s.key === columnKey);

    if (existingIdx !== -1) {
      // Cycle: ASC -> DESC -> Unsorted
      const currentDir = this.sortKeys[existingIdx].dir;
      if (currentDir === 'asc') {
        this.sortKeys[existingIdx].dir = 'desc';
      } else {
        // Remove key
        this.sortKeys.splice(existingIdx, 1);
      }
    } else {
      // Add new key
      const newSort = { key: columnKey, dir: 'asc' };
      if (isShiftPressed) {
        this.sortKeys.push(newSort); // Add secondary key
      } else {
        this.sortKeys = [newSort]; // Overwrite as primary
      }
    }

    this.applyFiltersAndSorts();
    this.renderSongsView();
    this.updateSortHeadersUI();
  }

  updateSortHeadersUI() {
    // Clear header visual styles
    document.querySelectorAll('.sortable-col').forEach(col => {
      const key = col.dataset.col;
      const indicator = col.querySelector('.sort-icon');
      if (!indicator) return;

      const sortRule = this.sortKeys.find(s => s.key === key);
      const orderIdx = this.sortKeys.findIndex(s => s.key === key);

      indicator.classList.remove('active');
      indicator.innerHTML = '↕';

      if (sortRule) {
        indicator.classList.add('active');
        indicator.innerHTML = sortRule.dir === 'asc' ? '↑' : '↓';

        // If secondary sorts exist, show order indicators (e.g. "Title 1 ↑")
        if (this.sortKeys.length > 1) {
          indicator.innerHTML += `<sub>${orderIdx + 1}</sub>`;
        }
      }
    });
  }

  /* ----------------------------------------------------
     Virtual Scroll View Rendering (Module 8)
     ---------------------------------------------------- */
  renderSongsView() {
    const contentPanel = document.getElementById('content-area');
    if (!contentPanel) return;

    // Load template shell — uses same flex-column fill layout as playlist view
    contentPanel.innerHTML = `
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column;">
        <div class="library-header-actions" style="flex-shrink: 0;">
          <div class="library-title-row">
            <div class="library-title-text">
              <h2 id="library-view-title">All Music Library</h2>
            </div>
            <div class="library-count-card" aria-label="Tracks in current view">
              <strong>${this.visibleTracksList.length}</strong><span>tracks</span>
            </div>
          </div>

          <div class="filter-row">
            <div class="filter-actions">
              <button class="btn-filter-toggle" id="btn-adv-filters-trigger">
                <i data-lucide="filter"></i>
                <span>Advanced Filters</span>
              </button>
              <button class="btn-filter-toggle" id="btn-export-m3u-list" title="Export as M3U Playlist">
                <i data-lucide="download"></i>
                <span>Export M3U</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Advanced Filters Drawer -->
        <div class="adv-filter-panel" id="adv-filter-form" style="flex-shrink: 0;">
          <div class="adv-filter-group">
            <label for="filter-adv-genre">Genre</label>
            <select id="filter-adv-genre">
              <option value="">Any Genre</option>
              ${this.getUniqueGenres().map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>
          </div>
          <div class="adv-filter-group">
            <label>Year Range</label>
            <div style="display:flex; gap:6px;">
              <input type="text" id="filter-adv-year-min" placeholder="Min" style="width:50%;">
              <input type="text" id="filter-adv-year-max" placeholder="Max" style="width:50%;">
            </div>
          </div>
          <div class="adv-filter-group">
            <label>Min Duration (mins)</label>
            <input type="text" id="filter-adv-dur-min" placeholder="e.g. 3">
          </div>
          <div class="adv-filter-group">
            <label>Max Duration (mins)</label>
            <input type="text" id="filter-adv-dur-max" placeholder="e.g. 10">
          </div>
          <div class="adv-filter-group">
            <label for="filter-adv-rating-min">Min Rating (Stars)</label>
            <select id="filter-adv-rating-min">
              <option value="0">Any Rating</option>
              <option value="1">★☆☆☆☆+</option>
              <option value="2">★★☆☆☆+</option>
              <option value="3">★★★☆☆+</option>
              <option value="4">★★★★☆+</option>
              <option value="5">★★★★★</option>
            </select>
          </div>
          <div class="adv-filter-group">
            <label for="filter-adv-bitrate-min">Min Bitrate (kbps)</label>
            <input type="text" id="filter-adv-bitrate-min" placeholder="e.g. 320">
          </div>
          <div class="adv-filter-group">
            <label for="filter-adv-lyrics">Has Comments</label>
            <select id="filter-adv-lyrics">
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div class="adv-filter-group">
            <label for="filter-adv-art">Has Cover Art</label>
            <select id="filter-adv-art">
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div class="adv-filter-group form-group-full" style="grid-column: span 2; display: flex; flex-direction: row; gap: 8px; justify-content: flex-end; margin-top: 10px;">
            <button class="btn-eq-reset" id="btn-adv-filters-clear" style="padding: 8px 16px;">Clear Filters</button>
          </div>
        </div>

        <!-- Songs list (Scrollable remaining area — fills to bottom) -->
        <div style="flex: 1; overflow: hidden; position: relative;">
          <div class="song-table-container" style="overflow: visible; position: absolute; inset: 0; display: flex; flex-direction: column;">
            <div class="song-table-header" style="flex-shrink: 0;">
              <div>#</div>
              <div class="sortable-col" data-col="title">Title <span class="sort-icon">↕</span></div>
              <div class="sortable-col" data-col="artist">Artist <span class="sort-icon">↕</span></div>
              <div class="sortable-col" data-col="album">Album <span class="sort-icon">↕</span></div>
              <div class="sortable-col" data-col="year">Year <span class="sort-icon">↕</span></div>
              <div class="sortable-col" data-col="genre">Genre <span class="sort-icon">↕</span></div>
              <div class="sortable-col" data-col="duration">Duration <span class="sort-icon">↕</span></div>
              <div class="sortable-col" data-col="bitrate">Bitrate <span class="sort-icon">↕</span></div>
              <div></div>
            </div>

            <div class="virtual-scroll-viewport" id="songs-scroll-viewport" style="flex: 1;">
              <div class="virtual-scroll-content" id="songs-scroll-content"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) {
      window.lucide.createIcons({ container: contentPanel });
    }

    // Restore advanced dropdown view status
    const advPanel = document.getElementById('adv-filter-form');
    const trigger = document.getElementById('btn-adv-filters-trigger');
    const isAdvOpen = localStorage.getItem('wavevault_adv_filter_open') === 'true';
    if (isAdvOpen && advPanel && trigger) {
      advPanel.classList.add('show');
      trigger.classList.add('active');
    }

    // Bind Advanced filters Toggle click
    if (trigger && advPanel) {
      trigger.addEventListener('click', () => {
        const show = advPanel.classList.toggle('show');
        trigger.classList.toggle('active', show);
        localStorage.setItem('wavevault_adv_filter_open', show.toString());
        // Trigger virtual list height recalculations
        if (this.virtualList) this.virtualList.updateViewportSize();
      });
    }

    // Bind M3U Playlist Export
    const btnExport = document.getElementById('btn-export-m3u-list');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        if (window.playlists) {
          window.playlists.exportM3U(this.visibleTracksList.map(t => t.id));
        }
      });
    }

    // Bind inputs search updates
    const searchFilter = document.getElementById('search-inline-filter');
    if (searchFilter) {
      searchFilter.addEventListener('input', (e) => this.setSearchQuery(e.target.value));
    }

    // Bind Advanced Form Inputs
    this.bindAdvancedFiltersUI();

    // Bind Table Column Sorts
    document.querySelectorAll('.sortable-col').forEach(col => {
      col.addEventListener('click', (e) => {
        this.toggleSort(col.dataset.col, e.shiftKey);
      });
    });
    this.updateSortHeadersUI();

    // Instantiate Custom Scroll Virtualization
    const viewport = document.getElementById('songs-scroll-viewport');
    const content = document.getElementById('songs-scroll-content');

    if (viewport && content) {
      this.virtualList = new CustomVirtualList(viewport, content, this.rowHeight, this.visibleTracksList, (row, track, index) => {
        this.renderRowMarkup(row, track, index);
      });
    }
  }

  bindAdvancedFiltersUI() {
    const bindEl = (id, key, type = 'input') => {
      const el = document.getElementById(id);
      if (!el) return;

      // Load saved filter state
      el.value = this.advancedFilters[key] || (type === 'select' ? '' : '');

      el.addEventListener(type === 'select' ? 'change' : 'input', (e) => {
        this.setAdvancedFilter(key, e.target.value);
      });
    };

    bindEl('filter-adv-genre', 'genre', 'select');
    bindEl('filter-adv-year-min', 'yearMin');
    bindEl('filter-adv-year-max', 'yearMax');
    bindEl('filter-adv-dur-min', 'durationMin');
    bindEl('filter-adv-dur-max', 'durationMax');
    bindEl('filter-adv-rating-min', 'ratingMin', 'select');
    bindEl('filter-adv-bitrate-min', 'bitrateMin');
    bindEl('filter-adv-lyrics', 'hasLyrics', 'select');
    bindEl('filter-adv-art', 'hasArt', 'select');

    const btnClear = document.getElementById('btn-adv-filters-clear');
    if (btnClear) {
      btnClear.addEventListener('click', () => this.clearAdvancedFilters());
    }
  }

  scrollToTrack(trackId) {
    if (!this.virtualList || !this.visibleTracksList) return;
    const index = this.visibleTracksList.findIndex(t => t.id === trackId);
    if (index === -1) return;

    const viewport = document.getElementById('songs-scroll-viewport');
    if (!viewport) return;

    const targetScroll = Math.max(0, index * this.rowHeight - (viewport.clientHeight / 2) + (this.rowHeight / 2));
    const currentScroll = viewport.scrollTop;
    const distance = Math.abs(currentScroll - targetScroll);

    if (distance < 5) return;

    if (distance > 500) {
      // Large Jump: Use sleek Loading Theme Overlay
      this.triggerLoadingJump(viewport, targetScroll, () => {
        if (this.virtualList) this.virtualList.scrollUpdate();
      }, trackId);
    } else {
      // Small Distance: Smooth Scroll
      viewport.scrollTo({ top: targetScroll, behavior: 'smooth' });
      this.highlightRow(viewport, trackId, 200);
    }
  }

  triggerLoadingJump(container, targetScroll, renderCallback, trackId) {
    const parent = container.parentElement || container;
    let overlay = parent.querySelector('.scroll-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'scroll-loading-overlay';
      overlay.innerHTML = `
        <div class="scroll-loading-spinner"></div>
        <div class="scroll-loading-text">Navigating to track...</div>
      `;
      parent.appendChild(overlay);
    }

    // Show loading theme
    overlay.classList.add('show');

    setTimeout(() => {
      // Jump scroll & update rendering
      container.scrollTop = targetScroll;
      if (renderCallback) renderCallback();

      // Fade out loading theme
      setTimeout(() => {
        overlay.classList.remove('show');
        this.highlightRow(container, trackId, 50);
      }, 160);
    }, 80);
  }

  highlightRow(container, trackId, delay = 0) {
    setTimeout(() => {
      const activeRow = container.querySelector(`.song-row[data-id="${trackId}"]`);
      if (activeRow) {
        activeRow.classList.remove('jump-pulse');
        void activeRow.offsetWidth; // trigger reflow
        activeRow.classList.add('jump-pulse');
      }
    }, delay);
  }

  getUniqueGenres() {
    const genres = new Set();
    Object.values(this.tracks).forEach(t => {
      if (t.genre && t.genre.toLowerCase() !== 'unknown genre') {
        genres.add(t.genre);
      }
    });
    return Array.from(genres).sort();
  }

  /**
   * Renders details into Virtual row nodes.
   */
  renderRowMarkup(rowElement, track, index) {
    rowElement.className = `song-row ${window.player && window.player.currentTrack && window.player.currentTrack.id === track.id ? 'active-playing' : ''} ${track.is_online ? 'online-row' : ''}`;
    rowElement.dataset.id = track.id;
    rowElement.setAttribute('draggable', 'true');

    // Highlighting Query terms
    const highlight = (text) => {
      if (!text) return '';
      if (!this.searchQuery) return text;
      const index = text.toLowerCase().indexOf(this.searchQuery);
      if (index === -1) return text;
      const orig = text.substr(index, this.searchQuery.length);
      return text.replace(new RegExp(this.searchQuery, 'gi'), `<mark>${orig}</mark>`);
    };

    // Render columns markup
    const count = index + 1;
    const artUrl = `/api/art/${track.id}`;

    rowElement.innerHTML = `
      <div class="song-thumbnail-wrapper">
        <img class="song-row-art" src="${artUrl}" alt="Thumb" loading="lazy">
        <div class="song-play-overlay">
          <i data-lucide="play"></i>
        </div>
      </div>
      <div class="song-title-cell" title="${track.title}">${highlight(track.title)}</div>
      <div class="song-text-cell" title="${track.artist}">${highlight(track.artist)}</div>
      <div class="song-text-cell" title="${track.album}">${highlight(track.album)}</div>
      <div class="song-text-cell">${track.year || '--'}</div>
      <div class="song-text-cell">${highlight(track.genre)}</div>
      <div class="song-text-cell">${track.duration_fmt || '--'}</div>
      <div class="song-text-cell">${track.bitrate ? `${track.bitrate}k` : '--'}</div>
      <div class="song-text-cell" style="text-align: right;">
        <button class="row-context-btn" aria-label="More options">
          <i data-lucide="more-vertical"></i>
        </button>
      </div>
    `;

    // Bind Play triggers
    const overlay = rowElement.querySelector('.song-play-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.playlists) {
          // Play the entire filtered list starting from this track index
          window.playlists.setQueue(this.visibleTracksList, index);
          if (window.player) {
            window.player.playTrack(track.id, true);
          }
        }
      });
    }

    // Context Menu Button Trigger
    const ctxBtn = rowElement.querySelector('.row-context-btn');
    if (ctxBtn) {
      ctxBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.contextMenu) {
          const rect = ctxBtn.getBoundingClientRect();
          const playCallback = () => {
            if (window.playlists && window.player) {
              window.playlists.setQueue(this.visibleTracksList, index);
              window.player.playTrack(track.id, true);
            }
          };
          window.contextMenu.showForTrack(rect.left, rect.bottom + 5, track.id, playCallback);
        }
      });
    }

    // Single-click row plays track
    rowElement.addEventListener('click', (e) => {
      // Don't trigger if user clicked on a button/overlay inside the row
      if (e.target.closest('.song-play-overlay') || e.target.closest('.row-context-btn')) return;
      if (window.playlists) {
        window.playlists.setQueue(this.visibleTracksList, index);
        if (window.player) {
          window.player.playTrack(track.id, true);
        }
      }
    });

    // Right-Click DOM Custom context menus (Module 18)
    rowElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (window.contextMenu) {
        const playCallback = () => {
          if (window.playlists && window.player) {
            window.playlists.setQueue(this.visibleTracksList, index);
            window.player.playTrack(track.id, true);
          }
        };
        window.contextMenu.showForTrack(e.clientX, e.clientY, track.id, playCallback);
      }
    });

    // Binds HTML5 drag item data (for playlist additions)
    rowElement.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', track.id);
      e.dataTransfer.effectAllowed = 'copy';
      rowElement.style.opacity = '0.5';
    });

    rowElement.addEventListener('dragend', () => {
      rowElement.style.opacity = '1';
    });

    // Create Lucide Icons inside row
    if (window.lucide) {
      window.lucide.createIcons({ container: rowElement });
    }
  }
}

/* ----------------------------------------------------
   Custom Virtual Scrolling Engine (highly performant)
   ---------------------------------------------------- */
class CustomVirtualList {
  constructor(viewport, content, rowHeight, items, onRenderRow) {
    this.viewport = viewport;
    this.content = content;
    this.rowHeight = rowHeight;
    this.items = items;
    this.onRenderRow = onRenderRow;

    this.visibleCount = 0;
    this.renderedIndices = new Set();
    this.activeNodes = [];

    // Bind Scroll listener
    this.viewport.addEventListener('scroll', () => this.scrollUpdate());

    this.updateViewportSize();
    this.refresh();
  }

  updateViewportSize() {
    this.visibleCount = Math.ceil(this.viewport.clientHeight / this.rowHeight) + 15;
    // Set total scroll height container
    this.content.style.height = `${this.items.length * this.rowHeight}px`;
  }

  refresh() {
    this.content.innerHTML = '';
    this.renderedIndices.clear();
    this.activeNodes = [];
    this.scrollUpdate();
  }

  scrollUpdate() {
    const scrollTop = this.viewport.scrollTop;

    // Calculate start & end bounds of items in viewport + padding buffers
    const startIdx = Math.max(0, Math.floor(scrollTop / this.rowHeight) - 8);
    const endIdx = Math.min(this.items.length - 1, Math.ceil((scrollTop + this.viewport.clientHeight) / this.rowHeight) + 8);

    const currentIndices = new Set();
    for (let i = startIdx; i <= endIdx; i++) {
      currentIndices.add(i);
    }

    // 1. Recycle/Remove nodes that scrolled out of bounds
    this.activeNodes = this.activeNodes.filter(node => {
      const idx = parseInt(node.dataset.index);
      if (!currentIndices.has(idx)) {
        if (node.parentNode === this.content) {
          this.content.removeChild(node);
        }
        this.renderedIndices.delete(idx);
        return false;
      }
      return true;
    });

    // 2. Add/Render missing indices
    for (let i = startIdx; i <= endIdx; i++) {
      if (!this.renderedIndices.has(i)) {
        const item = this.items[i];
        if (!item) continue;

        const row = document.createElement('div');
        row.style.position = 'absolute';
        row.style.top = `${i * this.rowHeight}px`;
        row.style.left = '0';
        row.style.right = '0';
        row.style.height = `${this.rowHeight}px`;
        row.dataset.index = i.toString();

        this.onRenderRow(row, item, i);

        this.content.appendChild(row);
        this.activeNodes.push(row);
        this.renderedIndices.add(i);
      }
    }
  }
}

window.library = new LibraryManager();
