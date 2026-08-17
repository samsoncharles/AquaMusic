// AquaMusic Custom Waveform Seekbar Canvas Renderer
class WaveformSeekbar {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.samples = [];
    this.progress = 0; // 0.0 to 1.0
    this.isDragging = false;
  }

  init() {
    this.canvas = document.getElementById('waveform-canvas-element');
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    
    // Bind mouse events for seeking
    const container = document.getElementById('waveform-seek-container');
    const hoverLine = document.getElementById('waveform-hover-indicator');
    const tooltip = document.getElementById('waveform-time-tooltip');

    if (container) {
      container.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.seekToMouse(e, container);
      });

      window.addEventListener('mousemove', (e) => {
        if (this.isDragging) {
          this.seekToMouse(e, container);
        }
        this.updateHover(e, container, hoverLine, tooltip);
      });

      window.addEventListener('mouseup', () => {
        this.isDragging = false;
      });

      container.addEventListener('mouseenter', () => {
        if (hoverLine) hoverLine.style.display = 'block';
        if (tooltip) tooltip.style.display = 'block';
      });

      container.addEventListener('mouseleave', () => {
        if (hoverLine && !this.isDragging) hoverLine.style.display = 'none';
        if (tooltip && !this.isDragging) tooltip.style.display = 'none';
      });
    }

    // Auto resize canvas width to match boundingClientRect size
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * (window.devicePixelRatio || 1);
    this.canvas.height = rect.height * (window.devicePixelRatio || 1);
    this.redraw();
  }

  /**
   * Loads 200 amplitude samples from backend and redraws canvas.
   * @param {string} trackId 
   */
  async loadTrackWaveform(trackId) {
    this.samples = [];
    this.progress = 0;
    this.resize();
    this.redraw();

    try {
      const samples = await window.api.getWaveform(trackId);
      this.samples = samples;
      this.resize();
      this.redraw();
    } catch (e) {
      // Fallback if endpoint fails
      this.samples = new Array(200).fill(0.3).map(() => 0.1 + Math.random() * 0.4);
      this.resize();
      this.redraw();
    }
  }

  updateProgress(val) {
    this.progress = Math.max(0.0, Math.min(1.0, val));
    this.redraw();
  }

  redraw() {
    if (!this.canvas || !this.ctx || this.samples.length === 0) {
      if (this.ctx) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
      return;
    }

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    const barCount = this.samples.length;
    const gap = 1;
    const totalGapWidth = gap * (barCount - 1);
    const barW = (W - totalGapWidth) / barCount;
    
    // Extract accent properties dynamically
    const rootStyles = getComputedStyle(document.documentElement);
    const playedColor = rootStyles.getPropertyValue('--accent').trim() || '#7C6AF7';
    const unplayedColor = rootStyles.getPropertyValue('--bg-surface-3').trim() || '#252535';

    this.samples.forEach((amp, i) => {
      const x = i * (barW + gap);
      const barH = amp * H * 0.85; // fit in canvas nicely
      const y = (H - barH) / 2;

      // Color based on played progress fraction
      const isPlayed = (i / barCount) <= this.progress;
      ctx.fillStyle = isPlayed ? playedColor : unplayedColor;
      
      // Draw rounded bar line
      this.drawRoundedRect(ctx, x, y, barW, barH, 2);
    });
  }

  drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  }

  seekToMouse(e, container) {
    if (!window.player || !window.player.currentTrack) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const fraction = x / rect.width;
    
    const duration = window.player.getDuration();
    if (duration > 0) {
      window.player.seekTo(fraction * duration);
    }
  }

  updateHover(e, container, hoverLine, tooltip) {
    if (!window.player || !window.player.currentTrack || !hoverLine || !tooltip) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (x >= 0 && x <= rect.width) {
      hoverLine.style.left = `${x}px`;
      hoverLine.style.display = 'block';

      // Calculate time at horizontal hover offset
      const fraction = x / rect.width;
      const duration = window.player.getDuration();
      const time = fraction * duration;
      
      tooltip.innerText = this.formatTime(time);
      tooltip.style.left = `${x}px`;
      tooltip.style.display = 'block';
    } else {
      if (!this.isDragging) {
        hoverLine.style.display = 'none';
        tooltip.style.display = 'none';
      }
    }
  }

  formatTime(secs) {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

window.waveformSeekbar = new WaveformSeekbar();
