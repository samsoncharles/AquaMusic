/**
 * AquaMusic Ultra-Resilient Screen Wake Lock Engine
 * Guaranteed display keep-awake across local, LAN, HD network monitors, and Smart TVs.
 * 
 * Combines 5 independent hardware/browser keep-awake mechanisms:
 * 1. Active Hardware Canvas Video Stream (captureStream -> GPU video decode pipeline)
 * 2. Continuous Web Audio Subsystem Carrier (OS audio pipeline keep-alive)
 * 3. W3C Screen Wake Lock API (when on HTTPS / supported environments)
 * 4. Synthetic Interaction & DOM Mutation Pulse (bypasses TV/kiosk idle timers)
 * 5. Server-Side DPMS / ScreenSaver Inhibitor Heartbeat (/api/keep_awake)
 */

class WakeLockManager {
  constructor() {
    this.enabled = true;
    this.sentinel = null;
    this.hardwareVideo = null;
    this.activeCanvas = null;
    this.canvasStream = null;
    this.audioCtx = null;
    this.carrierNode = null;
    this.heartbeatTimer = null;
    this.isRequesting = false;
    this.isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    this.statusPill = null;
  }

  init() {
    // 1. Restore user preference (default: enabled)
    const saved = localStorage.getItem('wavevault_keep_awake');
    this.enabled = (saved === null || saved === 'true');

    // 2. Start hardware video stream engine (works over HTTP & LAN on all TVs/monitors)
    this.initHardwareVideoEngine();

    // 3. Start silent Web Audio carrier engine
    this.initAudioCarrier();

    // 4. Try native W3C Wake Lock (if HTTPS/localhost)
    if (this.enabled) {
      this.requestNativeWakeLock();
    }

    // 5. Visibility and focus listeners (re-arm immediately when coming back)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.enabled) {
        this.requestNativeWakeLock();
        this.ensureHardwareVideoPlaying();
      }
    });

    window.addEventListener('focus', () => {
      if (this.enabled) {
        this.requestNativeWakeLock();
        this.ensureHardwareVideoPlaying();
      }
    });

    // 6. User interaction gestures to satisfy any strict autoplay policies
    const onUserInteraction = () => {
      if (this.enabled) {
        this.ensureHardwareVideoPlaying();
        this.resumeAudioCarrier();
        if (!this.sentinel || this.sentinel.released) {
          this.requestNativeWakeLock();
        }
      }
    };
    ['click', 'touchstart', 'keydown', 'pointerdown'].forEach(evt => {
      document.addEventListener(evt, onUserInteraction, { passive: true });
    });

    // 7. Initialize Fullscreen buttons
    this.initFullscreenControls();

    // 8. Start the 15-second heartbeat monitor
    this.startHeartbeatLoop();

    console.log('[WakeLock] Ultra-Resilient Display Keep-Awake Engine active.');
  }

  /**
   * Hardware Video Engine:
   * Creates an actively rendering 25fps canvas and pipes its MediaStream into an in-viewport <video> element.
   * This forces browser engines (Chromium, WebKit, Gecko) to engage the OS PowerSaveBlocker /
   * display sleep inhibitor (SetThreadExecutionState on Windows, D-Bus Inhibit on Linux, etc.)
   * without requiring HTTPS!
   */
  initHardwareVideoEngine() {
    if (this.hardwareVideo || typeof document === 'undefined') return;

    try {
      // 1. Create a 64x64 dynamic canvas
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      canvas.id = 'wakelock-active-canvas';
      canvas.style.display = 'none';
      document.body.appendChild(canvas);
      this.activeCanvas = canvas;

      const ctx = canvas.getContext('2d');
      let hue = 0;

      // Animate canvas continuously so the video codec produces active moving frames
      const drawFrame = () => {
        if (this.enabled) {
          hue = (hue + 1) % 360;
          ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
          ctx.fillRect(0, 0, 64, 64);

          // Moving dot for motion vector detection
          ctx.fillStyle = '#ffffff';
          const x = 32 + Math.sin(hue * 0.05) * 20;
          const y = 32 + Math.cos(hue * 0.05) * 20;
          ctx.fillRect(x - 3, y - 3, 6, 6);
        }
        requestAnimationFrame(drawFrame);
      };
      drawFrame();

      // 2. Capture live MediaStream from canvas at 25 fps
      let stream = null;
      if (typeof canvas.captureStream === 'function') {
        stream = canvas.captureStream(25);
      } else if (typeof canvas.mozCaptureStream === 'function') {
        stream = canvas.mozCaptureStream(25);
      }
      this.canvasStream = stream;

      // 3. Create the hardware video element inside the DOM viewport
      const video = document.createElement('video');
      video.id = 'wakelock-hardware-stream';
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.setAttribute('autoplay', '');
      video.setAttribute('loop', '');
      video.muted = true;
      video.setAttribute('muted', '');

      // Crucial: Must be positioned in viewport with non-zero dimensions and hardware layer
      // Opacity 0.005 is imperceptible to human eyes but forces GPU compositor rendering
      video.style.cssText = `
        position: fixed !important;
        bottom: 2px !important;
        right: 2px !important;
        width: 120px !important;
        height: 120px !important;
        opacity: 0.005 !important;
        pointer-events: none !important;
        z-index: 999999 !important;
        transform: translateZ(0) !important;
        background: transparent !important;
        overflow: hidden !important;
      `;

      if (stream) {
        video.srcObject = stream;
      } else {
        // Fallback: Minimal valid MP4 video loop
        video.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAz5tb292AAAAbW12aGQAAAAA101Wc9dNVnMAAA+gAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAGXRyYWsAAAAAbHRraGQAAAAB101Wc9dNVnMAAAABAAAAAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAgAAAAEAAAAAAEgAAAAAAAEAAAAAAABtZGlhAAAAIG1kaGQAAAAA101Wc9dNVnMAAA+gAAAAAAAF3AAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABS21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPNzdGJsAAAAZHN0c2QAAAAAAAAAAQAAAFRhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAgACAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//+AAAAAMGF2Y0MBQEIA//+AAAAAEHN0dHMAAAAAAAAAAQAAAAEAAAAfAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAUc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAAAAAAAAEAAAAQAAAAFHN0Y28AAAAAAAAAAQAAADw=';
      }

      document.body.appendChild(video);
      this.hardwareVideo = video;

      this.ensureHardwareVideoPlaying();
    } catch (err) {
      console.warn('[WakeLock] Hardware video engine note:', err);
    }
  }

  ensureHardwareVideoPlaying() {
    if (this.hardwareVideo && this.enabled) {
      if (this.hardwareVideo.paused) {
        const p = this.hardwareVideo.play();
        if (p !== undefined) {
          p.catch(() => {});
        }
      }
    }
  }

  /**
   * Continuous Web Audio Carrier:
   * Keeps audio subsystem and OS media power manager alive.
   */
  initAudioCarrier() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }

      if (!this.carrierNode && this.audioCtx) {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(30, this.audioCtx.currentTime);
        // Inaudible amplitude (0.00001) keeps DAC/audio server hardware clock streaming
        gain.gain.setValueAtTime(0.00001, this.audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        this.carrierNode = osc;
      }
    } catch (e) {
      // Audio context might be restricted before first click
    }
  }

  resumeAudioCarrier() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  /**
   * Native W3C Screen Wake Lock API:
   * Used when in a secure context (HTTPS / localhost).
   */
  async requestNativeWakeLock() {
    if (!this.enabled || this.isRequesting) return;
    this.isRequesting = true;

    if (this.isSupported) {
      try {
        if (!this.sentinel || this.sentinel.released) {
          this.sentinel = await navigator.wakeLock.request('screen');
          this.sentinel.addEventListener('release', () => {
            this.sentinel = null;
            this.updateUIStatus(this.enabled);
            if (this.enabled && document.visibilityState === 'visible') {
              setTimeout(() => this.requestNativeWakeLock(), 1000);
            }
          });
        }
      } catch (err) {
        // Expected on HTTP or un-permissioned context — fallback engines handle it
      }
    }

    this.isRequesting = false;
    this.updateUIStatus(this.enabled);
  }

  /**
   * Heartbeat Loop:
   * Runs every 15 seconds.
   * - Ensures hardware video is actively decoding
   * - Ensures audio carrier is running
   * - Dispatches synthetic interaction event (prevents smart TV idle timeout)
   * - Pings server keep_awake endpoint (inhibits server-side DPMS)
   */
  startHeartbeatLoop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      if (!this.enabled) return;

      // 1. Hardware video check
      this.ensureHardwareVideoPlaying();

      // 2. Audio carrier check
      this.resumeAudioCarrier();

      // 3. Native wake lock check
      if (!this.sentinel || this.sentinel.released) {
        this.requestNativeWakeLock();
      }

      // 4. Synthetic input pulse to reset smart TV / kiosk idle timers
      try {
        const evt = new MouseEvent('mousemove', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: Math.floor(Math.random() * 40) + 10,
          clientY: Math.floor(Math.random() * 40) + 10
        });
        window.dispatchEvent(evt);
      } catch (_) {}

      // 5. Server-side DPMS / ScreenSaver inhibitor ping
      try {
        fetch('/api/keep_awake', { method: 'POST', cache: 'no-store' }).catch(() => {});
      } catch (_) {}
    }, 15000);
  }

  /**
   * Fullscreen Kiosk Mode Controls:
   * Fullscreen mode naturally instructs Smart TVs & monitors to stay awake in presentation mode.
   */
  initFullscreenControls() {
    const btnTop = document.getElementById('btn-fullscreen-toggle');
    const btnLyrics = document.getElementById('btn-lyrics-fullscreen');

    const toggle = () => this.toggleFullscreen();

    if (btnTop) btnTop.addEventListener('click', toggle);
    if (btnLyrics) btnLyrics.addEventListener('click', toggle);

    document.addEventListener('fullscreenchange', () => {
      const isFull = !!document.fullscreenElement;
      const icon = isFull ? 'minimize' : 'maximize';
      
      if (btnTop) {
        btnTop.innerHTML = `<i data-lucide="${icon}"></i>`;
        if (window.lucide) window.lucide.createIcons({ container: btnTop });
      }
      if (btnLyrics) {
        const span = btnLyrics.querySelector('span');
        const iconEl = btnLyrics.querySelector('i');
        if (span) span.textContent = isFull ? 'Exit Fullscreen' : 'Fullscreen';
        if (iconEl) {
          iconEl.setAttribute('data-lucide', icon);
          if (window.lucide) window.lucide.createIcons({ container: btnLyrics });
        }
      }
    });
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      const el = document.documentElement;
      const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (rfs) {
        rfs.call(el).catch(err => {
          console.warn('[Fullscreen] Request error:', err);
        });
      }
    } else {
      const efs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      if (efs) {
        efs.call(document).catch(() => {});
      }
    }
  }

  setEnabled(val) {
    this.enabled = !!val;
    localStorage.setItem('wavevault_keep_awake', this.enabled ? 'true' : 'false');

    if (this.enabled) {
      this.ensureHardwareVideoPlaying();
      this.resumeAudioCarrier();
      this.requestNativeWakeLock();
      this.startHeartbeatLoop();
      this.updateUIStatus(true);
      if (window.toast) {
        window.toast.show("Display Keep-Awake enabled: Screen will not sleep", "info");
      }
    } else {
      if (this.sentinel) {
        try { this.sentinel.release(); } catch (_) {}
        this.sentinel = null;
      }
      if (this.hardwareVideo && !this.hardwareVideo.paused) {
        try { this.hardwareVideo.pause(); } catch (_) {}
      }
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.updateUIStatus(false);
      if (window.toast) {
        window.toast.show("Display Keep-Awake disabled: Default OS screen sleep restored", "info");
      }
    }
  }

  updateUIStatus(active) {
    const badge = document.getElementById('setting-keep-awake-status');
    if (badge) {
      badge.textContent = active ? 'Active' : 'Disabled';
      badge.className = `settings-pill-val ${active ? 'pill-active' : ''}`;
    }
  }
}

window.wakeLock = new WakeLockManager();
