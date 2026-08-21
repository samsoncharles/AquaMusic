// AquaMusic High-Performance Audio Playback Engine (Web Audio API)
class AquaMusicPlayer {
  constructor() {
    this.audioCtx = null;
    
    // Alternating Audio elements for seamless gapless / crossfade support
    this.audioA = new Audio();
    this.audioB = new Audio();
    this.audioA.preload = 'metadata';
    this.audioB.preload = 'metadata';
    this.audioA.crossOrigin = 'anonymous';
    this.audioB.crossOrigin = 'anonymous';

    this.activeAudio = this.audioA;
    this.standbyAudio = this.audioB;

    this.sourceA = null;
    this.sourceB = null;
    
    this.gainA = null;
    this.gainB = null;
    
    this.gainNode = null; // Master volume node
    this.analyser = null;  // Master visualizer analysis

    this.currentTrack = null;
    this.isPlaying = false;
    this.preloadedNext = false;
    this.isCrossfading = false;
    
    // Settings configurations
    this.crossfadeEnabled = true;
    this.crossfadeDuration = 5; // seconds
    this.sweetFadesEnabled = true;
    this.gaplessEnabled = true;
    this.replayGainEnabled = true;
    this.playbackSpeed = 1.0;
    this.isMuted = false;
    this.volume = 1.0; // Original unmodified volume
    this.lastSessionCheckpoint = 0;
  }

  /**
   * Initializes the Web Audio graph on first user interaction.
   */
  async initAudioContext() {
    if (this.audioCtx) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    // 1. Create Media Sources
    this.sourceA = this.audioCtx.createMediaElementSource(this.audioA);
    this.sourceB = this.audioCtx.createMediaElementSource(this.audioB);

    // 2. Create independent gain nodes for crossfade controls
    this.gainA = this.audioCtx.createGain();
    this.gainB = this.audioCtx.createGain();
    
    // 3. Create Master Gain & Analyser nodes
    this.gainNode = this.audioCtx.createGain();
    this.analyser = this.audioCtx.createAnalyser();

    // Set initial volume parameters
    this.gainA.gain.value = 1.0;
    this.gainB.gain.value = 0.0;
    this.gainNode.gain.value = this.volume;

    // Connect Source -> Channel Gain -> Master Gain -> EQ Chain -> Analyser -> Output
    this.sourceA.connect(this.gainA);
    this.sourceB.connect(this.gainB);
    
    this.gainA.connect(this.gainNode);
    this.gainB.connect(this.gainNode);

    // Initialize 10-Band EQ filters chain
    let lastNode = this.gainNode;
    if (window.eq) {
      const filters = window.eq.createFilters(this.audioCtx);
      filters.forEach(filter => {
        lastNode.connect(filter);
        lastNode = filter;
      });
      
      // Load saved band levels
      window.eq.loadSavedBands();
    }

    lastNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    // Link Visualizers to master analyser
    const visualizerCanvas = document.getElementById('mini-visualizer-canvas');
    const radialVisualizerCanvas = document.getElementById('art-visualizer-canvas');
    const playerVisualizerCanvas = document.getElementById('player-visualizer-canvas');
    if (visualizerCanvas && window.visualizer) {
      window.visualizer.link(visualizerCanvas, this.analyser, radialVisualizerCanvas, playerVisualizerCanvas);
    }

    // Attach Event Listeners to both audio objects
    this.setupAudioListeners(this.audioA);
    this.setupAudioListeners(this.audioB);
  }

  setupAudioListeners(audioElement) {
    audioElement.addEventListener('timeupdate', () => {
      if (audioElement !== this.activeAudio) return;
      this.onTimeUpdate();
    });

    audioElement.addEventListener('ended', () => {
      if (audioElement !== this.activeAudio) return;
      this.onTrackEnded();
    });

    audioElement.addEventListener('pause', () => {
      if (audioElement === this.activeAudio) this.saveSession(true);
    });

    audioElement.addEventListener('error', (e) => {
      console.error("[Player] Audio tag error:", e);
      window.toast.show("Playback error. Skipping track...", "error");
      this.next();
    });
  }

