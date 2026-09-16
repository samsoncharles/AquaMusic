// AquaMusic Main Application Coordinator SPA Orchestration
class MainApp {
  constructor() {
    this.currentView = 'songs';
    this.pathSeparator = '/';
    this.isWindows = false;
    
    // Swipe gestures state variables
    this.startY = 0;
    this.startX = 0;
    this.nowPlayingPanel = null;
  }

  async boot() {
    const bootStartedAt = performance.now();
    // Restore settings/theme/playback preferences before any manager reads
    // localStorage. The source of truth is the per-user SQLite database.
    await window.persistence.init();
    try {
      window.onlineTracks = JSON.parse(localStorage.getItem('wavevault_online_tracks') || '{}');
    } catch (_) {
      window.onlineTracks = {};
    }
    // 1. Determine local OS path separator
    this.detectOS();

    // 2. Initialize all helper sub-managers
    window.themes.init();
    await window.ratings.init();
    window.settings.init();
    await window.playlists.init();
    window.waveformSeekbar.init();
    window.lyrics.init();
    window.eq.init();
    window.keyboard.init();
    window.contextMenu.init();
    window.tagger.init();
    if (window.sleepTimer) window.sleepTimer.init();

    // 3. Load library database
    await window.library.load();

    // 4. Register sidebar navigation links clicks
    this.bindSidebarNavigation();

    // 5. Setup mobile swiping sheet and gestures
    this.initMobileGestures();

    // 6. Render Smart Playlists submenu lists

    // 7. Hide boot loading screen with a fade
    // Desktop WebEngine can initialise much faster than a normal browser.
    // Keep the same visible loading animation long enough to avoid a blank
    // window flash and make startup feel consistent with the web version.
    const minimumLoaderTime = 700;
    const remainingLoaderTime = minimumLoaderTime - (performance.now() - bootStartedAt);
    if (remainingLoaderTime > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingLoaderTime));
    }

    const loader = document.getElementById('loading-screen');
    if (loader) {
      loader.style.transition = 'opacity 0.4s ease';
      loader.style.opacity = '0';
      setTimeout(() => loader.style.display = 'none', 400);
    }

    // 8. Restore last active session playhead states
    this.restoreLastSession();
  }

  detectOS() {
    // Basic test if paths contain backslashes (Windows)
    const testPath = Object.values(window.library.tracks)[0]?.path || '';
    if (testPath.includes('\\')) {
      this.pathSeparator = '\\';
      this.isWindows = true;
    } else {
      this.pathSeparator = '/';
      this.isWindows = false;
    }
  }

  bindSidebarNavigation() {
    // Global modal close logic
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = e.currentTarget.getAttribute('data-modal-close');
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
      });
    });

    // Global sidebar context menu
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.addEventListener('contextmenu', (e) => {
        // Only trigger if we clicked directly on an empty sidebar area or non-clickable element
        if (e.target.closest('.playlist-item')) return; // playlist items have their own context menu
        
        e.preventDefault();
        if (window.contextMenu) window.contextMenu.showForSidebar(e.clientX, e.clientY);
      });
    }

    // Main links
    document.querySelectorAll('#sidebar nav .sidebar-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        if (view) this.switchView(view);
      });
    });


    // Hamburger button (mobile Drawer toggle & desktop collapse toggle)
    const btnBurger = document.getElementById('btn-hamburger');
    const layout = document.getElementById('main-layout');
    if (btnBurger && layout) {
      btnBurger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isMobile = window.innerWidth <= 1080;
        if (isMobile) {
          layout.classList.toggle('sidebar-open');
        } else {
          layout.classList.toggle('sidebar-collapsed');
          // Trigger canvas resize
          setTimeout(() => {
            if (window.waveformSeekbar) window.waveformSeekbar.resize();
            if (window.visualizer) window.visualizer.resize();
          }, 350);
        }
      });

      // Close drawer if click content area or now playing panel (mobile only)
      const closeSidebarOnMobile = () => {
        if (window.innerWidth <= 1080) layout.classList.remove('sidebar-open');
      };
      
      const btnSidebarClose = document.getElementById('btn-sidebar-close');
      if (btnSidebarClose) {
        btnSidebarClose.addEventListener('click', closeSidebarOnMobile);
      }

      document.getElementById('content-area').addEventListener('click', closeSidebarOnMobile);
      const npPanel = document.getElementById('now-playing-panel');
      if (npPanel) npPanel.addEventListener('click', (e) => {
        // Only close if we clicked outside the actual now playing content or if we just want to dismiss sidebar
        closeSidebarOnMobile();
      });
    }

    // Bind Mini player detail click to open Now playing sheet on mobile
    const miniDetail = document.getElementById('player-details-trigger');
    if (miniDetail) {
      miniDetail.addEventListener('click', () => {
        // Expand now playing
        this.toggleNowPlayingPanel(true);
      });
    }

    // Close button now playing
    const btnCloseNP = document.getElementById('btn-close-nowplaying');
    if (btnCloseNP) {
      btnCloseNP.addEventListener('click', () => {
        this.toggleNowPlayingPanel(false);
      });
    }

    // Desktop Mini-player expand panel button
    const btnExpandNP = document.getElementById('btn-toggle-panel');
    if (btnExpandNP) {
      btnExpandNP.addEventListener('click', () => {
        this.toggleNowPlayingPanel();
      });
    }

    // Global Search keyboard listener
    const gSearch = document.getElementById('global-search');
    if (gSearch) {
      gSearch.addEventListener('input', (e) => {
        if (window.library) window.library.setSearchQuery(e.target.value);
      });
      gSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = gSearch.value.trim();
          if (val) {
            this.switchView('online');
            setTimeout(() => {
              const onlineInput = document.getElementById('online-search-input');
              if (onlineInput) {
                onlineInput.value = val;
                if (window.views && window.views.triggerOnlineSearch) {
                  window.views.triggerOnlineSearch(val);
                }
              }
            }, 80);
          }
        }
      });
      gSearch.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text')?.trim();
        if (text && (text.startsWith('http://') || text.startsWith('https://') || text.includes('youtube.com') || text.includes('youtu.be'))) {
          e.preventDefault();
          gSearch.value = text;
          this.switchView('online');
          setTimeout(() => {
            const onlineInput = document.getElementById('online-search-input');
            if (onlineInput) {
              onlineInput.value = text;
            }
            if (window.views && window.views.triggerOnlineSearch) {
              window.views.triggerOnlineSearch(text);
            }
          }, 80);
        }
      });
    }

    // ===== PLAYER TRANSPORT CONTROLS =====
    const triggerPulse = (el) => {
      if (!el) return;
      el.classList.remove('pulse-active');
      void el.offsetWidth; // Trigger reflow
      el.classList.add('pulse-active');
      setTimeout(() => el.classList.remove('pulse-active'), 400);
    };

    const btnPlayPause = document.getElementById('btn-play-pause');
    if (btnPlayPause) {
      btnPlayPause.addEventListener('click', () => {
        triggerPulse(btnPlayPause);
        if (window.player) window.player.togglePlay();
      });
    }

    const btnNext = document.getElementById('btn-next');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        triggerPulse(btnNext);
        if (window.player) window.player.next();
      });
    }

    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        triggerPulse(btnPrev);
        if (window.player) window.player.prev();
      });
    }

    const btnShuffle = document.getElementById('btn-shuffle');
    if (btnShuffle) {
      btnShuffle.addEventListener('click', () => {
        triggerPulse(btnShuffle);
        if (window.playlists) {
          window.playlists.toggleShuffle();
        }
      });
    }

    const btnAutopilot = document.getElementById('btn-autopilot');
    if (btnAutopilot) {
      btnAutopilot.addEventListener('click', () => {
        triggerPulse(btnAutopilot);
        if (window.playlists) {
          window.playlists.toggleAutopilot();
        }
      });
    }

    const btnRepeat = document.getElementById('btn-repeat');
    if (btnRepeat) {
      btnRepeat.addEventListener('click', () => {
        triggerPulse(btnRepeat);
        if (window.playlists) {
          window.playlists.cycleRepeat();
        }
      });
    }

    // Like button in Now Playing panel
    const btnLike = document.getElementById('btn-like-track');
    if (btnLike) {
      btnLike.addEventListener('click', () => {
        triggerPulse(btnLike);
        if (window.player) window.player.toggleLike();
      });
    }

    // Visualizer mode toggle in Now Playing panel
    const btnVisualizer = document.getElementById('btn-visualizer-mode');
    if (btnVisualizer) {
      btnVisualizer.addEventListener('click', () => {
        triggerPulse(btnVisualizer);
        if (window.visualizer) window.visualizer.cycleMode();
      });
    }

    const btnMute = document.getElementById('btn-mute');
    if (btnMute) {
      btnMute.addEventListener('click', () => {
        triggerPulse(btnMute);
        if (window.player) window.player.toggleMute();
      });
    }

    // Bind crossfade toggling directly on the player bar
    const btnCrossfadeToggle = document.getElementById('btn-player-crossfade-toggle');
    if (btnCrossfadeToggle) {
      // Set initial visual active state from configuration
      const isXEnabled = localStorage.getItem('wavevault_crossfade_enabled') !== 'false';
      btnCrossfadeToggle.classList.toggle('active', isXEnabled);

      btnCrossfadeToggle.addEventListener('click', () => {
        triggerPulse(btnCrossfadeToggle);
        if (window.player) {
          const newState = !window.player.crossfadeEnabled;
          window.player.crossfadeEnabled = newState;
          localStorage.setItem('wavevault_crossfade_enabled', newState.toString());
          btnCrossfadeToggle.classList.toggle('active', newState);
          
          // Sync Settings Modal Checkbox
          const chkCrossfade = document.getElementById('setting-crossfade-enabled');
          if (chkCrossfade) chkCrossfade.checked = newState;
          
          window.toast.show(`Crossfade transitions ${newState ? 'enabled' : 'disabled'}`, 'info');
        }
      });
    }

    // Vol Slider Drag clicks
    const volContainer = document.getElementById('volume-slider-container');
    if (volContainer) {
      let isVolDragging = false;
      const setVol = (e) => {
        const rect = volContainer.getBoundingClientRect();
        const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1.0));
        if (window.player) window.player.setVolume(pct);
      };

      volContainer.addEventListener('mousedown', (e) => {
        isVolDragging = true;
        setVol(e);
      });

      window.addEventListener('mousemove', (e) => {
        if (isVolDragging) setVol(e);
      });

      window.addEventListener('mouseup', () => {
        isVolDragging = false;
      });
    }

    // Master Timeline Progress Slider drag clicks & touch scrub
    const timelineContainer = document.getElementById('timeline-slider-container');
    if (timelineContainer) {
      let isTimelineDragging = false;
      const fill = document.getElementById('timeline-slider-fill');
      const handle = document.getElementById('timeline-slider-handle');
      const lblCurrent = document.getElementById('time-current');

      const getPctFromEvent = (e) => {
        const rect = timelineContainer.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : ((e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : e.clientX);
        return Math.max(0, Math.min((clientX - rect.left) / rect.width, 1.0));
      };

      const updateVisualScrub = (pct) => {
        if (fill) fill.style.width = `${pct * 100}%`;
        if (handle) handle.style.left = `${pct * 100}%`;
        if (lblCurrent && window.player) {
          const duration = window.player.getDuration();
          if (duration > 0) {
            lblCurrent.innerText = window.player.formatTime(pct * duration);
          }
        }
      };

      const commitSeek = (pct) => {
        if (!window.player || !window.player.currentTrack) return;
        const duration = window.player.getDuration();
        if (duration > 0 && isFinite(duration)) {
          window.player.seekTo(pct * duration);
        }
      };

      const onStart = (e) => {
        if (!window.player || !window.player.currentTrack) return;
        isTimelineDragging = true;
        if (window.player) window.player.isUserSeeking = true;
        const pct = getPctFromEvent(e);
        updateVisualScrub(pct);
      };

      const onMove = (e) => {
        if (!isTimelineDragging) return;
        const pct = getPctFromEvent(e);
        updateVisualScrub(pct);
      };

      const onEnd = (e) => {
        if (!isTimelineDragging) return;
        const pct = getPctFromEvent(e);
        commitSeek(pct);
        isTimelineDragging = false;
        if (window.player) {
          setTimeout(() => { if (window.player) window.player.isUserSeeking = false; }, 60);
        }
      };

      timelineContainer.addEventListener('mousedown', onStart);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);

      timelineContainer.addEventListener('touchstart', onStart, { passive: true });
      window.addEventListener('touchmove', onMove, { passive: true });
      window.addEventListener('touchend', onEnd);
    }
  }

  /* ----------------------------------------------------
     Mobile Drawer Sheet and Cover Art Gestures (Module 23)
     ---------------------------------------------------- */
  initMobileGestures() {
    this.nowPlayingPanel = document.getElementById('now-playing-panel');
    const dragHandle = document.getElementById('drag-handle-nowplaying');
    const coverArtFrame = document.getElementById('nowplaying-art-frame');

    if (!this.nowPlayingPanel) return;

    // 1. Swipe down on handle / panel to collapse Now Playing bottom sheet
    const handleTouchStart = (e) => {
      this.startY = e.touches[0].clientY;
      this.nowPlayingPanel.style.transition = 'none'; // pause transition during drag
    };

    const handleTouchMove = (e) => {
      const currentY = e.touches[0].clientY;
      const deltaY = currentY - this.startY;
      
      if (deltaY > 0) { // Only allow dragging downwards
        // Shift panel offset visually
        this.nowPlayingPanel.style.transform = `translateY(${deltaY - window.innerHeight * 0.9}px)`;
      }
    };

    const handleTouchEnd = (e) => {
      const currentY = e.changedTouches[0].clientY;
      const deltaY = currentY - this.startY;
      
      this.nowPlayingPanel.style.transition = ''; // restore CSS transitions
      
      if (deltaY > 120) {
        // Collapse sheet
        this.toggleNowPlayingPanel(false);
      } else {
        // Snap back open
        this.nowPlayingPanel.style.transform = '';
        this.nowPlayingPanel.classList.add('expanded');
      }
    };

    if (dragHandle) {
      dragHandle.addEventListener('touchstart', handleTouchStart);
      dragHandle.addEventListener('touchmove', handleTouchMove);
      dragHandle.addEventListener('touchend', handleTouchEnd);
    }

    // 2. Swipe Left / Right on Album cover art to skip / prev tracks
    if (coverArtFrame) {
      coverArtFrame.addEventListener('touchstart', (e) => {
        this.startX = e.touches[0].clientX;
        this.startY = e.touches[0].clientY;
      });

      coverArtFrame.addEventListener('touchend', (e) => {
        const deltaX = e.changedTouches[0].clientX - this.startX;
        const deltaY = e.changedTouches[0].clientY - this.startY;

        // Ensure horizontal swipe is dominant and large enough
        if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 40) {
          if (deltaX > 0) {
            // Swipe Right: Prev track
            if (window.player) window.player.prev();
          } else {
            // Swipe Left: Next track
            if (window.player) window.player.next();
          }
        }
      });

      // 3. Double-tap cover art -> Toggle Play/Pause + render custom heart zoom
      let lastTap = 0;
      coverArtFrame.addEventListener('click', (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        
        if (tapLength < 250 && tapLength > 0) {
          e.preventDefault();
          this.triggerDoubleTapHeart();
        }
        lastTap = currentTime;
      });
    }
  }

  triggerDoubleTapHeart() {
    // Toggle play state
    if (window.player) {
      window.player.togglePlay();
    }

    // Trigger Heart Overlay Animation (Module 23 double tap heart)
    const heart = document.getElementById('heart-anim-overlay');
    if (heart) {
      heart.classList.add('animate');
      setTimeout(() => {
        heart.classList.remove('animate');
      }, 700);
    }
  }

  toggleNowPlayingPanel(forceState = null) {
    const layout = document.getElementById('main-layout');
    const panel = this.nowPlayingPanel;
    if (!panel) return;

    // Check desktop toggle vs mobile sheet toggle (matches CSS 1080px breakpoint)
    const isMobile = window.innerWidth <= 1080;

    if (isMobile) {
      const show = (forceState !== null) ? forceState : !panel.classList.contains('expanded');
      
      panel.style.transform = ''; // clear drag overrides
      panel.classList.toggle('expanded', show);
      
      // Lock / unlock body scroll and add class to expand player tools
      document.body.style.overflow = show ? 'hidden' : '';
      document.body.classList.toggle('now-playing-expanded', show);
    } else {
      // Desktop: collapse Now Playing panel to 0 width
      if (layout) {
        const show = (forceState !== null) ? forceState : layout.classList.contains('no-nowplaying');
        layout.classList.toggle('no-nowplaying', !show);
        
        const btn = document.getElementById('btn-toggle-panel');
        if (btn) {
          const icon = btn.querySelector('i');
          if (icon) {
            icon.setAttribute('data-lucide', show ? 'minimize-2' : 'maximize-2');
            if (window.lucide) window.lucide.createIcons({ nodeList: [icon] });
          }
        }
      }
    }

    // Force resize of waveform seekbar and visualizer after layout transition
    setTimeout(() => {
      if (window.waveformSeekbar) window.waveformSeekbar.resize();
      if (window.visualizer) window.visualizer.resize();
    }, 350);
  }

  /* ----------------------------------------------------
     SPA SWITCH VIEW ROUTER
     ---------------------------------------------------- */
  switchView(viewName) {
    this.currentView = viewName;

    // Remove active markers on sidebar items
    document.querySelectorAll('.sidebar-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === viewName);
    });

    const contentPanel = document.getElementById('content-area');
    if (!contentPanel) return;

    // Reset scroll positions
    contentPanel.scrollTop = 0;

    // Sub-view routing
    if (viewName === 'songs') {
      window.library.applyFiltersAndSorts();
      window.library.renderSongsView();
    } else if (viewName === 'albums') {
      window.views.renderAlbums();
    } else if (viewName === 'artists') {
      window.views.renderArtists();
    } else if (viewName === 'genres') {
      window.views.renderGenres();
    } else if (viewName === 'folders') {
      let lastFolder = localStorage.getItem('wavevault_folder_path') || '';
      if (lastFolder === '/') lastFolder = '';
      window.views.renderFolders(lastFolder);
    } else if (viewName === 'favorites') {
      // Pre-filter favorites in library and render in table
      window.library.sortKeys = [];
      window.library.searchQuery = '';
      window.library.clearAdvancedFilters();
      
      window.library.visibleTracksList = Object.values(window.library.tracks).filter(t => 
        window.ratings.getRating(t.id) >= 4
      );
      
      window.library.renderSongsView();
      
      const title = document.getElementById('library-view-title');
      if (title) title.innerText = 'Liked Music';
      const sub = document.getElementById('library-track-count-subtitle');
      if (sub) sub.innerText = `${window.library.visibleTracksList.length} songs rated 4+ stars`;
    } else if (viewName === 'queue') {
      window.views.renderQueueView();
    } else if (viewName === 'online') {
      window.views.renderOnlineView();
    } else if (viewName.startsWith('playlist-')) {
      const plId = viewName.replace('playlist-', '');
      window.views.renderPlaylistView(plId);
    }

    // Close Mobile Drawer Sidebar on view transition
    document.getElementById('main-layout').classList.remove('sidebar-open');
    if (window.innerWidth <= 1080) {
      this.toggleNowPlayingPanel(false);
    }
  }

  refreshCurrentView() {
    this.switchView(this.currentView);
  }


  /* ----------------------------------------------------
     7. RESTORE STATE FROM PREVIOUS SESSION
     ---------------------------------------------------- */
  restoreLastSession() {
    // 1. Restore Volume
    const savedVol = localStorage.getItem('wavevault_volume');
    if (window.player) {
      window.player.setVolume(savedVol !== null ? parseFloat(savedVol) : 1.0);
      window.player.isMuted = localStorage.getItem('wavevault_muted') === 'true';
      window.player.setVolume(window.player.volume);
    }

    // 2. Restore playback speed
    const savedSpeed = localStorage.getItem('wavevault_playback_speed') || '1.0';
    if (window.player) {
      window.player.setPlaybackSpeed(savedSpeed);
    }

    // 3. Load last played track details in pause state
    const lastTrackId = localStorage.getItem('wavevault_last_track_id');
    if (lastTrackId && window.library.tracks[lastTrackId] && window.player) {
      const track = window.library.tracks[lastTrackId];
      window.player.currentTrack = track;
      window.player.activeAudio.src = `/api/stream/${track.id}`;
      const savedPosition = Math.max(0, Number(localStorage.getItem('wavevault_last_position') || 0));
      window.player.activeAudio.addEventListener('loadedmetadata', () => {
        // Restore the exact previous point, but keep playback paused until the
        // user presses Play; desktop apps should never start audio by surprise.
        if (savedPosition < window.player.activeAudio.duration - 1) {
          window.player.activeAudio.currentTime = savedPosition;
          window.player.onTimeUpdate();
        }
      }, { once: true });
      window.player.updateNowPlayingInfo(track.id);
    } else {
      // Default empty state Now Playing
      if (window.player) window.player.updateNowPlayingInfo(null);
    }

    // 4. Load initial view
    this.switchView('songs');
  }
}

window.mainApp = new MainApp();
window.addEventListener('DOMContentLoaded', () => window.mainApp.boot());
