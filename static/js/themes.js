// AquaMusic Theme Manager
class ThemeManager {
  constructor() {
    this.theme = 'dark-violet';
    this.dynamicThemeEnabled = false;
  }

  init() {
    // Load from localStorage or system preference
    const savedTheme = localStorage.getItem('wavevault_theme');
    if (savedTheme) {
      this.setTheme(savedTheme);
    } else {
      // Check prefers-color-scheme
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        // AquaMusic is dark cinematic by design, but we can load Nord or default Dark Violet.
        this.setTheme('nord');
      } else {
        this.setTheme('dark-violet');
      }
    }
    this.bindThemeToggle();
  }

  updateFavicon(themeName) {
    let bgColor = "#0f0a1c";
    let waveColor = "#7b42f6";
    if (themeName === 'nord') {
      bgColor = "#2e3440"; waveColor = "#88c0d0";
    } else if (themeName === 'light-pure') {
      bgColor = "#ffffff"; waveColor = "#7c6af7";
    } else if (themeName === 'midnight-blue') {
      bgColor = "#080b10"; waveColor = "#00d2ff";
    } else if (themeName === 'carbon') {
      bgColor = "#000000"; waveColor = "#ffffff";
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><rect width="24" height="24" fill="${bgColor}" rx="4"/><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" stroke="${waveColor}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" stroke="${waveColor}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" stroke="${waveColor}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    
    const encoded = "data:image/svg+xml;base64," + btoa(svg);
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = encoded;
  }

  bindThemeToggle() {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;

    const themes = ['dark-violet', 'midnight-blue', 'carbon', 'nord', 'light-pure', 'dynamic'];

    // Set initial icon based on current theme
    this._updateThemeIcon(btn, this.theme);

    btn.addEventListener('click', () => {
      let idx = themes.indexOf(this.theme);
      if (idx === -1) idx = 0;
      idx = (idx + 1) % themes.length;
      this.setTheme(themes[idx]);
      this._updateThemeIcon(btn, themes[idx]);
    });
  }

  _updateThemeIcon(btn, themeName) {
    let iconName = 'moon';
    if (themeName === 'light-pure') iconName = 'sun';
    else if (themeName === 'dynamic') iconName = 'sparkles';
    else if (themeName === 'nord') iconName = 'cloud-snow';

    btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Applies selected theme.
   * @param {string} themeName - Theme option name.
   */
  setTheme(themeName) {
    if (themeName === 'dynamic') {
      this.dynamicThemeEnabled = true;
      this.theme = 'dynamic';
      document.documentElement.setAttribute('data-theme', 'dark-violet'); // reset base variables
      // If a song is currently playing, load its dominant art color
      if (window.player && window.player.currentTrack) {
        this.applyDynamicColor(window.player.currentTrack.id);
      }
    } else {
      this.dynamicThemeEnabled = false;
      this.theme = themeName;
      document.documentElement.setAttribute('data-theme', themeName);
      
      // Reset accent colors back to theme defaults by removing inline document styles
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--accent-dim');
      document.documentElement.style.removeProperty('--accent-glow');
      document.documentElement.style.removeProperty('--accent-text');
    }
    
    this.updateFavicon(themeName);
    localStorage.setItem('wavevault_theme', themeName);
  }

  /**
   * Loads dominant color details from API and sets CSS variables.
   * @param {string} trackId - MD5 hash code of track path.
   */
  async applyDynamicColor(trackId) {
    if (!this.dynamicThemeEnabled) return;

    try {
      const data = await window.api.getDominantColor(trackId);
      if (data && data.hex) {
        const hex = data.hex;
        const r = data.r;
        const g = data.g;
        const b = data.b;

        // Apply inline styles to document root overriding standard colors
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, 0.18)`);
        document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.35)`);
        
        // Calculate lighter text color for contrast
        // Adding a bit of white to the RGB values
        const lr = Math.min(255, r + 40);
        const lg = Math.min(255, g + 40);
        const lb = Math.min(255, b + 40);
        document.documentElement.style.setProperty('--accent-text', `rgb(${lr}, ${lg}, ${lb})`);
        
        // Update visual elements that need redraws (like canvas visualizer or waveform seekbar)
        if (window.waveformSeekbar) {
          window.waveformSeekbar.redraw();
        }
      }
    } catch (err) {
      console.warn("[Theme Manager] Could not load dynamic dominant colors", err);
    }
  }

  /**
   * Invoked by player when track changes.
   * @param {string} trackId 
   */
  onTrackChanged(trackId) {
    if (this.dynamicThemeEnabled) {
      this.applyDynamicColor(trackId);
    }
  }
}

window.themes = new ThemeManager();