  /**
   * Starts playing a track by its ID.
   */
  async playTrack(trackId, forceNoCrossfade = false) {
    await this.initAudioContext();
    
    // Resume audio context if suspended (browser security)
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    if (!window.library || !window.library.tracks[trackId]) return;
    const track = window.library.tracks[trackId];
    
    this.preloadedNext = false;

    // Decide if we should crossfade or load directly
    if (this.isPlaying && this.crossfadeEnabled && this.crossfadeDuration > 0 && !forceNoCrossfade) {
      await this.crossfadeTo(trackId);
    } else {
      // Standard load
      this.currentTrack = track;
      this.activeAudio.src = `/api/stream/${track.id}`;
      this.activeAudio.playbackRate = this.playbackSpeed;
      
      // Reset channel gains
      const currentGainNode = this.activeAudio === this.audioA ? this.gainA : this.gainB;
      const standbyGainNode = this.activeAudio === this.audioA ? this.gainB : this.gainA;
      
      currentGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
      standbyGainNode.gain.setValueAtTime(0.0, this.audioCtx.currentTime);

      this.applyReplayGain(track);
      
      if (this.sweetFadesEnabled) {
        // Ramp up from 0
        this.gainNode.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
        this.activeAudio.play();
        this.rampGain(0.0, this.isMuted ? 0.0 : this.volume, 0.2);
      } else {
        this.gainNode.gain.setValueAtTime(this.isMuted ? 0.0 : this.volume, this.audioCtx.currentTime);
        this.activeAudio.play();
      }

      this.onTrackChanged(track);
    }
  }

  async togglePlay() {
    if (!this.currentTrack) return;
    
    await this.initAudioContext();

    if (this.isPlaying) {
      if (this.sweetFadesEnabled) {
        await this.rampGain(this.isMuted ? 0.0 : this.volume, 0.0, 0.2);
      }
      this.activeAudio.pause();
      this.isPlaying = false;
      this.updatePlayPauseButton();
      this.saveSession(true);
    } else {
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      this.activeAudio.play();
      this.isPlaying = true;
      this.updatePlayPauseButton();
      this.saveSession(true);
      
      if (this.sweetFadesEnabled) {
        this.gainNode.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
        await this.rampGain(0.0, this.isMuted ? 0.0 : this.volume, 0.2);
      } else {
        this.gainNode.gain.setValueAtTime(this.isMuted ? 0.0 : this.volume, this.audioCtx.currentTime);
      }
    }
  }

  async softPause() {
    if (this.isPlaying) {
      await this.togglePlay();
    }
  }

  async softResume() {
    if (!this.isPlaying) {
      await this.togglePlay();
    }
  }

  seekTo(seconds) {
    if (!this.currentTrack) return;
    this.activeAudio.currentTime = seconds;
    this.onTimeUpdate();
    this.saveSession(true);
  }

  seekRelative(secs) {
    if (!this.currentTrack) return;
    const target = this.activeAudio.currentTime + secs;
    this.seekTo(Math.max(0, Math.min(target, this.getDuration())));
  }

