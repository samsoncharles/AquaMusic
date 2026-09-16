// AquaMusic Audio Visualizer (Web Audio API)
class AudioVisualizer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.radialCanvas = null;
    this.radialCtx = null;
    this.playerCanvas = null;
    this.playerCtx = null;
    this.lyricsCanvas = null;
    this.lyricsCtx = null;
    this.lyricsRadialCanvas = null;
    this.lyricsRadialCtx = null;
    this.analyser = null;
    this.animationFrameId = null;
    this.mode = 'bars'; // 'bars' | 'radial' | 'off'
    this.dataArray = null;
    
    // Mode 1 physics variables
    this.barHeights = new Array(64).fill(0);
    
    // Lyrics visualizer physics
    this.lyricsBarHeights = new Array(48).fill(0);
    this.lyricsPeakHeights = new Array(48).fill(0);
    
    // Mode 3 rotation variables
    this.rotationAngle = 0;
  }

  /**
   * Links visualizer to canvas and Web Audio analyzer node.
   */
  link(canvasElement, analyserNode, radialCanvasElement = null, playerCanvasElement = null) {
    this.canvas = canvasElement;
    this.ctx = this.canvas?.getContext('2d') || null;
    this.radialCanvas = radialCanvasElement;
    this.radialCtx = radialCanvasElement?.getContext('2d') || null;
    this.playerCanvas = playerCanvasElement;
    this.playerCtx = playerCanvasElement?.getContext('2d') || null;
    this.lyricsCanvas = document.getElementById('lyrics-visualizer-canvas');
    this.lyricsCtx = this.lyricsCanvas?.getContext('2d') || null;
    this.lyricsRadialCanvas = document.getElementById('lyrics-art-visualizer-canvas');
    this.lyricsRadialCtx = this.lyricsRadialCanvas?.getContext('2d') || null;
    this.analyser = analyserNode;

    // Load visualizer mode preference from settings (default 'bars')
    let savedMode = localStorage.getItem('wavevault_visualizer_mode') || 'bars';
    if (!['bars', 'radial', 'off'].includes(savedMode)) savedMode = 'bars';
    this.setMode(savedMode);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.lyricsCanvas) {
      this.lyricsCanvas = document.getElementById('lyrics-visualizer-canvas');
      this.lyricsCtx = this.lyricsCanvas?.getContext('2d') || null;
    }
    if (!this.lyricsRadialCanvas) {
      this.lyricsRadialCanvas = document.getElementById('lyrics-art-visualizer-canvas');
      this.lyricsRadialCtx = this.lyricsRadialCanvas?.getContext('2d') || null;
    }

    [this.canvas, this.radialCanvas, this.playerCanvas, this.lyricsCanvas, this.lyricsRadialCanvas].filter(Boolean).forEach(canvas => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(rect.width * ratio));
        canvas.height = Math.max(1, Math.round(rect.height * ratio));
      }
    });
  }

  setMode(modeName) {
    if (!['bars', 'radial', 'off'].includes(modeName)) {
      modeName = 'bars';
    }
    this.mode = modeName;
    localStorage.setItem('wavevault_visualizer_mode', modeName);
    
    const showRadial = (modeName === 'radial');
    const showBars = (modeName === 'bars');

    const artFrame = document.getElementById('nowplaying-art-frame');
    if (artFrame) {
      artFrame.classList.toggle('visualizer-radial', showRadial);
    }
    const dock = document.getElementById('visualizer-dock');
    if (dock) {
      dock.classList.toggle('visualizer-dock-hidden', !showBars);
    }

    const lyricsRadial = document.getElementById('lyrics-art-visualizer-canvas');
    if (lyricsRadial) {
      lyricsRadial.style.display = showRadial ? 'block' : 'none';
    }
    const lyricsDock = document.getElementById('lyrics-spectrum-dock');
    if (lyricsDock) {
      lyricsDock.style.display = showBars ? 'flex' : 'none';
    }

    const btnLyrViz = document.getElementById('lyrics-btn-visualizer');
    if (btnLyrViz) {
      btnLyrViz.classList.toggle('active', modeName !== 'off');
      btnLyrViz.title = `Spectrum Mode: ${modeName.toUpperCase()}`;
    }
    const btnMainViz = document.getElementById('btn-visualizer-mode');
    if (btnMainViz) {
      btnMainViz.title = `Visualizer: ${modeName.toUpperCase()}`;
    }

    requestAnimationFrame(() => this.resize());
    
    // Configure fftSize based on mode
    if (this.analyser) {
      if (modeName === 'radial') {
        this.analyser.fftSize = 512;
      } else {
        this.analyser.fftSize = 256; 
      }
    }

    if (modeName === 'off') {
      this.stop();
      [ [this.canvas, this.ctx], [this.radialCanvas, this.radialCtx], [this.playerCanvas, this.playerCtx], [this.lyricsCanvas, this.lyricsCtx], [this.lyricsRadialCanvas, this.lyricsRadialCtx] ]
        .forEach(([canvas, ctx]) => ctx?.clearRect(0, 0, canvas?.width || 0, canvas?.height || 0));
    } else {
      this.start();
    }
  }

  cycleMode() {
    // Cycle: bars -> radial -> off -> bars
    const modes = ['bars', 'radial', 'off'];
    const nextIdx = (modes.indexOf(this.mode) + 1) % modes.length;
    this.setMode(modes[nextIdx]);
    const label = modes[nextIdx] === 'radial' ? 'Radial (Around Cover Art)' : (modes[nextIdx] === 'bars' ? 'Bars (Frequency Dock)' : 'Off');
    window.toast.show(`Visualizer: ${label}`, 'info');
    
    // Sync button state in Settings UI if open
    const select = document.getElementById('setting-visualizer-mode');
    if (select) select.value = modes[nextIdx];
  }

  start() {
    this.stop();
    if (!this.analyser || this.mode === 'off') return;
    this.loop();
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  loop() {
    this.animationFrameId = requestAnimationFrame(() => this.loop());
    this.draw();
  }

  draw() {
    if (!this.analyser || this.mode === 'off') return;

    const bufferLength = this.analyser.frequencyBinCount;
    if (!this.dataArray || this.dataArray.length !== bufferLength) {
      this.dataArray = new Uint8Array(bufferLength);
    }

    // Extract colors from CSS variables
    const rootStyles = getComputedStyle(document.documentElement);
    const accent = rootStyles.getPropertyValue('--accent').trim() || '#7C6AF7';
    this.accent2 = rootStyles.getPropertyValue('--accent-2').trim() || accent;

    // 1. Draw Player Bar backdrop if player canvas exists
    this.drawPlayerBackdrop(accent);

    // 2. Render active visualizer mode (bars OR radial)
    if (this.mode === 'radial') {
      // Draw Radial Wave Visualizer on Lyrics artwork canvas
      this.drawLyricsRadial(accent);
      // Draw Radial Wave Visualizer on Sidebar artwork canvas
      if (this.radialCanvas && this.radialCtx) {
        this.drawRadialToCanvas(this.radialCanvas, this.radialCtx, accent, bufferLength);
      }
    } else if (this.mode === 'bars') {
      // Draw Bars Frequency Spectrum on Lyrics dock canvas
      this.drawLyricsCanvas(accent);
      // Draw Bars Frequency Spectrum on Sidebar bottom dock
      if (this.canvas && this.ctx) {
        this.drawBarsToCanvas(this.canvas, this.ctx, accent);
      }
    }
  }

  drawRadialToCanvas(canvas, ctx, accent, bufferLength) {
    const W = canvas.width;
    const H = canvas.height;
    if (W <= 0 || H <= 0) return;

    ctx.clearRect(0, 0, W, H);
    this.analyser.getByteFrequencyData(this.dataArray);

    const centerX = W / 2;
    const centerY = H / 2;
    const baseRadius = Math.min(W, H) * 0.22;
    const maxBarLength = Math.min(W, H) * 0.24;
    const numBars = 120;
    
    this.rotationAngle += 0.0015;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(this.rotationAngle);

    for (let i = 0; i < numBars; i++) {
      const dataIdx = Math.floor((i / numBars) * (bufferLength * 0.7));
      const val = this.dataArray[dataIdx] || 0;
      const barH = (val / 255) * maxBarLength;

      const angle = (i / numBars) * Math.PI * 2;
      const startX = Math.cos(angle) * baseRadius;
      const startY = Math.sin(angle) * baseRadius;
      const endX = Math.cos(angle) * (baseRadius + Math.max(3, barH));
      const endY = Math.sin(angle) * (baseRadius + Math.max(3, barH));

      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawBarsToCanvas(canvas, ctx, accent) {
    const W = canvas.width;
    const H = canvas.height;
    if (W <= 0 || H <= 0) return;

    ctx.clearRect(0, 0, W, H);
    this.analyser.getByteFrequencyData(this.dataArray);
    const barW = W / 64;
    
    for (let i = 0; i < 64; i++) {
      const val = this.dataArray[i] || 0;
      const targetH = (val / 255) * H * 0.85;

      if (targetH > this.barHeights[i]) {
        this.barHeights[i] += (targetH - this.barHeights[i]) * 0.45;
      } else {
        this.barHeights[i] -= (this.barHeights[i] - targetH) * 0.08;
      }

      const x = i * barW;
      const barH = Math.max(2, this.barHeights[i]);
      const y = H - barH;

      const grad = ctx.createLinearGradient(x, y, x, H);
      grad.addColorStop(0, this.accent2 || accent);
      grad.addColorStop(0.65, accent);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW - 1, barH);
    }
  }

  drawWaveToCanvas(canvas, ctx, accent, bufferLength) {
    const W = canvas.width;
    const H = canvas.height;
    if (W <= 0 || H <= 0) return;

    ctx.clearRect(0, 0, W, H);
    this.analyser.getByteTimeDomainData(this.dataArray);

    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.beginPath();

    const sliceWidth = W / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = this.dataArray[i] / 128.0;
      const y = (v * H) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(W, H / 2);
    ctx.stroke();
  }

  drawPlayerBackdrop(accent) {
    if (!this.playerCanvas || !this.playerCtx || !this.dataArray || this.mode === 'off') return;
    const ctx = this.playerCtx;
    const W = this.playerCanvas.width;
    const H = this.playerCanvas.height;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    this.analyser.getByteFrequencyData(this.dataArray);
    const count = 36;
    const barW = W / count;
    for (let i = 0; i < count; i++) {
      const value = this.dataArray[Math.floor(i * this.dataArray.length / count)] || 0;
      const height = Math.max(1, (value / 255) * H * 0.9);
      ctx.fillStyle = accent;
      ctx.fillRect(i * barW, H - height, Math.max(1, barW - 2), height);
    }
  }

  drawLyricsCanvas(accent) {
    if (!this.lyricsCanvas) {
      this.lyricsCanvas = document.getElementById('lyrics-visualizer-canvas');
      this.lyricsCtx = this.lyricsCanvas?.getContext('2d') || null;
    }
    if (!this.lyricsCanvas || !this.lyricsCtx) return;

    // Check if lyrics view is active by inspecting bounding dimensions
    const rect = this.lyricsCanvas.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return;

    const ratio = window.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * ratio);
    const targetH = Math.round(rect.height * ratio);
    if (this.lyricsCanvas.width !== targetW || this.lyricsCanvas.height !== targetH) {
      this.lyricsCanvas.width = targetW;
      this.lyricsCanvas.height = targetH;
    }

    const W = this.lyricsCanvas.width;
    const H = this.lyricsCanvas.height;
    if (W <= 2 || H <= 2) return;

    const ctx = this.lyricsCtx;
    ctx.clearRect(0, 0, W, H);

    if (this.mode === 'off') return;

    const currentAccent = accent || '#7C6AF7';
    const bufferLength = this.analyser?.frequencyBinCount || 128;
    if (!this.dataArray || this.dataArray.length !== bufferLength) {
      this.dataArray = new Uint8Array(bufferLength);
    }

    // Oscilloscope wave mode
    if (this.mode === 'wave' && this.analyser) {
      this.analyser.getByteTimeDomainData(this.dataArray);
      ctx.lineWidth = Math.max(2, 2.5 * ratio);
      ctx.strokeStyle = currentAccent;
      ctx.shadowColor = currentAccent;
      ctx.shadowBlur = 8 * ratio;
      ctx.beginPath();
      const sliceW = W / bufferLength;
      for (let i = 0; i < bufferLength; i++) {
        const v = this.dataArray[i] / 128.0;
        const y = (v * H) / 2;
        const x = i * sliceW;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      return;
    }

    // Dynamic Spectrogram / Frequency Spectrum Bars mode
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.dataArray);
    }

    const count = 48;
    const barW = W / count;
    const gap = Math.max(1, Math.round(1.5 * ratio));
    const effectiveBarW = Math.max(1, barW - gap);

    if (!this.lyricsBarHeights || this.lyricsBarHeights.length !== count) {
      this.lyricsBarHeights = new Array(count).fill(0);
      this.lyricsPeakHeights = new Array(count).fill(0);
    }

    const isPlaying = window.player && window.player.isPlaying;

    for (let i = 0; i < count; i++) {
      // Perceptual logarithmic mapping across frequency spectrum
      const freqIdx = Math.min(
        bufferLength - 1,
        Math.floor(Math.pow(i / count, 1.45) * (bufferLength * 0.75))
      );
      const rawVal = this.analyser ? (this.dataArray[freqIdx] || 0) : (isPlaying ? 40 : 0);
      
      let targetH = (rawVal / 255) * (H * 0.92);
      if (isPlaying && targetH < 3 * ratio) {
        targetH = 3 * ratio; // active song resting pulse
      }

      // Smooth rise & decay physics
      if (targetH > this.lyricsBarHeights[i]) {
        this.lyricsBarHeights[i] += (targetH - this.lyricsBarHeights[i]) * 0.5;
      } else {
        this.lyricsBarHeights[i] = Math.max(2 * ratio, this.lyricsBarHeights[i] - (H * 0.045));
      }

      // Floating peak caps physics
      if (this.lyricsBarHeights[i] >= (this.lyricsPeakHeights[i] || 0)) {
        this.lyricsPeakHeights[i] = this.lyricsBarHeights[i];
      } else {
        this.lyricsPeakHeights[i] = Math.max(2 * ratio, (this.lyricsPeakHeights[i] || 0) - (H * 0.018));
      }

      const barH = Math.max(2 * ratio, this.lyricsBarHeights[i]);
      const x = i * barW;
      const y = H - barH;

      // Vertical theme gradient
      const grad = ctx.createLinearGradient(x, y, x, H);
      grad.addColorStop(0, this.accent2 || currentAccent);
      grad.addColorStop(0.70, currentAccent);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      const r = Math.min(2.5 * ratio, effectiveBarW / 2);
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, effectiveBarW, barH, [r, r, 0, 0]);
      } else {
        ctx.rect(x, y, effectiveBarW, barH);
      }
      ctx.fill();

      // Draw floating peak caps above each bar
      const peakY = H - (this.lyricsPeakHeights[i] || 0) - (2 * ratio);
      if (peakY >= 0 && peakY < H - 3) {
        ctx.fillStyle = currentAccent;
        ctx.fillRect(x, Math.max(0, peakY), effectiveBarW, Math.max(1, 1.8 * ratio));
      }
    }
  }

  drawLyricsRadial(accent) {
    if (!this.lyricsRadialCanvas) {
      this.lyricsRadialCanvas = document.getElementById('lyrics-art-visualizer-canvas');
      this.lyricsRadialCtx = this.lyricsRadialCanvas?.getContext('2d') || null;
    }
    if (!this.lyricsRadialCanvas || !this.lyricsRadialCtx) return;

    const rect = this.lyricsRadialCanvas.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return;

    const ratio = window.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * ratio);
    const targetH = Math.round(rect.height * ratio);
    if (this.lyricsRadialCanvas.width !== targetW || this.lyricsRadialCanvas.height !== targetH) {
      this.lyricsRadialCanvas.width = targetW;
      this.lyricsRadialCanvas.height = targetH;
    }

    const W = this.lyricsRadialCanvas.width;
    const H = this.lyricsRadialCanvas.height;
    if (W <= 2 || H <= 2) return;

    const ctx = this.lyricsRadialCtx;
    ctx.clearRect(0, 0, W, H);

    if (this.mode === 'off') return;

    const currentAccent = accent || '#7C6AF7';
    const bufferLength = this.analyser?.frequencyBinCount || 128;
    if (!this.dataArray || this.dataArray.length !== bufferLength) {
      this.dataArray = new Uint8Array(bufferLength);
    }
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.dataArray);
    }

    const centerX = W / 2;
    const centerY = H / 2;
    // Radial bars revolve around the cover art boundary
    const baseRadius = Math.min(W, H) * 0.36;
    const maxBarLength = Math.min(W, H) * 0.12;
    const numBars = 108;

    this.rotationAngle += 0.0018;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(this.rotationAngle);

    const isPlaying = window.player && window.player.isPlaying;

    for (let i = 0; i < numBars; i++) {
      const dataIdx = Math.min(
        bufferLength - 1,
        Math.floor(Math.pow(i / numBars, 1.2) * (bufferLength * 0.7))
      );
      const val = this.analyser ? (this.dataArray[dataIdx] || 0) : (isPlaying ? 35 : 0);
      let barH = (val / 255) * maxBarLength;
      if (isPlaying && barH < 2.5 * ratio) {
        barH = 2.5 * ratio;
      }

      const angle = (i / numBars) * Math.PI * 2;
      const startX = Math.cos(angle) * baseRadius;
      const startY = Math.sin(angle) * baseRadius;
      const endX = Math.cos(angle) * (baseRadius + Math.max(2 * ratio, barH));
      const endY = Math.sin(angle) * (baseRadius + Math.max(2 * ratio, barH));

      ctx.strokeStyle = currentAccent;
      ctx.lineWidth = Math.max(1.5, 2.2 * ratio);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    ctx.restore();
  }
}

window.visualizer = new AudioVisualizer();
