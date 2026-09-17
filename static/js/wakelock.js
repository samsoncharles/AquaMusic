/**
 * AquaMusic Universal Screen Wake Lock Manager
 * Prevents screen dimming, sleep, and screen-saver timeout while AquaMusic is active.
 * Uses W3C Screen Wake Lock API with automatic re-acquisition and continuous media keep-alive fallback.
 */

class WakeLockManager {
  constructor() {
    this.enabled = true;
    this.sentinel = null;
    this.isRequesting = false;
    this.isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    this.heartbeatTimer = null;
    this.fallbackVideo = null;
    this.isActive = false;
  }

  init() {
    // Restore preference, default to enabled (keep screen awake continuously)
    const saved = localStorage.getItem('wavevault_keep_awake');
    this.enabled = (saved === null || saved === 'true');

    // Create hardware fallback video keep-alive element
    this.createFallbackVideo();

    // 1. Re-acquire wake lock whenever page becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.enabled) {
        this.requestLock();
      }
    });

    // 2. Re-acquire on window focus
    window.addEventListener('focus', () => {
      if (this.enabled) {
        this.requestLock();
      }
    });

    // 3. User interaction triggers (browsers require user activation for some power locks)
    const onUserInteraction = () => {
      if (this.enabled && (!this.sentinel || this.sentinel.released)) {
        this.requestLock();
      }
    };
    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(evt => {
      document.addEventListener(evt, onUserInteraction, { passive: true });
    });

    // Initial acquisition attempt
    if (this.enabled) {
      this.requestLock();
    }

    // 4. Heartbeat Monitor: Every 15 seconds, ensure lock is held and re-assert if dropped
    this.heartbeatTimer = setInterval(() => {
      if (this.enabled) {
        if (!this.sentinel || this.sentinel.released) {
          this.requestLock();
        } else {
          this.playFallbackVideo();
        }
      }
    }, 15000);

    console.log(`[WakeLock] Initialized. Native W3C Wake Lock API supported: ${this.isSupported}`);
  }

  createFallbackVideo() {
    if (this.fallbackVideo || typeof document === 'undefined') return;
    try {
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.setAttribute('loop', '');
      video.muted = true;
      video.setAttribute('muted', '');
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      video.style.left = '-9999px';
      video.style.width = '2px';
      video.style.height = '2px';
      video.style.opacity = '0.001';
      video.style.pointerEvents = 'none';
      video.style.zIndex = '-9999';

      // 1x1 pixel silent WebM/MP4 data URI to prevent OS idle/screen-saver timer
      video.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAz5tb292AAAAbW12aGQAAAAA101Wc9dNVnMAAA+gAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAGXRyYWsAAAAAbHRraGQAAAAB101Wc9dNVnMAAAABAAAAAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAgAAAAEAAAAAAEgAAAAAAAEAAAAAAABtZGlhAAAAIG1kaGQAAAAA101Wc9dNVnMAAA+gAAAAAAAF3AAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABS21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPNzdGJsAAAAZHN0c2QAAAAAAAAAAQAAAFRhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAgACAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//+AAAAAMGF2Y0MBQEIA//+AAAAAEHN0dHMAAAAAAAAAAQAAAAEAAAAfAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAUc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAAAAAAAAEAAAAQAAAAFHN0Y28AAAAAAAAAAQAAADw=';

      document.body.appendChild(video);
      this.fallbackVideo = video;
    } catch (err) {
      console.warn('[WakeLock] Could not create fallback video element:', err);
    }
  }

  playFallbackVideo() {
    if (this.fallbackVideo && this.enabled) {
      const playPromise = this.fallbackVideo.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Autoplay policy may defer until user gesture
        });
      }
    }
  }

  async requestLock() {
    if (!this.enabled || this.isRequesting) return;
    this.isRequesting = true;

    // 1. Primary Engine: W3C Screen Wake Lock API
    if (this.isSupported) {
      try {
        if (!this.sentinel || this.sentinel.released) {
          this.sentinel = await navigator.wakeLock.request('screen');
          this.isActive = true;

          this.sentinel.addEventListener('release', () => {
            this.isActive = false;
            this.sentinel = null;
            this.updateUIStatus(false);

            // If still enabled and page visible, re-acquire promptly
            if (this.enabled && document.visibilityState === 'visible') {
              setTimeout(() => this.requestLock(), 800);
            }
          });

          this.updateUIStatus(true);
        }
      } catch (err) {
        // Expected when document is hidden or user has not yet interacted
        this.isActive = false;
        this.updateUIStatus(false);
      }
    }

    // 2. Auxiliary Engine: Active Video Element Keep-Alive
    this.playFallbackVideo();

    this.isRequesting = false;
  }

  releaseLock() {
    if (this.sentinel) {
      try {
        this.sentinel.release();
      } catch (_) {}
      this.sentinel = null;
    }

    if (this.fallbackVideo && !this.fallbackVideo.paused) {
      try {
        this.fallbackVideo.pause();
      } catch (_) {}
    }

    this.isActive = false;
    this.updateUIStatus(false);
  }

  setEnabled(val) {
    this.enabled = !!val;
    localStorage.setItem('wavevault_keep_awake', this.enabled ? 'true' : 'false');

    if (this.enabled) {
      this.requestLock();
      if (window.toast) {
        window.toast.show("Display Keep-Awake enabled: Screen will not sleep", "info");
      }
    } else {
      this.releaseLock();
      if (window.toast) {
        window.toast.show("Display Keep-Awake disabled: Default OS screen sleep restored", "info");
      }
    }
  }

  updateUIStatus(active) {
    const badge = document.getElementById('setting-keep-awake-status');
    if (badge) {
      badge.textContent = active ? 'Active' : (this.enabled ? 'Standby' : 'Disabled');
      badge.className = `settings-pill-val ${active ? 'pill-active' : ''}`;
    }
  }
}

window.wakeLock = new WakeLockManager();
