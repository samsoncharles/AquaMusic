// AquaMusic Audio Visualizer (Web Audio API)
class AudioVisualizer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.radialCanvas = null;
    this.radialCtx = null;
    this.playerCanvas = null;
    this.playerCtx = null;
    this.analyser = null;
    this.animationFrameId = null;
    this.mode = 'bars'; // 'bars' | 'wave' | 'radial' | 'off'
    this.dataArray = null;
    
    // Mode 1 physics variables
    this.barHeights = new Array(64).fill(0);
    
    // Mode 3 rotation variables
    this.rotationAngle = 0;
  }

  /**
   * Links visualizer to canvas and Web Audio analyzer node.
   */
  link(canvasElement, analyserNode, radialCanvasElement = null, playerCanvasElement = null) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.radialCanvas = radialCanvasElement;
    this.radialCtx = radialCanvasElement?.getContext('2d') || null;
    this.playerCanvas = playerCanvasElement;
    this.playerCtx = playerCanvasElement?.getContext('2d') || null;
    this.analyser = analyserNode;

    // Load visualizer mode preference from settings
    const savedMode = localStorage.getItem('wavevault_visualizer_mode') || 'bars';
    this.setMode(savedMode);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    [this.canvas, this.radialCanvas, this.playerCanvas].filter(Boolean).forEach(canvas => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
    });
  }

  setMode(modeName) {
    this.mode = modeName;
    localStorage.setItem('wavevault_visualizer_mode', modeName);
    document.getElementById('nowplaying-art-frame')?.classList.toggle('visualizer-radial', modeName === 'radial');
    document.getElementById('visualizer-dock')?.classList.toggle('visualizer-radial', modeName === 'radial');
    requestAnimationFrame(() => this.resize());
    
    // Configure fftSize based on mode
    if (this.analyser) {
      if (modeName === 'wave') {
        this.analyser.fftSize = 2048;
      } else if (modeName === 'radial') {
        this.analyser.fftSize = 512;
      } else {
        // default bars
        this.analyser.fftSize = 128; 
      }
    }

    if (modeName === 'off') {
      this.stop();
      [ [this.canvas, this.ctx], [this.radialCanvas, this.radialCtx], [this.playerCanvas, this.playerCtx] ]
        .forEach(([canvas, ctx]) => ctx?.clearRect(0, 0, canvas.width, canvas.height));
    } else {
      this.start();
    }
  }

  cycleMode() {
    // bars -> radial -> off -> bars
    const modes = ['bars', 'radial', 'off'];
    const nextIdx = (modes.indexOf(this.mode) + 1) % modes.length;
    this.setMode(modes[nextIdx]);
    window.toast.show(`Visualizer Mode: ${modes[nextIdx]}`, 'info');
    
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
    if (!this.canvas || !this.ctx || !this.analyser) return;

    if (this.canvas.width === 0 || this.canvas.height === 0) {
      this.resize();
    }

    const activeCanvas = this.mode === 'radial' && this.radialCanvas ? this.radialCanvas : this.canvas;
    const ctx = this.mode === 'radial' && this.radialCtx ? this.radialCtx : this.ctx;
    const W = activeCanvas.width;
    const H = activeCanvas.height;
    const bufferLength = this.analyser.frequencyBinCount;

    if (!this.dataArray || this.dataArray.length !== bufferLength) {
      this.dataArray = new Uint8Array(bufferLength);
    }

    // Extract colors from CSS variables
    const rootStyles = getComputedStyle(document.documentElement);
    const accent = rootStyles.getPropertyValue('--accent').trim() || '#7C6AF7';
    const accentText = rootStyles.getPropertyValue('--accent-text').trim() || '#C4B8FF';

    // Clear Canvas
    ctx.clearRect(0, 0, W, H);

    // The compact player gets a subtle copy of the analyser whenever the
    // now-playing sheet is hidden. It deliberately stays independent of the
    // selected visualizer mode so controls remain readable.
    this.drawPlayerBackdrop(accent);

    if (this.mode === 'bars') {
      /* ----------------------------------------------------
         MODE 1: FREQUENCY BARS (with Physics)
         ---------------------------------------------------- */
      this.analyser.getByteFrequencyData(this.dataArray);

      const barW = W / 64;
      
      for (let i = 0; i < 64; i++) {
        // Map data value to canvas height percentage
        const val = this.dataArray[i] || 0;
        const targetH = (val / 255) * H * 0.85;

        // Apply fast rise, slow fall physics
        if (targetH > this.barHeights[i]) {
          this.barHeights[i] += (targetH - this.barHeights[i]) * 0.45; // quick rise
        } else {
          this.barHeights[i] -= (this.barHeights[i] - targetH) * 0.08; // slow decay
        }

        const x = i * barW;
        const barH = Math.max(2, this.barHeights[i]);
        const y = H - barH;

        // Create colorful gradient for each bar
        const grad = ctx.createLinearGradient(x, y, x, H);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, 'rgba(124, 106, 247, 0.1)');

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW - 1, barH);
      }

    } else if (this.mode === 'radial') {
      /* ----------------------------------------------------
         MODE 3: RADIAL CIRCULAR BARS
         ---------------------------------------------------- */
      this.analyser.getByteFrequencyData(this.dataArray);

      const centerX = W / 2;
      const centerY = H / 2;
      const baseRadius = Math.min(W, H) * 0.22;
      const maxBarLength = Math.min(W, H) * 0.24;
      const numBars = 120;
      
      this.rotationAngle += 0.0015; // Slow rotate

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(this.rotationAngle);

      for (let i = 0; i < numBars; i++) {
        // Map radial sample index to frequency data array index
        const dataIdx = Math.floor((i / numBars) * (bufferLength * 0.7));
        const val = this.dataArray[dataIdx] || 0;
        const barH = (val / 255) * maxBarLength;

        const angle = (i / numBars) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // Start path outside base radius ring
        const startX = cos * baseRadius;
        const startY = sin * baseRadius;
        const endX = cos * (baseRadius + barH);
        const endY = sin * (baseRadius + barH);

        // Gradient radiating outward
        const radialGrad = ctx.createLinearGradient(startX, startY, endX, endY);
        radialGrad.addColorStop(0, accent);
        radialGrad.addColorStop(1, 'rgba(255, 255, 255, 0.05)');

        ctx.strokeStyle = radialGrad;
        ctx.lineWidth = Math.max(1, (baseRadius * 2 * Math.PI) / numBars * 0.6);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      ctx.restore();
    }
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
}

window.visualizer = new AudioVisualizer();
