// AquaMusic High-Performance Audio Playback Engine (Web Audio API)
class AquaMusicPlayer {
  constructor() {
    this.audioCtx = null;
    
    // Alternating Audio elements for seamless gapless / crossfade support
    this.audioA = new Audio();
    this.audioA.crossOrigin = 'anonymous';
    this.audioB = new Audio();
    this.audioB.crossOrigin = 'anonymous';
    this.audioA.preload = 'metadata';
    this.audioB.preload = 'metadata';

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
    this.isUserSeeking = false;
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

    audioElement.addEventListener('play', () => {
      if (audioElement === this.activeAudio) {
        this.isPlaying = true;
        this.updatePlayPauseButton();
        this.saveSession(true);
        if (window.wakeLock) window.wakeLock.requestLock();
      }
    });

    audioElement.addEventListener('pause', () => {
      if (audioElement === this.activeAudio && !this.isCrossfading) {
        this.isPlaying = false;
        this.updatePlayPauseButton();
        this.saveSession(true);
      }
    });

    const handleDuration = () => {
      if (audioElement !== this.activeAudio) return;
      const dur = audioElement.duration;
      if (dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
        if (this.currentTrack) {
          this.currentTrack.duration = Math.round(dur);
          this.currentTrack.duration_fmt = this.formatTime(dur);
        }
        const lblTotal = document.getElementById('time-total');
        if (lblTotal) lblTotal.innerText = this.formatTime(dur);
        const lblDuration = document.getElementById('time-duration');
        if (lblDuration) lblDuration.innerText = this.formatTime(dur);
        const lyrRemain = document.getElementById('lyrics-time-remaining');
        if (lyrRemain) lyrRemain.innerText = this.formatTime(dur);
      }
    };
    audioElement.addEventListener('loadedmetadata', handleDuration);
    audioElement.addEventListener('durationchange', handleDuration);

    audioElement.addEventListener('error', (e) => {
      if (audioElement !== this.activeAudio) return;
      if (!audioElement.src || audioElement.error?.code === 20) return; // Ignore aborts during fast track switches

      console.warn("[Player] Stream error encountered:", audioElement.error);

      // Attempt single resilient reconnect for the track
      if (this.currentTrack && !this.retryAttempt) {
        this.retryAttempt = true;
        const savedTime = audioElement.currentTime || 0;
        console.log(`[Player] Auto-reconnecting stream for "${this.currentTrack.title}"...`);
        setTimeout(() => {
          if (!this.currentTrack) return;
          audioElement.src = `/api/stream/${this.currentTrack.id}?t=${Date.now()}`;
          audioElement.load();
          if (savedTime > 0) {
            try { audioElement.currentTime = savedTime; } catch (_) {}
          }
          audioElement.play().then(() => {
            this.retryAttempt = false;
            this.isPlaying = true;
            this.updatePlayPauseButton();
          }).catch(err => {
            console.warn("[Player] Reconnect failed:", err);
            this.retryAttempt = false;
            this.isPlaying = false;
            this.updatePlayPauseButton();
            window.toast.show(`Stream interrupted for "${this.currentTrack.title}". Click play to retry.`, "warning");
          });
        }, 1200);
        return;
      }

      this.isPlaying = false;
      this.updatePlayPauseButton();
      window.toast.show(`Could not play "${this.currentTrack ? this.currentTrack.title : 'track'}".`, "error");
    });
  }

  /**
   * Resolves a track object from ID or object, supporting both local and online tracks.
   */
  resolveTrack(trackIdOrObj) {
    if (!trackIdOrObj) return null;
    if (typeof trackIdOrObj === 'object' && trackIdOrObj.id) {
      window.onlineTracks = window.onlineTracks || {};
      window.onlineTracks[trackIdOrObj.id] = trackIdOrObj;
      return trackIdOrObj;
    }
    const tid = String(trackIdOrObj);
    if (window.library && window.library.tracks && window.library.tracks[tid]) {
      return window.library.tracks[tid];
    }
    if (window.onlineTracks && window.onlineTracks[tid]) {
      return window.onlineTracks[tid];
    }
    if (this.currentTrack && String(this.currentTrack.id) === tid) {
      return this.currentTrack;
    }
    return {
      id: tid,
      title: 'Online Stream',
      artist: 'YouTube Music',
      album: 'Stream',
      duration: 0,
      duration_fmt: '0:00',
      thumbnail: `https://i.ytimg.com/vi/${tid}/hqdefault.jpg`,
      is_online: true,
      path: ''
    };
  }

  /**
   * Starts playing a track by its ID or track object.
   */
  async playTrack(trackIdOrObj, forceNoCrossfade = true) {
    await this.initAudioContext();
    
    // Resume audio context if suspended (browser security)
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try { await this.audioCtx.resume(); } catch (_) {}
    }

