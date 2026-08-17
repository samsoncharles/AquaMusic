// AquaMusic LRC Lyrics Parser and Synchronizer
class LyricsManager {
  constructor() {
    this.container = null;
    this.lrcLines = [];
    this.lyricsType = 'none'; // 'none', 'plain', 'lrc'
    this.lastActiveIndex = -1;
  }

  init() {
    this.container = document.getElementById('lyrics-content-scroller');
    
    // Close lyrics trigger
    const btnClose = document.getElementById('btn-lyrics-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.togglePanel(false));
    }
    const btnToggle = document.getElementById('btn-lyrics-toggle');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => this.togglePanel());
    }
  }

  togglePanel(forceState = null) {
    const panel = document.getElementById('lyrics-panel');
    if (!panel) return;
    
    const show = (forceState !== null) ? forceState : !panel.classList.contains('show');
    panel.classList.toggle('show', show);
    
    const toggleBtn = document.getElementById('btn-lyrics-toggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('btn-toggle-active', show);
    }
    
    if (show && window.player && window.player.currentTrack) {
      // Reload lyrics if opening panel
      this.loadLyrics(window.player.currentTrack.id);
    }
  }

  async loadLyrics(trackId) {
    if (!this.container) this.init();
    
    this.container.innerHTML = '<div class="lyric-empty"><div class="loader"></div><span>Searching for lyrics...</span></div>';
    this.lrcLines = [];
    this.lyricsType = 'none';
    this.lastActiveIndex = -1;

    try {
      const data = await window.api.getLyrics(trackId);
      this.container.innerHTML = '';

      if (data.type === 'lrc' && data.content && data.content.trim()) {
        this.lyricsType = 'lrc';
        this.parseLRC(data.content);
        this.renderLRC();
      } else if (data.type === 'plain' && data.content && data.content.trim()) {
        this.lyricsType = 'plain';
        this.renderPlain(data.content);
      } else {
        this.lyricsType = 'none';
        this.renderEmpty("No lyrics found for this song.");
      }
    } catch (err) {
      this.renderEmpty("Failed to load lyrics.");
    }
  }

  parseLRC(lrcText) {
    const lines = lrcText.split('\n');
    this.lrcLines = [];

    lines.forEach(line => {
      // Check for LRC format tags like [01:23.45] text or [01:23] text
      const matches = [...line.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g)];
      if (matches.length === 0) return;

      // Extract text content of line (remove tags)
      const text = line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();

      // Sometimes a single line can have multiple timestamp tags (e.g. [01:05.00][02:10.00] Chorus text)
      matches.forEach(match => {
        const mm = parseInt(match[1]);
        const ss = parseInt(match[2]);
        const ms = match[3] ? parseInt(match[3]) : 0;
        
        // Convert to seconds
        const time = mm * 60 + ss + (ms / (match[3].length === 3 ? 1000 : 100));
        this.lrcLines.push({ time, text });
      });
    });

    // Sort chronologically
    this.lrcLines.sort((a, b) => a.time - b.time);
  }

  renderLRC() {
    this.lrcLines.forEach((line, index) => {
      // Skip tags that don't actually have text
      if (!line.text && index > 0 && index < this.lrcLines.length - 1) {
        // Let empty text stay as spacer
      }
      
      const el = document.createElement('div');
      el.className = 'lyric-line';
      el.innerText = line.text || '• • •';
      
      // Allow user to click to seek directly to timestamp
      el.addEventListener('click', () => {
        if (window.player) {
          window.player.seekTo(line.time);
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
      window.lucide.createIcons({ nodeList: [this.container.querySelector('i')] });
    }
  }

  /**
   * Updates lyric line styling based on playhead time updates.
   * @param {number} currentTime - Current track playback time in seconds.
   */
  update(currentTime) {
    if (this.lyricsType !== 'lrc' || this.lrcLines.length === 0) return;

    // Find current active line index
    // The active line is the last index where the timestamp is <= currentTime
    let activeIndex = -1;
    for (let i = 0; i < this.lrcLines.length; i++) {
      if (this.lrcLines[i].time <= currentTime) {
        activeIndex = i;
      } else {
        break;
      }
    }

    if (activeIndex !== this.lastActiveIndex) {
      // Un-highlight previous
      if (this.lastActiveIndex !== -1 && this.lrcLines[this.lastActiveIndex].element) {
        this.lrcLines[this.lastActiveIndex].element.classList.remove('active');
      }

      // Highlight new
      if (activeIndex !== -1 && this.lrcLines[activeIndex].element) {
        const activeEl = this.lrcLines[activeIndex].element;
        activeEl.classList.add('active');
        
        // Auto scroll line to vertical center of panel viewport
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      this.lastActiveIndex = activeIndex;
    }
  }
}

window.lyrics = new LyricsManager();
