// AquaMusic Tag Editor Form Handler
class TagEditor {
  constructor() {
    this.trackId = null;
    this.artBase64 = null;
    this.removeArtFlag = false;
    this.modal = null;
    this.filePicker = null;
    this.previewArt = null;
  }

  init() {
    this.modal = document.getElementById('modal-tageditor');
    this.filePicker = document.getElementById('tag-art-file-picker');
    this.previewArt = document.getElementById('tag-edit-art-preview');

    // Bind Change Art file picker triggers
    const btnChangeArt = document.getElementById('btn-tag-change-art');
    if (btnChangeArt && this.filePicker) {
      btnChangeArt.addEventListener('click', () => this.filePicker.click());
    }

    if (this.filePicker) {
      this.filePicker.addEventListener('change', (e) => this.handleArtFileSelect(e));
    }

    // Bind Remove Art trigger
    const btnRemoveArt = document.getElementById('btn-tag-remove-art');
    if (btnRemoveArt) {
      btnRemoveArt.addEventListener('click', () => this.handleArtRemove());
    }

    // Save Action trigger
    const btnSave = document.getElementById('btn-tag-editor-save');
    if (btnSave) {
      btnSave.addEventListener('click', () => this.saveChanges());
    }
  }

  showEditor(trackId) {
    if (!window.library || !window.library.tracks[trackId]) return;
    const track = window.library.tracks[trackId];
    
    this.trackId = trackId;
    this.artBase64 = null;
    this.removeArtFlag = false;

    // Load data fields
    document.getElementById('tag-input-title').value = track.title || '';
    document.getElementById('tag-input-artist').value = track.artist || '';
    document.getElementById('tag-input-album').value = track.album || '';
    document.getElementById('tag-input-albumartist').value = track.album_artist || '';
    document.getElementById('tag-input-genre').value = track.genre || '';
    document.getElementById('tag-input-year').value = track.year || '';
    document.getElementById('tag-input-track').value = track.track_number || '0';
    document.getElementById('tag-input-disc').value = track.disc_number || '0';
    document.getElementById('tag-input-bpm').value = track.bpm || '';
    document.getElementById('tag-input-composer').value = track.composer || '';
    document.getElementById('tag-input-comment').value = track.comment || '';

    // Load current artwork preview
    if (this.previewArt) {
      this.previewArt.src = `/api/art/${trackId}?t=${Date.now()}`;
    }

    // Open Modal Overlay
    const overlay = document.getElementById('modal-overlay');
    if (overlay && this.modal) {
      overlay.classList.add('show');
      this.modal.style.display = 'block';
    }
  }

  closeEditor() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay && this.modal) {
      overlay.classList.remove('show');
      this.modal.style.display = 'none';
    }
    this.trackId = null;
    if (this.filePicker) this.filePicker.value = ''; // clear select
  }

  handleArtFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.artBase64 = e.target.result;
      this.removeArtFlag = false;
      if (this.previewArt) {
        this.previewArt.src = this.artBase64;
      }
    };
    reader.readAsDataURL(file);
  }

  handleArtRemove() {
    this.artBase64 = null;
    this.removeArtFlag = true;
    if (this.previewArt) {
      this.previewArt.src = '/api/art/default';
    }
  }

  async saveChanges() {
    if (!this.trackId) return;

    // Retrieve fields
    const data = {
      title: (document.getElementById('tag-input-title').value || '').trim(),
      artist: (document.getElementById('tag-input-artist').value || '').trim(),
      album: (document.getElementById('tag-input-album').value || '').trim(),
      album_artist: document.getElementById('tag-input-albumartist').value,
      genre: document.getElementById('tag-input-genre').value,
      year: document.getElementById('tag-input-year').value,
      track_number: parseInt(document.getElementById('tag-input-track').value) || 0,
      disc_number: parseInt(document.getElementById('tag-input-disc').value) || 0,
      bpm: parseInt(document.getElementById('tag-input-bpm').value) || '',
      composer: document.getElementById('tag-input-composer').value,
      comment: document.getElementById('tag-input-comment').value
    };

    if (this.artBase64) {
      data.art_base64 = this.artBase64;
    }
    if (this.removeArtFlag) {
      data.remove_art = true;
    }

    try {
      window.toast.show("Saving tags back to audio file...", "info");
      const res = await window.api.saveTags(this.trackId, data);
      
      if (res.status === 'ok') {
        window.toast.show("✓ Tags saved successfully!", "success");
        
        // Refresh local memory and views
        if (window.library) {
          await window.library.reload();
        }
        
        // If editing the currently playing song, update Now Playing info immediately
        if (window.player && window.player.currentTrack && window.player.currentTrack.id === this.trackId) {
          window.player.updateNowPlayingInfo(this.trackId);
        }

        this.closeEditor();
      }
    } catch (err) {
      window.toast.show(`Tag editing failed: ${err.message || err}`, "error");
    }
  }
}

window.tagger = new TagEditor();