    const track = this.resolveTrack(trackIdOrObj);
    if (!track) return;
    const trackId = track.id;
    
    this.preloadedNext = false;
    this.retryAttempt = false;

    // 1. Immediately stop any active or standby playback and reset positions
    // 1. Immediately stop any active or standby playback and purge both audio sources
    try {
      this.audioA.pause();
      this.audioB.pause();
      this.audioA.removeAttribute('src');
      this.audioB.removeAttribute('src');
      this.audioA.load();
      this.audioB.load();
      this.audioA.currentTime = 0;
      this.audioB.currentTime = 0;
    } catch (_) {}

    this.isCrossfading = false;
    this.hasTriggeredAutoCrossfade = false;

    // Clear standby channel source so old stream never overlaps
    try {
      this.standbyAudio.removeAttribute('src');
      this.standbyAudio.load();
    } catch (_) {}

    // 2. Immediately register currentTrack and reset scrubber & UI to 0:00
    // 2. Immediately register currentTrack and reset scrubber & UI to 0:00 / track duration
    this.currentTrack = track;
    this.resetTimelineUI(track);
    this.updateNowPlayingInfo(track);
    if (window.mainApp && typeof window.mainApp.toggleNowPlayingPanel === 'function') {
      window.mainApp.toggleNowPlayingPanel(true);
    }

    // 3. Load and play new track stream
    this.activeAudio.src = `/api/stream/${track.id}`;
    this.activeAudio.playbackRate = this.playbackSpeed;
    this.activeAudio.load();
    
    // Reset channel gains
    const currentGainNode = this.activeAudio === this.audioA ? this.gainA : this.gainB;
    const standbyGainNode = this.activeAudio === this.audioA ? this.gainB : this.gainA;
    
    if (currentGainNode && this.audioCtx) currentGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
    if (standbyGainNode && this.audioCtx) standbyGainNode.gain.setValueAtTime(0.0, this.audioCtx.currentTime);

