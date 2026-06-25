/**
 * PanelResizer - Drag-to-resize the right panel
 * Saves width to localStorage and optionally to poseidon_brain.settings
 */

const PanelResizer = {
  MIN_WIDTH: 200,
  MAX_WIDTH: 600,
  STORAGE_KEY: 'squidmind_right_panel_width',

  init() {
    const handle = document.getElementById('right-panel-resizer');
    if (!handle) {
      console.warn('[PanelResizer] No resize handle found');
      return;
    }

    // Restore saved width
    const saved = parseInt(localStorage.getItem(this.STORAGE_KEY), 10);
    if (saved && saved >= this.MIN_WIDTH && saved <= this.MAX_WIDTH) {
      this._setWidth(saved);
    }

    // Drag handlers
    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-panel-width'), 10) || 280;
      document.body.classList.add('is-resizing');
      handle.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      // Panel is on the right, so dragging left increases width
      const delta = startX - e.clientX;
      const newWidth = Math.min(this.MAX_WIDTH, Math.max(this.MIN_WIDTH, startWidth + delta));
      this._setWidth(newWidth);
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.classList.remove('is-resizing');
      handle.classList.remove('dragging');
      const finalWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-panel-width'), 10);
      this._persistWidth(finalWidth);
      // Trigger canvas resize so aquarium adapts
      if (window.aquarium && window.aquarium.resizeCanvas) {
        window.aquarium.resizeCanvas();
      }
    });

    console.log('[OK] PanelResizer initialized');
  },

  _setWidth(px) {
    document.documentElement.style.setProperty('--right-panel-width', px + 'px');
  },

  _persistWidth(px) {
    localStorage.setItem(this.STORAGE_KEY, String(px));
    // Also persist to backend brain.settings (async, no await needed)
    if (window.api) {
      window.api._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'BRAIN/poseidon_brain.json',
          fieldPath: 'settings.right_panel_width',
          newValue: px,
          reason: 'user resized panel'
        })
      }).catch(err => console.warn('[PanelResizer] backend save failed:', err.message));
    }
  }
};

// Initialize when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => PanelResizer.init());
} else {
  PanelResizer.init();
}

window.PanelResizer = PanelResizer;
