// AquaMusic Custom Dialog Manager (replaces native alert/confirm/prompt)
class DialogManager {
  constructor() {
    this.modal = document.getElementById('modal-dialog');
    this.overlay = document.getElementById('modal-overlay');
    this.titleEl = document.getElementById('dialog-title');
    this.messageEl = document.getElementById('dialog-message');
    this.inputContainer = document.getElementById('dialog-input-container');
    this.inputEl = document.getElementById('dialog-input');
    this.btnCancel = document.getElementById('dialog-btn-cancel');
    this.btnConfirm = document.getElementById('dialog-btn-confirm');
    
    this.resolvePromise = null;
    this.type = 'alert';
    
    if (this.btnCancel) {
      this.btnCancel.addEventListener('click', () => this._hide(false));
    }
    if (this.btnConfirm) {
      this.btnConfirm.addEventListener('click', () => {
        if (this.type === 'prompt') {
          this._hide(this.inputEl ? this.inputEl.value : '');
        } else {
          this._hide(true);
        }
      });
    }
    if (this.inputEl) {
      this.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.btnConfirm.click();
        if (e.key === 'Escape') this.btnCancel.click();
      });
    }
  }

  _show({ title, message, type = 'alert', confirmText = 'OK', cancelText = 'Cancel', defaultValue = '' }) {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.type = type;
      
      if (this.titleEl) this.titleEl.innerText = title;
      if (this.messageEl) this.messageEl.innerText = message;
      
      if (this.btnConfirm) this.btnConfirm.innerText = confirmText;
      if (this.btnCancel) {
        this.btnCancel.innerText = cancelText;
        this.btnCancel.style.display = type === 'alert' ? 'none' : 'block';
      }
      
      if (this.inputContainer && this.inputEl) {
        if (type === 'prompt') {
          this.inputContainer.style.display = 'block';
          this.inputEl.value = defaultValue;
        } else {
          this.inputContainer.style.display = 'none';
        }
      }

      // Hide all other modals first
      document.querySelectorAll('#modal-overlay .modal-container').forEach(m => {
        m.style.display = 'none';
      });

      if (this.overlay) this.overlay.classList.add('show');
      if (this.modal) this.modal.style.display = 'block';
      
      if (type === 'prompt' && this.inputEl) {
        setTimeout(() => this.inputEl.focus(), 100);
      }
    });
  }

  _hide(result) {
    if (this.overlay) this.overlay.classList.remove('show');
    if (this.modal) this.modal.style.display = 'none';
    if (this.resolvePromise) {
      this.resolvePromise(result);
      this.resolvePromise = null;
    }
  }

  alert(message, title = 'Alert') {
    return this._show({ title, message, type: 'alert' });
  }

  confirm(message, title = 'Confirm') {
    return this._show({ title, message, type: 'confirm', confirmText: 'Confirm' });
  }

  prompt(message, title = 'Input Required', defaultValue = '') {
    return this._show({ title, message, type: 'prompt', confirmText: 'Submit', defaultValue });
  }
}

window.dialog = new DialogManager();