    this.applyReplayGain(track);
    
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(this.isMuted ? 0.0 : this.volume, this.audioCtx.currentTime);
    }

    this.activeAudio.play().then(() => {
      this.isPlaying = true;
      this.updatePlayPauseButton();
    }).catch(err => {
      console.warn("[Player] play() deferred by browser policy:", err);
    });

    this.isPlaying = true;
    this.updatePlayPauseButton();
    this.onTrackChanged(track);
  }

  resetTimelineUI(track) {
    const lblCurrent = document.getElementById('time-current');
    const lblTotal = document.getElementById('time-total');
    const lblDuration = document.getElementById('time-duration');
    const lyrElapsed = document.getElementById('lyrics-time-elapsed');
    const lyrRemain = document.getElementById('lyrics-time-remaining');
    const timelineFill = document.getElementById('timeline-slider-fill');
    const timelineHandle = document.getElementById('timeline-slider-handle');
    const lyricsSeekBar = document.getElementById('lyrics-seek-bar');

    const durFmt = (track?.duration && track.duration > 0)
      ? (track.duration_fmt || this.formatTime(track.duration))
      : (track?.duration_fmt && track.duration_fmt !== '0:00' ? track.duration_fmt : "0:00");

    if (lblCurrent) lblCurrent.innerText = "0:00";
    if (lblTotal) lblTotal.innerText = durFmt;
    if (lblDuration) lblDuration.innerText = durFmt;
    if (lyrElapsed) lyrElapsed.innerText = "0:00";
    if (lyrRemain) lyrRemain.innerText = durFmt;

    if (timelineFill) timelineFill.style.width = "0%";
    if (timelineHandle) timelineHandle.style.left = "0%";
    if (lyricsSeekBar) lyricsSeekBar.value = 0;

    // Reset clock hands
    const handSec = document.getElementById('upnext-hand-second');
    const handMin = document.getElementById('upnext-hand-minute');
    const ring = document.getElementById('upnext-clock-ring');
    if (handSec) handSec.style.transform = 'rotate(0deg)';
    if (handMin) handMin.style.transform = 'rotate(0deg)';
    if (ring) ring.style.strokeDashoffset = '0';

    // Reset waveform
    if (window.waveform && typeof window.waveform.reset === 'function') {
      window.waveform.reset();
    }

    // Update lyrics and trigger proactive background prefetching
    if (window.lyrics) {
      window.lyrics.onTrackChanged(track);
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
    if (!this.currentTrack || !this.activeAudio) return;
    if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) seconds = 0;
    const dur = this.getDuration();
    if (dur > 0 && isFinite(dur)) {
      seconds = Math.min(seconds, dur);
    }
    try {
      this.activeAudio.currentTime = seconds;
    } catch (e) {
      console.warn("[Player] seekTo error:", e);
    }
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
    
    // Default 0.0dB (no reduction) if replay gain disabled, missing, or invalid
    let rg = 0.0;
    if (this.replayGainEnabled && track && typeof track.replay_gain === 'number' && isFinite(track.replay_gain)) {
      rg = track.replay_gain;
    }
    const linear = Math.pow(10, rg / 20);
    const gainVal = (isFinite(linear) && !isNaN(linear)) ? Math.min(Math.max(0.0, linear), 1.0) : 1.0;

    const activeChannelGain = this.activeAudio === this.audioA ? this.gainA : this.gainB;
    if (activeChannelGain && activeChannelGain.gain && isFinite(this.audioCtx.currentTime)) {
      try {
        activeChannelGain.gain.setValueAtTime(gainVal, this.audioCtx.currentTime);
      } catch (_) {}
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

    const nextTrack = this.resolveTrack(nextTrackId);
    if (!nextTrack) {
      this.isCrossfading = false;
      return;
    }
    const trackId = nextTrack.id;
    
    // 1. Prepare standby audio
    this.standbyAudio.src = `/api/stream/${trackId}`;
    this.standbyAudio.playbackRate = this.playbackSpeed;
    
    // Ensure standby channel volume is 0
    const standbyGainNode = this.activeAudio === this.audioA ? this.gainB : this.gainA;
    const currentGainNode = this.activeAudio === this.audioA ? this.gainA : this.gainB;
    
    standbyGainNode.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
    
    // Compute exact ReplayGains for both tracks (default to 0.0dB if disabled or invalid)
    const currentTrack = this.currentTrack;
    const currentRG = (this.replayGainEnabled && currentTrack && typeof currentTrack.replay_gain === 'number' && isFinite(currentTrack.replay_gain)) ? currentTrack.replay_gain : 0.0;
    const currentLinear = Math.pow(10, currentRG / 20);
    const currentTargetGain = (isFinite(currentLinear) && !isNaN(currentLinear)) ? Math.min(Math.max(0.0, currentLinear), 1.0) : 1.0;

    const nextRG = (this.replayGainEnabled && nextTrack && typeof nextTrack.replay_gain === 'number' && isFinite(nextTrack.replay_gain)) ? nextTrack.replay_gain : 0.0;
    const nextLinear = Math.pow(10, nextRG / 20);
    const targetGain = (isFinite(nextLinear) && !isNaN(nextLinear)) ? Math.min(Math.max(0.0, nextLinear), 1.0) : 1.0;

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
    this.resetTimelineUI(nextTrack);
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
    if (!this.activeAudio) return;
    const curTime = Number.isFinite(this.activeAudio.currentTime) ? this.activeAudio.currentTime : 0;
    const duration = this.getDuration();
    
    // Update seeking layouts if user is not actively dragging
    const progressPercent = (duration > 0 && isFinite(duration)) ? Math.max(0, Math.min(1, curTime / duration)) : 0;
    
    if (!this.isUserSeeking) {
      const fill = document.getElementById('timeline-slider-fill');
      const handle = document.getElementById('timeline-slider-handle');
      if (fill && handle) {
        fill.style.width = `${progressPercent * 100}%`;
        handle.style.left = `${progressPercent * 100}%`;
      }

      // Update time indicators
      const lblCurrent = document.getElementById('time-current');
      if (lblCurrent) lblCurrent.innerText = this.formatTime(curTime);
    }

    // Keep duration display synced once stream duration is resolved
    if (duration > 0 && isFinite(duration)) {
      const durFormatted = this.formatTime(duration);
      const lblDuration = document.getElementById('time-duration');
      if (lblDuration && (lblDuration.innerText === '0:00' || lblDuration.innerText === '--:--')) {
        lblDuration.innerText = durFormatted;
      }
      const lblTotal = document.getElementById('time-total');
      if (lblTotal && (lblTotal.innerText === '0:00' || lblTotal.innerText === '--:--')) {
        lblTotal.innerText = durFormatted;
      }
      if (this.currentTrack && (!this.currentTrack.duration || this.currentTrack.duration <= 0)) {
        this.currentTrack.duration = Math.round(duration);
        this.currentTrack.duration_fmt = durFormatted;
      }
    }

    // Update Waveform progress
    if (window.waveformSeekbar && !this.isUserSeeking) {
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
      if (window.sleepTimer.onTrackEnded()) return;
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

  previous() {
    this.prev();
  }

  toggleShuffle() {
    if (window.playlists) {
      window.playlists.toggleShuffle();
    }
  }

  toggleRepeat() {
    if (window.playlists) {
      window.playlists.cycleRepeat();
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
    this.updateNowPlayingInfo(track);

    // Update active-playing class on all visible song rows across the DOM
    document.querySelectorAll('.song-row').forEach(row => {
      if (row.dataset.id === String(track.id)) {
        row.classList.add('active-playing');
      } else {
        row.classList.remove('active-playing');
      }
    });

    // Save states
    localStorage.setItem('wavevault_last_track_id', track.id);
    if (window.playlists) {
      localStorage.setItem('wavevault_queue_index', window.playlists.activeQueueIndex.toString());
    }
    this.saveSession(true);

    // Trigger theme dynamic color swaps
    if (window.themes) {
      window.themes.onTrackChanged(track.id, track);
    }

    // Trigger waveform canvas loader
    if (window.waveformSeekbar) {
      window.waveformSeekbar.loadTrackWaveform(track.id);
    }

    // Ensure lyrics and its player view are updated and cached offline
    if (window.lyrics) {
      window.lyrics.onTrackChanged(track);
    }


    // Register OS Media Session bindings
    this.updateMediaSession(track);
  }

  getDuration() {
    if (this.activeAudio && !isNaN(this.activeAudio.duration) && isFinite(this.activeAudio.duration) && this.activeAudio.duration > 0) {
      return this.activeAudio.duration;
    }
    if (this.currentTrack && typeof this.currentTrack.duration === 'number' && isFinite(this.currentTrack.duration) && this.currentTrack.duration > 0) {
      return this.currentTrack.duration;
    }
    return 0;
  }

  updatePlayPauseButton() {
    const playIcon = document.getElementById('play-pause-icon');
    const playBtn = document.getElementById('btn-play-pause');

    document.body.classList.toggle('is-playing', !!this.isPlaying);

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

    const track = this.resolveTrack(trackId || this.currentTrack);

    if (!track) {
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

    const artUrl = track.thumbnail || `/api/art/${track.id}?t=${Date.now()}`;

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

  triggerPulse(el) {
    if (!el) return;
    el.classList.remove('pulse-active');
    void el.offsetWidth;
    el.classList.add('pulse-active');
    setTimeout(() => el.classList.remove('pulse-active'), 400);
  }

  updateLikeButton(trackId) {
    if (!trackId && this.currentTrack) trackId = this.currentTrack.id;
    if (!trackId) return;

    const isLiked = window.ratings && window.ratings.getRating(trackId) >= 4;
    const btnMain = document.getElementById('btn-like-track');
    const btnLyrics = document.getElementById('lyrics-btn-like');

    [btnMain, btnLyrics].filter(Boolean).forEach(btn => {
      btn.classList.toggle('liked', isLiked);
      btn.classList.toggle('active', isLiked);
      btn.title = isLiked ? 'Unlike this track' : 'Like this track';
      btn.style.color = isLiked ? 'var(--accent)' : '';

      const svg = btn.querySelector('svg');
      if (svg) {
        svg.style.fill = isLiked ? 'var(--accent)' : 'none';
        svg.style.stroke = isLiked ? 'var(--accent)' : 'currentColor';
      }

      const icon = btn.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', 'heart');
        if (window.lucide) window.lucide.createIcons({ nodeList: [icon] });
        const newSvg = btn.querySelector('svg');
        if (newSvg) {
          newSvg.style.fill = isLiked ? 'var(--accent)' : 'none';
          newSvg.style.stroke = isLiked ? 'var(--accent)' : 'currentColor';
        }
      }
    });
  }

  toggleLike() {
    if (!this.currentTrack || !window.ratings) return;
    const trackId = this.currentTrack.id;
    const currentRating = window.ratings.getRating(trackId);
    const isLiked = currentRating >= 4;
    
    if (isLiked) {
      window.ratings.setRating(trackId, 0, true);
      window.toast.show('Removed from Liked Music', 'info');
    } else {
      window.ratings.setRating(trackId, 5, true);
      window.toast.show('Added to Liked Music', 'success');

      // Heart pop animation overlay on cover art in both views
      const heartAnim = document.getElementById('heart-anim-overlay');
      if (heartAnim) {
        heartAnim.classList.add('animate');
        setTimeout(() => heartAnim.classList.remove('animate'), 700);
      }
      const lyricsHeartAnim = document.getElementById('lyrics-heart-anim-overlay');
      if (lyricsHeartAnim) {
        lyricsHeartAnim.classList.add('animate');
        setTimeout(() => lyricsHeartAnim.classList.remove('animate'), 700);
      }
    }

    const btnMain = document.getElementById('btn-like-track');
    const btnLyrics = document.getElementById('lyrics-btn-like');
    this.triggerPulse(btnMain);
    this.triggerPulse(btnLyrics);

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