  setVolume(val) {
    // Standard volume capped at 1.0 (100% gain) to maintain original sound quality and prevent clipping
    this.volume = Math.max(0, Math.min(val, 1.0));
    localStorage.setItem('wavevault_volume', this.volume.toString());

    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.audioCtx.currentTime);
    }

    // Update Slider UI
    const fill = document.getElementById('volume-slider-fill');
    const handle = document.getElementById('volume-slider-handle');
    if (fill && handle) {
      const pct = this.volume * 100;
      fill.style.width = `${pct}%`;
      handle.style.left = `${pct}%`;
    }

    this.updateVolumeIcon();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('wavevault_muted', JSON.stringify(this.isMuted));
    this.setVolume(this.volume);
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = parseFloat(speed);
    localStorage.setItem('wavevault_playback_speed', this.playbackSpeed.toString());

    this.activeAudio.playbackRate = this.playbackSpeed;
    this.standbyAudio.playbackRate = this.playbackSpeed;

    const speedSelect = document.getElementById('playback-speed-select');
    if (speedSelect) speedSelect.value = speed;
  }

  applyReplayGain(track) {
    if (!this.audioCtx) return;
    
    // Default 0.0dB (no reduction) if replay gain disabled or not tagged
    const rg = (this.replayGainEnabled && track.replay_gain !== null) ? track.replay_gain : 0.0;
    const linear = Math.pow(10, rg / 20);
    const gainVal = Math.min(linear, 1.0);

    const activeChannelGain = this.activeAudio === this.audioA ? this.gainA : this.gainB;
    if (activeChannelGain) {
      activeChannelGain.gain.setValueAtTime(gainVal, this.audioCtx.currentTime);
    }
  }

  /**
   * Gradually ramps gain values over time.
   */
  rampGain(from, to, duration) {
    if (!this.gainNode || !this.audioCtx) return Promise.resolve();
    
    this.gainNode.gain.setValueAtTime(from, this.audioCtx.currentTime);
    this.gainNode.gain.linearRampToValueAtTime(to, this.audioCtx.currentTime + duration);
    return new Promise(resolve => setTimeout(resolve, duration * 1000));
  }

  /* ----------------------------------------------------
     Spotify-style Crossfading (2 audio source swap)
     ---------------------------------------------------- */
  async crossfadeTo(nextTrackId) {
    if (this.isCrossfading) return;
    this.isCrossfading = true;

    const nextTrack = window.library.tracks[nextTrackId];
    
    // 1. Prepare standby audio
    this.standbyAudio.src = `/api/stream/${nextTrackId}`;
    this.standbyAudio.playbackRate = this.playbackSpeed;
    
    // Ensure standby channel volume is 0
    const standbyGainNode = this.activeAudio === this.audioA ? this.gainB : this.gainA;
    const currentGainNode = this.activeAudio === this.audioA ? this.gainA : this.gainB;
    
    standbyGainNode.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
    
    // Compute exact ReplayGains for both tracks (default to 0.0dB if disabled)
    const currentTrack = this.currentTrack;
    const currentRG = (this.replayGainEnabled && currentTrack && currentTrack.replay_gain !== null) ? currentTrack.replay_gain : 0.0;
    const currentTargetGain = Math.min(Math.pow(10, currentRG / 20), 1.0);

    const nextRG = (this.replayGainEnabled && nextTrack.replay_gain !== null) ? nextTrack.replay_gain : 0.0;
    const targetGain = Math.min(Math.pow(10, nextRG / 20), 1.0);

    // 2. Play standby track
    try {
      await this.standbyAudio.play();
    } catch (e) {
      console.warn("Standby play failed", e);
    }

    // --- INSTANT UI SWAP ---
    // Swap references early so the UI tracks the new song immediately.
    const temp = this.activeAudio;
    this.activeAudio = this.standbyAudio;
    this.standbyAudio = temp; // standbyAudio is now the old track fading out

    this.currentTrack = nextTrack;
    this.onTrackChanged(nextTrack);

    // 3. Smooth cross-fade channel gains in parallel
    const steps = 40;
    const stepTime = (this.crossfadeDuration * 1000) / steps;

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      // Exponential power curve crossfade
      const outVal = Math.cos(progress * Math.PI / 2);
      const inVal = Math.sin(progress * Math.PI / 2);
      
      currentGainNode.gain.setValueAtTime(outVal * currentTargetGain, this.audioCtx.currentTime);
      standbyGainNode.gain.setValueAtTime(inVal * targetGain, this.audioCtx.currentTime);
      
      await new Promise(r => setTimeout(r, stepTime));
    }

    // 4. Finalize
    // The old track is now in standbyAudio, so we pause it.
    this.standbyAudio.pause();
    this.isCrossfading = false;
  }

  onTimeUpdate() {
    const curTime = this.activeAudio.currentTime;
    const duration = this.getDuration();
    
    // Update seeking layouts
    const progressPercent = duration > 0 ? (curTime / duration) : 0;
    
    // Update timeline progress fills
    const fill = document.getElementById('timeline-slider-fill');
    const handle = document.getElementById('timeline-slider-handle');
    if (fill && handle) {
      fill.style.width = `${progressPercent * 100}%`;
      handle.style.left = `${progressPercent * 100}%`;
    }

    // Update time indicators
    const lblCurrent = document.getElementById('time-current');
    if (lblCurrent) lblCurrent.innerText = this.formatTime(curTime);

    // Update Waveform progress
    if (window.waveformSeekbar) {
      window.waveformSeekbar.updateProgress(progressPercent);
    }

    // Update Up Next Analogue Countdown Clock
    const ring = document.getElementById('upnext-clock-ring');
    const minHand = document.getElementById('upnext-hand-minute');
    const secHand = document.getElementById('upnext-hand-second');
    if (ring && minHand && secHand) {
      // Progress ring empties as song plays
      const circumference = 87.964;
      ring.style.strokeDashoffset = (circumference * progressPercent).toString();
      
      // Minute hand spins 1 full rotation per song
      minHand.style.transform = `rotate(${progressPercent * 360}deg)`;
      
      // Second hand spins 1 full rotation every 60 seconds
      secHand.style.transform = `rotate(${(curTime % 60) / 60 * 360}deg)`;
    }

    // Update active Lyrics scrolling lines
    if (window.lyrics) {
      window.lyrics.update(curTime);
    }

    // Gapless pre-loading triggers (30s before end of song)
    if (this.gaplessEnabled && duration > 0 && (duration - curTime) <= 30 && !this.preloadedNext) {
      this.preloadedNext = true;
      this.prebufferNextTrack();
    }

    // AUTO CROSSFADE TRIGGERS (approaching end of song)
    if (this.isPlaying && this.crossfadeEnabled && this.crossfadeDuration > 0 && !this.isCrossfading && !this.hasTriggeredAutoCrossfade && duration > 0) {
      const timeRemaining = duration - curTime;
      if (duration > (this.crossfadeDuration + 5) && timeRemaining <= this.crossfadeDuration) {
        this.hasTriggeredAutoCrossfade = true;
        if (window.playlists) {
          const nextTrack = window.playlists.nextTrack();
          if (nextTrack) {
            console.log(`[Player] Auto-crossfading to next track: ${nextTrack.title}`);
            this.crossfadeTo(nextTrack.id);
          }
        }
      }
    }

    this.saveSession(false);
  }

  saveSession(force = false) {
    const now = Date.now();
    if (!force && now - this.lastSessionCheckpoint < 5000) return;
    if (!this.currentTrack) return;
    this.lastSessionCheckpoint = now;
    const session = {
      trackId: this.currentTrack.id,
      position: Number.isFinite(this.activeAudio.currentTime) ? this.activeAudio.currentTime : 0,
      wasPlaying: this.isPlaying,
      savedAt: now
    };
    localStorage.setItem('wavevault_last_track_id', session.trackId);
    localStorage.setItem('wavevault_last_position', session.position.toString());
    window.api.saveState('playback', session).catch(error =>
      console.warn('Could not save playback session.', error)
    );
  }

  prebufferNextTrack() {
    if (!window.playlists) return;
    const nextIdx = window.playlists.activeQueueIndex + 1;
    if (nextIdx < window.playlists.activeQueue.length) {
      const nextTrack = window.playlists.activeQueue[nextIdx];
      this.standbyAudio.src = `/api/stream/${nextTrack.id}`;
      this.standbyAudio.preload = 'auto';
      console.log(`[Gapless] Pre-buffered next track: ${nextTrack.title}`);
    }
  }

  onTrackEnded() {
    if (this.isCrossfading) return;
    
    // Fire Sleep Timer checks if running
    if (window.sleepTimer) {
      window.sleepTimer.onTrackEnded();
      if (window.sleepTimer.mode !== 'off') return;
    }

    // Increment playcount statistics
    if (this.currentTrack && window.playlists) {
      window.playlists.incrementPlayCount(this.currentTrack.id);
    }

    // Advance to next song in queue
    this.next();
  }

  next() {
    if (!window.playlists) return;
    const track = window.playlists.nextTrack(true);
    if (track) {
      this.playTrack(track.id, true);
    } else {
      this.stopAll();
    }
  }

  prev() {
    if (!window.playlists) return;
    const track = window.playlists.prevTrack(true);
    if (track) {
      this.playTrack(track.id, true);
    }
  }

  stopAll() {
    this.audioA.pause();
    this.audioB.pause();
    this.isPlaying = false;
    this.currentTrack = null;
    this.updatePlayPauseButton();
    this.updateNowPlayingInfo(null);
  }

  onTrackChanged(track) {
    this.isPlaying = true;
    this.hasTriggeredAutoCrossfade = false;
    this.updatePlayPauseButton();
    this.updateNowPlayingInfo(track.id);

    // Save states
    localStorage.setItem('wavevault_last_track_id', track.id);
    if (window.playlists) {
      localStorage.setItem('wavevault_queue_index', window.playlists.activeQueueIndex.toString());
    }
    this.saveSession(true);

    // Trigger theme dynamic color swaps
    if (window.themes) {
      window.themes.onTrackChanged(track.id);
    }

    // Trigger waveform canvas loader
    if (window.waveformSeekbar) {
      window.waveformSeekbar.loadTrackWaveform(track.id);
    }

    // Load LRC/Plain Lyrics
    if (window.lyrics) {
      window.lyrics.loadLyrics(track.id);
    }

    // Register OS Media Session bindings
    this.updateMediaSession(track);
  }

  getDuration() {
    if (this.activeAudio && !isNaN(this.activeAudio.duration)) {
      return this.activeAudio.duration;
    }
    return this.currentTrack ? this.currentTrack.duration : 0;
  }

  updatePlayPauseButton() {
    const playIcon = document.getElementById('play-pause-icon');
    const playBtn = document.getElementById('btn-play-pause');

    if (playIcon) {
      if (this.isPlaying) {
        playIcon.setAttribute('data-lucide', 'pause');
        if (playBtn) playBtn.title = "Pause (Space)";
      } else {
        playIcon.setAttribute('data-lucide', 'play');
        if (playBtn) playBtn.title = "Play (Space)";
      }
      if (window.lucide) {
        window.lucide.createIcons({ nodeList: [playIcon] });
      }
    }
  }

  updateNowPlayingInfo(trackId) {
    const titleCellMini = document.getElementById('mini-player-title');
    const artistCellMini = document.getElementById('mini-player-artist');
    const artCellMini = document.getElementById('mini-player-art');

    const titleCellLarge = document.getElementById('nowplaying-track-title');
    const artistCellLarge = document.getElementById('nowplaying-track-artist');
    const artCellLarge = document.getElementById('nowplaying-image');
    const blurArtBg = document.getElementById('nowplaying-blur-art');

    const lblDuration = document.getElementById('time-duration');
    const badgeCodec = document.getElementById('nowplaying-codec');
    const lblBitrate = document.getElementById('nowplaying-bitrate');
    const lblSamplerate = document.getElementById('nowplaying-samplerate');
    const starsWidget = document.getElementById('nowplaying-stars-widget');

    if (!trackId || !window.library || !window.library.tracks[trackId]) {
      // Show beautiful idle state
      if (titleCellMini) titleCellMini.innerText = "Not Playing";
      if (artistCellMini) artistCellMini.innerText = "Select a song";
      if (artCellMini) artCellMini.src = "/api/art/default";

      if (titleCellLarge) titleCellLarge.innerText = "Nothing Playing";
      if (artistCellLarge) artistCellLarge.innerText = "Pick a song from your library";
      if (artCellLarge) artCellLarge.src = "/api/art/default";
      if (blurArtBg) blurArtBg.style.backgroundImage = 'none';

      // Add idle class to the art wrapper for CSS-driven idle animation
      const artWrapper = document.getElementById('nowplaying-art-frame');
      if (artWrapper) artWrapper.classList.add('idle-state');

      // Hide live label and stats when idle
      const liveLabel = document.querySelector('.nowplaying-live-label');
      if (liveLabel) liveLabel.style.display = 'none';

      if (lblDuration) lblDuration.innerText = "0:00";
      if (badgeCodec) badgeCodec.innerText = "---";
      if (lblBitrate) lblBitrate.innerText = "-- kbps";
      if (lblSamplerate) lblSamplerate.innerText = "-- kHz";
      if (starsWidget) starsWidget.innerHTML = '';
      
      const upNextWidget = document.getElementById('nowplaying-upnext-widget');
      if (upNextWidget) {
        upNextWidget.style.opacity = '0';
        upNextWidget.style.transform = 'translateY(10px)';
        upNextWidget.style.pointerEvents = 'none';
      }
      return;
    }

    // Remove idle state when a track is playing
    const artWrapper = document.getElementById('nowplaying-art-frame');
    if (artWrapper) artWrapper.classList.remove('idle-state');

    // Show live label when playing
    const liveLabel = document.querySelector('.nowplaying-live-label');
    if (liveLabel) liveLabel.style.display = '';

    const track = window.library.tracks[trackId];
    const artUrl = `/api/art/${track.id}?t=${Date.now()}`;

    // Fill Mini bar UI
    if (titleCellMini) titleCellMini.innerText = track.title;
    if (artistCellMini) artistCellMini.innerText = track.artist;
    if (artCellMini) artCellMini.src = artUrl;

    // Fill Right Sidebar UI
    if (titleCellLarge) titleCellLarge.innerText = track.title;
    if (artistCellLarge) artistCellLarge.innerText = track.artist;
    if (artCellLarge) artCellLarge.src = artUrl;
    if (blurArtBg) blurArtBg.style.backgroundImage = `url(${artUrl})`;

    if (lblDuration) lblDuration.innerText = track.duration_fmt || "0:00";
    if (badgeCodec) badgeCodec.innerText = track.codec || "---";
    if (lblBitrate) {
      if (track.bitrate) {
        const mbps = (track.bitrate / 1000).toFixed(1);
        lblBitrate.innerText = track.bitrate >= 1000 ? `${mbps} mbps` : `${track.bitrate} kbps (${mbps} mbps)`;
      } else {
        lblBitrate.innerText = "-- mbps";
      }
    }
    if (lblSamplerate) lblSamplerate.innerText = track.sample_rate ? `${(track.sample_rate / 1000).toFixed(1)} kHz` : "-- kHz";

    // --- Update Up Next Widget ---
    this.updateUpNextWidget();

    // Like button state
    this.updateLikeButton(track.id);

    // Toggle active song highlight class in song-row lists
    document.querySelectorAll('.song-row').forEach(row => {
      row.classList.toggle('active-playing', row.dataset.id === trackId);
    });

    // Wait for the current view to finish rendering, then map the playing
    // track to that view's exact row. Do not use the Songs virtual list while
    // the user is looking at a playlist, folder, or queue.
    requestAnimationFrame(() => requestAnimationFrame(() => this.syncPlayingRowToCurrentView(trackId)));
  }

  syncPlayingRowToCurrentView(trackId) {
    const currentView = window.mainApp?.currentView;
    if (currentView === 'songs') {
      window.library?.scrollToTrack?.(trackId);
      return;
    }

    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;
    const row = [...contentArea.querySelectorAll('.song-row')]
      .find(candidate => candidate.dataset.id === trackId);
    if (!row) return; // The playing track is not part of the view the user chose.

    const scrollParent = this.findScrollParent(row, contentArea);
    if (!scrollParent) return;

    const rowRect = row.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    const targetTop = Math.max(
      0,
      scrollParent.scrollTop + rowRect.top - parentRect.top - (parentRect.height - rowRect.height) / 2
    );
    if (Math.abs(scrollParent.scrollTop - targetTop) > 4) {
      scrollParent.scrollTo({ top: targetTop, behavior: 'smooth' });
    }

    row.classList.remove('jump-pulse');
    void row.offsetWidth;
    row.classList.add('jump-pulse');
  }

  findScrollParent(element, fallback) {
    let parent = element.parentElement;
    while (parent && parent !== fallback) {
      const style = window.getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return fallback.scrollHeight > fallback.clientHeight ? fallback : null;
  }

  updateVolumeIcon() {
    const icon = document.getElementById('volume-icon');
    if (!icon) return;

    let iconName = 'volume-2';
    if (this.isMuted || this.volume === 0) {
      iconName = 'volume-x';
    } else if (this.volume < 0.3) {
      iconName = 'volume';
    } else if (this.volume < 0.7) {
      iconName = 'volume-1';
    }

    icon.setAttribute('data-lucide', iconName);
    if (window.lucide) {
      window.lucide.createIcons({ nodeList: [icon] });
    }
  }

  updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: [
        { src: `/api/art/${track.id}`, sizes: '256x256', type: 'image/jpeg' },
        { src: `/api/art/${track.id}`, sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => this.softResume());
    navigator.mediaSession.setActionHandler('pause', () => this.softPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.fastSeek && 'fastSeek' in this.activeAudio) {
        this.activeAudio.fastSeek(details.seekTime);
      } else {
        this.seekTo(details.seekTime);
      }
    });
  }

  formatTime(secs) {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  updateLikeButton(trackId) {
    const btn = document.getElementById('btn-like-track');
    if (!btn) return;
    const isLiked = window.ratings && window.ratings.getRating(trackId) >= 4;
    btn.classList.toggle('liked', isLiked);
    btn.title = isLiked ? 'Unlike this track' : 'Like this track';
    
    const icon = btn.querySelector('i');
    if (icon) {
      if (isLiked) {
        icon.setAttribute('data-lucide', 'heart');
        btn.style.color = 'var(--accent)';
      } else {
        icon.setAttribute('data-lucide', 'heart');
        btn.style.color = '';
      }
      if (window.lucide) window.lucide.createIcons({ nodeList: [icon] });
    }
    // Fill the SVG if liked
    const svg = btn.querySelector('svg');
    if (svg) {
      svg.style.fill = isLiked ? 'var(--accent)' : 'none';
      svg.style.stroke = isLiked ? 'var(--accent)' : 'currentColor';
    }
  }

  toggleLike() {
    if (!this.currentTrack || !window.ratings) return;
    const trackId = this.currentTrack.id;
    const currentRating = window.ratings.getRating(trackId);
    const isLiked = currentRating >= 4;
    
    if (isLiked) {
      window.ratings.setRating(trackId, 0);
      window.toast.show('Removed from Liked Music', 'info');
    } else {
      window.ratings.setRating(trackId, 5);
      window.toast.show('Added to Liked Music', 'success');
    }
    this.updateLikeButton(trackId);
    
    // Refresh star widget too
    const starsWidget = document.getElementById('nowplaying-stars-widget');
    if (starsWidget) window.ratings.render(starsWidget, trackId, true);
  }
  updateUpNextWidget() {
    const upNextWidget = document.getElementById('nowplaying-upnext-widget');
    if (upNextWidget && window.playlists) {
      const nextTrack = window.playlists.peekNextTrack();
      if (nextTrack) {
        // If we want a fresh animation every time it updates:
        upNextWidget.style.opacity = '0';
        upNextWidget.style.transform = 'translateY(10px)';
        upNextWidget.style.pointerEvents = 'none';

        setTimeout(() => {
          document.getElementById('upnext-art-thumb').src = `/api/art/${nextTrack.id}`;
          document.getElementById('upnext-track-title').innerText = nextTrack.title;
          document.getElementById('upnext-track-artist').innerText = nextTrack.artist;
          
          // Animate in
          upNextWidget.style.opacity = '1';
          upNextWidget.style.transform = 'translateY(0)';
          upNextWidget.style.pointerEvents = 'auto';
        }, 150);
        
        // Ensure click handler is set once
        if (!upNextWidget.dataset.bound) {
          upNextWidget.dataset.bound = 'true';
          upNextWidget.addEventListener('click', () => {
            this.next();
          });
        }
      } else {
        upNextWidget.style.opacity = '0';
        upNextWidget.style.transform = 'translateY(10px)';
        upNextWidget.style.pointerEvents = 'none';
      }
    }
  }
}

window.player = new AquaMusicPlayer();
