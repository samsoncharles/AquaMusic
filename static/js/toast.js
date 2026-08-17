// AquaMusic Toast Notification Manager
class ToastManager {
  constructor() {
    this.container = null;
  }

  init() {
    this.container = document.getElementById('toast-container');
  }

  /**
   * Shows a toast notification.
   * @param {string} message - Message body.
   * @param {'info'|'success'|'warning'|'error'} type - Semantic notification level.
   * @param {number} duration - Autos-dismiss time in ms.
   * @param {Object} action - Optional object with { text, callback }
   */
  show(message, type = 'info', duration = 3500, action = null) {
    if (!this.container) {
      this.init();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // If we have an action, we might need a longer duration or let the user click it
    if (action) duration = 5000;

    // Select Lucide icon
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    else if (type === 'error') iconName = 'alert-triangle';
    else if (type === 'warning') iconName = 'alert-circle';

    let actionHtml = '';
    if (action && action.text) {
      actionHtml = `<button class="toast-action-btn" style="
        margin-left: 12px;
        background: transparent;
        color: white;
        border: 1px solid rgba(255,255,255,0.4);
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 0.8rem;
        cursor: pointer;
        text-transform: uppercase;
        font-weight: 600;
      ">${action.text}</button>`;
    }

    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span style="flex: 1; word-break: break-word;">${message}</span>
      ${actionHtml}
      <div class="toast-progress" style="
        position: absolute;
        bottom: 0;
        left: 0;
        height: 2px;
        background-color: rgba(255, 255, 255, 0.4);
        width: 100%;
        transition: width ${duration}ms linear;
      "></div>
    `;

    this.container.appendChild(toast);

    if (action && action.callback) {
      const btn = toast.querySelector('.toast-action-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          action.callback();
          // Immediately dismiss the toast
          toast.style.opacity = '0';
          setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
          }, 300);
        });
      }
    }

    // Refresh Lucide icon on the new node
    if (window.lucide) {
      window.lucide.createIcons({
        nodeList: [toast.querySelector('i')]
      });
    }

    // Force reflow and slide-in
    toast.offsetHeight; 
    toast.classList.add('show');

    // Trigger timer progress bar shrink
    setTimeout(() => {
      const progress = toast.querySelector('.toast-progress');
      if (progress) {
        progress.style.width = '0%';
      }
    }, 50);

    // Auto-dismiss countdown
    const dismissTimer = setTimeout(() => {
      this.dismiss(toast);
    }, duration);

    // Dismiss on click
    toast.addEventListener('click', () => {
      clearTimeout(dismissTimer);
      this.dismiss(toast);
    });
  }

  dismiss(toast) {
    toast.classList.remove('show');
    // Wait for slide-out transition to finish before removal
    setTimeout(() => {
      if (this.container && toast.parentNode === this.container) {
        this.container.removeChild(toast);
      }
    }, 350);
  }
}

window.toast = new ToastManager();
window.showToast = (msg, type, dur) => window.toast.show(msg, type, dur);
