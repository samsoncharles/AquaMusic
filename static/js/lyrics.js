// AquaMusic Unified Immersive Lyrics & Player Manager
class LyricsManager {
  constructor() {
    this.panel = null;
    this.container = null;
    this.lrcLines = [];
    this.lyricsType = 'none'; // 'none', 'plain', 'lrc'
    this.lastActiveIndex = -1;
    this.currentTrackId = null;
    this.isUserDraggingScrubber = false;
    this.lyricsCache = new Map(); // trackId -> { type, content }
    this.fetchingTracks = new Set(); // Track IDs currently fetching in background
    this.isUserScrolling = false;
    this.userScrollTimer = null;
  }

  isPanelVisible() {
    if (!this.panel) this.panel = document.getElementById('lyrics-panel');
    return !!(this.panel && (this.panel.classList.contains('show') || this.panel.style.display === 'flex'));
  }

  init() {
    this.panel = document.getElementById('lyrics-panel');
    this.container = document.getElementById('lyrics-content-scroller');
    if (this.container) {
      const handleUserScroll = () => {
        this.isUserScrolling = true;
        clearTimeout(this.userScrollTimer);
        this.userScrollTimer = setTimeout(() => {
          this.isUserScrolling = false;
          // Smoothly re-center to the currently active lyric line
          this.scrollToActiveLine(true);
        }, 2200);
      };

      this.container.addEventListener('wheel', handleUserScroll, { passive: true });
      this.container.addEventListener('touchstart', handleUserScroll, { passive: true });
      this.container.addEventListener('touchmove', handleUserScroll, { passive: true });
    }

    // Close button in top nav
    const btnClose = document.getElementById('btn-lyrics-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.togglePanel(false));
    }

    // Toggle button in bottom player bar
    const btnToggle = document.getElementById('btn-lyrics-toggle');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => this.togglePanel());
    }

    // Bind In-Lyrics Player Controls
    this.bindPlayerControls();

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isPanelVisible()) {
        this.togglePanel(false);
      }
    });
  }


  bindPlayerControls() {
    // Play/Pause
    const btnPlay = document.getElementById('lyrics-btn-play');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        if (window.player) window.player.togglePlay();
      });
    }

    // Prev / Next
    const btnPrev = document.getElementById('lyrics-btn-prev');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (window.player) window.player.previous();
      });
    }

    const btnNext = document.getElementById('lyrics-btn-next');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (window.player) window.player.next();
      });
    }

    // Like Track
    const btnLike = document.getElementById('lyrics-btn-like');
    if (btnLike) {
      btnLike.addEventListener('click', () => {
        if (window.player) {
          window.player.toggleLike();
        }
      });
    }

    // Double-tap or double-click cover art in lyrics view to toggle like
    let lastArtTap = 0;
    const lyricsArtFrame = document.querySelector('.lyrics-art-frame');
    if (lyricsArtFrame) {
      lyricsArtFrame.addEventListener('click', (e) => {
        const now = Date.now();
        if (now - lastArtTap < 280) {
          e.preventDefault();
          if (window.player) window.player.toggleLike();
        }
        lastArtTap = now;
      });
    }

    // Shuffle
    const btnShuffle = document.getElementById('lyrics-btn-shuffle');
    if (btnShuffle) {
      btnShuffle.addEventListener('click', () => {
        if (window.playlists) {
          window.playlists.toggleShuffle();
        } else if (window.player?.toggleShuffle) {
          window.player.toggleShuffle();
        }
        this.syncControlStates();
      });
    }

    // Repeat
    const btnRepeat = document.getElementById('lyrics-btn-repeat');
    if (btnRepeat) {
      btnRepeat.addEventListener('click', () => {
        if (window.playlists) {
          window.playlists.cycleRepeat();
        } else if (window.player?.toggleRepeat) {
          window.player.toggleRepeat();
        }
        this.syncControlStates();
      });
    }

    // Scrubber
    const seekBar = document.getElementById('lyrics-seek-bar');
    if (seekBar) {
      seekBar.addEventListener('mousedown', () => { 
        this.isUserDraggingScrubber = true; 
        if (window.player) window.player.isUserSeeking = true;
      });

      seekBar.addEventListener('touchstart', () => { 
        this.isUserDraggingScrubber = true; 
        if (window.player) window.player.isUserSeeking = true;
      }, { passive: true });

      seekBar.addEventListener('input', (e) => {
        if (!window.player) return;
        const dur = this.getDuration();
        const targetSecs = (parseFloat(e.target.value) / 100) * dur;
        const lblCurrent = document.getElementById('lyrics-time-elapsed');
        if (lblCurrent) lblCurrent.textContent = this.formatTime(targetSecs);
      });

      const commitLyricsSeek = (e) => {
        if (!window.player) return;
        const dur = this.getDuration();
        const targetSecs = (parseFloat(e.target.value) / 100) * dur;
        window.player.seekTo(targetSecs);
        this.isUserDraggingScrubber = false;
        setTimeout(() => { if (window.player) window.player.isUserSeeking = false; }, 60);
      };

      seekBar.addEventListener('mouseup', commitLyricsSeek);
      seekBar.addEventListener('touchend', commitLyricsSeek);
      seekBar.addEventListener('change', commitLyricsSeek);
    }

    // Volume & Mute
    const volSlider = document.getElementById('lyrics-vol-slider');
    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) / 100;
        if (window.player) window.player.setVolume(val);
      });
    }

    const btnMute = document.getElementById('lyrics-btn-mute');
    if (btnMute) {
      btnMute.addEventListener('click', () => {
        if (window.player) {
          window.player.toggleMute();
          this.syncControlStates();
        }
      });
    }

    // Spectrum Visualizer Mode Toggle
    const btnVis = document.getElementById('lyrics-btn-visualizer');
    if (btnVis) {
      btnVis.addEventListener('click', () => {
        if (window.visualizer) {
          window.visualizer.cycleMode();
        }
      });
    }
  }

  togglePanel(forceState = null) {
    if (!this.panel) this.init();
    if (!this.panel) return;

    const shouldShow = (forceState !== null) ? forceState : !this.panel.classList.contains('show');
    this.panel.classList.toggle('show', shouldShow);
    this.panel.style.display = shouldShow ? 'flex' : 'none';

    const toggleBtn = document.getElementById('btn-lyrics-toggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('btn-toggle-active', shouldShow);
    }

    if (shouldShow) {
      if (window.lucide) {
        window.lucide.createIcons({ container: this.panel });
      }
      this.updateTrackDetails();
      this.syncControlStates();

      const current = window.player?.currentTrack;
      if (current) {
        // If lyrics are already loaded and rendered for the current track, immediately sync without wiping
        if (this.currentTrackId === current.id && this.lyricsType !== 'none' && this.container?.children.length > 0) {
          if (window.player) {
            this.update(window.player.currentTime || 0, true);
          }
        } else {
          this.loadLyrics(current);
        }
      }

      this.startSyncLoop();

      if (window.visualizer) {
        requestAnimationFrame(() => {
          window.visualizer.resize();
        });
      }
    }
  }

  updateTrackDetails(track = null) {
    const current = track || window.player?.currentTrack;
    const titleEl = document.getElementById('lyrics-display-title');
    const artistEl = document.getElementById('lyrics-display-artist');
    const albumEl = document.getElementById('lyrics-display-album');
    const coverArt = document.getElementById('lyrics-cover-art');
    const ambientBg = document.getElementById('lyrics-ambient-glow');
    const upnextEl = document.getElementById('lyrics-nav-upnext-title');

    if (current) {
      if (titleEl) titleEl.textContent = current.title || 'Unknown Title';
      if (artistEl) artistEl.textContent = current.artist || 'AquaMusic';
      if (albumEl) albumEl.textContent = current.album || '';

      const artUrl = current.cover_art || (current.id ? `/api/art/${encodeURIComponent(current.id)}` : '/static/images/default-art.svg');
      if (coverArt) {
        coverArt.onerror = () => { coverArt.src = '/static/images/default-art.svg'; };
        coverArt.src = artUrl;
      }
      if (ambientBg) ambientBg.style.backgroundImage = `url("${artUrl}")`;
    } else {
      if (titleEl) titleEl.textContent = 'No Track Playing';
      if (artistEl) artistEl.textContent = 'AquaMusic';
      if (albumEl) albumEl.textContent = '';
      if (coverArt) coverArt.src = '/static/images/default-art.svg';
      if (ambientBg) ambientBg.style.backgroundImage = 'none';
    }

    // Up Next Queue Preview in Top Navigator
    if (upnextEl && window.playlists) {
      const q = window.playlists.activeQueue || [];
      const idx = window.playlists.activeQueueIndex;
      const nextTrack = (idx >= 0 && idx + 1 < q.length) ? q[idx + 1] : null;
      if (nextTrack) {
        upnextEl.textContent = `${nextTrack.title} — ${nextTrack.artist || 'Unknown'}`;
      } else {
        upnextEl.textContent = 'Queue end';
      }
    }

    // Reset timeline display values for the new track
    const elapsedEl = document.getElementById('lyrics-time-elapsed');
    const remainEl = document.getElementById('lyrics-time-remaining');
    const seekBar = document.getElementById('lyrics-seek-bar');
    if (elapsedEl) elapsedEl.textContent = '0:00';
    if (remainEl) {
      const dur = (current?.duration && current.duration > 0) ? current.duration : 0;
      remainEl.textContent = this.formatTime(dur);
    }
    if (seekBar && !this.isUserDraggingScrubber) seekBar.value = 0;

    // Sync in-lyrics control states (play/pause, like, shuffle, repeat, etc.)
    this.syncControlStates();
  }

  resetScroller() {
    this.lrcLines = [];
    this.lyricsType = 'none';
    this.lastActiveIndex = -1;
    this.isUserScrolling = false;
    if (this.container) {
      this.container.innerHTML = '';
      this.container.scrollTop = 0;
    }
  }

  resolveTrack(trackOrId) {
    if (typeof trackOrId === 'object' && trackOrId !== null) {
      return trackOrId;
    }
    const trackId = trackOrId;
    if (!trackId) return null;
    if (window.library?.tracks?.[trackId]) {
      return window.library.tracks[trackId];
    }
    if (window.onlineTracks?.[trackId]) {
      return window.onlineTracks[trackId];
    }
    if (window.player?.currentTrack?.id === trackId) {
      return window.player.currentTrack;
    }
    return { id: trackId };
  }

  /**
   * Called whenever a track changes in playback.
   * Immediately updates track details, and if the lyrics view is currently open,
   * loads or renders the new song's lyrics dynamically without requiring re-opening.
   */
  onTrackChanged(trackOrId) {
    if (!this.panel) this.init();
    const track = this.resolveTrack(trackOrId);
    if (!track || !track.id) return;

    this.currentTrackId = track.id;
    this.updateTrackDetails(track);

    const isPanelOpen = this.isPanelVisible();

    if (isPanelOpen) {
      this.resetScroller();
      const cached = this.lyricsCache.get(track.id) || this.getLocalStorageLyrics(track.id);
      if (cached) {
        this.applyLyricsData(track.id, cached.content, cached.type, true);
      } else {
        this.container.innerHTML = '<div class="lyric-empty"><div class="loader"></div><span>Searching for synchronized lyrics...</span></div>';
        this.loadLyrics(track);
      }
    } else {
      // Proactively prefetch lyrics in background
      this.prefetchLyrics(track);
    }

    // Also prefetch lyrics for Up Next track in queue
    if (window.playlists?.activeQueue) {
      const q = window.playlists.activeQueue;
      const idx = window.playlists.activeQueueIndex;
      if (idx >= 0 && idx + 1 < q.length) {
        const upNext = q[idx + 1];
        if (upNext && upNext.id) {
          setTimeout(() => this.prefetchLyrics(upNext), 400);
        }
      }
    }
  }


  getLocalStorageLyrics(trackId) {
    try {
      const content = localStorage.getItem('wavevault_lrc_' + trackId);
      if (content && content.trim()) {
        const isLrc = content.includes('[0') || content.includes('[1') || content.includes('[2');
        const type = isLrc ? 'lrc' : 'plain';
        this.lyricsCache.set(trackId, { type, content });
        return { type, content };
      }
    } catch (_) {}
    return null;
  }

  applyLyricsData(trackId, content, type, shouldRender = true) {
    if (!content || !content.trim()) return;

    // Cache in memory and localStorage
    this.lyricsCache.set(trackId, { type, content });
    try {
      localStorage.setItem('wavevault_lrc_' + trackId, content);
    } catch (_) {}

    if (this.currentTrackId !== trackId) return;

    this.lyricsType = type;
    if (type === 'lrc') {
      this.parseLRC(content);
    }

    if (shouldRender && this.container) {
      this.container.innerHTML = '';
      if (type === 'lrc') {
        this.renderLRC();
      } else {
        this.renderPlain(content);
      }
      if (window.player) {
        this.update(window.player.currentTime || 0);
      }
    }
  }

  /**
   * Unconditional background lyrics fetcher.
   * Runs silently in the background even when lyrics panel is hidden.
   * Ensures lyrics are stored locally for immediate offline playback.
   */
  async prefetchLyrics(trackOrId) {
    const track = this.resolveTrack(trackOrId);
    if (!track || !track.id) return null;
    const trackId = track.id;

    // 1. Check in-memory cache
    if (this.lyricsCache.has(trackId)) {
      return this.lyricsCache.get(trackId);
    }

    // 2. Check localStorage
    const local = this.getLocalStorageLyrics(trackId);
    if (local) {
      return local;
    }

    // Avoid duplicate parallel requests for the same track
    if (this.fetchingTracks.has(trackId)) {
      return null;
    }
    this.fetchingTracks.add(trackId);

    try {
      // 3. Query multi-tier backend lyrics engine (disk cache, embedded tags, companion .lrc)
      const data = await window.api.getLyrics(trackId, track.title, track.artist);

      if (data && (data.type === 'lrc' || data.type === 'plain') && data.content && data.content.trim()) {
        const isPanelOpen = this.panel && this.panel.classList.contains('show');
        this.applyLyricsData(trackId, data.content, data.type, isPanelOpen);
        this.fetchingTracks.delete(trackId);
        return { type: data.type, content: data.content };
      }

      // 4. Client-side LRCLIB online fallback (only if online)
      if (navigator.onLine && (track.title || track.artist)) {
        let cleanTitle = (track.title || '')
          .replace(/\(Official.*?\)|\[Official.*?\]|\(Music Video\)|\(Audio\)|\[Audio\]|\(Visualizer\)|\(Lyric Video\)|ft\..*|feat\..*/gi, '')
          .replace(/[\(\[\{][^\)\]\}]*$/g, '')
          .replace(/[-:;,]+$/g, '')
          .trim();
        let cleanArtist = (track.artist || '')
          .replace(/VEVO|Official/gi, '')
          .replace(/[-:;,]+$/g, '')
          .trim();
        const q = `${cleanArtist} ${cleanTitle}`.trim();

        if (q) {
          try {
            const resp = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
            if (resp.ok) {
              const list = await resp.json();
              if (Array.isArray(list) && list.length > 0) {
                const match = list.find(item => item.syncedLyrics) || list[0];
                const content = match.syncedLyrics || match.plainLyrics;
                const type = match.syncedLyrics ? 'lrc' : 'plain';

                if (content && content.trim()) {
                  // Persist to local disk cache through backend API
                  window.api.saveLyrics(trackId, content, type, track.title, track.artist).catch(() => {});

                  const isPanelOpen = this.panel && this.panel.classList.contains('show');
                  this.applyLyricsData(trackId, content, type, isPanelOpen);
                  this.fetchingTracks.delete(trackId);
                  return { type, content };
                }
              }
            }
          } catch (_) {}
        }
      }

      if (this.currentTrackId === trackId && this.panel && this.panel.classList.contains('show')) {
        this.renderEmpty("No synchronized lyrics found for this song.");
      }
    } catch (err) {
      console.warn("[Lyrics] Prefetch error:", err);
    } finally {
      this.fetchingTracks.delete(trackId);
    }
    return null;
  }

  async loadLyrics(trackOrId) {
    if (!this.container) this.init();
    const track = this.resolveTrack(trackOrId);
    if (!track || !track.id) return;

    this.currentTrackId = track.id;
    this.updateTrackDetails(track);

    // 1. Instant check from memory cache or localStorage
    const cached = this.lyricsCache.get(track.id) || this.getLocalStorageLyrics(track.id);
    if (cached) {
      this.applyLyricsData(track.id, cached.content, cached.type, true);
      return;
    }

    // 2. Show loading spinner while prefetch completes
    this.resetScroller();
    this.container.innerHTML = '<div class="lyric-empty"><div class="loader"></div><span>Searching for synchronized lyrics...</span></div>';

    // 3. Trigger prefetch
    await this.prefetchLyrics(track);
  }

  parseLRC(lrcText) {
    const lines = lrcText.split('\n');
    this.lrcLines = [];

    lines.forEach(line => {
      const matches = [...line.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g)];
      if (matches.length === 0) return;

      const text = line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();

      matches.forEach(match => {
        const mm = parseInt(match[1], 10);
        const ss = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3], 10) : 0;
        const time = mm * 60 + ss + (ms / (match[3] && match[3].length === 3 ? 1000 : 100));
        this.lrcLines.push({ time, text });
      });
    });

    this.lrcLines.sort((a, b) => a.time - b.time);
  }

  renderLRC() {
    this.lrcLines.forEach((line, index) => {
      const el = document.createElement('div');
      el.className = 'lyric-line';
      el.innerText = line.text || '♪ ♪ ♪';

      el.addEventListener('click', () => {
        this.isUserScrolling = false;
        clearTimeout(this.userScrollTimer);
        if (window.player) {
          window.player.seekTo(line.time);
          this.update(line.time, true);
        }
      });

      this.container.appendChild(el);
      line.element = el;
    });
  }

  renderPlain(content) {
    const el = document.createElement('div');
    el.className = 'lyric-plain-text';
    el.innerText = content;
    this.container.appendChild(el);
  }

  renderEmpty(message) {
    this.container.innerHTML = `
      <div class="lyric-empty">
        <i data-lucide="music-4"></i>
        <span>${message}</span>
      </div>
    `;
    if (window.lucide) {
      window.lucide.createIcons({ container: this.container });
    }
  }

  scrollToActiveLine(smooth = true) {
    if (this.isUserScrolling) return;
    if (this.lastActiveIndex < 0 || !this.container) return;
    const activeLine = this.lrcLines[this.lastActiveIndex];
    if (!activeLine || !activeLine.element) return;

    const container = this.container;
    const activeEl = activeLine.element;

    const containerRect = container.getBoundingClientRect();
    const lineRect = activeEl.getBoundingClientRect();

    if (containerRect.height <= 0) return;

    // Calculate exact center position
    const lineCenter = lineRect.top + (lineRect.height / 2);
    const containerCenter = containerRect.top + (containerRect.height / 2);
    const delta = lineCenter - containerCenter;

    if (Math.abs(delta) > 1.5) {
      const targetScrollTop = container.scrollTop + delta;
      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }

  startSyncLoop() {
    if (this._syncLoopRunning) return;
    this._syncLoopRunning = true;

    const syncTick = () => {
      if (!this.isPanelVisible()) {
        this._syncLoopRunning = false;
        return;
      }

      if (window.player && window.player.isPlaying) {
        const curTime = Number.isFinite(window.player.activeAudio?.currentTime)
          ? window.player.activeAudio.currentTime
          : (window.player.currentTime || 0);
        this.update(curTime);
      }

      requestAnimationFrame(syncTick);
    };

    requestAnimationFrame(syncTick);
  }

  update(currentTime, forceScroll = false) {
    // 1. Sync Lyrics Line Highlight & Smooth Scrolling (every single line transitions on beat)
    if (this.lyricsType === 'lrc' && this.lrcLines.length > 0) {
      let activeIndex = -1;
      const targetTime = currentTime + 0.15; // 150ms anticipation offset for human audio/visual alignment
      for (let i = 0; i < this.lrcLines.length; i++) {
        if (this.lrcLines[i].time <= targetTime) {
          activeIndex = i;
        } else {
          break;
        }
      }

      if (activeIndex !== this.lastActiveIndex || forceScroll) {
        this.lastActiveIndex = activeIndex;
        const isVisible = this.isPanelVisible();

        if (isVisible) {
          // Update classes on all lines
          for (let i = 0; i < this.lrcLines.length; i++) {
            const line = this.lrcLines[i];
            if (!line?.element) continue;

            if (i === activeIndex) {
              line.element.classList.remove('passed');
              line.element.classList.add('active');
            } else if (i < activeIndex) {
              line.element.classList.remove('active');
              line.element.classList.add('passed');
            } else {
              line.element.classList.remove('active', 'passed');
            }
          }

          if (activeIndex !== -1) {
            this.scrollToActiveLine(!forceScroll);
          }
        }
      }
    }

    // 2. Sync In-View Player Scrubber & Time
    if (this.isPanelVisible()) {
      const duration = this.getDuration();
      const elapsedEl = document.getElementById('lyrics-time-elapsed');
      const remainEl = document.getElementById('lyrics-time-remaining');
      const seekBar = document.getElementById('lyrics-seek-bar');

      if (elapsedEl) elapsedEl.textContent = this.formatTime(currentTime);
      if (remainEl) remainEl.textContent = this.formatTime(Math.max(0, duration - currentTime));


      if (seekBar && !this.isUserDraggingScrubber && duration > 0) {
        seekBar.value = (currentTime / duration) * 100;
      }

      this.syncControlStates();
    }
  }

  syncControlStates() {
    if (!window.player) return;

    // Play/pause button icon
    const btnPlay = document.getElementById('lyrics-btn-play');
    if (btnPlay) {
      const isPlaying = window.player.isPlaying;
      btnPlay.innerHTML = `<i data-lucide="${isPlaying ? 'pause' : 'play'}"></i>`;
      if (window.lucide) window.lucide.createIcons({ container: btnPlay });
    }

    // Like button state
    if (window.player && window.player.currentTrack) {
      window.player.updateLikeButton(window.player.currentTrack.id);
    }

    // Shuffle & Repeat buttons
    const btnShuffle = document.getElementById('lyrics-btn-shuffle');
    if (btnShuffle && window.playlists) {
      btnShuffle.classList.toggle('active', !!window.playlists.isShuffled);
      btnShuffle.title = window.playlists.isShuffled ? 'Shuffle Enabled' : 'Shuffle Disabled';
    }

    const btnRepeat = document.getElementById('lyrics-btn-repeat');
    if (btnRepeat && window.playlists) {
      const mode = window.playlists.repeatMode || 'off';
      btnRepeat.classList.toggle('active', mode !== 'off');
      btnRepeat.title = mode === 'one' ? 'Repeat One' : (mode === 'all' ? 'Repeat All' : 'Repeat Off');
      
      // Update repeat icon or label if repeat one
      if (mode === 'one') {
        btnRepeat.innerHTML = '<i data-lucide="repeat-1"></i>';
      } else {
        btnRepeat.innerHTML = '<i data-lucide="repeat"></i>';
      }
      if (window.lucide) window.lucide.createIcons({ container: btnRepeat });
    }

    // Volume & Mute
    const volSlider = document.getElementById('lyrics-vol-slider');
    if (volSlider) {
      volSlider.value = Math.round((window.player.volume ?? 1) * 100);
    }

    const btnMute = document.getElementById('lyrics-btn-mute');
    if (btnMute) {
      const isMuted = !!window.player.isMuted;
      btnMute.innerHTML = `<i data-lucide="${isMuted ? 'volume-x' : 'volume-2'}"></i>`;
      if (window.lucide) window.lucide.createIcons({ container: btnMute });
    }
  }

  getDuration() {
    if (window.player) {
      const d = window.player.activeAudio?.duration;
      if (d && !isNaN(d) && isFinite(d) && d > 0) return d;
      if (window.player.currentTrack?.duration) return window.player.currentTrack.duration;
    }
    return 0;
  }

  formatTime(secs) {
    if (isNaN(secs) || secs < 0) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

window.lyrics = new LyricsManager();
