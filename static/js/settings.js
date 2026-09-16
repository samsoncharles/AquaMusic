// AquaMusic Configurations and Settings Manager
class SettingsManager {
  constructor() {
    this.modal = null;
    this.evtSource = null;
  }

  init() {
    this.modal = document.getElementById('modal-settings');

    // Bind Toggle Gear click
    const btnToggle = document.getElementById('btn-settings-toggle');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => this.showSettings());
    }

    // Close settings when clicking outside the modal (on the backdrop)
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        // Only close if user clicked directly on the overlay backdrop, not on the modal itself
        if (e.target === overlay && this.modal && this.modal.style.display !== 'none') {
          this.closeSettings();
        }
      });
    }

    const btnClose = document.getElementById('btn-settings-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.closeSettings());
    }

    // Bind crossfade slider updates
    const xSlider = document.getElementById('setting-crossfade-slider');
    const xLabel = document.getElementById('setting-crossfade-val');
    if (xSlider && xLabel) {
      xSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        xLabel.innerText = `${val}s`;
        if (window.player) window.player.crossfadeDuration = parseInt(val);
        localStorage.setItem('wavevault_crossfade', val);
      });
    }

    // Bind checkbox toggles
    this.bindCheckbox('setting-crossfade-enabled', 'wavevault_crossfade_enabled', (checked) => {
      if (window.player) window.player.crossfadeEnabled = checked;
    }, true);

    this.bindCheckbox('setting-sweet-fades', 'wavevault_sweet_fades', (checked) => {
      if (window.player) window.player.sweetFadesEnabled = checked;
    }, true);

    this.bindCheckbox('setting-gapless', 'wavevault_gapless', (checked) => {
      if (window.player) window.player.gaplessEnabled = checked;
    }, true);

    this.bindCheckbox('setting-replaygain', 'wavevault_replaygain', (checked) => {
      if (window.player) window.player.replayGainEnabled = checked;
    }, true);

    this.bindCheckbox('setting-mono-output', 'wavevault_mono', (checked) => {
      // Setup mono channel merge nodes if required, or simple toggle
      // Since Web Audio API supports channel splitters/mergers, simple flag checked works
      window.toast.show(`Mono audio mode ${checked ? 'enabled' : 'disabled'}`, 'info');
    }, false);

    this.bindCheckbox('setting-compact-mode', 'wavevault_compact', (checked) => {
      document.body.classList.toggle('compact-mode', checked);
      if (window.library) {
        window.library.rowHeight = checked ? 40 : 56;
        if (window.library.virtualList) {
          window.library.virtualList.rowHeight = window.library.rowHeight;
          window.library.virtualList.updateViewportSize();
          window.library.virtualList.refresh();
        }
      }
    }, false);

    // Bind visual Theme swatch picker click triggers
    const themePicker = document.getElementById('setting-theme-picker');
    if (themePicker && window.themes) {
      const cards = themePicker.querySelectorAll('.theme-card');
      cards.forEach(card => {
        const val = card.dataset.themeVal;
        card.classList.toggle('active', val === window.themes.theme);
        
        card.addEventListener('click', () => {
          cards.forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          window.themes.setTheme(val);
        });
      });
    }

    // Bind Folder Scan Trigger (Sidebar)
    const btnScan = document.getElementById('btn-sidebar-scan');
    const folderInput = document.getElementById('setting-music-dir');
    
    if (btnScan && folderInput) {
      // Load last folder path
      let lastFolder = localStorage.getItem('wavevault_folder_path') || '';
      if (lastFolder === '/') lastFolder = '';
      folderInput.value = lastFolder;

      btnScan.addEventListener('click', () => {
        const path = folderInput.value.trim();
        if (path) {
          localStorage.setItem('wavevault_folder_path', path);
          this.triggerLibraryScan(path);
        } else {
          window.toast.show("Please enter a valid directory path.", "warning");
        }
      });
    }

    // Prune Deleted Files Trigger
    const btnPrune = document.getElementById('btn-settings-prune');
    if (btnPrune) {
      btnPrune.addEventListener('click', () => this.pruneMissingData());
    }

    // Reset Data Trigger
    const btnReset = document.getElementById('btn-settings-clear');
    if (btnReset) {
      btnReset.addEventListener('click', () => this.clearAllData());
    }

    this.initSharing();
    this.initSafeFolder();

    // Initial config loads
    this.loadSettings();
  }

  showSettings() {
    if (!this.modal) this.modal = document.getElementById('modal-settings');
    if (!this.modal) return;

    // Hide all other modals in the overlay first to prevent overlap bugs
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.querySelectorAll('.modal-container').forEach(m => {
        m.style.display = 'none';
        m.classList.remove('show');
      });
      overlay.classList.add('show');
    }
    
    this.modal.classList.add('show');
    this.modal.style.display = 'flex';

    // Sync theme picker visual card highlight
    const themePicker = document.getElementById('setting-theme-picker');
    if (themePicker && window.themes) {
      const cards = themePicker.querySelectorAll('.theme-card');
      cards.forEach(card => {
        card.classList.toggle('active', card.dataset.themeVal === window.themes.theme);
      });
    }

    // Sync dynamic living aurora toggle switch
    const dToggle = document.getElementById('setting-dynamic-toggle') || document.getElementById('setting-dynamic2-toggle');
    if (dToggle && window.themes) {
      dToggle.checked = (window.themes.theme === 'dynamic' || window.themes.theme === 'dynamic2');
    }
  }

  closeSettings() {
    const overlay = document.getElementById('modal-overlay');
    if (this.modal) {
      this.modal.classList.remove('show');
      this.modal.style.display = 'none';
    }
    if (overlay) {
      overlay.classList.remove('show');
    }
    
    // Stop any active status SSE feeds if settings panel closes (save threads)
    this.disconnectScanFeed();
  }

  bindCheckbox(elementId, storageKey, callback, defaultVal = false) {
    const cb = document.getElementById(elementId);
    if (!cb) return;

    const saved = localStorage.getItem(storageKey);
    const checked = saved !== null ? JSON.parse(saved) : defaultVal;
    cb.checked = checked;

    // Trigger initial callback setup
    callback(checked);

    cb.addEventListener('change', (e) => {
      localStorage.setItem(storageKey, JSON.stringify(e.target.checked));
      callback(e.target.checked);
    });
  }

  loadSettings() {
    // Crossfade
    const xSlider = document.getElementById('setting-crossfade-slider');
    const xLabel = document.getElementById('setting-crossfade-val');
    const savedX = localStorage.getItem('wavevault_crossfade') || '5';
    if (xSlider && xLabel) {
      xSlider.value = savedX;
      xLabel.innerText = `${savedX}s`;
      if (window.player) window.player.crossfadeDuration = parseInt(savedX);
    }

    const chkCrossfade = document.getElementById('setting-crossfade-enabled');
    const savedCrossfadeEnabled = localStorage.getItem('wavevault_crossfade_enabled') !== 'false';
    if (chkCrossfade) {
      chkCrossfade.checked = savedCrossfadeEnabled;
      if (window.player) window.player.crossfadeEnabled = savedCrossfadeEnabled;
    }
    
    // Speed dropdown syncs
    const speedSelect = document.getElementById('playback-speed-select');
    const savedSpeed = localStorage.getItem('wavevault_playback_speed') || '1.0';
    if (speedSelect) {
      speedSelect.value = savedSpeed;
      speedSelect.addEventListener('change', (e) => {
        if (window.player) window.player.setPlaybackSpeed(e.target.value);
      });
    }
  }

  async initSharing() {
    const enabled = document.getElementById('setting-share-enabled');
    const fields = document.getElementById('setting-share-fields');
    const links = document.getElementById('setting-share-links');
    const render = (config) => {
      enabled.checked = !!config.enabled;
      fields.style.display = enabled.checked ? 'flex' : 'none';
      links.textContent = (config.urls || []).length ? `Open on your Wi-Fi: ${(config.urls || []).join('  •  ')}` : '';
    };
    try { render(await window.api.getSharing()); } catch (_) { /* server may be starting */ }
    enabled.addEventListener('change', () => {
      fields.style.display = enabled.checked ? 'flex' : 'none';
      this.saveSharing();
    });
  }

  async saveSharing() {
    const enabled = document.getElementById('setting-share-enabled');
    try {
      const result = await window.api.saveSharing({
        enabled: enabled.checked
      });
      document.getElementById('setting-share-links').textContent = (result.urls || []).length ? `Open on your Wi-Fi: ${result.urls.join('  •  ')}` : '';
      window.toast.show(enabled.checked ? 'Network sharing is active on HTTP port 5000.' : 'Network sharing is off; AquaMusic is local only.', 'success');
    } catch (error) {
      window.toast.show(`Could not change sharing: ${error.message || error}`, 'error');
    }
  }

  async initSafeFolder() {
    const input = document.getElementById('setting-safe-folder-input');
    const btnSave = document.getElementById('btn-save-safe-folder');
    const status = document.getElementById('setting-safe-folder-status');
    if (!input || !btnSave) return;

    try {
      const data = await window.api.getSafeFolder();
      if (data && data.folder) {
        input.value = data.folder;
      }
    } catch (e) {
      console.warn("[Settings] Could not fetch safe folder:", e);
    }

    btnSave.addEventListener('click', async () => {
      const val = input.value.trim();
      if (!val) return;
      btnSave.disabled = true;
      btnSave.textContent = 'Saving...';
      try {
        const res = await window.api.setSafeFolder(val);
        if (res.status === 'ok') {
          input.value = res.folder;
          if (status) {
            status.textContent = `✓ Active safe download folder: ${res.folder}`;
            status.style.color = 'var(--accent)';
          }
          window.toast.show("Safe download folder updated!", "success");
        }
      } catch (err) {
        if (status) {
          status.textContent = `Error: ${err.message}`;
          status.style.color = 'var(--danger)';
        }
        window.toast.show("Could not set folder: " + err.message, "error");
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Save Folder';
      }
    });
  }

  async triggerLibraryScan(folderPath) {
    try {
      this.lastScannedFolder = folderPath;
      window.toast.show("Starting directory scanner...", "info");
      const res = await window.api.scanFolder(folderPath);
      
      if (res.status === 'ok') {
        localStorage.setItem('wavevault_folder_path', folderPath);
        
        // Show scanning status UI element
        const scanBox = document.getElementById('settings-scan-progress-box');
        if (scanBox) scanBox.style.display = 'block';

        this.connectScanFeed();
      }
    } catch (err) {
      window.toast.show(`Scan failed: ${err.message || err}`, "error");
    }
  }

  connectScanFeed() {
    this.disconnectScanFeed();

    // Setup Server-Sent Events monitoring scan status
    this.evtSource = new EventSource('/api/scan/status');
    
    const pFill = document.getElementById('scan-progressbar-fill');
    const pCounts = document.getElementById('scan-progress-counts');
    const pStatus = document.getElementById('scan-status-text');
    const pFile = document.getElementById('scan-current-filepath');

    this.evtSource.onmessage = (event) => {
      try {
        const state = JSON.parse(event.data);
        
        if (pStatus) pStatus.innerText = state.status === 'scanning' ? 'Scanning directory...' : 'Scan Finished';
        if (pCounts) pCounts.innerText = `${state.scanned} / ${state.total}`;
        
        if (pFill && state.total > 0) {
          const pct = (state.scanned / state.total) * 100;
          pFill.style.width = `${pct}%`;
        }

        if (pFile) {
          pFile.innerText = state.current_file || '';
        }

        if (state.status === 'done' || state.status === 'error') {
          this.disconnectScanFeed();
          window.toast.show("Folder scan completed successfully!", "success");
          
          // Hide scanner UI status drawer on done
          setTimeout(() => {
            const scanBox = document.getElementById('settings-scan-progress-box');
            if (scanBox) scanBox.style.display = 'none';
          }, 4000);

          // Force reload library content databases
          if (window.library) {
            window.library.reload().then(() => {
              window.toast.show('Music folder imported.', 'success');
            });
          }
        }
      } catch (err) {
        console.error("[SSE Parse Error]", err);
      }
    };

    this.evtSource.onerror = () => {
      this.disconnectScanFeed();
    };
  }

  disconnectScanFeed() {
    if (this.evtSource) {
      this.evtSource.close();
      this.evtSource = null;
    }
  }

  async pruneMissingData() {
    try {
      window.toast.show("Scanning library for missing & deleted files...", "info");
      const res = await window.api.pruneMissingTracks();
      const count = res?.pruned_count || 0;
      if (res?.pruned_ids && window.playlists) {
        window.playlists.removeTracksEverywhere(res.pruned_ids);
      }
      if (window.library) {
        await window.library.reload();
      }
      if (count > 0) {
        window.toast.show(`✓ Pruned ${count} deleted track${count === 1 ? '' : 's'} from library!`, "success");
      } else {
        window.toast.show("No missing files found. Library is synchronized!", "info");
      }
    } catch (err) {
      window.toast.show("Prune failed: " + (err.message || err), "error");
    }
  }

  async clearAllData() {
    const confirmed = await window.dialog.confirm("WARNING: This will wipe all AquaMusic metadata, configurations, user playlists, ratings, and play counts. Are you sure?", "Reset All Data");
    if (confirmed) {
      this.disconnectScanFeed();
      try {
        // The library is persisted separately from browser preferences, so it
        // must be cleared explicitly as part of a full local-data reset.
        await window.api.clearLibrary();
        await Promise.all([
          window.api.saveState('preferences', {}),
          window.api.saveState('playlists', []),
          window.api.saveState('queue', {}),
          window.api.saveState('playback', {})
        ]);
        localStorage.clear();
        window.location.reload();
      } catch (error) {
        window.toast.show(`Could not clear all local data: ${error.message || error}`, 'error');
      }
    }
  }
}

window.settings = new SettingsManager();
