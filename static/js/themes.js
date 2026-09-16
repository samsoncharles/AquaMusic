// AquaMusic Theme Manager - Modern Dynamic Living Aurora System
class ThemeManager {
  constructor() {
    this.theme = 'dark-violet';
    this.dynamicThemeEnabled = false;
    this.previousStaticTheme = 'dark-violet';
    this.d2Style = localStorage.getItem('wavevault_d2_style') || 'aurora';
    this.currentPalette = null;
  }

  init() {
    // Load from localStorage or system preference
    let savedTheme = localStorage.getItem('wavevault_theme');
    if (savedTheme === 'dynamic2') savedTheme = 'dynamic';

    if (savedTheme) {
      this.setTheme(savedTheme);
    } else {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        this.setTheme('nord');
      } else {
        this.setTheme('dark-violet');
      }
    }
    this.bindThemeToggle();
    this.bindSettingsToggle();
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
    } else if (themeName === 'dynamic' || themeName === 'dynamic2') {
      bgColor = "#080c14"; waveColor = this.currentPalette?.color1 ? `rgb(${this.currentPalette.color1.r},${this.currentPalette.color1.g},${this.currentPalette.color1.b})` : "#38bdf8";
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

    this._updateThemeIcon(btn, this.theme);

    btn.addEventListener('click', () => {
      let idx = themes.indexOf(this.theme);
      if (idx === -1) idx = 0;
      idx = (idx + 1) % themes.length;
      this.setTheme(themes[idx]);
      this._updateThemeIcon(btn, themes[idx]);
    });
  }

  bindSettingsToggle() {
    const toggle = document.getElementById('setting-dynamic-toggle') || document.getElementById('setting-dynamic2-toggle');
    if (toggle) {
      toggle.checked = (this.theme === 'dynamic');
      toggle.addEventListener('change', () => {
        if (toggle.checked) {
          this.setTheme('dynamic');
        } else {
          this.setTheme(this.previousStaticTheme || 'dark-violet');
        }
      });
    }

    const styleSelect = document.getElementById('setting-dynamic-style') || document.getElementById('setting-dynamic2-style');
    if (styleSelect) {
      styleSelect.value = this.d2Style;
      styleSelect.addEventListener('change', () => {
        this.d2Style = styleSelect.value;
        localStorage.setItem('wavevault_d2_style', this.d2Style);
        document.documentElement.setAttribute('data-d2-style', this.d2Style);
        if (this.dynamicThemeEnabled && window.player?.currentTrack) {
          this.applyDynamicColor(window.player.currentTrack);
        }
      });
    }
  }

  _updateThemeIcon(btn, themeName) {
    if (!btn) return;
    let iconName = 'moon';
    if (themeName === 'light-pure') iconName = 'sun';
    else if (themeName === 'dynamic' || themeName === 'dynamic2') iconName = 'palette';
    else if (themeName === 'nord') iconName = 'cloud-snow';
    else if (themeName === 'carbon') iconName = 'zap';
    else if (themeName === 'dark-violet') iconName = 'disc';

    btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    if (window.lucide) window.lucide.createIcons({ container: btn });
  }

  cleanDynamicStyles() {
    const props = [
      '--bg-base', '--bg-surface', '--bg-surface-2', '--bg-surface-3',
      '--bg-overlay', '--bg-player', '--border', '--border-strong',
      '--accent', '--accent-2', '--accent-3', '--accent-grad',
      '--accent-dim', '--accent-glow', '--accent-text',
      '--d2-accent-rgb', '--d2-accent2-rgb', '--d2-accent3-rgb', '--d2-surface-rgb',
      '--text-primary', '--text-secondary', '--text-muted'
    ];
    props.forEach(p => document.documentElement.style.removeProperty(p));
    document.documentElement.removeAttribute('data-d2-style');

    const panel = document.getElementById('dynamic-options-panel') || document.getElementById('dynamic2-options-panel');
    if (panel) panel.style.display = 'none';
  }

  /**
   * Applies selected theme.
   * @param {string} themeName - Theme option name.
   */
  setTheme(themeName) {
    this.cleanDynamicStyles();

    if (themeName === 'dynamic' || themeName === 'dynamic2') {
      this.dynamicThemeEnabled = true;
      this.theme = 'dynamic';
      document.documentElement.setAttribute('data-theme', 'dynamic');
      document.documentElement.setAttribute('data-d2-style', this.d2Style || 'aurora');
      
      const panel = document.getElementById('dynamic-options-panel') || document.getElementById('dynamic2-options-panel');
      if (panel) panel.style.display = 'flex';

      if (window.player && window.player.currentTrack) {
        this.applyDynamicColor(window.player.currentTrack);
      }
    } else {
      this.dynamicThemeEnabled = false;
      this.theme = themeName;
      this.previousStaticTheme = themeName;
      document.documentElement.setAttribute('data-theme', themeName);
    }

    // Sync toggle switch in settings
    const toggle = document.getElementById('setting-dynamic-toggle') || document.getElementById('setting-dynamic2-toggle');
    if (toggle) {
      toggle.checked = (this.theme === 'dynamic');
    }

    // Sync theme picker cards in settings modal
    const themePicker = document.getElementById('setting-theme-picker');
    if (themePicker) {
      const cards = themePicker.querySelectorAll('.theme-card');
      cards.forEach(card => {
        card.classList.toggle('active', card.dataset.themeVal === this.theme || (card.dataset.themeVal === 'dynamic' && this.theme === 'dynamic2'));
      });
    }

    // Sync topbar button icon
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
      this._updateThemeIcon(btn, this.theme);
    }

    this.updateFavicon(this.theme);
    localStorage.setItem('wavevault_theme', this.theme);

    if (window.lyrics && window.lyrics.syncControlStates) {
      window.lyrics.syncControlStates();
    }
  }

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h, s, l];
  }

  hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  /**
   * Extracts a 3-color palette (Primary, Harmonic, Highlight) from album art.
   */
  extractPaletteFromImage(imageUrl) {
    return new Promise((resolve) => {
      if (!imageUrl) return resolve(null);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 1400);

      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 48;
          canvas.height = 48;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 48, 48);
          const data = ctx.getImageData(0, 0, 48, 48).data;

          // Bucket pixels into 12 hue ranges (30 degrees each)
          const bins = Array.from({ length: 12 }, () => ({
            rSum: 0, gSum: 0, bSum: 0, count: 0, totalWeight: 0, maxSat: 0
          }));

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
            if (a < 128) continue;
            const [h, s, l] = this.rgbToHsl(r, g, b);
            if (s < 0.16 || l < 0.10 || l > 0.92) continue;

            const binIdx = Math.floor(((h * 360) % 360) / 30);
            const weight = (s * s) * (1 - Math.abs(l - 0.5) * 1.5) + 0.1;
            const bin = bins[binIdx];
            bin.rSum += r * weight;
            bin.gSum += g * weight;
            bin.bSum += b * weight;
            bin.totalWeight += weight;
            bin.count++;
            if (s > bin.maxSat) bin.maxSat = s;
          }

          const validBins = bins
            .filter(b => b.count >= 4)
            .sort((a, b) => (b.totalWeight * b.maxSat) - (a.totalWeight * a.maxSat));

          let color1, color2, color3;

          if (validBins.length > 0) {
            const b1 = validBins[0];
            color1 = {
              r: Math.round(b1.rSum / b1.totalWeight),
              g: Math.round(b1.gSum / b1.totalWeight),
              b: Math.round(b1.bSum / b1.totalWeight)
            };
          }

          if (validBins.length > 1) {
            const b2 = validBins[1];
            color2 = {
              r: Math.round(b2.rSum / b2.totalWeight),
              g: Math.round(b2.gSum / b2.totalWeight),
              b: Math.round(b2.bSum / b2.totalWeight)
            };
          }

          if (validBins.length > 2) {
            const b3 = validBins[2];
            color3 = {
              r: Math.round(b3.rSum / b3.totalWeight),
              g: Math.round(b3.gSum / b3.totalWeight),
              b: Math.round(b3.bSum / b3.totalWeight)
            };
          }

          // Smart artistic harmonics fallback for monochromatic/duotone artwork
          if (!color1) {
            color1 = { r: 56, g: 189, b: 248 };
          }
          if (!color2) {
            const [h, s, l] = this.rgbToHsl(color1.r, color1.g, color1.b);
            const [r2, g2, b2] = this.hslToRgb((h + 0.12) % 1, Math.min(1, s + 0.15), Math.max(0.45, l));
            color2 = { r: r2, g: g2, b: b2 };
          }
          if (!color3) {
            const [h, s, l] = this.rgbToHsl(color1.r, color1.g, color1.b);
            const [r3, g3, b3] = this.hslToRgb((h + 0.45) % 1, Math.min(1, s + 0.2), Math.min(0.85, l + 0.15));
            color3 = { r: r3, g: g3, b: b3 };
          }

          resolve({ color1, color2, color3 });
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      };
      img.src = imageUrl;
    });
  }

  /**
   * Dynamic: Living multi-color ambient aurora mesh and frosted glassmorphism.
   */
  async applyDynamicColor(track) {
    if (!this.dynamicThemeEnabled || !track) return;

    let palette = null;
    let artUrl = track.thumbnail;
    if ((!navigator.onLine && artUrl && artUrl.startsWith('http')) || !artUrl) {
      artUrl = `/api/art/${track.id}`;
    }

    // 1. Multi-color sampling directly from thumbnail/art
    try {
      palette = await this.extractPaletteFromImage(artUrl);
    } catch (_) {}

    // 2. Fallback to backend dominant color if client extraction fails
    if (!palette || !palette.color1) {
      try {
        const data = await window.api.getDominantColor(track.id);
        if (data && typeof data.r === 'number') {
          const c1 = { r: data.r, g: data.g, b: data.b };
          const [h, s, l] = this.rgbToHsl(c1.r, c1.g, c1.b);
          const [r2, g2, b2] = this.hslToRgb((h + 0.15) % 1, Math.min(1, s + 0.15), Math.max(0.5, l));
          const [r3, g3, b3] = this.hslToRgb((h + 0.45) % 1, Math.min(1, s + 0.2), Math.min(0.85, l + 0.15));
          palette = {
            color1: c1,
            color2: { r: r2, g: g2, b: b2 },
            color3: { r: r3, g: g3, b: b3 }
          };
        }
      } catch (_) {}
    }

    if (!palette || !palette.color1) {
      palette = {
        color1: { r: 56, g: 189, b: 248 },
        color2: { r: 129, g: 140, b: 248 },
        color3: { r: 236, g: 72, b: 153 }
      };
    }

    this.currentPalette = palette;
    const { color1: c1, color2: c2, color3: c3 } = palette;

    const [h1, s1, l1] = this.rgbToHsl(c1.r, c1.g, c1.b);
    const H1_deg = Math.round(h1 * 360);
    const S1_pct = Math.round(Math.max(0.45, s1) * 100);

    // Compute deep atmospheric background base
    const baseLight = this.d2Style === 'neon' ? 4 : (this.d2Style === 'subtle' ? 3 : 4);
    const bgBase = `hsl(${H1_deg}, ${Math.min(24, Math.round(S1_pct * 0.30))}%, ${baseLight}%)`;

    // Frosted glass surface tint
    const [sr, sg, sb] = this.hslToRgb(h1, Math.min(0.35, s1 * 0.4), 0.11);
    const [s2r, s2g, s2b] = this.hslToRgb(h1, Math.min(0.35, s1 * 0.4), 0.16);
    const [s3r, s3g, s3b] = this.hslToRgb(h1, Math.min(0.35, s1 * 0.4), 0.21);

    const rootStyle = document.documentElement.style;

    // Set RGB triplets for transparent borders & glass shadows
    rootStyle.setProperty('--d2-accent-rgb', `${c1.r}, ${c1.g}, ${c1.b}`);
    rootStyle.setProperty('--d2-accent2-rgb', `${c2.r}, ${c2.g}, ${c2.b}`);
    rootStyle.setProperty('--d2-accent3-rgb', `${c3.r}, ${c3.g}, ${c3.b}`);
    rootStyle.setProperty('--d2-surface-rgb', `${sr}, ${sg}, ${sb}`);

    // Color swatches & gradients
    rootStyle.setProperty('--accent', `rgb(${c1.r}, ${c1.g}, ${c1.b})`);
    rootStyle.setProperty('--accent-2', `rgb(${c2.r}, ${c2.g}, ${c2.b})`);
    rootStyle.setProperty('--accent-3', `rgb(${c3.r}, ${c3.g}, ${c3.b})`);
    rootStyle.setProperty('--accent-grad', `linear-gradient(135deg, rgb(${c1.r}, ${c1.g}, ${c1.b}) 0%, rgb(${c2.r}, ${c2.g}, ${c2.b}) 100%)`);

    rootStyle.setProperty('--accent-dim', `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.18)`);
    rootStyle.setProperty('--accent-glow', `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.45)`);
    rootStyle.setProperty('--accent-text', `hsl(${H1_deg}, 65%, 88%)`);

    // System surfaces
    rootStyle.setProperty('--bg-base', bgBase);
    rootStyle.setProperty('--bg-surface', `rgba(${sr}, ${sg}, ${sb}, 0.78)`);
    rootStyle.setProperty('--bg-surface-2', `rgba(${s2r}, ${s2g}, ${s2b}, 0.68)`);
    rootStyle.setProperty('--bg-surface-3', `rgba(${s3r}, ${s3g}, ${s3b}, 0.75)`);
    rootStyle.setProperty('--bg-overlay', `rgba(${Math.round(sr*0.6)}, ${Math.round(sg*0.6)}, ${Math.round(sb*0.6)}, 0.88)`);
    rootStyle.setProperty('--bg-player', `rgba(${sr}, ${sg}, ${sb}, 0.82)`);

    rootStyle.setProperty('--border', `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.14)`);
    rootStyle.setProperty('--border-strong', `rgba(${c2.r}, ${c2.g}, ${c2.b}, 0.26)`);

    rootStyle.setProperty('--text-primary', '#ffffff');
    rootStyle.setProperty('--text-secondary', `hsl(${H1_deg}, 20%, 75%)`);
    rootStyle.setProperty('--text-muted', `hsl(${H1_deg}, 15%, 52%)`);

    // Update live aurora backdrop orbs directly with colors
    const blob1 = document.getElementById('aurora-blob-1');
    const blob2 = document.getElementById('aurora-blob-2');
    const blob3 = document.getElementById('aurora-blob-3');
    if (blob1) blob1.style.background = `radial-gradient(circle, rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.45) 0%, transparent 68%)`;
    if (blob2) blob2.style.background = `radial-gradient(circle, rgba(${c2.r}, ${c2.g}, ${c2.b}, 0.38) 0%, transparent 68%)`;
    if (blob3) blob3.style.background = `radial-gradient(circle, rgba(${c3.r}, ${c3.g}, ${c3.b}, 0.30) 0%, transparent 68%)`;

    // Update palette preview swatches in settings modal
    const sw1 = document.getElementById('d2-swatch-1');
    const sw2 = document.getElementById('d2-swatch-2');
    const sw3 = document.getElementById('d2-swatch-3');
    if (sw1) {
      sw1.style.background = `rgb(${c1.r}, ${c1.g}, ${c1.b})`;
      sw1.style.boxShadow = `0 0 10px rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.6)`;
    }
    if (sw2) {
      sw2.style.background = `rgb(${c2.r}, ${c2.g}, ${c2.b})`;
      sw2.style.boxShadow = `0 0 8px rgba(${c2.r}, ${c2.g}, ${c2.b}, 0.4)`;
    }
    if (sw3) {
      sw3.style.background = `rgb(${c3.r}, ${c3.g}, ${c3.b})`;
      sw3.style.boxShadow = `0 0 8px rgba(${c3.r}, ${c3.g}, ${c3.b}, 0.4)`;
    }

    if (window.waveformSeekbar) {
      window.waveformSeekbar.redraw();
    }
    if (window.lyrics && window.lyrics.syncControlStates) {
      window.lyrics.syncControlStates();
    }
    this.updateFavicon('dynamic');
  }

  /**
   * Invoked by player when track changes.
   * @param {string} trackId 
   * @param {object} [track]
   */
  onTrackChanged(trackId, track) {
    if (this.dynamicThemeEnabled) {
      this.applyDynamicColor(track || window.player?.currentTrack || { id: trackId });
    }
  }
}

window.themes = new ThemeManager();
