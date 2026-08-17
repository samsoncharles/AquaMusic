// AquaMusic 10-Band Graphic Equalizer Manager (Web Audio API)
class EqualizerManager {
  constructor() {
    this.frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.bands = []; // BiquadFilterNode array
    this.presets = {
      'flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      'bass-boost': [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
      'treble-boost': [0, 0, 0, 0, 0, 0, 2, 4, 6, 8],
      'pop': [2, 3, 4, 2, 0, -1, -1, 0, 2, 3],
      'rock': [4, 3, 2, 0, -2, -1, 2, 4, 5, 5],
      'jazz': [3, 2, 0, 2, -2, -2, 0, 2, 3, 3],
      'classical': [4, 3, 2, 1, 0, 0, -1, -2, -2, -3],
      'electronic': [5, 4, 3, 0, -3, 2, 1, 2, 4, 5],
      'hip-hop': [5, 4, 2, 3, -1, 1, -1, 1, 2, 2]
    };
  }

  /**
   * Builds the Web Audio biquad peaking filters chain.
   * @param {AudioContext} audioCtx 
   * @returns {BiquadFilterNode[]}
   */
  createFilters(audioCtx) {
    this.bands = this.frequencies.map(freq => {
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4; // standard bandwidth ratio
      filter.gain.value = 0.0;
      return filter;
    });
    return this.bands;
  }

  init() {
    this.renderUI();
    this.loadSavedBands();
    
    // Bind drawer triggers
    const btnToggle = document.getElementById('btn-eq-toggle');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => this.togglePanel());
    }

    const btnClose = document.getElementById('btn-eq-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.togglePanel(false));
    }

    // Preset dropdown change
    const ddown = document.getElementById('eq-presets-dropdown');
    if (ddown) {
      ddown.addEventListener('change', (e) => this.applyPreset(e.target.value));
    }

    // Reset button click
    const btnReset = document.getElementById('btn-eq-reset-flat');
    if (btnReset) {
      btnReset.addEventListener('click', () => this.applyPreset('flat'));
    }
  }

  togglePanel(forceState = null) {
    const panel = document.getElementById('eq-panel');
    if (!panel) return;
    const show = (forceState !== null) ? forceState : !panel.classList.contains('show');
    panel.classList.toggle('show', show);
    
    const toggleBtn = document.getElementById('btn-eq-toggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('btn-toggle-active', show);
    }
  }

  renderUI() {
    const container = document.getElementById('eq-sliders-container');
    if (!container) return;
    container.innerHTML = '';

    this.frequencies.forEach((freq, index) => {
      const col = document.createElement('div');
      col.className = 'eq-slider-col';

      // Format label (e.g. 32Hz, 1kHz)
      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;

      col.innerHTML = `
        <span class="eq-value" id="eq-val-${index}">0</span>
        <input type="range" id="eq-slider-${index}" min="-12" max="12" step="1" value="0">
        <span class="eq-slider-label">${label}</span>
      `;

      const slider = col.querySelector('input');
      slider.addEventListener('input', (e) => this.handleSliderInput(index, parseFloat(e.target.value)));
      
      container.appendChild(col);
    });
  }

  loadSavedBands() {
    // Always start with flat EQ for original unmodified sound
    const gains = this.presets['flat'];

    // Reset preset dropdown to flat
    const ddown = document.getElementById('eq-presets-dropdown');
    if (ddown) {
      ddown.value = 'flat';
    }

    // Apply flat values to UI and audio nodes
    gains.forEach((db, i) => {
      this.setBandGain(i, db, false);
      const slider = document.getElementById(`eq-slider-${i}`);
      if (slider) slider.value = db;
    });

    // Clear any previously saved EQ boost
    localStorage.removeItem('wavevault_eq_bands');
    localStorage.setItem('wavevault_eq_preset', 'flat');
  }

  handleSliderInput(index, dbValue) {
    this.setBandGain(index, dbValue, true);
    
    // Set active preset selection to custom
    const ddown = document.getElementById('eq-presets-dropdown');
    if (ddown) {
      ddown.value = 'custom';
      localStorage.setItem('wavevault_eq_preset', 'custom');
    }
  }

  setBandGain(index, dbValue, shouldSave = true) {
    // Apply to UI text
    const display = document.getElementById(`eq-val-${index}`);
    if (display) {
      display.innerText = (dbValue > 0 ? `+${dbValue}` : dbValue);
    }

    // Apply to Audio node
    if (this.bands[index] && window.player) {
      const node = this.bands[index];
      // Parametric biquad takes gain value directly
      if (window.player.audioCtx) {
        node.gain.setValueAtTime(dbValue, window.player.audioCtx.currentTime);
      }
    }

    if (shouldSave) {
      this.saveBands();
    }
  }

  applyPreset(presetName) {
    const gains = this.presets[presetName] || this.presets['flat'];
    
    gains.forEach((db, i) => {
      this.setBandGain(i, db, false);
      const slider = document.getElementById(`eq-slider-${i}`);
      if (slider) slider.value = db;
    });

    const ddown = document.getElementById('eq-presets-dropdown');
    if (ddown) {
      ddown.value = presetName;
      localStorage.setItem('wavevault_eq_preset', presetName);
    }
    
    this.saveBands();
    window.toast.show(`Equalizer preset applied: ${presetName}`, 'info');
  }

  saveBands() {
    const gains = this.frequencies.map((_, i) => {
      const slider = document.getElementById(`eq-slider-${i}`);
      return slider ? parseFloat(slider.value) : 0;
    });
    localStorage.setItem('wavevault_eq_bands', JSON.stringify(gains));
  }
}

window.eq = new EqualizerManager();
